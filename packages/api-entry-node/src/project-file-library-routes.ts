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
  buildFileLibraryRestoreOperationPublicId,
  buildTaskFileTemplateIdempotencyRequestHash,
  buildTaskFileTemplateIdempotencyId,
  isFileLibraryRestoreOperationPublicId,
  JsonDocFileLibraryVersionOperationRepo,
  JsonDocFileLibraryRestoreOperationRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocFileLibrarySavePointMappingRepo,
  JsonDocProjectTaskFileTemplateRepo,
  type FileLibrarySavePointPublicRecord,
  type FileLibraryRestoreOperationRecord,
  type FileLibraryRestoreOperationStatus,
  type FileLibraryVersionOperationRecord,
  type FileLibraryVersionOperationStatus,
  type TaskFileTemplateRecord,
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
  type FileLibraryEntry,
  type FileLibraryOperationProjection,
  type FileLibraryObjectMeta,
  type FileLibraryStoragePort,
  type FileLibraryStorageOperationStatus,
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
const RECENT_TERMINAL_RESTORE_OPERATION_PROJECTION_WINDOW_MS = 30_000;
const PRE_START_RESTORE_STARTS_IN_FLIGHT = new Set<string>();

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
  | 'fileLibraryActiveOperation'
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

function presentFileLibraryWithTaskHomeBinding(input: {
  library: FileLibraryRecord;
  binding: TaskFileLibraryBinding | null;
  actorUserId: string;
}): Omit<FileLibraryRecord, 'file_library_home_segment' | 'version'> & ReturnType<typeof buildFileLibraryTaskHomeBindingFields> {
  return {
    id: input.library.id,
    workspace_id: input.library.workspace_id,
    project_id: input.library.project_id,
    name: input.library.name,
    ...(input.library.description !== undefined ? { description: input.library.description } : {}),
    status: input.library.status,
    source: input.library.source,
    ...(input.library.last_restore ? { last_restore: input.library.last_restore } : {}),
    created_by_user_id: input.library.created_by_user_id,
    created_at: input.library.created_at,
    updated_at: input.library.updated_at,
    ...buildFileLibraryTaskHomeBindingFields({
      binding: input.binding,
      actorUserId: input.actorUserId,
    }),
  };
}

function presentFileLibraryEntry(entry: FileLibraryEntry): FileLibraryEntry {
  if (entry.kind === 'directory') {
    return entry;
  }
  return {
    kind: 'file',
    path: entry.path,
    name: entry.name,
    size_bytes: entry.size_bytes,
    content_type: entry.content_type,
    modified_at: entry.modified_at,
  };
}

function presentFileLibraryObjectMeta(meta: FileLibraryObjectMeta): FileLibraryObjectMeta {
  return {
    key: meta.key,
    size_bytes: meta.size_bytes,
    content_type: meta.content_type,
    last_modified: meta.last_modified,
    user_metadata: meta.user_metadata,
  };
}

function presentStorageOperationProjection(projection: FileLibraryOperationProjection): FileLibraryOperationProjection {
  const publicProjection = { ...projection };
  delete publicProjection.resultSavePointId;
  return publicProjection;
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

function publicRestoreOperationFailureReason(operation: FileLibraryRestoreOperationRecord): string | undefined {
  if (operation.status === 'recovery_required') {
    return 'file_library_storage_admin_action_required';
  }
  const reason = operation.failure_reason?.trim();
  if (!reason) {
    return undefined;
  }
  const normalized = reason.toLowerCase();
  if (
    normalized.includes('recovery')
    || normalized.includes('operator')
    || normalized.includes('journal')
    || normalized.includes('control_root')
    || normalized.includes('/var/lib')
  ) {
    return 'file_library_storage_admin_action_required';
  }
  return publicFileOperationMessage(new Error(reason), 'file_library_restore_failed');
}

function presentFileLibraryRestoreActiveOperation(operation: FileLibraryRestoreOperationRecord) {
  const failureReason = publicRestoreOperationFailureReason(operation);
  return {
    id: buildFileLibraryRestoreOperationPublicId(operation),
    kind: 'restore',
    file_library_id: operation.file_library_id,
    source_save_point_id: operation.source_save_point_id,
    status: operation.status === 'pending'
      ? 'accepted'
      : operation.status === 'restoring'
        ? 'running'
        : operation.status,
    ...(failureReason ? { failure_reason: failureReason } : {}),
    created_at: operation.created_at,
    updated_at: operation.updated_at,
  };
}

function isBlockedRestoreOperationLookupId(operationId: string): boolean {
  return /^restore_op(?:_|$)/u.test(operationId)
    || /^op_restore(?:_|$)/u.test(operationId)
    || (/^flro_/u.test(operationId) && !isFileLibraryRestoreOperationPublicId(operationId));
}

function isFileLibraryVersionOperationActiveStatus(status: FileLibraryVersionOperationStatus): boolean {
  return status === 'accepted' || status === 'running';
}

function mapStorageOperationStatusToVersionStatus(
  status: FileLibraryStorageOperationStatus,
): FileLibraryVersionOperationStatus {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'recovery_required') return 'recovery_required';
  if (status === 'failed') return 'failed';
  return 'accepted';
}

function mapOperationProjectionToVersionStatus(
  projection: FileLibraryOperationProjection,
): FileLibraryVersionOperationStatus {
  const errorCode = projection.error?.code?.trim().toLowerCase() ?? '';
  if (
    errorCode === 'file_library_storage_admin_action_required'
    || errorCode === 'file_library_operation_requires_recovery'
    || errorCode === 'file_library_recovery_required'
    || errorCode.includes('admin_action')
    || errorCode.includes('storage_admin')
    || errorCode.includes('requires_recovery')
    || errorCode.includes('requires recovery')
    || errorCode.includes('admin action')
    || errorCode.includes('system_admin')
    || errorCode.includes('system admin')
    || errorCode.includes('operator')
    || errorCode.includes('recovery')
    || errorCode.includes('journal')
  ) {
    return 'recovery_required';
  }
  const state = projection.operation_state.trim().toLowerCase();
  if (
    state === 'succeeded'
    || state === 'success'
    || state === 'completed'
    || state === 'complete'
    || state === 'done'
  ) {
    return 'succeeded';
  }
  if (
    state === 'operator_intervention_required'
    || state === 'recovery_required'
    || state.includes('recovery_required')
    || state.includes('journal_recovery')
  ) {
    return 'recovery_required';
  }
  if (
    state === 'failed'
    || state === 'failure'
    || state === 'error'
    || state === 'errored'
    || state === 'canceled'
    || state === 'cancelled'
  ) {
    return 'failed';
  }
  if (
    state === 'running'
    || state === 'in_progress'
    || state === 'executing'
    || state === 'started'
    || state.includes('running')
  ) {
    return 'running';
  }
  return 'accepted';
}

function publicVersionOperationFailureReason(input: {
  status: FileLibraryVersionOperationStatus;
  projection?: FileLibraryOperationProjection | null;
  fallback: string;
}): string | null {
  if (input.status === 'succeeded' || input.status === 'accepted' || input.status === 'running') {
    return null;
  }
  const code = input.projection?.error?.code?.trim();
  if (
    input.status === 'recovery_required'
    || code === 'file_library_storage_admin_action_required'
    || code?.toLowerCase().includes('recovery')
    || code?.toLowerCase().includes('operator')
  ) {
    return 'file_library_storage_admin_action_required';
  }
  if (code === 'file_library_active_writer_blocked') {
    return 'file_library_active_writer_blocked';
  }
  if (code === 'file_library_capability_denied') {
    return 'file_library_capability_denied';
  }
  return input.fallback;
}

function restoreFailureReasonForStatus(status: FileLibraryRestoreOperationStatus): string | null {
  if (status === 'recovery_required') {
    return 'file_library_storage_admin_action_required';
  }
  if (status === 'failed') {
    return 'file_library_restore_failed';
  }
  return null;
}

function restoreFailureStatusForPublicMessage(message: string): FileLibraryRestoreOperationStatus {
  return message === 'file_library_storage_admin_action_required'
    ? 'recovery_required'
    : 'failed';
}

function publicSavePointLabel(savePoint: FileLibrarySavePointPublicRecord): string {
  return savePoint.message?.trim() || 'Manual save point';
}

async function recordSuccessfulFileLibraryRestore(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operation: FileLibraryRestoreOperationRecord;
}): Promise<void> {
  if (input.operation.status !== 'succeeded') {
    return;
  }
  const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(input.deps.docStore);
  const savePoint = await savePointRepo.getById(
    input.workspaceId,
    input.projectId,
    input.libraryId,
    input.operation.source_save_point_id,
  );
  if (!savePoint) {
    return;
  }
  await new JsonDocProjectFileLibraryCatalogRepo(input.deps.docStore).recordSuccessfulRestore({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    sourceSavePointId: savePoint.id,
    sourceSavePointLabel: publicSavePointLabel(savePoint),
    sourceSavePointCreatedAt: savePoint.created_at,
    restoredAt: input.operation.updated_at,
    restoreOperationId: buildFileLibraryRestoreOperationPublicId(input.operation),
  });
}

function versionOperationRank(operation: FileLibraryVersionOperationRecord | FileLibraryRestoreOperationRecord): number {
  const status = 'kind' in operation
    ? operation.status
    : operation.status === 'pending'
      ? 'accepted'
      : operation.status === 'restoring'
        ? 'running'
        : operation.status;
  return isFileLibraryVersionOperationActiveStatus(status as FileLibraryVersionOperationStatus) ? 1 : 0;
}

function pickLatestVersionOperation(
  candidates: Array<FileLibraryVersionOperationRecord | FileLibraryRestoreOperationRecord>,
): FileLibraryVersionOperationRecord | FileLibraryRestoreOperationRecord | null {
  const sorted = candidates.sort((left, right) => {
    const activeDelta = versionOperationRank(right) - versionOperationRank(left);
    if (activeDelta !== 0) return activeDelta;
    const updated = right.updated_at.localeCompare(left.updated_at);
    return updated !== 0 ? updated : right.created_at.localeCompare(left.created_at);
  });
  return sorted[0] ?? null;
}

const PUBLIC_FILE_OPERATION_MESSAGES = new Set([
  'destination_exists',
  'file_library_afscp_mapping_not_found',
  'file_library_afscp_mapping_not_ready',
  'file_library_backend_unavailable',
  'file_library_delete_failed',
  'file_library_destination_exists',
  'file_library_download_not_found',
  'file_library_folder_create_failed',
  'file_library_list_failed',
  'file_library_list_pending',
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
  'file_library_idempotency_conflict',
  'file_library_restore_operation_idempotency_conflict',
  'file_library_version_operation_idempotency_conflict',
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
  'task_file_template_material_not_ready',
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
  context?: Record<string, unknown>;
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
    ...(mapped.context ? { context: mapped.context } : {}),
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
  if (
    message === 'file_library_idempotency_conflict'
    || message === 'file_library_restore_operation_idempotency_conflict'
    || message === 'file_library_version_operation_idempotency_conflict'
  ) {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_IDEMPOTENCY_CONFLICT', message: 'file_library_idempotency_conflict' };
  }
  if (message === 'task_file_template_material_not_ready') {
    return { statusCode: 409, errorCode: 'TASK_FILE_TEMPLATE_MATERIAL_NOT_READY', message };
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
  const isSavePointOperationPending =
    mapped.errorCode === 'FILE_LIBRARY_OPERATION_PENDING'
    && (
      mapped.message === 'file_library_save_point_create_pending'
      || mapped.message === 'file_library_save_point_list_pending'
    );
  const base = {
    error_code: isSavePointOperationPending
      ? 'FILE_LIBRARY_SAVE_POINT_OPERATION_PENDING'
      : mapped.errorCode,
    message: mapped.message,
  };
  if (
    mapped.errorCode === 'FILE_LIBRARY_OPERATION_PENDING'
    && (
      isSavePointOperationPending
      || mapped.message === 'file_library_restore_operation_active'
    )
  ) {
    return {
      ...base,
      ...(error instanceof FileLibraryRestoreOperationActiveError
        ? {
            file_library_id: error.operation.file_library_id,
          }
        : {}),
      operation_status: 'pending',
      retry_after_ms: FILE_LIBRARY_RETRY_AFTER_MS,
    };
  }
  return base;
}

function isSameTaskFileTemplateCreateRequest(input: {
  template: TaskFileTemplateRecord;
  sourceLibraryId: string;
  name: string;
  description?: string;
  publishOnCreate?: boolean;
}): boolean {
  if (input.template.idempotency_request_hash) {
    return input.template.idempotency_request_hash === buildTaskFileTemplateIdempotencyRequestHash(input);
  }
  return input.template.source_library_id === input.sourceLibraryId
    && input.template.name === input.name
    && (input.template.description ?? undefined) === (input.description ?? undefined);
}

function storageStatusToRestoreOperationStatus(
  status: FileLibraryStorageOperationStatus,
): FileLibraryRestoreOperationStatus {
  if (status === 'pending') return 'restoring';
  if (status === 'recovery_required') return 'recovery_required';
  return status;
}

function isActiveRestoreOperationStatus(status: FileLibraryRestoreOperationStatus): boolean {
  return status === 'pending' || status === 'restoring';
}

function isTerminalRestoreOperationStatus(status: FileLibraryRestoreOperationStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'recovery_required';
}

function isRecentTerminalRestoreOperation(operation: FileLibraryRestoreOperationRecord): boolean {
  if (!isTerminalRestoreOperationStatus(operation.status)) {
    return false;
  }
  const updatedAtMs = Date.parse(operation.updated_at);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }
  const nowMs = Date.now();
  return updatedAtMs <= nowMs + 1_000
    && nowMs - updatedAtMs <= RECENT_TERMINAL_RESTORE_OPERATION_PROJECTION_WINDOW_MS;
}

async function findRecentTerminalRestoreOperation(input: {
  restoreRepo: JsonDocFileLibraryRestoreOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): Promise<FileLibraryRestoreOperationRecord | null> {
  const latest = await input.restoreRepo.findLatestByLibrary(
    input.workspaceId,
    input.projectId,
    input.libraryId,
  );
  if (!latest || !isRecentTerminalRestoreOperation(latest)) {
    return null;
  }
  return latest;
}

function preStartRestoreStartInFlightKey(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operationId: string;
}): string {
  return [
    input.workspaceId,
    input.projectId,
    input.libraryId,
    input.operationId,
  ].join('\0');
}

function markPreStartRestoreStartInFlight(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operationId: string;
}): (() => void) | null {
  const key = preStartRestoreStartInFlightKey(input);
  if (PRE_START_RESTORE_STARTS_IN_FLIGHT.has(key)) {
    return null;
  }
  PRE_START_RESTORE_STARTS_IN_FLIGHT.add(key);
  return () => {
    PRE_START_RESTORE_STARTS_IN_FLIGHT.delete(key);
  };
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
      restore_operation_id: buildFileLibraryRestoreOperationPublicId(input.operation),
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
      await recordSuccessfulFileLibraryRestore({
        deps: input.deps,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
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
    failureReason: restoreFailureReasonForStatus(storageStatusToRestoreOperationStatus(result.operationStatus)),
  });
  const next = updated ?? operation;
  if (isTerminalRestoreOperationStatus(next.status)) {
    await restoreRuntimeAccessReleaseFenceAfterTerminalRestore({
      ...input,
      operation: next,
    });
    await recordSuccessfulFileLibraryRestore({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
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

async function ensurePreStartRestoreOperationCanStart(input: {
  deps: NodeApiDeps;
  restoreRepo: JsonDocFileLibraryRestoreOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operation: FileLibraryRestoreOperationRecord;
}): Promise<FileLibraryRestoreOperationRecord> {
  const activeWriter = await findActiveRuntimeWriter({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
  });
  if (activeWriter) {
    throw new Error('file_library_active_writer_blocked');
  }

  const operation = await associateRuntimeAccessReleaseFenceWithRestoreOperation({
    deps: input.deps,
    restoreRepo: input.restoreRepo,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    operation: input.operation,
    allowClaim: true,
  });
  const binding = await new JsonDocTaskFileLibraryBindingRepo(input.deps.docStore).find({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.libraryId,
  });
  if (!binding || binding.bindingState !== 'releasing') {
    return operation;
  }
  const restoreCorrelationId = operation.runtime_access_release_restore_correlation_id;
  if (
    !restoreCorrelationId
    || operation.runtime_access_release_task_id !== binding.taskId
    || operation.runtime_access_release_binding_generation !== binding.bindingGeneration
    || binding.correlationId !== restoreCorrelationId
    || !isRuntimeAccessRestoreStartedCorrelationForOperation({
      correlationId: binding.correlationId,
      operationId: operation.id,
    })
  ) {
    throw new Error('file_library_active_writer_blocked');
  }
  return operation;
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
  let operation = input.operation;

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
      operationId: operation.id,
      status: restoreFailureStatusForPublicMessage(mapped.message),
      failureReason: mapped.message,
    }) ?? operation;
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
      actorUserId: operation.created_by_user_id,
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

  operation = await ensurePreStartRestoreOperationCanStart({
    deps: input.deps,
    restoreRepo: input.restoreRepo,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    operation,
  });
  const clearInFlight = markPreStartRestoreStartInFlight({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    operationId: operation.id,
  });
  if (!clearInFlight) {
    return operation;
  }

  try {
    try {
      const result = await input.deps.fileLibraryStorageAdapter.restoreFileLibrary({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
        savePointId: operation.source_afscp_save_point_id,
        idempotencyKey: operation.idempotency_key,
        actorUserId: operation.created_by_user_id,
        requestId: input.requestId,
      });
      if (!result.operationId) {
        return await failOperation(new Error('file_library_restore_failed'));
      }
      const nextStatus = storageStatusToRestoreOperationStatus(result.operationStatus);
      const updatedOperation = await input.restoreRepo.updateStatus({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
        operationId: operation.id,
        afscpOperationId: result.operationId,
        status: nextStatus,
        failureReason: restoreFailureReasonForStatus(nextStatus),
      }) ?? operation;
      if (isTerminalRestoreOperationStatus(updatedOperation.status)) {
        await restoreRuntimeAccessReleaseFenceAfterTerminalRestore({
          deps: input.deps,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          libraryId: input.libraryId,
          operation: updatedOperation,
          requestId: input.requestId,
        });
        await recordSuccessfulFileLibraryRestore({
          deps: input.deps,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          libraryId: input.libraryId,
          operation: updatedOperation,
        });
        await writeFileLibraryRestoreAuditEvent({
          deps: input.deps,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorUserId: updatedOperation.created_by_user_id,
          requestId: input.requestId,
          operation: updatedOperation,
          action: updatedOperation.status === 'succeeded'
            ? 'project.file_library.restore.succeeded'
            : 'project.file_library.restore.failed',
          result: updatedOperation.status === 'succeeded' ? 'ok' : 'error',
          ...(updatedOperation.status === 'failed'
            ? {
                errorCode: 'FILE_LIBRARY_RESTORE_FAILED',
                errorMessage: 'file_library_restore_failed',
                failureCategory: updatedOperation.failure_reason ?? 'file_library_restore_failed',
              }
            : {}),
        });
      }
      return updatedOperation;
    } catch (error) {
      return await failOperation(error);
    }
  } finally {
    clearInFlight();
  }
}

async function preparePreStartRestoreOperationContinuation(input: {
  deps: NodeApiDeps;
  restoreRepo: JsonDocFileLibraryRestoreOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operation: FileLibraryRestoreOperationRecord;
}): Promise<FileLibraryRestoreOperationRecord> {
  if (
    !isActiveRestoreOperationStatus(input.operation.status)
    || input.operation.afscp_operation_id
    || !input.deps.fileLibraryStorageAdapter?.enabled
  ) {
    return input.operation;
  }
  return await ensurePreStartRestoreOperationCanStart(input);
}

function schedulePreStartRestoreOperationContinuation(input: {
  deps: NodeApiDeps;
  restoreRepo: JsonDocFileLibraryRestoreOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operation: FileLibraryRestoreOperationRecord;
  requestId?: string;
}): void {
  void Promise.resolve()
    .then(() => continuePreStartRestoreOperationReplay(input))
    .catch(async (error) => {
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
        status: restoreFailureStatusForPublicMessage(mapped.message),
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
    })
    .catch(() => undefined);
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
  continuePreStart?: boolean;
}): Promise<FileLibraryRestoreOperationRecord | null> {
  const active = await input.restoreRepo.findActiveByLibrary(input.workspaceId, input.projectId, input.libraryId);
  if (!active) {
    return null;
  }
  const reconciled = await reconcileRestoreOperationRecord({
    ...input,
    operation: active,
  });
  if (input.continuePreStart) {
    schedulePreStartRestoreOperationContinuation({
      ...input,
      operation: reconciled,
    });
  }
  return isActiveRestoreOperationStatus(reconciled.status) ? reconciled : null;
}

async function reconcileVersionOperationRecord(input: {
  deps: NodeApiDeps;
  operationRepo: JsonDocFileLibraryVersionOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operation: FileLibraryVersionOperationRecord;
  requestId?: string;
}): Promise<FileLibraryVersionOperationRecord> {
  if (!input.operation.afscp_operation_id) {
    return input.operation;
  }
  if (!isFileLibraryVersionOperationActiveStatus(input.operation.status)) {
    return input.operation;
  }
  const projection = await input.deps.fileLibraryStorageAdapter?.getOperationProjection({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    operationId: input.operation.afscp_operation_id,
    requestId: input.requestId,
  });
  if (!projection) {
    return input.operation;
  }
  const status = mapOperationProjectionToVersionStatus(projection);
  const resultSavePoint = status === 'succeeded' && projection.resultSavePointId
    ? await new JsonDocFileLibrarySavePointMappingRepo(input.deps.docStore).upsertFromAfscp({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
        afscpSavePointId: projection.resultSavePointId,
        message: input.operation.message,
        createdAt: projection.finished_at ?? projection.updated_at ?? projection.created_at,
        purpose: 'user',
      })
    : null;
  if (status === input.operation.status && !projection.error?.code) {
    if (!resultSavePoint || input.operation.result_save_point_id === resultSavePoint.id) {
      return input.operation;
    }
  }
  return await input.operationRepo.updateStatus({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    operationId: input.operation.id,
    status,
    resultSavePointId: resultSavePoint?.id,
    failureReason: publicVersionOperationFailureReason({
      status,
      projection,
      fallback: 'file_library_save_point_create_failed',
    }),
  }) ?? input.operation;
}

async function findReconciledActiveVersionOperation(input: {
  deps: NodeApiDeps;
  operationRepo: JsonDocFileLibraryVersionOperationRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  requestId?: string;
}): Promise<FileLibraryVersionOperationRecord | null> {
  const active = await input.operationRepo.findActiveByLibrary(
    input.workspaceId,
    input.projectId,
    input.libraryId,
  );
  if (!active) {
    return null;
  }
  const reconciled = await reconcileVersionOperationRecord({
    ...input,
    operation: active,
  });
  return isFileLibraryVersionOperationActiveStatus(reconciled.status) ? reconciled : null;
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

async function findActiveRestoreBlockingRuntimeAccessRelease(input: {
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
  const operation = active.afscp_operation_id
    ? await reconcileRestoreOperationRecord({
        deps: input.deps,
        restoreRepo: input.restoreRepo,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
        operation: active,
        requestId: input.requestId,
      })
    : active;
  if (!isActiveRestoreOperationStatus(operation.status)) {
    return null;
  }
  if (!operation.afscp_operation_id) {
    const activeWriter = await findActiveRuntimeWriter({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
    });
    if (activeWriter) {
      return null;
    }
  }
  return operation;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecordString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readRecordNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function readRecordBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function readNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function isRuntimeAccessSandboxReleasePendingError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = readRecordString(error, 'code');
  const operation = readRecordString(error, 'operation', 'sandboxOperation', 'sandbox_operation');
  const status = readRecordNumber(error, 'status', 'statusCode');
  if (
    code === 'AGENT_SANDBOX_UNAVAILABLE'
    && operation === 'delete_pod'
    && (status === undefined || status >= 500)
  ) {
    return true;
  }
  return code === 'AGENT_SANDBOX_RATE_LIMITED'
    && operation === 'delete_pod';
}

function buildRuntimeAccessReleaseFailureDiagnostic(input: {
  error: unknown;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  task: TaskRecord | null;
  requestId?: string | null;
  mappedErrorCode: string;
  mappedMessage: string;
}): Record<string, unknown> {
  const errorRecord = isRecord(input.error) ? input.error : {};
  const metadata = readNestedRecord(errorRecord, 'metadata');
  const afscpError = metadata ? readNestedRecord(metadata, 'afscp_error') : undefined;
  const releaseDiagnostic = readNestedRecord(errorRecord, 'releaseDiagnostic')
    ?? readNestedRecord(errorRecord, 'release_diagnostic');
  const sandboxDiagnostics = readNestedRecord(errorRecord, 'sandboxDiagnostics')
    ?? readNestedRecord(errorRecord, 'sandbox_diagnostics');
  const directCode = readRecordString(errorRecord, 'code');
  const afscpCode = afscpError ? readRecordString(afscpError, 'code') : undefined;
  const releaseCode = releaseDiagnostic ? readRecordString(releaseDiagnostic, 'code') : undefined;
  const directStatus = readRecordNumber(errorRecord, 'status', 'statusCode');
  const afscpStatus = afscpError ? readRecordNumber(afscpError, 'status') : undefined;
  const releaseStatus = releaseDiagnostic ? readRecordNumber(releaseDiagnostic, 'status') : undefined;
  const directRetryable = readRecordBoolean(errorRecord, 'retryable');
  const afscpRetryable = afscpError ? readRecordBoolean(afscpError, 'retryable') : undefined;
  const releaseRetryable = releaseDiagnostic ? readRecordBoolean(releaseDiagnostic, 'retryable') : undefined;
  const requestId = input.requestId
    ?? readRecordString(errorRecord, 'requestId', 'request_id')
    ?? (releaseDiagnostic ? readRecordString(releaseDiagnostic, 'requestId', 'request_id') : undefined)
    ?? (afscpError ? readRecordString(afscpError, 'correlation_id') : undefined);
  const operationId = readRecordString(errorRecord, 'operationId', 'operation_id')
    ?? (afscpError ? readRecordString(afscpError, 'operation_id') : undefined);
  const status = directStatus ?? releaseStatus ?? afscpStatus;
  const retryable = directRetryable ?? releaseRetryable ?? afscpRetryable;
  return {
    theme: 'runtime_pending_readiness',
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    file_library_id: input.libraryId,
    ...(input.task ? { task_id: input.task.id, workload_id: sanitizeWorkloadId(input.task.id) } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(operationId ? { operation_id: operationId } : {}),
    operation: readRecordString(errorRecord, 'operation', 'sandboxOperation', 'sandbox_operation')
      ?? (releaseDiagnostic ? readRecordString(releaseDiagnostic, 'operation') : undefined)
      ?? 'runtime_access_release',
    error_code: directCode ?? releaseCode ?? afscpCode ?? input.mappedErrorCode,
    mapped_error_code: input.mappedErrorCode,
    mapped_message: input.mappedMessage,
    ...(status !== undefined ? { status } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(afscpCode ? { afscp_code: afscpCode } : {}),
    ...(releaseDiagnostic ? { release_diagnostic: releaseDiagnostic } : {}),
    ...(sandboxDiagnostics ? { pod_manager: sandboxDiagnostics } : {}),
  };
}

function logRuntimeAccessReleaseFailure(input: {
  error: unknown;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  task: TaskRecord | null;
  requestId?: string | null;
  mappedErrorCode: string;
  mappedMessage: string;
}): void {
  const payload = {
    event: 'runtime_pending_readiness_failure',
    theme: 'runtime_pending_readiness',
    scope: 'file_library_runtime_access_release',
    convergence: {
      pending: 'return_file_library_list_pending_before_read_export',
      releasing: 'retry_runtime_access_release_before_read_export',
      offline: 'wait_for_sandbox_or_workspace_binding_recheck',
      not_found: 'recheck_workspace_binding_before_terminalizing',
      failed: 'stable_blocker_after_repeated_gate_failure',
    },
    diagnostic: buildRuntimeAccessReleaseFailureDiagnostic(input),
  };
  try {
    console.warn('[files] runtime_pending_readiness_failure %s', JSON.stringify(payload));
  } catch {
    console.warn('[files] runtime_pending_readiness_failure %s', JSON.stringify({
      event: payload.event,
      theme: payload.theme,
      scope: payload.scope,
      diagnostic_serialization: 'failed',
    }));
  }
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

function isTerminalRuntimeWorkspaceStatus(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const status = value.trim().toLowerCase();
  return status === 'released' || status === 'revoked' || status === 'expired' || status === 'deleted';
}

function isReleasingRuntimeWorkspaceBinding(binding: InternalAgentWorkspaceBinding): boolean {
  if (isTerminalRuntimeWorkspaceStatus(binding.mount_binding_status)) {
    return false;
  }
  if (binding.mount_binding_status === 'releasing') {
    return true;
  }
  const status = binding.status.trim().toLowerCase();
  return status === 'releasing'
    || status === 'release_pending';
}

function hasRuntimeWorkspaceReleaseOperation(binding: InternalAgentWorkspaceBinding): boolean {
  return typeof binding.release_operation_id === 'string'
    && binding.release_operation_id.trim().length > 0;
}

function isTerminalRuntimeWorkspaceBinding(binding: InternalAgentWorkspaceBinding): boolean {
  if (isTerminalRuntimeWorkspaceStatus(binding.mount_binding_status)) return true;
  const status = binding.status.trim().toLowerCase();
  if (isTerminalRuntimeWorkspaceStatus(status)) {
    return true;
  }
  if (status === 'releasing' || status === 'release_pending') {
    return false;
  }
  if (
    status === 'ready'
    || status === 'active'
  ) {
    return false;
  }
  return false;
}

function isRuntimeAccessReleaseBeginCorrelation(correlationId: string): boolean {
  return correlationId.startsWith('release:begin:');
}

function isRuntimeAccessReleaseCompleteCorrelation(correlationId: string): boolean {
  return correlationId.startsWith('release:complete:');
}

type RuntimeAccessReleaseRouteResponse = {
  statusCode: number;
  body: Record<string, unknown>;
  invalidateListReadExport?: boolean;
};

const FILE_LIBRARY_ENTRIES_PENDING_RUNTIME_RELEASE_WAIT_MS = 100;
const FILE_LIBRARY_ENTRIES_PENDING_RUNTIME_RELEASE_RECHECK_DELAYS_MS = [
  1_000,
  2_000,
  5_000,
  10_000,
  15_000,
] as const;

async function continueRuntimeAccessReleaseAfterFence(input: {
  deps: NodeApiDeps;
  bindingRepo: JsonDocTaskFileLibraryBindingRepo;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  binding: TaskFileLibraryBinding;
  task: TaskRecord | null;
  releaseCorrelationId: string;
  actorUserId: string;
}): Promise<RuntimeAccessReleaseRouteResponse> {
  const workspaceBindingManager = input.deps.internalAgentWorkspaceBindingManager
    ?? input.deps.internalAgentWorkspaceProvisioner;
  if (typeof workspaceBindingManager?.deleteWorkspaceBinding !== 'function') {
    return {
      statusCode: 503,
      body: {
        error_code: 'SERVICE_UNAVAILABLE',
        message: 'file_library_runtime_access_release_unavailable',
        file_library_id: input.libraryId,
      },
    };
  }
  const rollbackReleaseFence = async (
    correlationId: string,
  ): Promise<void> => {
    await input.bindingRepo.rollbackRuntimeAccessRelease({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      fileLibraryId: input.libraryId,
      taskId: input.binding.taskId,
      bindingGeneration: input.binding.bindingGeneration,
      expectedCorrelationId: input.releaseCorrelationId,
      correlationId,
    });
  };

  try {
    if (!input.task) {
      await rollbackReleaseFence(buildRuntimeAccessReleaseRollbackCorrelationId({
        beginCorrelationId: input.releaseCorrelationId,
        reason: 'hard_blocker',
      }));
      return {
        statusCode: 409,
        body: buildRuntimeAccessReleaseBlockedBody({
          libraryId: input.libraryId,
          binding: input.binding,
          actorUserId: input.actorUserId,
          blockers: ['bound_task_missing'],
        }),
      };
    }

    await releaseManagedTaskWorkloadBeforeRuntimeAccessRelease({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      task: input.task,
    });
    await releaseTaskWorkspaceHoldersForRuntimeAccessRelease({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      task: input.task,
      binding: input.binding,
    });
    const remainingHardBlockers = runtimeAccessReleaseHardBlockers(await collectRuntimeAccessReleaseBlockers({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      task: input.task,
      binding: input.binding,
    }));
    if (remainingHardBlockers.length > 0) {
      await rollbackReleaseFence(buildRuntimeAccessReleaseRollbackCorrelationId({
        beginCorrelationId: input.releaseCorrelationId,
        reason: 'hard_blocker',
      }));
      return {
        statusCode: 409,
        body: buildRuntimeAccessReleaseBlockedBody({
          libraryId: input.libraryId,
          binding: input.binding,
          actorUserId: input.actorUserId,
          blockers: remainingHardBlockers,
        }),
      };
    }

    await workspaceBindingManager.deleteWorkspaceBinding({
      workspaceId: input.workspaceId,
      fileLibraryId: input.libraryId,
    });
    const runtimeBinding = typeof workspaceBindingManager.findWorkspaceBinding === 'function'
      ? await workspaceBindingManager.findWorkspaceBinding({
          workspaceId: input.workspaceId,
          fileLibraryId: input.libraryId,
        })
      : null;
    const releasePending = runtimeBinding ? !isTerminalRuntimeWorkspaceBinding(runtimeBinding) : false;
    if (!releasePending) {
      const completed = await input.bindingRepo.completeRuntimeAccessRelease({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        fileLibraryId: input.libraryId,
        taskId: input.binding.taskId,
        bindingGeneration: input.binding.bindingGeneration,
        expectedCorrelationId: input.releaseCorrelationId,
        correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({
          beginCorrelationId: input.releaseCorrelationId,
        }),
      });
      if (!completed.ok) {
        return {
          statusCode: 409,
          body: buildRuntimeAccessReleaseBindingConflictBody({
            libraryId: input.libraryId,
            binding: completed.binding,
            actorUserId: input.actorUserId,
          }),
        };
      }
    }
    return {
      statusCode: 200,
      body: {
        file_library_id: input.libraryId,
        released: !releasePending,
        runtime_access_status: releasePending ? 'release_pending' : 'released',
      },
      invalidateListReadExport: !releasePending,
    };
  } catch (error) {
    if (isWorkspaceBindingActiveWorkloadError(error)) {
      await rollbackReleaseFence(buildRuntimeAccessReleaseRollbackCorrelationId({
        beginCorrelationId: input.releaseCorrelationId,
        reason: 'workspace_holder',
      }));
      return {
        statusCode: 409,
        body: buildRuntimeAccessReleaseBlockedBody({
          libraryId: input.libraryId,
          binding: input.binding,
          actorUserId: input.actorUserId,
          blockers: ['workspace_holder'],
        }),
      };
    }
    const mapped = mapFileLibraryInfraError(error);
    if (isRuntimeAccessSandboxReleasePendingError(error)) {
      logRuntimeAccessReleaseFailure({
        error,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
        task: input.task,
        requestId: input.releaseCorrelationId,
        mappedErrorCode: mapped.errorCode,
        mappedMessage: mapped.message,
      });
      return {
        statusCode: 200,
        body: {
          file_library_id: input.libraryId,
          released: false,
          runtime_access_status: 'release_pending',
        },
        invalidateListReadExport: false,
      };
    }
    await rollbackReleaseFence(buildRuntimeAccessReleaseRollbackCorrelationId({
      beginCorrelationId: input.releaseCorrelationId,
      reason: 'failed',
    }));
    logRuntimeAccessReleaseFailure({
      error,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      task: input.task,
      requestId: input.releaseCorrelationId,
      mappedErrorCode: mapped.errorCode,
      mappedMessage: mapped.message,
    });
    return {
      statusCode: mapped.statusCode,
      body: {
        error_code: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
          ? 'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_FAILED'
          : mapped.errorCode,
        message: mapped.message,
        file_library_id: input.libraryId,
      },
    };
  }
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
  invalidateListReadExport?: boolean;
}> {
  if (
    input.binding.bindingState !== 'releasing'
  ) {
    return { handled: false };
  }
  if (isRuntimeAccessReleaseCompleteCorrelation(input.binding.correlationId)) {
    return {
      handled: true,
      statusCode: 200,
      body: {
        file_library_id: input.libraryId,
        released: true,
        runtime_access_status: 'released',
      },
      invalidateListReadExport: false,
    };
  }
  if (!isRuntimeAccessReleaseBeginCorrelation(input.binding.correlationId)) {
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
  if (runtimeBinding && !isTerminalRuntimeWorkspaceBinding(runtimeBinding)) {
    if (
      isReleasingRuntimeWorkspaceBinding(runtimeBinding)
      && hasRuntimeWorkspaceReleaseOperation(runtimeBinding)
    ) {
      return {
        handled: true,
        statusCode: 200,
        body: {
          file_library_id: input.libraryId,
          released: false,
          runtime_access_status: 'release_pending',
        },
        invalidateListReadExport: false,
      };
    }
    const task = await findTaskRecordForBinding({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      binding: input.binding,
    });
    const response = await continueRuntimeAccessReleaseAfterFence({
      deps: input.deps,
      bindingRepo: input.bindingRepo,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      binding: input.binding,
      task,
      releaseCorrelationId: input.binding.correlationId,
      actorUserId: input.actorUserId,
    });
    return {
      handled: true,
      ...response,
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
    invalidateListReadExport: true,
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

async function releaseRuntimeAccessForFileLibrary(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  actorUserId: string;
  requestId?: string | null;
}): Promise<RuntimeAccessReleaseRouteResponse> {
  await hydrateFileLibraryTaskBindings({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(input.deps.docStore);
  const binding = await bindingRepo.find({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.libraryId,
  });
  if (!binding) {
    return {
      statusCode: 409,
      body: {
        error_code: 'FILE_LIBRARY_RUNTIME_ACCESS_NOT_BOUND',
        message: 'file_library_runtime_access_not_bound',
        file_library_id: input.libraryId,
      },
    };
  }
  const releaseCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
    requestId: input.requestId ?? undefined,
  });
  const convergedReleaseFence = await convergeExistingRuntimeAccessReleaseFence({
    deps: input.deps,
    bindingRepo,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    binding,
    actorUserId: input.actorUserId,
  });
  if (convergedReleaseFence.handled) {
    return {
      statusCode: convergedReleaseFence.statusCode,
      body: convergedReleaseFence.body,
      invalidateListReadExport: convergedReleaseFence.invalidateListReadExport,
    };
  }
  const task = await findTaskRecordForBinding({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    binding,
  });
  const blockers = await collectRuntimeAccessReleaseBlockers({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    task,
    binding,
  });
  const hardBlockers = runtimeAccessReleaseHardBlockers(blockers);
  if (hardBlockers.length > 0) {
    return {
      statusCode: 409,
      body: buildRuntimeAccessReleaseBlockedBody({
        libraryId: input.libraryId,
        binding,
        actorUserId: input.actorUserId,
        blockers: hardBlockers,
      }),
    };
  }
  if (!task) {
    return {
      statusCode: 409,
      body: buildRuntimeAccessReleaseBlockedBody({
        libraryId: input.libraryId,
        binding,
        actorUserId: input.actorUserId,
        blockers: ['bound_task_missing'],
      }),
    };
  }
  const workspaceBindingManager = input.deps.internalAgentWorkspaceBindingManager
    ?? input.deps.internalAgentWorkspaceProvisioner;
  if (typeof workspaceBindingManager?.deleteWorkspaceBinding !== 'function') {
    return {
      statusCode: 503,
      body: {
        error_code: 'SERVICE_UNAVAILABLE',
        message: 'file_library_runtime_access_release_unavailable',
        file_library_id: input.libraryId,
      },
    };
  }
  const releaseFence = await bindingRepo.beginRuntimeAccessRelease({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.libraryId,
    taskId: task.id,
    bindingGeneration: binding.bindingGeneration,
    correlationId: releaseCorrelationId,
  });
  if (!releaseFence.ok) {
    return {
      statusCode: 409,
      body: buildRuntimeAccessReleaseBindingConflictBody({
        libraryId: input.libraryId,
        binding: releaseFence.binding,
        actorUserId: input.actorUserId,
      }),
    };
  }
  return continueRuntimeAccessReleaseAfterFence({
    deps: input.deps,
    bindingRepo,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    binding: releaseFence.binding,
    task,
    releaseCorrelationId,
    actorUserId: input.actorUserId,
  });
}

function runtimeAccessReleaseCompleted(response: RuntimeAccessReleaseRouteResponse): boolean {
  return response.statusCode === 200
    && response.body.runtime_access_status === 'released';
}

function runtimeAccessReleasePending(response: RuntimeAccessReleaseRouteResponse): boolean {
  return response.statusCode === 200
    && response.body.runtime_access_status === 'release_pending';
}

function runtimeAccessReleasePendingRecheckResponse(libraryId: string): RuntimeAccessReleaseRouteResponse {
  return {
    statusCode: 200,
    body: {
      file_library_id: libraryId,
      released: false,
      runtime_access_status: 'release_pending',
    },
  };
}

function readResponseBodyErrorCode(body: Record<string, unknown>): string | null {
  const value = body.error_code;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRuntimeAccessReleaseReadExportPending(response: RuntimeAccessReleaseRouteResponse): boolean {
  if (runtimeAccessReleasePending(response)) {
    return true;
  }
  const errorCode = readResponseBodyErrorCode(response.body);
  if (
    response.statusCode === 409
    && (
      errorCode === 'FILE_LIBRARY_OPERATION_PENDING'
      || errorCode === 'FILE_LIBRARY_RETRYABLE_INFRASTRUCTURE_CONFLICT'
    )
  ) {
    return true;
  }
  return response.statusCode >= 500
    && errorCode === 'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_FAILED';
}

function shouldInvalidateListReadExportAfterRuntimeRelease(response: RuntimeAccessReleaseRouteResponse): boolean {
  return runtimeAccessReleaseCompleted(response)
    && response.invalidateListReadExport === true;
}

async function raceEntriesPendingRuntimeRelease(
  releasePromise: Promise<RuntimeAccessReleaseRouteResponse>,
): Promise<RuntimeAccessReleaseRouteResponse | null> {
  const guardedReleasePromise = releasePromise.catch(() => null);
  const timeoutPromise = new Promise<null>((resolve) => {
    const timeout = setTimeout(
      () => resolve(null),
      FILE_LIBRARY_ENTRIES_PENDING_RUNTIME_RELEASE_WAIT_MS,
    );
    const maybeNodeTimeout = timeout as unknown as { unref?: () => void };
    if (typeof maybeNodeTimeout.unref === 'function') {
      maybeNodeTimeout.unref();
    }
  });
  return Promise.race([guardedReleasePromise, timeoutPromise]);
}

async function waitForEntriesPendingRuntimeReleaseRecheck(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, delayMs);
    const maybeNodeTimeout = timeout as unknown as { unref?: () => void };
    if (typeof maybeNodeTimeout.unref === 'function') {
      maybeNodeTimeout.unref();
    }
  });
}

async function invalidateListReadExport(input: {
  storageAdapter: FileLibraryStoragePort;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  createdBeforeOrAtMs?: number;
  requestId?: string;
}): Promise<void> {
  await input.storageAdapter.invalidateListReadExport?.({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    ...(typeof input.createdBeforeOrAtMs === 'number'
      ? { createdBeforeOrAtMs: input.createdBeforeOrAtMs }
      : {}),
    requestId: input.requestId,
  });
}

function scheduleListReadExportInvalidationAfterRuntimeRelease(input: {
  deps: NodeApiDeps;
  storageAdapter: FileLibraryStoragePort;
  releasePromise: Promise<RuntimeAccessReleaseRouteResponse>;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  actorUserId: string;
  createdBeforeOrAtMs: number;
  requestId?: string;
}): void {
  void (async () => {
    let releaseResponse: RuntimeAccessReleaseRouteResponse | null = await input.releasePromise.catch(() => null);
    if (!releaseResponse) {
      return;
    }

    if (shouldInvalidateListReadExportAfterRuntimeRelease(releaseResponse)) {
      await invalidateListReadExport(input);
      return;
    }
    if (!runtimeAccessReleasePending(releaseResponse)) {
      return;
    }

    for (const delayMs of FILE_LIBRARY_ENTRIES_PENDING_RUNTIME_RELEASE_RECHECK_DELAYS_MS) {
      await waitForEntriesPendingRuntimeReleaseRecheck(delayMs);
      releaseResponse = await releaseRuntimeAccessForFileLibrary({
        deps: input.deps,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
      }).catch(() => null);
      if (!releaseResponse) {
        return;
      }
      if (shouldInvalidateListReadExportAfterRuntimeRelease(releaseResponse)) {
        await invalidateListReadExport(input);
        return;
      }
      if (!runtimeAccessReleasePending(releaseResponse)) {
        return;
      }
    }
  })().catch(() => undefined);
}

function isFileLibraryListPendingRouteError(input: {
  statusCode: number;
  errorCode: string;
  message: string;
}): boolean {
  return input.statusCode === 409
    && input.errorCode === 'FILE_LIBRARY_OPERATION_PENDING'
    && input.message === 'file_library_list_pending';
}

function buildFileLibraryListPendingBody(): Record<string, unknown> {
  return {
    error_code: 'FILE_LIBRARY_OPERATION_PENDING',
    message: 'file_library_list_pending',
  };
}

function isRuntimeAccessReleaseBlocked(response: RuntimeAccessReleaseRouteResponse): boolean {
  return response.statusCode === 409
    && response.body.message === 'file_library_runtime_access_release_blocked';
}

async function convergeRuntimeAccessBeforeFileLibraryEntriesList(input: {
  deps: NodeApiDeps;
  storageAdapter: FileLibraryStoragePort;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  actorUserId: string;
  requestId?: string;
}): Promise<{ handled: false } | { handled: true; statusCode: number; body: Record<string, unknown> }> {
  const activeWriter = await findActiveRuntimeWriter({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
  });
  if (!activeWriter?.binding) {
    return { handled: false };
  }

  const listPendingObservedAtMs = Date.now();
  const releasePromise = releaseRuntimeAccessForFileLibrary({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.libraryId,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
  });
  const releaseResponse = await raceEntriesPendingRuntimeRelease(releasePromise);
  if (!releaseResponse || isRuntimeAccessReleaseReadExportPending(releaseResponse)) {
    scheduleListReadExportInvalidationAfterRuntimeRelease({
      deps: input.deps,
      storageAdapter: input.storageAdapter,
      releasePromise: releaseResponse
        ? Promise.resolve(runtimeAccessReleasePendingRecheckResponse(input.libraryId))
        : releasePromise,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      actorUserId: input.actorUserId,
      createdBeforeOrAtMs: listPendingObservedAtMs,
      requestId: input.requestId,
    });
    return {
      handled: true,
      statusCode: 409,
      body: buildFileLibraryListPendingBody(),
    };
  }
  if (shouldInvalidateListReadExportAfterRuntimeRelease(releaseResponse)) {
    await invalidateListReadExport({
      storageAdapter: input.storageAdapter,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      createdBeforeOrAtMs: listPendingObservedAtMs,
      requestId: input.requestId,
    });
    return { handled: false };
  }
  if (isRuntimeAccessReleaseBlocked(releaseResponse)) {
    return { handled: false };
  }
  if (releaseResponse.statusCode !== 200) {
    return {
      handled: true,
      statusCode: releaseResponse.statusCode,
      body: releaseResponse.body,
    };
  }
  return { handled: false };
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
    const requestId = readRequestId(req) ?? undefined;
    try {
      const operationRepo = new JsonDocFileLibraryVersionOperationRepo(deps.docStore);
      const versionOperation = await operationRepo.getByIdInProject(workspaceId, projectId, operationId);
      if (versionOperation) {
        const reconciled = await reconcileVersionOperationRecord({
          deps,
          operationRepo,
          workspaceId,
          projectId,
          libraryId: versionOperation.library_id,
          operation: versionOperation,
          requestId,
        });
        json(res, 200, operationRepo.toPublic(reconciled));
        return true;
      }

      const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
      const restoreOperation = await restoreRepo.getByPublicIdInProject(workspaceId, projectId, operationId);
      if (restoreOperation) {
        const reconciled = await reconcileRestoreOperationRecord({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId: restoreOperation.library_id,
          operation: restoreOperation,
          requestId,
        });
        json(res, 200, presentFileLibraryRestoreActiveOperation(reconciled));
        return true;
      }

      if (isBlockedRestoreOperationLookupId(operationId)) {
        json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'not_found' });
        return true;
      }

      if (!deps.fileLibraryStorageAdapter?.enabled) {
        json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
        return true;
      }
      const projection = await deps.fileLibraryStorageAdapter.getOperationProjection({
        workspaceId,
        projectId,
        operationId,
        requestId,
      });
      json(res, 200, presentStorageOperationProjection(projection));
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
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_task_file_template_request' });
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
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const existingTemplate = await templateRepo.findByIdempotencyKey({
      workspaceId,
      projectId,
      sourceLibraryId: parsed.data.source_library_id,
      idempotencyKey,
    });
    if (existingTemplate) {
      if (!isSameTaskFileTemplateCreateRequest({
        template: existingTemplate,
        sourceLibraryId: parsed.data.source_library_id,
        name: parsed.data.name,
        description: parsed.data.description,
        publishOnCreate: parsed.data.publish_on_create,
      })) {
        json(res, 409, {
          error_code: 'TASK_FILE_TEMPLATE_IDEMPOTENCY_CONFLICT',
          message: 'task_file_template_idempotency_conflict',
        });
        return true;
      }
      json(res, 200, templateRepo.toPublic(existingTemplate));
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
    const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(deps.docStore);
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    const templateId = buildTaskFileTemplateIdempotencyId({
      workspaceId,
      projectId,
      idempotencyKey,
    });
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
        idempotencyKey,
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
            purpose: 'template_source',
          })
        : null;
      const { template, created } = await templateRepo.createOrReuseByIdempotencyKey({
        workspaceId,
        projectId,
        name: parsed.data.name,
        description: parsed.data.description,
        status: parsed.data.publish_on_create ? 'published' : 'unpublished',
        sourceLibraryId: sourceLibrary.id,
        sourceSavePointId: sourceSavePoint?.id,
        sourceAfscpSavePointId: result.sourceSavePointId ?? undefined,
        createdByUserId: user.id,
        afscpTemplateId: result.templateId,
        afscpCreateOperationId: result.operationId ?? undefined,
        idempotencyKey,
        publishOnCreate: parsed.data.publish_on_create,
      });
      json(res, created ? 201 : 200, templateRepo.toPublic(template));
    } catch (error) {
      if (readErrorMessage(error) === 'task_file_template_idempotency_conflict') {
        json(res, 409, {
          error_code: 'TASK_FILE_TEMPLATE_IDEMPOTENCY_CONFLICT',
          message: 'task_file_template_idempotency_conflict',
        });
        return true;
      }
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
    if (
      existing.status === 'failed'
      || !existing.source_save_point_id
      || !existing.source_afscp_save_point_id
      || !existing.afscp_template_id
    ) {
      json(res, 409, {
        error_code: 'TASK_FILE_TEMPLATE_MATERIAL_NOT_READY',
        message: 'task_file_template_material_not_ready',
      });
      return true;
    }
    if (existing.status === 'published') {
      json(res, 200, templateRepo.toPublic(existing));
      return true;
    }
    try {
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
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    try {
      const requestId = readOptionalRequestId(req);
      if (routeKind === 'fileLibraryRuntimeAccessRelease' && method === 'POST') {
        const blocker = await findActiveRestoreBlockingRuntimeAccessRelease({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          requestId,
        });
        if (blocker) {
          throw new FileLibraryRestoreOperationActiveError(blocker);
        }
      } else {
        await ensureNoActiveRestoreOperation({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          requestId,
        });
      }
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
    const releaseResponse = await releaseRuntimeAccessForFileLibrary({
      deps,
      workspaceId,
      projectId,
      libraryId,
      actorUserId: user.id,
      requestId: readOptionalRequestId(req),
    });
    json(res, releaseResponse.statusCode, releaseResponse.body);
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
      await (deps.internalAgentWorkspaceBindingManager ?? deps.internalAgentWorkspaceProvisioner)?.deleteWorkspaceBinding({
        workspaceId,
        fileLibraryId: libraryId,
      });
      await deps.fileLibraryStorageAdapter.deleteRepoForLibrary({
        workspaceId,
        projectId,
        libraryId,
        actorUserId: user.id,
        requestId,
        reason: 'file_library_delete',
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
      } else if (mapped.context?.retryable === true) {
        await catalogRepo.update(workspaceId, projectId, libraryId, {
          status: 'deleting',
          delete_correlation_id: requestId,
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
        ...(mapped.context ?? {}),
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
    const operationRepo = new JsonDocFileLibraryVersionOperationRepo(deps.docStore);
    try {
      const message = parsed.data.message ?? 'Manual save point';
      const existingOperation = await operationRepo.findByIdempotencyKey(
        workspaceId,
        projectId,
        libraryId,
        'save_point_create',
        idempotencyKey,
      );
      if (existingOperation) {
        if ((existingOperation.message ?? undefined) !== (message ?? undefined)) {
          json(res, 409, {
            error_code: 'FILE_LIBRARY_IDEMPOTENCY_CONFLICT',
            message: 'file_library_idempotency_conflict',
          });
          return true;
        }
        json(res, 202, operationRepo.toPublic(existingOperation));
        return true;
      }
      const result = await deps.fileLibraryStorageAdapter.createSavePoint({
        workspaceId,
        projectId,
        libraryId,
        message,
        idempotencyKey,
        actorUserId: user.id,
        requestId: typeof req.headers?.['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
      });
      const resultSavePoint = result.savePointId
        ? await savePointRepo.upsertFromAfscp({
            workspaceId,
            projectId,
            libraryId,
            afscpSavePointId: result.savePointId,
            message,
            createdAt: result.createdAt,
            purpose: 'user',
          })
        : null;
      const { operation } = await operationRepo.createOrReuseByIdempotencyKey({
        workspaceId,
        projectId,
        libraryId,
        kind: 'save_point_create',
        status: mapStorageOperationStatusToVersionStatus(result.operationStatus),
        afscpOperationId: result.operationId,
        idempotencyKey,
        createdByUserId: user.id,
        message,
        failureReason: publicVersionOperationFailureReason({
          status: mapStorageOperationStatusToVersionStatus(result.operationStatus),
          fallback: 'file_library_save_point_create_failed',
        }) ?? undefined,
        resultSavePointId: resultSavePoint?.id,
      });
      json(res, 202, operationRepo.toPublic(operation));
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

  if (routeKind === 'fileLibraryActiveOperation' && method === 'GET') {
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    const operationRepo = new JsonDocFileLibraryVersionOperationRepo(deps.docStore);
    const requestId = readOptionalRequestId(req);
    try {
      const activeRestore = await findReconciledActiveRestoreOperation({
        deps,
        restoreRepo,
        workspaceId,
        projectId,
        libraryId,
        requestId,
        continuePreStart: true,
      });
      const activeVersionOperation = await findReconciledActiveVersionOperation({
        deps,
        operationRepo,
        workspaceId,
        projectId,
        libraryId,
        requestId,
      });
      const recentTerminalRestore = (!activeRestore && !activeVersionOperation)
        ? await findRecentTerminalRestoreOperation({
            restoreRepo,
            workspaceId,
            projectId,
            libraryId,
          })
        : null;
      const latest = pickLatestVersionOperation([
        ...(activeRestore ? [activeRestore] : []),
        ...(activeVersionOperation ? [activeVersionOperation] : []),
        ...(recentTerminalRestore ? [recentTerminalRestore] : []),
      ]);
      json(res, 200, {
        operation: latest
          ? 'kind' in latest
            ? operationRepo.toPublic(latest)
            : presentFileLibraryRestoreActiveOperation(latest)
          : null,
      });
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(
        error,
        'FILE_LIBRARY_OPERATION_PROJECTION_FAILED',
        'file_library_operation_projection_failed',
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
        const savePoint = await savePointRepo.getById(workspaceId, projectId, libraryId, parsed.data.save_point_id);
        if (
          existing.source_save_point_id !== parsed.data.save_point_id
          || (
            savePoint
            && existing.source_afscp_save_point_id !== savePoint.afscp_save_point_id
          )
        ) {
          json(res, 409, {
            error_code: 'FILE_LIBRARY_IDEMPOTENCY_CONFLICT',
            message: 'file_library_idempotency_conflict',
          });
          return true;
        }
        const reconciled = await reconcileRestoreOperationRecord({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          operation: existing,
          requestId,
        });
        const prepared = await preparePreStartRestoreOperationContinuation({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          operation: reconciled,
        });
        schedulePreStartRestoreOperationContinuation({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          operation: prepared,
          requestId,
        });
        json(res, 200, restoreRepo.toPublic(prepared));
        return true;
      }

      const savePoint = await savePointRepo.getById(workspaceId, projectId, libraryId, parsed.data.save_point_id);
      if (!savePoint) {
        json(res, 404, {
          error_code: 'FILE_LIBRARY_SAVE_POINT_NOT_FOUND',
          message: 'file_library_save_point_not_found',
        });
        return true;
      }

      const active = await findReconciledActiveRestoreOperation({
        deps,
        restoreRepo,
        workspaceId,
        projectId,
        libraryId,
        requestId,
        continuePreStart: true,
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
        const prepared = await preparePreStartRestoreOperationContinuation({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          operation: reconciled,
        });
        schedulePreStartRestoreOperationContinuation({
          deps,
          restoreRepo,
          workspaceId,
          projectId,
          libraryId,
          operation: prepared,
          requestId,
        });
        json(res, 200, restoreRepo.toPublic(prepared));
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

      schedulePreStartRestoreOperationContinuation({
        deps,
        restoreRepo,
        workspaceId,
        projectId,
        libraryId,
        operation: startedOperation,
        requestId,
      });
      json(res, 200, restoreRepo.toPublic(startedOperation));
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
          status: restoreFailureStatusForPublicMessage(mapped.message),
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
    const requestId = readOptionalRequestId(req);
    const listInput = {
      workspaceId,
      projectId,
      libraryId,
      path: parsed.data.path ? ensureDirectoryPath(parsed.data.path) : '',
      pageSize: parsed.data.page_size ?? 200,
      continuationToken: parsed.data.continuation_token,
      search: parsed.data.search,
      sortBy: parsed.data.sort_by ?? 'name',
      sortOrder: parsed.data.sort_order ?? 'asc',
      requestId,
    } as const;
    const runtimeAccessConvergence = await convergeRuntimeAccessBeforeFileLibraryEntriesList({
      deps,
      storageAdapter: deps.fileLibraryStorageAdapter,
      workspaceId,
      projectId,
      libraryId,
      actorUserId: user.id,
      requestId,
    });
    if (runtimeAccessConvergence.handled) {
      json(res, runtimeAccessConvergence.statusCode, runtimeAccessConvergence.body);
      return true;
    }
    try {
      const listed = await deps.fileLibraryStorageAdapter.listEntries(listInput);
      json(res, 200, {
        path: listed.path,
        items: listed.items.map(presentFileLibraryEntry),
        next_continuation_token: listed.nextContinuationToken,
      });
    } catch (error) {
      const mapped = mapFileLibraryControlRouteError(error, 'FILE_LIBRARY_LIST_FAILED', 'file_library_list_failed');
      if (isFileLibraryListPendingRouteError(mapped)) {
        const listPendingObservedAtMs = Date.now();
        const releasePromise = releaseRuntimeAccessForFileLibrary({
          deps,
          workspaceId,
          projectId,
          libraryId,
          actorUserId: user.id,
          requestId,
        });
        const releaseResponse = await raceEntriesPendingRuntimeRelease(releasePromise);
        if (releaseResponse && shouldInvalidateListReadExportAfterRuntimeRelease(releaseResponse)) {
          await invalidateListReadExport({
            storageAdapter: deps.fileLibraryStorageAdapter,
            workspaceId,
            projectId,
            libraryId,
            createdBeforeOrAtMs: listPendingObservedAtMs,
            requestId,
          });
        } else if (!releaseResponse || runtimeAccessReleasePending(releaseResponse)) {
          scheduleListReadExportInvalidationAfterRuntimeRelease({
            deps,
            storageAdapter: deps.fileLibraryStorageAdapter,
            releasePromise: releaseResponse ? Promise.resolve(releaseResponse) : releasePromise,
            workspaceId,
            projectId,
            libraryId,
            actorUserId: user.id,
            createdBeforeOrAtMs: listPendingObservedAtMs,
            requestId,
          });
        }
      }
      json(res, mapped.statusCode, {
        error_code: mapped.errorCode,
        message: mapped.message,
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
      json(res, 201, presentFileLibraryEntry(uploaded));
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
      json(res, 200, presentFileLibraryObjectMeta(meta));
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
