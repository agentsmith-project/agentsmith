import type http from 'node:http';
import Busboy from 'busboy';
import {
  CreateFileLibraryRestoreRequestSchema,
  CreateFileLibrarySavePointRequestSchema,
  CreateFileLibraryRequestSchema,
  CreateFileLibraryFolderRequestSchema,
  CreateTaskFileTemplateRequestSchema,
  DeleteFileLibraryEntriesRequestSchema,
  FileLibraryDownloadQuerySchema,
  ListFileLibraryEntriesQuerySchema,
  MoveFileLibraryEntryRequestSchema,
  UpdateFileLibraryRequestSchema,
} from '@mbos/contracts';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  buildAfscpTemplateId,
  JsonDocFileLibraryRestoreOperationRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocFileLibrarySavePointMappingRepo,
  JsonDocProjectTaskFileTemplateRepo,
  generateTaskFileTemplateId,
  type FileLibrarySavePointPublicRecord,
  type FileLibraryRestoreOperationRecord,
  type FileLibraryRestoreOperationStatus,
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
  DEFAULT_FILE_LIBRARY_PROJECT_STORAGE_READY_WAIT,
  mapFileLibraryInfraError,
  reconcileProjectFileLibraryProvisioning,
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
  buildRuntimeAccessReleaseBeginCorrelationId,
  buildRuntimeAccessReleaseCompleteCorrelationId,
  buildRuntimeAccessReleaseRollbackCorrelationId,
  buildRuntimeAccessRestoreStartedCorrelationId,
  buildRuntimeAccessRestoreTerminalCorrelationId,
  findTaskFileLibraryBinding,
  hydrateTaskFileLibraryBindingsForProject,
  isRuntimeAccessRestoreStartedCorrelationForOperation,
  JsonDocTaskFileLibraryBindingRepo,
  JsonDocTaskWorkspaceHolderRepo,
  type TaskFileLibraryBinding,
} from './notebook-task/task-file-library-bindings.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { getNotebookTaskRunState } from './notebook-task/task-run-coordination.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import type { InternalAgentWorkspaceBinding } from './internal-agent-workspace-provisioner.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;
const TASK_FILE_TEMPLATE_USE_PERMISSION = 'project:agent_task:use';
const TASK_FILE_TEMPLATE_MANAGE_PERMISSION = 'project:files:update';
const FILE_LIBRARY_RETRY_AFTER_MS = 2_000;

class FileLibraryRestoreOperationActiveError extends Error {
  readonly operation: FileLibraryRestoreOperationRecord;

  constructor(operation: FileLibraryRestoreOperationRecord) {
    super('file_library_restore_operation_active');
    this.name = 'FileLibraryRestoreOperationActiveError';
    this.operation = operation;
  }
}

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
  | 'fileLibraryRestore'
  | 'fileLibraryRuntimeAccessRelease'
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
  if (routeKind === 'fileLibraryRestore' && method === 'POST') return true;
  return false;
}

function isFileLibraryRestoreConflictingMutationRoute(routeKind: ProjectFileLibraryRouteKind, method: string): boolean {
  return isFileLibraryWriteRoute(routeKind, method)
    || (routeKind === 'fileLibraryRuntimeAccessRelease' && method === 'POST')
    || (routeKind === 'fileLibraryItem' && method === 'DELETE');
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
  'file_library_save_point_create_pending',
  'file_library_save_point_list_failed',
  'file_library_save_point_list_pending',
  'file_library_restore_failed',
  'file_library_restore_operation_active',
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
  const normalized = message.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (normalized.includes('storage not ready')) {
    return 'file_library_project_storage_not_ready';
  }
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
  if (message === 'file_library_restore_operation_active') {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_OPERATION_PENDING', message };
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

function fileLibraryControlRouteErrorBody(
  mapped: { errorCode: string; message: string },
  error: unknown,
): Record<string, unknown> {
  const base = {
    error_code: mapped.errorCode,
    message: mapped.message,
  };
  if (
    mapped.errorCode === 'FILE_LIBRARY_OPERATION_PENDING'
    && (
      mapped.message === 'file_library_save_point_create_pending'
      || mapped.message === 'file_library_save_point_list_pending'
      || mapped.message === 'file_library_restore_operation_active'
    )
  ) {
    return {
      ...base,
      ...(error instanceof FileLibraryRestoreOperationActiveError
        ? {
            file_library_id: error.operation.file_library_id,
            restore_operation: {
              id: error.operation.id,
              file_library_id: error.operation.file_library_id,
              source_save_point_id: error.operation.source_save_point_id,
              status: error.operation.status,
              created_at: error.operation.created_at,
              updated_at: error.operation.updated_at,
            },
          }
        : {}),
      operation_status: 'pending',
      retry_after_ms: FILE_LIBRARY_RETRY_AFTER_MS,
    };
  }
  return base;
}

function buildPublishSnapshotAfscpTemplateId(taskFileTemplateId: string, requestId?: string): string {
  const suffix = requestId?.trim() || generateTaskFileTemplateId();
  return buildAfscpTemplateId(`${taskFileTemplateId}_publish_${suffix}`);
}

function storageStatusToRestoreOperationStatus(
  status: 'pending' | 'succeeded' | 'failed',
): FileLibraryRestoreOperationStatus {
  if (status === 'pending') return 'restoring';
  return status;
}

function isActiveRestoreOperationStatus(status: FileLibraryRestoreOperationStatus): boolean {
  return status === 'pending' || status === 'restoring';
}

function isTerminalRestoreOperationStatus(status: FileLibraryRestoreOperationStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

async function writeFileLibraryRestoreAuditEvent(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  requestId?: string | null;
  operation: FileLibraryRestoreOperationRecord;
  action: 'project.file_library.restore.start' | 'project.file_library.restore.succeeded' | 'project.file_library.restore.failed';
  result?: 'ok' | 'error';
  errorCode?: string;
  errorMessage?: string;
  finalResult?: 'started' | 'succeeded' | 'failed';
  failureCategory?: string;
}): Promise<void> {
  await writeProjectAuditEvent(input.deps, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorUserId },
    action: input.action,
    result: input.result ?? 'ok',
    requestId: input.requestId ?? null,
    resourceType: 'project_file_library',
    resourceId: input.operation.file_library_id,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    metadata: {
      file_library_id: input.operation.file_library_id,
      source_save_point_id: input.operation.source_save_point_id,
      discard_unsaved_changes_confirmed: input.operation.discard_unsaved_changes_confirmed,
      restore_operation_id: input.operation.id,
      restore_operation_status: input.operation.status,
      final_result: input.finalResult ?? (
        input.action === 'project.file_library.restore.succeeded'
          ? 'succeeded'
          : input.action === 'project.file_library.restore.failed'
            ? 'failed'
            : 'started'
      ),
      ...(input.failureCategory ? { failure_category: input.failureCategory } : {}),
    },
  });
}

async function reconcileRestoreOperationRecord(input: {
  deps: NodeApiDeps;
  restoreRepo: JsonDocFileLibraryRestoreOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operation: FileLibraryRestoreOperationRecord;
  requestId?: string;
}): Promise<FileLibraryRestoreOperationRecord> {
  const operation = await associateRuntimeAccessReleaseFenceWithRestoreOperation({
    ...input,
    allowClaim: isActiveRestoreOperationStatus(input.operation.status),
  });
  if (!isActiveRestoreOperationStatus(operation.status)) {
    if (isTerminalRestoreOperationStatus(operation.status)) {
      await restoreRuntimeAccessReleaseFenceAfterTerminalRestore({
        ...input,
        operation,
      });
    }
    return operation;
  }
  if (!input.deps.fileLibraryStorageAdapter?.enabled) {
    return operation;
  }
  if (!operation.afscp_operation_id) {
    return operation;
  }
  const result = await input.deps.fileLibraryStorageAdapter.reconcileRestoreOperation({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    operationId: operation.afscp_operation_id,
    requestId: input.requestId,
  });
  const updated = await input.restoreRepo.updateStatus({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    operationId: operation.id,
    status: storageStatusToRestoreOperationStatus(result.operationStatus),
    afscpOperationId: result.operationId,
    failureReason: result.operationStatus === 'failed' ? 'file_library_restore_failed' : null,
  });
  const next = updated ?? operation;
  if (isTerminalRestoreOperationStatus(next.status)) {
    await restoreRuntimeAccessReleaseFenceAfterTerminalRestore({
      ...input,
      operation: next,
    });
  }
  if (
    isTerminalRestoreOperationStatus(next.status)
    && next.status !== operation.status
  ) {
    await writeFileLibraryRestoreAuditEvent({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: next.created_by_user_id,
      requestId: input.requestId,
      operation: next,
      action: next.status === 'succeeded'
        ? 'project.file_library.restore.succeeded'
        : 'project.file_library.restore.failed',
      result: next.status === 'succeeded' ? 'ok' : 'error',
      ...(next.status === 'failed'
        ? {
            errorCode: 'FILE_LIBRARY_RESTORE_FAILED',
            errorMessage: 'file_library_restore_failed',
            failureCategory: next.failure_reason ?? 'file_library_restore_failed',
          }
        : {}),
    });
  }
  return next;
}

async function continuePreStartRestoreOperationReplay(input: {
  deps: NodeApiDeps;
  restoreRepo: JsonDocFileLibraryRestoreOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operation: FileLibraryRestoreOperationRecord;
  requestId?: string;
}): Promise<FileLibraryRestoreOperationRecord> {
  if (
    !isActiveRestoreOperationStatus(input.operation.status)
    || input.operation.afscp_operation_id
    || !input.deps.fileLibraryStorageAdapter?.enabled
  ) {
    return input.operation;
  }

  const failOperation = async (error: unknown): Promise<FileLibraryRestoreOperationRecord> => {
    const mapped = mapFileLibraryControlRouteError(
      error,
      'FILE_LIBRARY_RESTORE_FAILED',
      'file_library_restore_failed',
    );
    const failedOperation = await input.restoreRepo.updateStatus({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      operationId: input.operation.id,
      status: 'failed',
      failureReason: mapped.message,
    }) ?? input.operation;
    await restoreRuntimeAccessReleaseFenceAfterTerminalRestore({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      operation: failedOperation,
      requestId: input.requestId,
    });
    await writeFileLibraryRestoreAuditEvent({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: input.operation.created_by_user_id,
      requestId: input.requestId,
      operation: failedOperation,
      action: 'project.file_library.restore.failed',
      result: 'error',
      errorCode: mapped.errorCode,
      errorMessage: mapped.message,
      failureCategory: mapped.message,
    });
    return failedOperation;
  };

  try {
    const result = await input.deps.fileLibraryStorageAdapter.restoreFileLibrary({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      savePointId: input.operation.source_afscp_save_point_id,
      discardUnsavedChangesConfirmed: true,
      idempotencyKey: input.operation.idempotency_key,
      actorUserId: input.operation.created_by_user_id,
      requestId: input.requestId,
    });
    if (!result.operationId) {
      return await failOperation(new Error('file_library_restore_failed'));
    }
    const nextStatus = storageStatusToRestoreOperationStatus(result.operationStatus);
    const operation = await input.restoreRepo.updateStatus({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      operationId: input.operation.id,
      afscpOperationId: result.operationId,
      status: nextStatus,
      failureReason: nextStatus === 'failed' ? 'file_library_restore_failed' : null,
    }) ?? input.operation;
    if (isTerminalRestoreOperationStatus(operation.status)) {
      await restoreRuntimeAccessReleaseFenceAfterTerminalRestore({
        deps: input.deps,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
        operation,
        requestId: input.requestId,
      });
      await writeFileLibraryRestoreAuditEvent({
        deps: input.deps,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorUserId: operation.created_by_user_id,
        requestId: input.requestId,
        operation,
        action: operation.status === 'succeeded'
          ? 'project.file_library.restore.succeeded'
          : 'project.file_library.restore.failed',
        result: operation.status === 'succeeded' ? 'ok' : 'error',
        ...(operation.status === 'failed'
          ? {
              errorCode: 'FILE_LIBRARY_RESTORE_FAILED',
              errorMessage: 'file_library_restore_failed',
              failureCategory: operation.failure_reason ?? 'file_library_restore_failed',
            }
          : {}),
      });
    }
    return operation;
  } catch (error) {
    return await failOperation(error);
  }
}

async function restoreRuntimeAccessReleaseFenceAfterTerminalRestore(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operation: FileLibraryRestoreOperationRecord;
  requestId?: string;
}): Promise<void> {
  const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(input.deps.docStore);
  const binding = await bindingRepo.find({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.libraryId,
  });
  if (!binding || binding.bindingState !== 'releasing') {
    return;
  }
  const restoreCorrelationId = input.operation.runtime_access_release_restore_correlation_id;
  if (
    !restoreCorrelationId
    || input.operation.runtime_access_release_task_id !== binding.taskId
    || input.operation.runtime_access_release_binding_generation !== binding.bindingGeneration
    || binding.correlationId !== restoreCorrelationId
  ) {
    return;
  }
  await bindingRepo.rollbackRuntimeAccessRelease({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.libraryId,
    taskId: binding.taskId,
    bindingGeneration: binding.bindingGeneration,
    expectedCorrelationId: restoreCorrelationId,
    correlationId: buildRuntimeAccessRestoreTerminalCorrelationId({
      operationId: input.operation.id,
      requestId: input.requestId,
    }),
  });
}

async function associateRuntimeAccessReleaseFenceWithRestoreOperation(input: {
  deps: NodeApiDeps;
  restoreRepo: JsonDocFileLibraryRestoreOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operation: FileLibraryRestoreOperationRecord;
  allowClaim: boolean;
}): Promise<FileLibraryRestoreOperationRecord> {
  const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(input.deps.docStore);
  const binding = await bindingRepo.find({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.libraryId,
  });
  if (!binding || binding.bindingState !== 'releasing') {
    return input.operation;
  }
  const restoreCorrelationId = buildRuntimeAccessRestoreStartedCorrelationId({
    operationId: input.operation.id,
  });
  if (isRuntimeAccessRestoreStartedCorrelationForOperation({
    correlationId: binding.correlationId,
    operationId: input.operation.id,
  })) {
    return await input.restoreRepo.updateRuntimeAccessReleaseAssociation({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      operationId: input.operation.id,
      taskId: binding.taskId,
      bindingGeneration: binding.bindingGeneration,
      fenceCorrelationId: input.operation.runtime_access_release_fence_correlation_id ?? binding.correlationId,
      restoreCorrelationId: binding.correlationId,
    }) ?? input.operation;
  }
  if (!input.allowClaim || input.operation.runtime_access_release_restore_correlation_id) {
    return input.operation;
  }
  const claimed = await bindingRepo.claimRuntimeAccessReleaseForRestore({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.libraryId,
    taskId: binding.taskId,
    bindingGeneration: binding.bindingGeneration,
    releaseCorrelationId: binding.correlationId,
    restoreCorrelationId,
  });
  if (!claimed.ok) {
    throw new Error('file_library_active_writer_blocked');
  }
  if (!claimed.binding || !isRuntimeAccessRestoreStartedCorrelationForOperation({
    correlationId: claimed.binding.correlationId,
    operationId: input.operation.id,
  })) {
    return input.operation;
  }
  return await input.restoreRepo.updateRuntimeAccessReleaseAssociation({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    operationId: input.operation.id,
    taskId: claimed.binding.taskId,
    bindingGeneration: claimed.binding.bindingGeneration,
    fenceCorrelationId: binding.correlationId,
    restoreCorrelationId: claimed.binding.correlationId,
  }) ?? input.operation;
}

async function findReconciledActiveRestoreOperation(input: {
  deps: NodeApiDeps;
  restoreRepo: JsonDocFileLibraryRestoreOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  requestId?: string;
}): Promise<FileLibraryRestoreOperationRecord | null> {
  const active = await input.restoreRepo.findActiveByLibrary(input.workspaceId, input.projectId, input.libraryId);
  if (!active) {
    return null;
  }
  const reconciled = await reconcileRestoreOperationRecord({
    ...input,
    operation: active,
  });
  return isActiveRestoreOperationStatus(reconciled.status) ? reconciled : null;
}

async function ensureNoActiveRestoreOperation(input: {
  deps: NodeApiDeps;
  restoreRepo: JsonDocFileLibraryRestoreOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  requestId?: string;
}): Promise<void> {
  const active = await findReconciledActiveRestoreOperation(input);
  if (active) {
    throw new FileLibraryRestoreOperationActiveError(active);
  }
}

function readIdempotencyKey(req: http.IncomingMessage): string | null {
  const value = req.headers?.['idempotency-key'];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

async function listCachedUserSavePoints(input: {
  savePointRepo: JsonDocFileLibrarySavePointMappingRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): Promise<FileLibrarySavePointPublicRecord[]> {
  const records = await input.savePointRepo.listByLibrary({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
  });
  return records.map((record) => input.savePointRepo.toPublic(record));
}

type FileLibraryRuntimeAccessReleaseBlockerCode =
  | 'bound_task_missing'
  | 'active_run'
  | 'active_terminal'
  | 'workspace_holder';

function isWorkspaceBindingActiveWorkloadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('workspace binding has active workloads');
}

function runtimeAccessReleaseHardBlockers(
  blockers: FileLibraryRuntimeAccessReleaseBlockerCode[],
): FileLibraryRuntimeAccessReleaseBlockerCode[] {
  return blockers.filter((blocker) => blocker !== 'workspace_holder');
}

function isActiveWritableTaskBinding(binding: TaskFileLibraryBinding): boolean {
  return binding.bindingState === 'bound'
    && binding.taskStatus === 'active'
    && (
      binding.runtimeWritableAffordance === 'task_internal_home'
      || binding.runtimeWritableAffordance === 'files_update'
    );
}

function isActiveRuntimeWorkspaceBinding(binding: InternalAgentWorkspaceBinding): boolean {
  const mountStatus = binding.mount_binding_status;
  if (mountStatus) {
    return mountStatus === 'issued' || mountStatus === 'active';
  }
  const status = binding.status.trim().toLowerCase();
  return status === 'ready' || status === 'active';
}

function isReleasingRuntimeWorkspaceBinding(binding: InternalAgentWorkspaceBinding): boolean {
  const status = binding.status.trim().toLowerCase();
  return status === 'releasing'
    || status === 'release_pending'
    || binding.mount_binding_status === 'releasing';
}

function isReleasePendingRuntimeWorkspaceBinding(binding: InternalAgentWorkspaceBinding): boolean {
  const status = binding.status.trim().toLowerCase();
  if (status === 'releasing' || status === 'release_pending') {
    return true;
  }
  const mountStatus = binding.mount_binding_status;
  if (mountStatus === 'released' || mountStatus === 'revoked' || mountStatus === 'expired') {
    return false;
  }
  if (status === 'released' || status === 'revoked' || status === 'expired' || status === 'deleted') {
    return false;
  }
  return true;
}

function isRuntimeAccessReleaseBeginCorrelation(correlationId: string): boolean {
  return correlationId.startsWith('release:begin:');
}

async function convergeExistingRuntimeAccessReleaseFence(input: {
  deps: NodeApiDeps;
  bindingRepo: JsonDocTaskFileLibraryBindingRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  binding: TaskFileLibraryBinding;
  actorUserId: string;
}): Promise<{
  handled: false;
} | {
  handled: true;
  statusCode: number;
  body: Record<string, unknown>;
}> {
  if (
    input.binding.bindingState !== 'releasing'
    || !isRuntimeAccessReleaseBeginCorrelation(input.binding.correlationId)
  ) {
    return { handled: false };
  }
  const workspaceBindingManager = input.deps.internalAgentWorkspaceBindingManager
    ?? input.deps.internalAgentWorkspaceProvisioner;
  if (typeof workspaceBindingManager?.findWorkspaceBinding !== 'function') {
    return { handled: false };
  }
  const runtimeBinding = await workspaceBindingManager.findWorkspaceBinding({
    workspaceId: input.workspaceId,
    fileLibraryId: input.libraryId,
  });
  const releasePending = runtimeBinding ? isReleasePendingRuntimeWorkspaceBinding(runtimeBinding) : false;
  if (releasePending) {
    return {
      handled: true,
      statusCode: 200,
      body: {
        file_library_id: input.libraryId,
        released: false,
        runtime_access_status: 'release_pending',
      },
    };
  }
  const completed = await input.bindingRepo.completeRuntimeAccessRelease({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.libraryId,
    taskId: input.binding.taskId,
    bindingGeneration: input.binding.bindingGeneration,
    expectedCorrelationId: input.binding.correlationId,
    correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({
      beginCorrelationId: input.binding.correlationId,
    }),
  });
  if (!completed.ok) {
    return {
      handled: true,
      statusCode: 409,
      body: buildRuntimeAccessReleaseBindingConflictBody({
        libraryId: input.libraryId,
        binding: completed.binding,
        actorUserId: input.actorUserId,
      }),
    };
  }
  return {
    handled: true,
    statusCode: 200,
    body: {
      file_library_id: input.libraryId,
      released: true,
      runtime_access_status: 'released',
    },
  };
}

async function findTaskRecordForBinding(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  binding: TaskFileLibraryBinding;
}): Promise<TaskRecord | null> {
  const task = await input.deps.docStore.get<TaskRecord>(
    notebookTasksCollection(input.workspaceId),
    input.binding.taskId,
  );
  if (
    !task
    || task.workspace_id !== input.workspaceId
    || task.project_id !== input.projectId
    || task.id !== input.binding.taskId
  ) {
    return null;
  }
  return task;
}

async function findActiveRuntimeWriter(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): Promise<{ binding: TaskFileLibraryBinding | null } | null> {
  const workspaceBindingManager = input.deps.internalAgentWorkspaceBindingManager
    ?? input.deps.internalAgentWorkspaceProvisioner;
  if (typeof workspaceBindingManager?.findWorkspaceBinding !== 'function') {
    return null;
  }
  const runtimeBinding = await workspaceBindingManager.findWorkspaceBinding({
    workspaceId: input.workspaceId,
    fileLibraryId: input.libraryId,
  });
  if (!runtimeBinding) {
    return null;
  }
  const releasePending = isReleasingRuntimeWorkspaceBinding(runtimeBinding);
  if (!isActiveRuntimeWorkspaceBinding(runtimeBinding) && !releasePending) {
    return null;
  }
  return {
    binding: await findRestoreActiveWriterBinding({
      ...input,
      includeReleasingBinding: true,
    }),
  };
}

async function findRestoreActiveWriterBinding(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  includeReleasingBinding?: boolean;
}): Promise<TaskFileLibraryBinding | null> {
  await hydrateFileLibraryTaskBindings({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const binding = await findTaskFileLibraryBinding({
    docStore: input.deps.docStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.libraryId,
  });
  if (!binding) return null;
  if (isActiveWritableTaskBinding(binding)) return binding;
  return input.includeReleasingBinding
    && binding.bindingState === 'releasing'
    && binding.taskStatus === 'active'
    && (
      binding.runtimeWritableAffordance === 'task_internal_home'
      || binding.runtimeWritableAffordance === 'files_update'
    )
    ? binding
    : null;
}

function buildActiveWriterRestoreBlockedBody(input: {
  libraryId: string;
  binding: TaskFileLibraryBinding | null;
  actorUserId: string;
}): Record<string, unknown> {
  return {
    error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
    message: 'file_library_active_writer_blocked',
    file_library_id: input.libraryId,
    blockers: [{ code: 'active_writer_sessions' }],
    ...(input.binding
      ? buildBoundTaskSafeFields({
          binding: input.binding,
          actorUserId: input.actorUserId,
        })
      : { bound_task_visible: false }),
  };
}

async function buildActiveWriterRestoreBlockedBodyForCurrentBinding(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  actorUserId: string;
}): Promise<Record<string, unknown>> {
  const binding = await findRestoreActiveWriterBinding({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    includeReleasingBinding: true,
  });
  return buildActiveWriterRestoreBlockedBody({
    libraryId: input.libraryId,
    binding,
    actorUserId: input.actorUserId,
  });
}

async function hasLiveTerminalSessionsForTask(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
}): Promise<boolean> {
  const terminalService = input.deps.notebookTerminalService as NodeApiDeps['notebookTerminalService'] & {
    hasLiveSessionsForTask?: (args: {
      workspaceId: string;
      projectId: string;
      taskId: string;
      userId: string;
    }) => Promise<boolean>;
  };
  if (typeof terminalService.hasLiveSessionsForTask === 'function') {
    return terminalService.hasLiveSessionsForTask({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.task.id,
      userId: input.task.owner_user_id,
    });
  }
  const sessions = await terminalService.listSessionsForTask({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.task.id,
    userId: input.task.owner_user_id,
  });
  return sessions.some((session) => (
    session.status === 'pending'
    || session.status === 'active'
    || session.status === 'disconnected'
  ));
}

async function collectRuntimeAccessReleaseBlockers(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord | null;
  binding: TaskFileLibraryBinding;
}): Promise<FileLibraryRuntimeAccessReleaseBlockerCode[]> {
  if (!input.task) {
    return ['bound_task_missing'];
  }
  const blockers: FileLibraryRuntimeAccessReleaseBlockerCode[] = [];
  const activeRun = await getNotebookTaskRunState(input.deps.cache, input.task.id);
  if (activeRun) {
    blockers.push('active_run');
  }
  if (await hasLiveTerminalSessionsForTask({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    task: input.task,
  })) {
    blockers.push('active_terminal');
  }
  const liveWorkspaceHolders = await new JsonDocTaskWorkspaceHolderRepo(input.deps.docStore).listLiveByTask({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.task.id,
    bindingGeneration: input.binding.bindingGeneration,
  });
  if (liveWorkspaceHolders.length > 0) {
    blockers.push('workspace_holder');
  }
  const coordinator = input.deps.internalWorkloadCoordinator as {
    readSnapshotForTests?: () => Array<{
      workspaceId: string;
      projectId: string;
      workloadId: string;
      holders: string[];
    }>;
  } | undefined;
  const workloadId = sanitizeWorkloadId(input.task.id);
  const holderSnapshots = typeof coordinator?.readSnapshotForTests === 'function'
    ? coordinator.readSnapshotForTests().filter((snapshot) => (
      snapshot.workspaceId === input.workspaceId
      && snapshot.projectId === input.projectId
      && snapshot.workloadId === workloadId
      && snapshot.holders.length > 0
    ))
    : [];
  if (holderSnapshots.length > 0 && !blockers.includes('workspace_holder')) {
    blockers.push('workspace_holder');
  }
  return blockers;
}

function buildRuntimeAccessReleaseBlockedBody(input: {
  libraryId: string;
  binding: TaskFileLibraryBinding;
  actorUserId: string;
  blockers: FileLibraryRuntimeAccessReleaseBlockerCode[];
}): Record<string, unknown> {
  return {
    error_code: 'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_BLOCKED',
    message: 'file_library_runtime_access_release_blocked',
    file_library_id: input.libraryId,
    blockers: input.blockers.map((code) => ({ code })),
    ...buildBoundTaskSafeFields({
      binding: input.binding,
      actorUserId: input.actorUserId,
    }),
  };
}

function buildRuntimeAccessReleaseBindingConflictBody(input: {
  libraryId: string;
  binding: TaskFileLibraryBinding | null;
  actorUserId: string;
}): Record<string, unknown> {
  return {
    error_code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
    message: 'agent_task_workspace_binding_conflict',
    file_library_id: input.libraryId,
    ...(input.binding
      ? {
          binding_generation: String(input.binding.bindingGeneration),
          ...buildBoundTaskSafeFields({
            binding: input.binding,
            actorUserId: input.actorUserId,
          }),
        }
      : {}),
  };
}

async function releaseManagedTaskWorkloadBeforeRuntimeAccessRelease(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
}): Promise<void> {
  await input.deps.internalAgentPodManager?.releasePod(
    input.workspaceId,
    input.projectId,
    sanitizeWorkloadId(input.task.id),
  );
}

async function releaseTaskWorkspaceHoldersForRuntimeAccessRelease(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  binding: TaskFileLibraryBinding;
}): Promise<void> {
  const holderRepo = new JsonDocTaskWorkspaceHolderRepo(input.deps.docStore);
  const liveHolders = await holderRepo.listLiveByTask({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: input.task.id,
    bindingGeneration: input.binding.bindingGeneration,
  });
  const releasedAt = new Date().toISOString();
  for (const holder of liveHolders) {
    await holderRepo.release({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.task.id,
      fileLibraryId: holder.fileLibraryId,
      holderId: holder.holderId,
      bindingGeneration: holder.bindingGeneration,
      leaseEpoch: holder.leaseEpoch,
      releasedAt,
    });
  }
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
    const requestId = readOptionalRequestId(req);
    const reconciledLibraries = await Promise.all(libraries.map((item) => reconcileProjectFileLibraryProvisioning({
      deps,
      workspaceId,
      projectId,
      library: item,
      requestId,
    })));
    const items = await Promise.all(reconciledLibraries.map(async (item) => presentFileLibraryWithTaskHomeBinding({
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
        projectStorageReadyWait: DEFAULT_FILE_LIBRARY_PROJECT_STORAGE_READY_WAIT,
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
        ...(mapped.context ?? {}),
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
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    const templateId = generateTaskFileTemplateId();
    const afscpTemplateId = buildAfscpTemplateId(templateId);
    try {
      await ensureNoActiveRestoreOperation({
        deps,
        restoreRepo,
        workspaceId,
        projectId,
        libraryId: sourceLibrary.id,
        requestId: readOptionalRequestId(req),
      });
      const result = await deps.fileLibraryStorageAdapter.createTemplateFromLibrary({
        workspaceId,
        projectId,
        libraryId: sourceLibrary.id,
        templateId: afscpTemplateId,
        actorUserId: user.id,
        requestId: typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      });
      if (result.operationStatus === 'pending') {
        throw new Error('file_library_template_create_pending');
      }
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
      json(res, mapped.statusCode, fileLibraryControlRouteErrorBody(mapped, error));
    }
    return true;
  }

  if (routeKind === 'taskFileTemplatePublish' && method === 'POST') {
    if (!taskFileTemplateId) return false;
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const existing = await templateRepo.getById(workspaceId, projectId, taskFileTemplateId);
    if (!existing) {
      json(res, 404, { error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND', message: 'task_file_template_not_found' });
      return true;
    }
    const requestId = readOptionalRequestId(req);
    const sourceLibrary = existing.status === 'published'
      ? null
      : await catalogRepo.getById(workspaceId, projectId, existing.source_library_id);
    if (existing.status !== 'published') {
      if (!deps.fileLibraryStorageAdapter?.enabled) {
        json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
        return true;
      }
      if (!sourceLibrary) {
        json(res, 404, { error_code: 'FILE_LIBRARY_NOT_FOUND', message: 'file_library_not_found' });
        return true;
      }
      if (sourceLibrary.status !== 'ready') {
        json(res, 409, buildFileLibraryNotReadyResponse(sourceLibrary));
        return true;
      }
    }
    try {
      await ensureNoActiveRestoreOperation({
        deps,
        restoreRepo: new JsonDocFileLibraryRestoreOperationRepo(deps.docStore),
        workspaceId,
        projectId,
        libraryId: existing.source_library_id,
        requestId,
      });
      const updated = existing.status === 'published'
        ? await templateRepo.updateStatus({
            workspaceId,
            projectId,
            taskFileTemplateId,
            status: 'published',
          })
        : await (async () => {
            if (!sourceLibrary || !deps.fileLibraryStorageAdapter?.enabled) {
              throw new Error('file_library_template_create_failed');
            }
            const result = await deps.fileLibraryStorageAdapter.createTemplateFromLibrary({
              workspaceId,
              projectId,
              libraryId: sourceLibrary.id,
              templateId: buildPublishSnapshotAfscpTemplateId(taskFileTemplateId, requestId),
              actorUserId: user.id,
              requestId,
            });
            if (result.operationStatus === 'pending') {
              throw new Error('file_library_template_create_pending');
            }
            if (result.operationStatus === 'failed') {
              throw new Error('file_library_template_create_failed');
            }
            if (!result.sourceSavePointId) {
              throw new Error('file_library_template_create_failed');
            }
            const sourceSavePoint = await new JsonDocFileLibrarySavePointMappingRepo(deps.docStore).upsertFromAfscp({
              workspaceId,
              projectId,
              libraryId: sourceLibrary.id,
              afscpSavePointId: result.sourceSavePointId,
              message: `Template source: ${existing.name}`,
              purpose: 'task_template_source',
            });
            return templateRepo.publishWithSnapshot({
              workspaceId,
              projectId,
              taskFileTemplateId,
              afscpTemplateId: result.templateId,
              afscpCreateOperationId: result.operationId ?? null,
              sourceSavePointId: sourceSavePoint.id,
              sourceAfscpSavePointId: result.sourceSavePointId,
            });
          })();
      if (!updated) {
        json(res, 404, { error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND', message: 'task_file_template_not_found' });
        return true;
      }
      json(res, 200, templateRepo.toPublic(updated));
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'TASK_FILE_TEMPLATE_PUBLISH_FAILED',
        'file_library_template_create_failed',
      );
      json(res, mapped.statusCode, fileLibraryControlRouteErrorBody(mapped, error));
    }
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

  let library = await catalogRepo.getById(workspaceId, projectId, libraryId);
  if (!library) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' });
    return true;
  }
  library = await reconcileProjectFileLibraryProvisioning({
    deps,
    workspaceId,
    projectId,
    library,
    requestId: readOptionalRequestId(req),
  });
  if (
    isFileLibraryWriteRoute(routeKind, method)
    && library.status !== 'ready'
  ) {
    json(res, 409, buildFileLibraryNotReadyResponse(library));
    return true;
  }

  if (
    isFileLibraryRestoreConflictingMutationRoute(routeKind, method)
    && routeKind !== 'fileLibraryRestore'
  ) {
    try {
      await ensureNoActiveRestoreOperation({
        deps,
        restoreRepo: new JsonDocFileLibraryRestoreOperationRepo(deps.docStore),
        workspaceId,
        projectId,
        libraryId,
        requestId: readOptionalRequestId(req),
      });
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_RESTORE_FAILED',
        'file_library_restore_failed',
      );
      json(res, mapped.statusCode, fileLibraryControlRouteErrorBody(mapped, error));
      return true;
    }
  }

  if (routeKind === 'fileLibraryRuntimeAccessRelease' && method === 'POST') {
    await hydrateFileLibraryTaskBindings({ deps, workspaceId, projectId });
    const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const binding = await bindingRepo.find({
      workspaceId,
      projectId,
      fileLibraryId: libraryId,
    });
    if (!binding) {
      json(res, 409, {
        error_code: 'FILE_LIBRARY_RUNTIME_ACCESS_NOT_BOUND',
        message: 'file_library_runtime_access_not_bound',
        file_library_id: libraryId,
      });
      return true;
    }
    const releaseCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
      requestId: readOptionalRequestId(req),
    });
    const convergedReleaseFence = await convergeExistingRuntimeAccessReleaseFence({
      deps,
      bindingRepo,
      workspaceId,
      projectId,
      libraryId,
      binding,
      actorUserId: user.id,
    });
    if (convergedReleaseFence.handled) {
      json(res, convergedReleaseFence.statusCode, convergedReleaseFence.body);
      return true;
    }
    const task = await findTaskRecordForBinding({
      deps,
      workspaceId,
      projectId,
      binding,
    });
    const blockers = await collectRuntimeAccessReleaseBlockers({
      deps,
      workspaceId,
      projectId,
      task,
      binding,
    });
    const hardBlockers = runtimeAccessReleaseHardBlockers(blockers);
    if (hardBlockers.length > 0) {
      json(res, 409, buildRuntimeAccessReleaseBlockedBody({
        libraryId,
        binding,
        actorUserId: user.id,
        blockers: hardBlockers,
      }));
      return true;
    }
    if (!task) {
      json(res, 409, buildRuntimeAccessReleaseBlockedBody({
        libraryId,
        binding,
        actorUserId: user.id,
        blockers: ['bound_task_missing'],
      }));
      return true;
    }
    const workspaceBindingManager = deps.internalAgentWorkspaceBindingManager
      ?? deps.internalAgentWorkspaceProvisioner;
    if (!workspaceBindingManager) {
      json(res, 503, {
        error_code: 'SERVICE_UNAVAILABLE',
        message: 'file_library_runtime_access_release_unavailable',
        file_library_id: libraryId,
      });
      return true;
    }
    const releaseFence = await bindingRepo.beginRuntimeAccessRelease({
      workspaceId,
      projectId,
      fileLibraryId: libraryId,
      taskId: task.id,
      bindingGeneration: binding.bindingGeneration,
      correlationId: releaseCorrelationId,
    });
    if (!releaseFence.ok) {
      json(res, 409, buildRuntimeAccessReleaseBindingConflictBody({
        libraryId,
        binding: releaseFence.binding,
        actorUserId: user.id,
      }));
      return true;
    }
    const rollbackReleaseFence = async (correlationId: string): Promise<void> => {
      await bindingRepo.rollbackRuntimeAccessRelease({
        workspaceId,
        projectId,
        fileLibraryId: libraryId,
        taskId: task.id,
        bindingGeneration: binding.bindingGeneration,
        expectedCorrelationId: releaseCorrelationId,
        correlationId,
      });
    };
    try {
      await releaseManagedTaskWorkloadBeforeRuntimeAccessRelease({
        deps,
        workspaceId,
        projectId,
        task,
      });
      await releaseTaskWorkspaceHoldersForRuntimeAccessRelease({
        deps,
        workspaceId,
        projectId,
        task,
        binding,
      });
      const remainingHardBlockers = runtimeAccessReleaseHardBlockers(await collectRuntimeAccessReleaseBlockers({
        deps,
        workspaceId,
        projectId,
        task,
        binding,
      }));
      if (remainingHardBlockers.length > 0) {
        await rollbackReleaseFence(buildRuntimeAccessReleaseRollbackCorrelationId({
          beginCorrelationId: releaseCorrelationId,
          reason: 'hard_blocker',
        }));
        json(res, 409, buildRuntimeAccessReleaseBlockedBody({
          libraryId,
          binding,
          actorUserId: user.id,
          blockers: remainingHardBlockers,
        }));
        return true;
      }
      await workspaceBindingManager.deleteWorkspaceBinding({
        workspaceId,
        fileLibraryId: libraryId,
      });
      const runtimeBinding = typeof workspaceBindingManager.findWorkspaceBinding === 'function'
        ? await workspaceBindingManager.findWorkspaceBinding({
            workspaceId,
            fileLibraryId: libraryId,
          })
        : null;
      const releasePending = runtimeBinding ? isReleasePendingRuntimeWorkspaceBinding(runtimeBinding) : false;
      if (!releasePending) {
        const completed = await bindingRepo.completeRuntimeAccessRelease({
          workspaceId,
          projectId,
          fileLibraryId: libraryId,
          taskId: task.id,
          bindingGeneration: binding.bindingGeneration,
          expectedCorrelationId: releaseCorrelationId,
          correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({
            beginCorrelationId: releaseCorrelationId,
          }),
        });
        if (!completed.ok) {
          json(res, 409, buildRuntimeAccessReleaseBindingConflictBody({
            libraryId,
            binding: completed.binding,
            actorUserId: user.id,
          }));
          return true;
        }
      }
      json(res, 200, {
        file_library_id: libraryId,
        released: !releasePending,
        runtime_access_status: releasePending ? 'release_pending' : 'released',
      });
    } catch (error) {
      if (isWorkspaceBindingActiveWorkloadError(error)) {
        await rollbackReleaseFence(buildRuntimeAccessReleaseRollbackCorrelationId({
          beginCorrelationId: releaseCorrelationId,
          reason: 'workspace_holder',
        }));
        json(res, 409, buildRuntimeAccessReleaseBlockedBody({
          libraryId,
          binding,
          actorUserId: user.id,
          blockers: ['workspace_holder'],
        }));
        return true;
      }
      await rollbackReleaseFence(buildRuntimeAccessReleaseRollbackCorrelationId({
        beginCorrelationId: releaseCorrelationId,
        reason: 'failed',
      }));
      const mapped = mapFileLibraryInfraError(error);
      json(res, mapped.statusCode, {
        error_code: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
          ? 'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_FAILED'
          : mapped.errorCode,
        message: mapped.message,
        file_library_id: libraryId,
      });
    }
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
        if (mapped.purpose === 'user') {
          items.push(savePointRepo.toPublic(mapped));
        }
      }
      json(res, 200, { items });
    } catch (error) {
      const publicMessage = publicFileOperationMessage(error, 'file_library_save_point_list_failed');
      if (publicMessage === 'file_library_save_point_list_pending') {
        const cachedItems = await listCachedUserSavePoints({
          savePointRepo,
          workspaceId,
          projectId,
          libraryId,
        });
        if (cachedItems.length > 0) {
          json(res, 200, { items: cachedItems });
          return true;
        }
      }
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_SAVE_POINT_LIST_FAILED',
        'file_library_save_point_list_failed',
      );
      json(res, mapped.statusCode, fileLibraryControlRouteErrorBody(mapped, error));
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
      json(res, mapped.statusCode, fileLibraryControlRouteErrorBody(mapped, error));
    }
    return true;
  }

  if (routeKind === 'fileLibraryRestore' && method === 'GET') {
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    try {
      const active = await findReconciledActiveRestoreOperation({
        deps,
        restoreRepo,
        workspaceId,
        projectId,
        libraryId,
        requestId: readOptionalRequestId(req),
      });
      json(res, 200, {
        restore_operation: active ? restoreRepo.toPublic(active) : null,
      });
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_RESTORE_FAILED',
        'file_library_restore_failed',
      );
      json(res, mapped.statusCode, fileLibraryControlRouteErrorBody(mapped, error));
    }
    return true;
  }

  if (routeKind === 'fileLibraryRestore' && method === 'POST') {
    const parsed = CreateFileLibraryRestoreRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'bad_request' });
      return true;
    }
    const idempotencyKey = readIdempotencyKey(req);
    if (!idempotencyKey) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'idempotency_key_required' });
      return true;
    }
    if (!deps.fileLibraryStorageAdapter?.enabled) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(deps.docStore);
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    const savePoint = await savePointRepo.getById(workspaceId, projectId, libraryId, parsed.data.save_point_id);
    if (!savePoint) {
      json(res, 404, {
        error_code: 'FILE_LIBRARY_SAVE_POINT_NOT_FOUND',
        message: 'file_library_save_point_not_found',
      });
      return true;
    }
    const requestId = readOptionalRequestId(req);
    let startedOperation: FileLibraryRestoreOperationRecord | null = null;
    try {
      const existing = await restoreRepo.findByIdempotencyKey(
        workspaceId,
        projectId,
        libraryId,
        idempotencyKey,
      );
      if (existing) {
        const reconciled = await reconcileRestoreOperationRecord({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          operation: existing,
          requestId,
        });
        const replayed = await continuePreStartRestoreOperationReplay({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          operation: reconciled,
          requestId,
        });
        json(res, 200, restoreRepo.toPublic(replayed));
        return true;
      }

      const active = await findReconciledActiveRestoreOperation({
        deps,
        restoreRepo,
        workspaceId,
        projectId,
        libraryId,
        requestId,
      });
      if (active) {
        throw new FileLibraryRestoreOperationActiveError(active);
      }

      const activeWriter = await findActiveRuntimeWriter({
        deps,
        workspaceId,
        projectId,
        libraryId,
      });
      if (activeWriter) {
        json(res, 409, buildActiveWriterRestoreBlockedBody({
          libraryId,
          binding: activeWriter.binding,
          actorUserId: user.id,
        }));
        return true;
      }

      await deps.fileLibraryStorageAdapter.preflightRestoreFileLibrary({
        workspaceId,
        projectId,
        libraryId,
        savePointId: savePoint.afscp_save_point_id,
        discardUnsavedChangesConfirmed: true,
        idempotencyKey,
        actorUserId: user.id,
        requestId: requestId ?? undefined,
      });

      const pendingOperationResult = await restoreRepo.createOrReuseActiveByLibrary({
        workspaceId,
        projectId,
        libraryId,
        afscpOperationId: null,
        sourceSavePointId: savePoint.id,
        sourceAfscpSavePointId: savePoint.afscp_save_point_id,
        status: 'pending',
        idempotencyKey,
        createdByUserId: user.id,
        discardUnsavedChangesConfirmed: true,
      });
      const pendingOperation = pendingOperationResult.operation;
      if (!pendingOperationResult.created) {
        const reconciled = await reconcileRestoreOperationRecord({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          operation: pendingOperation,
          requestId,
        });
        if (
          pendingOperationResult.reason === 'active'
          && isActiveRestoreOperationStatus(reconciled.status)
        ) {
          throw new FileLibraryRestoreOperationActiveError(reconciled);
        }
        json(res, 200, restoreRepo.toPublic(reconciled));
        return true;
      }
      startedOperation = pendingOperation;
      startedOperation = await associateRuntimeAccessReleaseFenceWithRestoreOperation({
        deps,
        restoreRepo,
        workspaceId,
        projectId,
        libraryId,
        operation: pendingOperation,
        allowClaim: true,
      });
      await writeFileLibraryRestoreAuditEvent({
        deps,
        workspaceId,
        projectId,
        actorUserId: user.id,
        requestId,
        operation: startedOperation,
        action: 'project.file_library.restore.start',
      });

      const result = await deps.fileLibraryStorageAdapter.restoreFileLibrary({
        workspaceId,
        projectId,
        libraryId,
        savePointId: savePoint.afscp_save_point_id,
        discardUnsavedChangesConfirmed: true,
        idempotencyKey,
        actorUserId: user.id,
        requestId: requestId ?? undefined,
      });
      if (!result.operationId) {
        const failedOperation = await restoreRepo.updateStatus({
          workspaceId,
          projectId,
          libraryId,
          operationId: startedOperation.id,
          status: 'failed',
          failureReason: 'file_library_restore_failed',
        }) ?? startedOperation;
        await restoreRuntimeAccessReleaseFenceAfterTerminalRestore({
          deps,
          workspaceId,
          projectId,
          libraryId,
          operation: failedOperation,
          requestId,
        });
        await writeFileLibraryRestoreAuditEvent({
          deps,
          workspaceId,
          projectId,
          actorUserId: user.id,
          requestId,
          operation: failedOperation,
          action: 'project.file_library.restore.failed',
          result: 'error',
          errorCode: 'FILE_LIBRARY_RESTORE_FAILED',
          errorMessage: 'file_library_restore_failed',
          failureCategory: 'file_library_restore_failed',
        });
        json(res, 502, {
          error_code: 'FILE_LIBRARY_RESTORE_FAILED',
          message: 'file_library_restore_failed',
        });
        return true;
      }
      const nextStatus = storageStatusToRestoreOperationStatus(result.operationStatus);
      const operation = await restoreRepo.updateStatus({
        workspaceId,
        projectId,
        libraryId,
        operationId: startedOperation.id,
        afscpOperationId: result.operationId,
        status: nextStatus,
        failureReason: nextStatus === 'failed' ? 'file_library_restore_failed' : null,
      }) ?? startedOperation;
      if (isTerminalRestoreOperationStatus(operation.status)) {
        await restoreRuntimeAccessReleaseFenceAfterTerminalRestore({
          deps,
          workspaceId,
          projectId,
          libraryId,
          operation,
          requestId,
        });
        await writeFileLibraryRestoreAuditEvent({
          deps,
          workspaceId,
          projectId,
          actorUserId: user.id,
          requestId,
          operation,
          action: operation.status === 'succeeded'
            ? 'project.file_library.restore.succeeded'
            : 'project.file_library.restore.failed',
          result: operation.status === 'succeeded' ? 'ok' : 'error',
          ...(operation.status === 'failed'
            ? {
                errorCode: 'FILE_LIBRARY_RESTORE_FAILED',
                errorMessage: 'file_library_restore_failed',
                failureCategory: operation.failure_reason ?? 'file_library_restore_failed',
              }
            : {}),
        });
      }
      json(res, 200, restoreRepo.toPublic(operation));
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_RESTORE_FAILED',
        'file_library_restore_failed',
      );
      if (startedOperation) {
        const failedOperation = await restoreRepo.updateStatus({
          workspaceId,
          projectId,
          libraryId,
          operationId: startedOperation.id,
          status: 'failed',
          failureReason: mapped.message,
        }) ?? startedOperation;
        await restoreRuntimeAccessReleaseFenceAfterTerminalRestore({
          deps,
          workspaceId,
          projectId,
          libraryId,
          operation: failedOperation,
          requestId,
        });
        await writeFileLibraryRestoreAuditEvent({
          deps,
          workspaceId,
          projectId,
          actorUserId: user.id,
          requestId,
          operation: failedOperation,
          action: 'project.file_library.restore.failed',
          result: 'error',
          errorCode: mapped.errorCode,
          errorMessage: mapped.message,
          failureCategory: mapped.message,
        });
      }
      if (mapped.errorCode === 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED') {
        json(res, 409, await buildActiveWriterRestoreBlockedBodyForCurrentBinding({
          deps,
          workspaceId,
          projectId,
          libraryId,
          actorUserId: user.id,
        }));
        return true;
      }
      json(res, mapped.statusCode, fileLibraryControlRouteErrorBody(mapped, error));
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
