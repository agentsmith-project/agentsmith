import type http from 'node:http';
import Busboy from 'busboy';
import {
  CancelFileLibraryRestoreRequestSchema,
  CreateFileLibraryRestorePreviewRequestSchema,
  CreateFileLibrarySavePointRequestSchema,
  CreateFileLibraryRequestSchema,
  CreateFileLibraryFolderRequestSchema,
  CreateTaskFileTemplateRequestSchema,
  DeleteFileLibraryEntriesRequestSchema,
  FileLibraryDownloadQuerySchema,
  ListFileLibraryEntriesQuerySchema,
  MoveFileLibraryEntryRequestSchema,
  RunFileLibraryRestoreRequestSchema,
  UpdateFileLibraryRequestSchema,
} from '@mbos/contracts';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  buildAfscpTemplateId,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocFileLibraryRestorePreviewRepo,
  JsonDocFileLibrarySavePointMappingRepo,
  JsonDocProjectTaskFileTemplateRepo,
  generateFileLibraryRestoreRunId,
  generateTaskFileTemplateId,
  type FileLibrarySavePointPublicRecord,
} from './file-library-persistence.js';
import {
  createHttpOperationEnvelope,
  parseMultipartUploadAndExecute,
  pipeObjectDownloadToHttpResponse,
} from './object-stream-bridge.js';
import { buildAttachmentContentDisposition } from './http-utils.js';
import { guessFileLibraryContentType } from './file-library-content-type.js';
import {
  createAndProvisionProjectFileLibrary,
  mapFileLibraryInfraError,
} from './project-file-library-service.js';
import type {
  FileLibraryRecord,
} from './file-library-model.js';
import {
  FileLibraryStorageOperationPendingError,
} from './file-library-afscp-storage.js';
import {
  readProjectPermissionContext,
  readRequestId,
} from './project-route-handler-utils.js';
import { notebookTasksCollection } from './notebook-task/task-store.js';
import type { TaskRecord } from './notebook-task/task-models.js';
import {
  buildBoundTaskSafeFields,
  buildFileLibraryTaskHomeBindingFields,
  findTaskFileLibraryBinding,
  hydrateTaskFileLibraryBindingsForProject,
  type TaskFileLibraryBinding,
} from './notebook-task/task-file-library-bindings.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;
const TASK_FILE_TEMPLATE_USE_PERMISSION = 'project:agent_task:use';
const TASK_FILE_TEMPLATE_MANAGE_PERMISSION = 'project:files:update';

type ProjectFileLibraryRouteKind =
  | 'fileLibraries'
  | 'fileLibraryItem'
  | 'fileLibraryEntries'
  | 'fileLibraryFolders'
  | 'fileLibraryDelete'
  | 'fileLibraryMove'
  | 'fileLibraryUpload'
  | 'fileLibraryDownload'
  | 'fileLibraryMeta'
  | 'fileLibrarySavePoints'
  | 'fileLibraryRestorePreview'
  | 'fileLibraryRestoreRun'
  | 'fileLibraryRestoreCancel'
  | 'fileLibraryOperation'
  | 'taskFileTemplates'
  | 'taskFileTemplateItem'
  | 'taskFileTemplatePublish'
  | 'taskFileTemplateUnpublish';

function normalizeFileLibraryPath(input?: string | null): string {
  const value = (input ?? '').trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (!value) return '';
  const segments = value.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error('invalid_file_library_path');
    }
  }
  return segments.join('/');
}

function ensureDirectoryPath(input: string): string {
  const normalized = normalizeFileLibraryPath(input);
  if (!normalized) {
    throw new Error('invalid_file_library_directory_path');
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

async function hydrateFileLibraryTaskBindings(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
}): Promise<void> {
  const tasks = await args.deps.docStore.list<TaskRecord>(notebookTasksCollection(args.workspaceId), {
    workspace_id: args.workspaceId,
    project_id: args.projectId,
  });
  await hydrateTaskFileLibraryBindingsForProject({
    docStore: args.deps.docStore,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    tasks,
  });
}

function withTaskHomeBindingFields(input: {
  library: FileLibraryRecord;
  binding: TaskFileLibraryBinding | null;
  actorUserId: string;
}): FileLibraryRecord & ReturnType<typeof buildFileLibraryTaskHomeBindingFields> {
  return {
    ...input.library,
    ...buildFileLibraryTaskHomeBindingFields({
      binding: input.binding,
      actorUserId: input.actorUserId,
    }),
  };
}

function presentFileLibraryWithTaskHomeBinding(input: {
  library: FileLibraryRecord;
  binding: TaskFileLibraryBinding | null;
  actorUserId: string;
}): FileLibraryRecord & ReturnType<typeof buildFileLibraryTaskHomeBindingFields> {
  return withTaskHomeBindingFields(input);
}

function isDeletingFileLibraryStatus(status: FileLibraryRecord['status']): boolean {
  return status === 'deleting' || status === 'deleted';
}

function buildFileLibraryDeletingResponse(library: FileLibraryRecord): Record<string, unknown> {
  return {
    error_code: 'FILE_LIBRARY_DELETING',
    message: 'file_library_deleting',
    file_library_id: library.id,
    file_library_status: library.status,
  };
}

function buildFileLibraryNotReadyResponse(library: FileLibraryRecord): Record<string, unknown> {
  if (isDeletingFileLibraryStatus(library.status)) {
    return buildFileLibraryDeletingResponse(library);
  }
  return {
    error_code: 'FILE_LIBRARY_NOT_READY',
    message: 'file_library_not_ready',
    file_library_id: library.id,
    file_library_status: library.status,
  };
}

function isFileLibraryWriteRoute(routeKind: ProjectFileLibraryRouteKind, method: string): boolean {
  if (routeKind === 'fileLibraryItem' && method === 'PATCH') return true;
  if (routeKind === 'fileLibraryFolders' && method === 'POST') return true;
  if (routeKind === 'fileLibraryDelete' && method === 'POST') return true;
  if (routeKind === 'fileLibraryMove' && method === 'POST') return true;
  if (routeKind === 'fileLibraryUpload' && method === 'POST') return true;
  if (routeKind === 'fileLibrarySavePoints' && method === 'POST') return true;
  if (routeKind === 'fileLibraryRestorePreview' && method === 'POST') return true;
  if (routeKind === 'fileLibraryRestoreRun' && method === 'POST') return true;
  if (routeKind === 'fileLibraryRestoreCancel' && method === 'POST') return true;
  return false;
}

const PUBLIC_FILE_OPERATION_MESSAGES = new Set([
  'destination_exists',
  'file_library_backend_unavailable',
  'file_library_delete_failed',
  'file_library_destination_exists',
  'file_library_download_not_found',
  'file_library_folder_create_failed',
  'file_library_list_failed',
  'file_library_meta_not_found',
  'file_library_move_failed',
  'file_library_object_not_found',
  'file_library_project_storage_generation_mismatch',
  'file_library_project_storage_not_ready',
  'file_library_save_point_create_failed',
  'file_library_save_point_list_failed',
  'file_library_restore_preview_failed',
  'file_library_restore_preview_pending',
  'file_library_restore_run_failed',
  'file_library_restore_run_pending',
  'file_library_restore_discard_failed',
  'file_library_restore_discard_pending',
  'file_library_restore_preview_stale',
  'file_library_active_writer_blocked',
  'file_library_namespace_project_mismatch',
  'file_library_template_clone_not_allowed',
  'file_library_capability_denied',
  'file_library_storage_admin_action_required',
  'file_library_template_create_failed',
  'file_library_template_create_pending',
  'file_library_template_clone_failed',
  'file_library_template_clone_pending',
  'file_library_upload_failed',
  'invalid_file_library_directory_path',
  'invalid_file_library_path',
]);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function readOptionalRequestId(req: http.IncomingMessage): string | undefined {
  return req.headers ? readRequestId(req) : undefined;
}

function publicFileOperationMessage(error: unknown, fallback: string): string {
  const message = readErrorMessage(error);
  if (PUBLIC_FILE_OPERATION_MESSAGES.has(message)) {
    return message;
  }
  for (const publicMessage of PUBLIC_FILE_OPERATION_MESSAGES) {
    if (message.startsWith(`${publicMessage} `)) {
      return publicMessage;
    }
  }
  return fallback;
}

function mapDeleteRepoRouteError(error: unknown): {
  statusCode: number;
  errorCode: string;
  message: string;
} {
  if (isDeleteRepoPendingContractFailure(error)) {
    return {
      statusCode: 502,
      errorCode: 'FILE_LIBRARY_DELETE_FAILED',
      message: 'file_library_operation_failed',
    };
  }
  const message = readErrorMessage(error);
  if (message === 'file_library_repo_delete_pending') {
    return {
      statusCode: 409,
      errorCode: 'FILE_LIBRARY_OPERATION_PENDING',
      message,
    };
  }
  if (message === 'file_library_repo_delete_failed') {
    return {
      statusCode: 502,
      errorCode: 'FILE_LIBRARY_DELETE_FAILED',
      message: 'file_library_operation_failed',
    };
  }
  const mapped = mapFileLibraryInfraError(error);
  return {
    statusCode: mapped.statusCode,
    errorCode: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
      ? 'FILE_LIBRARY_DELETE_FAILED'
      : mapped.errorCode,
    message: mapped.message,
  };
}

function isDeleteRepoPendingError(error: unknown): boolean {
  return error instanceof FileLibraryStorageOperationPendingError
    && readDeleteRepoPendingOperationId(error) !== null;
}

function isDeleteRepoPendingContractFailure(error: unknown): boolean {
  return error instanceof FileLibraryStorageOperationPendingError
    && readDeleteRepoPendingOperationId(error) === null;
}

function readDeleteRepoPendingOperationId(error: unknown): string | null {
  if (!(error instanceof FileLibraryStorageOperationPendingError)) {
    return null;
  }
  return typeof error.operationId === 'string' && error.operationId.trim().length > 0
    ? error.operationId
    : null;
}

function buildFileLibraryDeleteAcceptedResponse(input: {
  libraryId: string;
  operationId: string;
}): Record<string, unknown> {
  return {
    file_library_id: input.libraryId,
    file_library_status: 'deleting',
    operation_id: input.operationId,
    operation_status: 'pending',
  };
}

function mapFileLibraryControlRouteError(error: unknown, fallbackErrorCode: string, fallbackMessage: string): {
  statusCode: number;
  errorCode: string;
  message: string;
} {
  const message = publicFileOperationMessage(error, fallbackMessage);
  if (message.endsWith('_pending')) {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_OPERATION_PENDING', message };
  }
  if (message === 'file_library_restore_preview_stale') {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_RESTORE_PREVIEW_STALE', message };
  }
  if (message === 'file_library_active_writer_blocked') {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED', message };
  }
  if (message === 'file_library_namespace_project_mismatch') {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_NAMESPACE_PROJECT_MISMATCH', message };
  }
  if (message === 'file_library_template_clone_not_allowed') {
    return { statusCode: 403, errorCode: 'FILE_LIBRARY_TEMPLATE_CLONE_NOT_ALLOWED', message };
  }
  if (message === 'file_library_capability_denied') {
    return { statusCode: 403, errorCode: 'FILE_LIBRARY_CAPABILITY_DENIED', message };
  }
  if (message === 'file_library_storage_admin_action_required') {
    return { statusCode: 503, errorCode: 'FILE_LIBRARY_STORAGE_ADMIN_ACTION_REQUIRED', message };
  }
  if (message === 'file_library_backend_unavailable') {
    return { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message };
  }
  if (
    message === 'file_library_afscp_mapping_not_found'
    || message === 'file_library_afscp_mapping_not_ready'
    || message === 'file_library_project_storage_not_ready'
    || message === 'file_library_project_storage_generation_mismatch'
  ) {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_STORAGE_NOT_READY', message };
  }
  return { statusCode: 502, errorCode: fallbackErrorCode, message };
}

function operationStatusToRestorePreviewStatus(status: 'pending' | 'succeeded' | 'failed') {
  if (status === 'succeeded') return 'ready' as const;
  if (status === 'failed') return 'failed' as const;
  return 'previewing' as const;
}

export async function handleProjectFileLibraryRoutes(args: {
  routeKind: ProjectFileLibraryRouteKind;
  method: string;
  workspaceId: string;
  projectId: string;
  libraryId?: string;
  operationId?: string;
  taskFileTemplateId?: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const {
    routeKind,
    method,
    workspaceId,
    projectId,
    libraryId,
    operationId,
    taskFileTemplateId,
    deps,
    user,
    req,
    res,
    json,
    readBody,
  } = args;
  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(deps.docStore);

  if (routeKind === 'fileLibraryOperation' && method === 'GET') {
    if (!operationId) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'not_found' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    try {
      const projection = await deps.fileLibraryStorageAdapter.getOperationProjection({
        workspaceId,
        projectId,
        operationId,
        requestId: readRequestId(req) ?? undefined,
      });
      json(res, 200, projection);
    } catch (error) {
      const message = readErrorMessage(error);
      if (message === 'file_library_operation_not_found') {
        json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'not_found' });
        return true;
      }
      json(res, 502, {
        error_code: 'FILE_LIBRARY_OPERATION_PROJECTION_FAILED',
        message: 'file_library_operation_projection_failed',
      });
    }
    return true;
  }

  if (routeKind === 'fileLibraries' && method === 'GET') {
    await hydrateFileLibraryTaskBindings({ deps, workspaceId, projectId });
    const libraries = await catalogRepo.listByProject(workspaceId, projectId);
    const items = await Promise.all(libraries.map(async (item) => presentFileLibraryWithTaskHomeBinding({
      library: item,
      binding: await findTaskFileLibraryBinding({
        docStore: deps.docStore,
        workspaceId,
        projectId,
        fileLibraryId: item.id,
      }),
      actorUserId: user.id,
    })));
    json(res, 200, {
      items,
    });
    return true;
  }

  if (routeKind === 'fileLibraries' && method === 'POST') {
    const parsed = CreateFileLibraryRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_create_request' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    try {
      const updated = await createAndProvisionProjectFileLibrary({
        deps,
        workspaceId,
        projectId,
        userId: user.id,
        name: parsed.data.name,
        description: parsed.data.description,
        requestId: readOptionalRequestId(req),
      });
      json(res, 201, presentFileLibraryWithTaskHomeBinding({
        library: updated,
        binding: null,
        actorUserId: user.id,
      }));
    } catch (error) {
      const mapped = mapFileLibraryInfraError(error);
      json(res, mapped.statusCode, {
        error_code: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
          ? 'FILE_LIBRARY_PROVISIONING_FAILED'
          : mapped.errorCode,
        message: mapped.message,
      });
    }
    return true;
  }

  if (routeKind === 'taskFileTemplates' && method === 'GET') {
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const permissionContext = await readProjectPermissionContext({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    const permissions = new Set(permissionContext?.permissions ?? []);
    const canManageTemplates = permissions.has(TASK_FILE_TEMPLATE_MANAGE_PERMISSION);
    const canUseTemplates = permissions.has(TASK_FILE_TEMPLATE_USE_PERMISSION);
    if (!canManageTemplates && !canUseTemplates) {
      json(res, 403, {
        error_code: 'FORBIDDEN',
        message: 'forbidden',
        missing_permissions: [TASK_FILE_TEMPLATE_USE_PERMISSION, TASK_FILE_TEMPLATE_MANAGE_PERMISSION],
      });
      return true;
    }
    const templates = await templateRepo.listByProject(workspaceId, projectId);
    const visibleTemplates = canManageTemplates
      ? templates
      : templates.filter((template) => template.status === 'published');
    json(res, 200, {
      items: visibleTemplates.map((template) => templateRepo.toPublic(template)),
    });
    return true;
  }

  if (routeKind === 'taskFileTemplates' && method === 'POST') {
    const parsed = CreateTaskFileTemplateRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_task_file_template_create_request' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const sourceLibrary = await catalogRepo.getById(workspaceId, projectId, parsed.data.source_library_id);
    if (!sourceLibrary) {
      json(res, 404, { error_code: 'FILE_LIBRARY_NOT_FOUND', message: 'file_library_not_found' });
      return true;
    }
    if (sourceLibrary.status !== 'ready') {
      json(res, 409, buildFileLibraryNotReadyResponse(sourceLibrary));
      return true;
    }
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(deps.docStore);
    const templateId = generateTaskFileTemplateId();
    const afscpTemplateId = buildAfscpTemplateId(templateId);
    try {
      const result = await deps.fileLibraryStorageAdapter.createTemplateFromLibrary({
        workspaceId,
        projectId,
        libraryId: sourceLibrary.id,
        templateId: afscpTemplateId,
        actorUserId: user.id,
        requestId: typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      });
      const sourceSavePoint = result.sourceSavePointId
        ? await savePointRepo.upsertFromAfscp({
            workspaceId,
            projectId,
            libraryId: sourceLibrary.id,
            afscpSavePointId: result.sourceSavePointId,
            message: `Template source: ${parsed.data.name}`,
            purpose: 'task_template_source',
          })
        : null;
      const template = await templateRepo.create({
        id: templateId,
        workspaceId,
        projectId,
        name: parsed.data.name,
        description: parsed.data.description,
        sourceLibraryId: sourceLibrary.id,
        sourceSavePointId: sourceSavePoint?.id,
        sourceAfscpSavePointId: result.sourceSavePointId ?? undefined,
        createdByUserId: user.id,
        afscpTemplateId: result.templateId,
        afscpCreateOperationId: result.operationId ?? undefined,
      });
      json(res, 201, templateRepo.toPublic(template));
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'TASK_FILE_TEMPLATE_CREATE_FAILED',
        'file_library_template_create_failed',
      );
      json(res, mapped.statusCode, { error_code: mapped.errorCode, message: mapped.message });
    }
    return true;
  }

  if (routeKind === 'taskFileTemplatePublish' && method === 'POST') {
    if (!taskFileTemplateId) return false;
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const updated = await templateRepo.updateStatus({
      workspaceId,
      projectId,
      taskFileTemplateId,
      status: 'published',
    });
    if (!updated) {
      json(res, 404, { error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND', message: 'task_file_template_not_found' });
      return true;
    }
    json(res, 200, templateRepo.toPublic(updated));
    return true;
  }

  if (routeKind === 'taskFileTemplateUnpublish' && method === 'POST') {
    if (!taskFileTemplateId) return false;
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const updated = await templateRepo.updateStatus({
      workspaceId,
      projectId,
      taskFileTemplateId,
      status: 'unpublished',
    });
    if (!updated) {
      json(res, 404, { error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND', message: 'task_file_template_not_found' });
      return true;
    }
    json(res, 200, templateRepo.toPublic(updated));
    return true;
  }

  if (routeKind === 'taskFileTemplateItem' && method === 'DELETE') {
    if (!taskFileTemplateId) return false;
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const deleted = await templateRepo.delete(workspaceId, projectId, taskFileTemplateId);
    if (!deleted) {
      json(res, 404, { error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND', message: 'task_file_template_not_found' });
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (!libraryId) {
    return false;
  }

  const library = await catalogRepo.getById(workspaceId, projectId, libraryId);
  if (!library) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' });
    return true;
  }
  if (
    isFileLibraryWriteRoute(routeKind, method)
    && library.status !== 'ready'
  ) {
    json(res, 409, buildFileLibraryNotReadyResponse(library));
    return true;
  }

  if (routeKind === 'fileLibraryItem' && method === 'GET') {
    await hydrateFileLibraryTaskBindings({ deps, workspaceId, projectId });
    json(res, 200, presentFileLibraryWithTaskHomeBinding({
      library,
      binding: await findTaskFileLibraryBinding({
        docStore: deps.docStore,
        workspaceId,
        projectId,
        fileLibraryId: libraryId,
      }),
      actorUserId: user.id,
    }));
    return true;
  }

  if (routeKind === 'fileLibraryItem' && method === 'PATCH') {
    const parsed = UpdateFileLibraryRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_update_request' });
      return true;
    }
    const updated = await catalogRepo.update(workspaceId, projectId, libraryId, parsed.data);
    if (!updated) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' });
      return true;
    }
    await hydrateFileLibraryTaskBindings({ deps, workspaceId, projectId });
    json(res, 200, presentFileLibraryWithTaskHomeBinding({
      library: updated,
      binding: await findTaskFileLibraryBinding({
        docStore: deps.docStore,
        workspaceId,
        projectId,
        fileLibraryId: libraryId,
      }),
      actorUserId: user.id,
    }));
    return true;
  }

  if (routeKind === 'fileLibraryItem' && method === 'DELETE') {
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const requestId = typeof req.headers?.['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : `delete_${libraryId}_${Date.now()}`;
    if (library.status === 'deleted') {
      json(res, 409, buildFileLibraryDeletingResponse(library));
      return true;
    }
    await hydrateFileLibraryTaskBindings({ deps, workspaceId, projectId });
    const taskUsingLibrary = await findTaskFileLibraryBinding({
      docStore: deps.docStore,
      workspaceId,
      projectId,
      fileLibraryId: libraryId,
    });
    if (taskUsingLibrary) {
      const boundTaskFields = buildBoundTaskSafeFields({
        binding: taskUsingLibrary,
        actorUserId: user.id,
      });
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: 'project.file_library.delete.blocked',
        result: 'error',
        requestId: typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
        resourceType: 'project_file_library',
        resourceId: libraryId,
        errorCode: 'FILE_LIBRARY_TASK_IN_USE',
        errorMessage: 'file_library_task_in_use',
        metadata: {
          file_library_id: libraryId,
          ...boundTaskFields,
        },
      });
      json(res, 409, {
        error_code: 'FILE_LIBRARY_TASK_IN_USE',
        message: 'file_library_task_in_use',
        file_library_id: libraryId,
        ...boundTaskFields,
      });
      return true;
    }
    const isFailedLibraryCleanup = library.status === 'failed';
    const isRepairingDeletingLibrary = library.status === 'deleting';
    if (!isFailedLibraryCleanup && !isRepairingDeletingLibrary && library.status !== 'ready') {
      json(res, 409, {
        error_code: 'FILE_LIBRARY_NOT_READY',
        message: 'file_library_not_ready',
        file_library_id: libraryId,
        file_library_status: library.status,
      });
      return true;
    }
    const transition = isFailedLibraryCleanup
      || isRepairingDeletingLibrary
      ? null
      : await catalogRepo.transitionReadyToDeleting({
          workspaceId,
          projectId,
          libraryId,
          expectedVersion: library.version,
          correlationId: requestId,
        });
    if (transition && !transition.ok) {
      json(res, transition.code === 'FILE_LIBRARY_NOT_FOUND' ? 404 : 409, {
        error_code: transition.code,
        message: transition.code === 'FILE_LIBRARY_DELETING'
          ? 'file_library_deleting'
          : transition.code === 'FILE_LIBRARY_NOT_READY'
            ? 'file_library_not_ready'
            : 'file_library_not_found',
        file_library_id: libraryId,
        ...(transition.library ? { file_library_status: transition.library.status } : {}),
      });
      return true;
    }
    const deletingLibrary = transition?.library ?? library;
    const bindingAfterTransition = await findTaskFileLibraryBinding({
      docStore: deps.docStore,
      workspaceId,
      projectId,
      fileLibraryId: libraryId,
    });
    if (!isFailedLibraryCleanup && bindingAfterTransition) {
      const boundTaskFields = buildBoundTaskSafeFields({
        binding: bindingAfterTransition,
        actorUserId: user.id,
      });
      if (!isRepairingDeletingLibrary) {
        await catalogRepo.rollbackDeletingToReady({
          workspaceId,
          projectId,
          libraryId,
          expectedVersion: deletingLibrary.version,
          correlationId: requestId,
        });
      }
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: 'project.file_library.delete.blocked',
        result: 'error',
        requestId,
        resourceType: 'project_file_library',
        resourceId: libraryId,
        errorCode: 'FILE_LIBRARY_TASK_IN_USE',
        errorMessage: 'file_library_task_in_use',
        metadata: {
          file_library_id: libraryId,
          ...boundTaskFields,
        },
      });
      json(res, 409, {
        error_code: 'FILE_LIBRARY_TASK_IN_USE',
        message: 'file_library_task_in_use',
        file_library_id: libraryId,
        ...boundTaskFields,
      });
      return true;
    }
    try {
      if (!isFailedLibraryCleanup) {
        await deps.fileLibraryStorageAdapter.assertEmpty({
          workspaceId,
          projectId,
          libraryId,
        });
      }
      await deps.fileLibraryStorageAdapter.deleteRepoForLibrary({
        workspaceId,
        projectId,
        libraryId,
        actorUserId: user.id,
        requestId,
        reason: 'file_library_delete',
      });
      await (deps.internalAgentWorkspaceBindingManager ?? deps.internalAgentWorkspaceProvisioner)?.deleteWorkspaceBinding({
        workspaceId,
        fileLibraryId: libraryId,
      });
      await catalogRepo.delete(workspaceId, projectId, libraryId);
      res.statusCode = 204;
      res.end();
    } catch (error) {
      if (isDeleteRepoPendingError(error)) {
        const operationId = readDeleteRepoPendingOperationId(error);
        if (!operationId) {
          throw new Error('unreachable_delete_pending_operation_id_missing');
        }
        await catalogRepo.update(workspaceId, projectId, libraryId, {
          status: 'deleting',
          delete_correlation_id: requestId,
        });
        json(res, 202, buildFileLibraryDeleteAcceptedResponse({
          libraryId,
          operationId,
        }));
        return true;
      }
      const mapped = mapDeleteRepoRouteError(error);
      if (mapped.errorCode === 'FILE_LIBRARY_NOT_EMPTY') {
        await catalogRepo.rollbackDeletingToReady({
          workspaceId,
          projectId,
          libraryId,
          expectedVersion: deletingLibrary.version,
          correlationId: requestId,
        });
        await writeProjectAuditEvent(deps, {
          workspaceId,
          projectId,
          actor: { type: 'user', id: user.id },
          action: 'project.file_library.delete.rollback',
          result: 'ok',
          requestId,
          resourceType: 'project_file_library',
          resourceId: libraryId,
          metadata: {
            file_library_id: libraryId,
            from_status: 'deleting',
            to_status: 'ready',
            reason: 'not_empty_or_compensation',
          },
        });
      } else if (!isFailedLibraryCleanup) {
        await catalogRepo.update(workspaceId, projectId, libraryId, {
          status: 'degraded',
          delete_correlation_id: requestId,
        });
      }
      json(res, mapped.statusCode, {
        error_code: mapped.errorCode,
        message: mapped.message,
        ...(mapped.errorCode === 'FILE_LIBRARY_NOT_EMPTY' ? { file_library_id: libraryId } : {}),
      });
    }
    return true;
  }

  if (routeKind === 'fileLibrarySavePoints' && method === 'GET') {
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(deps.docStore);
    try {
      const rawSavePoints = await deps.fileLibraryStorageAdapter.listSavePoints({
        workspaceId,
        projectId,
        libraryId,
        requestId: typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      });
      const items: FileLibrarySavePointPublicRecord[] = [];
      for (const rawSavePoint of rawSavePoints) {
        const mapped = await savePointRepo.upsertFromAfscp({
          workspaceId,
          projectId,
          libraryId,
          afscpSavePointId: rawSavePoint.savePointId,
          message: rawSavePoint.message,
          createdAt: rawSavePoint.createdAt,
        });
        if (mapped.purpose !== 'task_template_source') {
          items.push(savePointRepo.toPublic(mapped));
        }
      }
      json(res, 200, { items });
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_SAVE_POINT_LIST_FAILED',
        'file_library_save_point_list_failed',
      );
      json(res, mapped.statusCode, { error_code: mapped.errorCode, message: mapped.message });
    }
    return true;
  }

  if (routeKind === 'fileLibrarySavePoints' && method === 'POST') {
    const parsed = CreateFileLibrarySavePointRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_save_point_request' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(deps.docStore);
    try {
      const message = parsed.data.message ?? 'Manual save point';
      const result = await deps.fileLibraryStorageAdapter.createSavePoint({
        workspaceId,
        projectId,
        libraryId,
        message,
        actorUserId: user.id,
        requestId: typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      });
      if (!result.savePointId) {
        json(res, 502, {
          error_code: 'FILE_LIBRARY_SAVE_POINT_CREATE_FAILED',
          message: 'file_library_save_point_create_failed',
        });
        return true;
      }
      const savePoint = await savePointRepo.upsertFromAfscp({
        workspaceId,
        projectId,
        libraryId,
        afscpSavePointId: result.savePointId,
        message,
        createdAt: result.createdAt,
        purpose: 'user',
      });
      json(res, 201, savePointRepo.toPublic(savePoint));
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_SAVE_POINT_CREATE_FAILED',
        'file_library_save_point_create_failed',
      );
      json(res, mapped.statusCode, { error_code: mapped.errorCode, message: mapped.message });
    }
    return true;
  }

  if (routeKind === 'fileLibraryRestorePreview' && method === 'POST') {
    const parsed = CreateFileLibraryRestorePreviewRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_restore_preview_request' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(deps.docStore);
    const restoreRepo = new JsonDocFileLibraryRestorePreviewRepo(deps.docStore);
    const savePoint = await savePointRepo.getById(workspaceId, projectId, libraryId, parsed.data.save_point_id);
    if (!savePoint) {
      json(res, 404, {
        error_code: 'FILE_LIBRARY_SAVE_POINT_NOT_FOUND',
        message: 'file_library_save_point_not_found',
      });
      return true;
    }
    try {
      const result = await deps.fileLibraryStorageAdapter.createRestorePreview({
        workspaceId,
        projectId,
        libraryId,
        savePointId: savePoint.afscp_save_point_id,
        actorUserId: user.id,
        requestId: typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      });
      if (!result.operationId) {
        json(res, 502, {
          error_code: 'FILE_LIBRARY_RESTORE_PREVIEW_FAILED',
          message: 'file_library_restore_preview_failed',
        });
        return true;
      }
      const preview = await restoreRepo.create({
        workspaceId,
        projectId,
        libraryId,
        afscpPreviewOperationId: result.operationId,
        sourceSavePointId: savePoint.id,
        sourceAfscpSavePointId: savePoint.afscp_save_point_id,
        status: operationStatusToRestorePreviewStatus(result.operationStatus),
        restorePlanId: result.restorePlanId ?? undefined,
        summary: result.summary,
        blockers: result.blockers,
        stale: result.stale,
      });
      json(res, 201, restoreRepo.toPublic(preview));
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_RESTORE_PREVIEW_FAILED',
        'file_library_restore_preview_failed',
      );
      json(res, mapped.statusCode, { error_code: mapped.errorCode, message: mapped.message });
    }
    return true;
  }

  if (routeKind === 'fileLibraryRestoreRun' && method === 'POST') {
    const parsed = RunFileLibraryRestoreRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_restore_run_request' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const restoreRepo = new JsonDocFileLibraryRestorePreviewRepo(deps.docStore);
    const preview = await restoreRepo.getById(workspaceId, projectId, libraryId, parsed.data.restore_preview_id);
    if (!preview) {
      json(res, 404, {
        error_code: 'FILE_LIBRARY_RESTORE_PREVIEW_NOT_FOUND',
        message: 'file_library_restore_preview_not_found',
      });
      return true;
    }
    try {
      const result = await deps.fileLibraryStorageAdapter.runRestorePreview({
        workspaceId,
        projectId,
        libraryId,
        previewOperationId: preview.afscp_preview_operation_id,
        actorUserId: user.id,
        requestId: typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      });
      await restoreRepo.updateStatus({
        workspaceId,
        projectId,
        libraryId,
        restorePreviewId: preview.id,
        status: result.operationStatus === 'succeeded' ? 'restored' : 'restoring',
        restorePlanId: result.restorePlanId ?? undefined,
        summary: result.summary,
        blockers: result.blockers,
        stale: result.stale,
      });
      const now = new Date().toISOString();
      json(res, 200, {
        id: generateFileLibraryRestoreRunId(),
        file_library_id: libraryId,
        restore_preview_id: preview.id,
        status: result.operationStatus,
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_RESTORE_RUN_FAILED',
        'file_library_restore_run_failed',
      );
      json(res, mapped.statusCode, { error_code: mapped.errorCode, message: mapped.message });
    }
    return true;
  }

  if (routeKind === 'fileLibraryRestoreCancel' && method === 'POST') {
    const parsed = CancelFileLibraryRestoreRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_restore_cancel_request' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const restoreRepo = new JsonDocFileLibraryRestorePreviewRepo(deps.docStore);
    const preview = await restoreRepo.getById(workspaceId, projectId, libraryId, parsed.data.restore_preview_id);
    if (!preview) {
      json(res, 404, {
        error_code: 'FILE_LIBRARY_RESTORE_PREVIEW_NOT_FOUND',
        message: 'file_library_restore_preview_not_found',
      });
      return true;
    }
    try {
      const result = await deps.fileLibraryStorageAdapter.discardRestorePreview({
        workspaceId,
        projectId,
        libraryId,
        previewOperationId: preview.afscp_preview_operation_id,
        actorUserId: user.id,
        requestId: typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      });
      const updated = await restoreRepo.updateStatus({
        workspaceId,
        projectId,
        libraryId,
        restorePreviewId: preview.id,
        status: result.operationStatus === 'succeeded' ? 'canceled' : 'canceling',
        restorePlanId: result.restorePlanId ?? undefined,
      });
      json(res, 200, restoreRepo.toPublic(updated ?? preview));
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_RESTORE_CANCEL_FAILED',
        'file_library_restore_discard_failed',
      );
      json(res, mapped.statusCode, { error_code: mapped.errorCode, message: mapped.message });
    }
    return true;
  }

  if (routeKind === 'fileLibraryEntries' && method === 'GET') {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const parsed = ListFileLibraryEntriesQuerySchema.safeParse(Object.fromEntries(parsedUrl.searchParams.entries()));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_entries_query' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    try {
      const listed = await deps.fileLibraryStorageAdapter.listEntries({
        workspaceId,
        projectId,
        libraryId,
        path: parsed.data.path ? ensureDirectoryPath(parsed.data.path) : '',
        pageSize: parsed.data.page_size ?? 200,
        continuationToken: parsed.data.continuation_token,
        search: parsed.data.search,
        sortBy: parsed.data.sort_by ?? 'name',
        sortOrder: parsed.data.sort_order ?? 'asc',
      });
      json(res, 200, {
        path: listed.path,
        items: listed.items,
        next_continuation_token: listed.nextContinuationToken,
      });
    } catch (error) {
      json(res, 502, {
        error_code: 'FILE_LIBRARY_LIST_FAILED',
        message: publicFileOperationMessage(error, 'file_library_list_failed'),
      });
    }
    return true;
  }

  if (routeKind === 'fileLibraryFolders' && method === 'POST') {
    const operation = createHttpOperationEnvelope({ req, res });
    try {
      const parsed = CreateFileLibraryFolderRequestSchema.safeParse(await readBody(req));
      operation.markRequestBodyConsumed();
      if (!parsed.success) {
        json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_folder_request' });
        return true;
      }
      const folderPath = ensureDirectoryPath(parsed.data.path);
      if (!deps.fileLibraryStorageAdapter?.enabled) {
        json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
        return true;
      }
      await deps.fileLibraryStorageAdapter.createFolder({
        workspaceId,
        projectId,
        libraryId,
        folderPath,
        actorUserId: user.id,
        signal: operation.signal,
      });
      if (operation.signal.aborted) {
        return true;
      }
      res.statusCode = 204;
      res.end();
      return true;
    } catch (error) {
      if (operation.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return true;
      }
      json(res, 400, {
        error_code: 'FILE_LIBRARY_FOLDER_CREATE_FAILED',
        message: publicFileOperationMessage(error, 'file_library_folder_create_failed'),
      });
      return true;
    } finally {
      operation.cleanup();
    }
  }

  if (routeKind === 'fileLibraryDelete' && method === 'POST') {
    const parsed = DeleteFileLibraryEntriesRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_delete_request' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    try {
      const results = await deps.fileLibraryStorageAdapter.deletePaths({
        workspaceId,
        projectId,
        libraryId,
        paths: parsed.data.paths,
        actorUserId: user.id,
      });
      json(res, 200, { results });
    } catch (error) {
      json(res, 502, {
        error_code: 'FILE_LIBRARY_DELETE_FAILED',
        message: publicFileOperationMessage(error, 'file_library_delete_failed'),
      });
    }
    return true;
  }

  if (routeKind === 'fileLibraryMove' && method === 'POST') {
    const operation = createHttpOperationEnvelope({ req, res });
    try {
      const parsed = MoveFileLibraryEntryRequestSchema.safeParse(await readBody(req));
      operation.markRequestBodyConsumed();
      if (!parsed.success) {
        json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_move_request' });
        return true;
      }
      if (!deps.fileLibraryStorageAdapter?.enabled) {
        json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
        return true;
      }
      await deps.fileLibraryStorageAdapter.moveEntry({
        workspaceId,
        projectId,
        libraryId,
        fromPath: parsed.data.from_path,
        toPath: parsed.data.to_path,
        overwrite: parsed.data.overwrite ?? false,
        actorUserId: user.id,
        signal: operation.signal,
      });
      if (operation.signal.aborted) {
        return true;
      }
      res.statusCode = 204;
      res.end();
      return true;
    } catch (error) {
      if (operation?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return true;
      }
      const message = publicFileOperationMessage(error, 'file_library_move_failed');
      json(res, message === 'file_library_destination_exists' ? 409 : 400, {
        error_code: message === 'file_library_destination_exists' ? 'destination_exists' : 'FILE_LIBRARY_MOVE_FAILED',
        message: message === 'file_library_destination_exists' ? 'destination_exists' : message,
      });
      return true;
    } finally {
      operation.cleanup();
    }
  }

  if (routeKind === 'fileLibraryUpload' && method === 'POST') {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      json(res, 415, {
        error_code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'file_library_upload_requires_multipart_form_data',
      });
      return true;
    }

    const operation = createHttpOperationEnvelope({ req, res });
    try {
      const storageAdapter = deps.fileLibraryStorageAdapter;
      if (!storageAdapter?.enabled) {
        json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
        return true;
      }
      const uploaded = await parseMultipartUploadAndExecute(
        req,
        async ({ fileName, fileStream, contentType: uploadedContentType, prefix, overwrite, signal }) => {
          const normalizedPrefix = prefix ? ensureDirectoryPath(prefix) : '';
          const objectPath = normalizeFileLibraryPath(`${normalizedPrefix}${fileName}`);
          return storageAdapter.uploadObject({
            workspaceId,
            projectId,
            libraryId,
            actorUserId: user.id,
            objectPath,
            body: fileStream,
            contentType: uploadedContentType || guessFileLibraryContentType(objectPath) || 'application/octet-stream',
            overwrite: overwrite ?? false,
            signal,
          });
        },
        (headers) =>
          Busboy({
            headers,
            defParamCharset: 'utf8',
            limits: { fileSize: 1024 * 1024 * 1024 },
          }),
        {
          signal: operation.signal,
        },
      );
      if (operation.signal.aborted) {
        return true;
      }
      json(res, 201, uploaded);
    } catch (error) {
      if (operation.signal.aborted) {
        return true;
      }
      const message = publicFileOperationMessage(error, 'file_library_upload_failed');
      const isDestinationConflict = message === 'file_library_destination_exists';
      json(res, isDestinationConflict ? 409 : 400, {
        error_code: isDestinationConflict ? 'destination_exists' : 'FILE_LIBRARY_UPLOAD_FAILED',
        message: isDestinationConflict ? 'destination_exists' : 'file_library_upload_failed',
      });
    } finally {
      operation.cleanup();
    }
    return true;
  }

  if (routeKind === 'fileLibraryDownload' && method === 'GET') {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const parsed = FileLibraryDownloadQuerySchema.safeParse(Object.fromEntries(parsedUrl.searchParams.entries()));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_download_query' });
      return true;
    }
    const operation = createHttpOperationEnvelope({ req, res });
    try {
      const objectPath = normalizeFileLibraryPath(parsed.data.path);
      if (!deps.fileLibraryStorageAdapter?.enabled) {
        json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
        return true;
      }
      const { meta, download } = await deps.fileLibraryStorageAdapter.downloadObject({
        workspaceId,
        projectId,
        libraryId,
        objectPath,
        signal: operation.signal,
      });
      if (operation.signal.aborted) {
        await download.cancel(operation.signal.reason);
        return true;
      }
      const fileName = objectPath.split('/').at(-1) || 'download.bin';
      res.statusCode = 200;
      res.setHeader('Content-Type', meta.content_type);
      res.setHeader('Content-Length', String(meta.size_bytes));
      res.setHeader('Content-Disposition', buildAttachmentContentDisposition(fileName));
      pipeObjectDownloadToHttpResponse({
        req,
        res,
        download,
        streamErrorMessage: 'file_library_download_stream_failed',
      });
    } catch (error) {
      if (operation.signal.aborted) {
        return true;
      }
      json(res, 404, {
        error_code: 'RESOURCE_NOT_FOUND',
        message: publicFileOperationMessage(error, 'file_library_download_not_found') === 'file_library_object_not_found'
          ? 'file_library_object_not_found'
          : 'file_library_download_not_found',
      });
    } finally {
      operation.cleanup();
    }
    return true;
  }

  if (routeKind === 'fileLibraryMeta' && method === 'GET') {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const path = parsedUrl.searchParams.get('path') ?? parsedUrl.searchParams.get('key') ?? '';
    if (!path.trim()) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_meta_query' });
      return true;
    }
    let operation: ReturnType<typeof createHttpOperationEnvelope> | null = null;
    try {
      operation = createHttpOperationEnvelope({ req, res });
      const objectPath = normalizeFileLibraryPath(path);
      if (!deps.fileLibraryStorageAdapter?.enabled) {
        json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
        return true;
      }
      const meta = await deps.fileLibraryStorageAdapter.getObjectMeta({
        workspaceId,
        projectId,
        libraryId,
        objectPath,
        signal: operation.signal,
      });
      if (operation.signal.aborted) {
        return true;
      }
      json(res, 200, meta);
    } catch (error) {
      if (operation?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return true;
      }
      json(res, 404, {
        error_code: 'RESOURCE_NOT_FOUND',
        message: publicFileOperationMessage(error, 'file_library_meta_not_found') === 'file_library_object_not_found'
          ? 'file_library_object_not_found'
          : 'file_library_meta_not_found',
      });
    } finally {
      operation?.cleanup();
    }
    return true;
  }

  return false;
}
