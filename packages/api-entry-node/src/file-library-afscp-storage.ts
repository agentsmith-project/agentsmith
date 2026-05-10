import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { JsonDocStorePort } from '@mbos/ports';
import type {
  AfscpExportAccessCredential,
  AfscpExportCreateOperationEnvelope,
  AfscpExportMode,
  AfscpOperationEnvelope,
  AfscpOperationRecord,
  AfscpProductClientPort,
  AfscpSavePoint,
} from './afscp-client.js';
import {
  AfscpClientError,
  sanitizeAfscpOperationId,
} from './afscp-error-mapper.js';
import type {
  ProjectAfscpNamespaceStore,
  ProjectAfscpResourceOwnershipStore,
} from './project-afscp-namespace-store.js';
import type {
  FileLibraryRestorePreviewBlocker,
  FileLibraryRestorePreviewBlockerCode,
  FileLibraryRestorePreviewSummary,
} from './file-library-persistence.js';
import { normalizeAfscpValidatedValue } from './afscp-validation.js';
import { guessFileLibraryContentType } from './file-library-content-type.js';
import { createAbortError } from './object-stream-bridge.js';

export const FILE_LIBRARY_AFSCP_MAPPING_COLLECTION = 'project_file_library_afscp_mappings';

export type FileLibraryStorageOperationStatus =
  | 'pending'
  | 'succeeded'
  | 'failed';

export interface FileLibraryAfscpSavePoint {
  savePointId: string;
  repoId: string;
  message?: string;
  createdAt: string;
}

export interface FileLibraryStorageOperationResult {
  operationId: string | null;
  operationStatus: FileLibraryStorageOperationStatus;
}

export class FileLibraryStorageOperationPendingError extends Error {
  readonly operationId: string | null;
  readonly operationStatus: Extract<FileLibraryStorageOperationStatus, 'pending'> = 'pending';

  constructor(input: {
    message: string;
    operationId: string | null;
  }) {
    super(input.message);
    this.name = 'FileLibraryStorageOperationPendingError';
    this.operationId = input.operationId;
  }
}

export interface FileLibraryOperationProjection {
  operation_id: string;
  operation_state: string;
  operation_type?: string;
  resource?: {
    type: string;
  };
  error: {
    code: string;
    retryable?: boolean;
  } | null;
  created_at?: string;
  started_at?: string;
  updated_at?: string;
  finished_at?: string;
}

export interface FileLibrarySavePointCreateResult extends FileLibraryStorageOperationResult {
  savePointId: string | null;
  createdAt?: string;
}

export interface FileLibraryRestoreOperationResult extends FileLibraryStorageOperationResult {
  restorePlanId: string | null;
  sourceSavePointId: string | null;
  summary?: FileLibraryRestorePreviewSummary;
  blockers?: FileLibraryRestorePreviewBlocker[];
  stale?: boolean;
}

export interface FileLibraryTemplateCreateResult extends FileLibraryStorageOperationResult {
  templateId: string;
  sourceSavePointId: string | null;
}

export interface ProjectFileLibraryAfscpMapping {
  id: string;
  workspace_id: string;
  project_id: string;
  library_id: string;
  namespace_id: string;
  repo_id: string;
  project_storage_generation: number;
  operation_id: string | null;
  operation_status: FileLibraryStorageOperationStatus;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

export type FileLibraryEntry =
  | {
      kind: 'directory';
      path: string;
      name: string;
    }
  | {
      kind: 'file';
      path: string;
      name: string;
      size_bytes: number;
      content_type?: string;
      modified_at: string;
      etag?: string;
    };

export interface FileLibraryObjectMeta {
  key: string;
  size_bytes: number;
  content_type: string;
  etag?: string;
  last_modified: string;
  user_metadata: Record<string, string>;
}

export interface FileLibraryDownloadHandle {
  stream: Readable;
  cancel: (reason?: unknown) => Promise<void>;
}

export interface FileLibraryDownloadResult {
  meta: FileLibraryObjectMeta;
  download: FileLibraryDownloadHandle;
}

export interface FileLibraryStoragePort {
  readonly enabled: boolean;
  getOperationProjection(input: {
    workspaceId: string;
    projectId: string;
    operationId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryOperationProjection>;
  createRepoForLibrary(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    namespaceId: string;
    projectStorageGeneration: number;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<{
    namespaceId: string;
    repoId: string;
    operationId: string | null;
    operationStatus: FileLibraryStorageOperationStatus;
    projectStorageGeneration: number;
  }>;
  deleteRepoForLibrary(input: FileLibraryStorageLibraryInput & {
    actorUserId: string;
    requestId?: string;
    reason?: string;
    signal?: AbortSignal;
  }): Promise<void>;
  assertEmpty(input: FileLibraryStorageLibraryInput & { requestId?: string; signal?: AbortSignal }): Promise<void>;
  listSavePoints(input: FileLibraryStorageLibraryInput & {
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryAfscpSavePoint[]>;
  createSavePoint(input: FileLibraryStorageLibraryInput & {
    message: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibrarySavePointCreateResult>;
  createRestorePreview(input: FileLibraryStorageLibraryInput & {
    savePointId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryRestoreOperationResult>;
  runRestorePreview(input: FileLibraryStorageLibraryInput & {
    previewOperationId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryRestoreOperationResult>;
  discardRestorePreview(input: FileLibraryStorageLibraryInput & {
    previewOperationId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryRestoreOperationResult>;
  createTemplateFromLibrary(input: FileLibraryStorageLibraryInput & {
    templateId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryTemplateCreateResult>;
  cloneTemplateToLibrary(input: FileLibraryStorageLibraryInput & {
    namespaceId: string;
    projectStorageGeneration: number;
    templateId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<{
    namespaceId: string;
    repoId: string;
    operationId: string | null;
    operationStatus: FileLibraryStorageOperationStatus;
    projectStorageGeneration: number;
  }>;
  listEntries(input: FileLibraryStorageLibraryInput & {
    path: string;
    pageSize: number;
    continuationToken?: string;
    search?: string;
    sortBy: 'name' | 'size_bytes' | 'modified_at';
    sortOrder: 'asc' | 'desc';
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<{
    path: string;
    items: FileLibraryEntry[];
    nextContinuationToken: string | null;
  }>;
  createFolder(input: FileLibraryStorageLibraryInput & {
    folderPath: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<void>;
  deletePaths(input: FileLibraryStorageLibraryInput & {
    paths: string[];
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<Array<{ path: string; status: 'deleted' | 'not_found' | 'error'; error_code?: string; message?: string }>>;
  moveEntry(input: FileLibraryStorageLibraryInput & {
    fromPath: string;
    toPath: string;
    overwrite: boolean;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<void>;
  uploadObject(input: FileLibraryStorageLibraryInput & {
    objectPath: string;
    body: WebReadableStream<Uint8Array>;
    contentType?: string;
    overwrite: boolean;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<Extract<FileLibraryEntry, { kind: 'file' }>>;
  downloadObject(input: FileLibraryStorageLibraryInput & {
    objectPath: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryDownloadResult>;
  getObjectMeta(input: FileLibraryStorageLibraryInput & {
    objectPath: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryObjectMeta>;
}

interface FileLibraryStorageLibraryInput {
  workspaceId: string;
  projectId: string;
  libraryId: string;
}

interface WebdavExportContext {
  mapping: ProjectFileLibraryAfscpMapping;
  access: AfscpExportAccessCredential;
  exportId: string;
}

interface AfscpFileLibraryStorageAdapterOptions {
  client: AfscpProductClientPort;
  mappingRepo: JsonDocProjectFileLibraryAfscpMappingRepo;
  projectAfscpNamespaceStore: ProjectAfscpNamespaceStore;
  resourceOwnershipStore: ProjectAfscpResourceOwnershipStore;
  fetchFn?: typeof fetch;
  nowIso?: () => string;
}

const OPERATION_TERMINAL_STATES = new Set(['succeeded', 'success', 'completed', 'ready', 'failed', 'failure', 'error', 'errored', 'cancelled', 'canceled']);
const OPERATION_SUCCESS_STATES = new Set(['succeeded', 'success', 'completed', 'ready']);
const HEADER_SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;
const EXPORT_REVOKE_TIMEOUT_MS = 2500;
const PUBLIC_STORAGE_ERROR_MESSAGES = new Set([
  'file_library_backend_unavailable',
  'file_library_object_not_found',
  'file_library_destination_exists',
  'file_library_download_failed',
  'file_library_upload_failed',
  'file_library_delete_failed',
  'file_library_move_failed',
  'file_library_list_failed',
  'file_library_meta_failed',
  'file_library_folder_create_failed',
  'file_library_export_access_unavailable',
  'file_library_afscp_mapping_not_found',
  'file_library_afscp_mapping_not_ready',
  'file_library_project_storage_not_ready',
  'file_library_project_storage_generation_mismatch',
  'invalid_file_library_path',
  'invalid_file_library_directory_path',
  'file_library_save_point_create_failed',
  'file_library_save_point_list_failed',
  'file_library_restore_preview_failed',
  'file_library_restore_run_failed',
  'file_library_restore_discard_failed',
  'file_library_template_create_failed',
  'file_library_template_clone_failed',
  'file_library_restore_preview_stale',
  'file_library_active_writer_blocked',
  'file_library_namespace_project_mismatch',
  'file_library_template_clone_not_allowed',
  'file_library_capability_denied',
  'file_library_storage_admin_action_required',
]);

type AfscpStorageFailureContext =
  | 'restore_preview'
  | 'restore_run'
  | 'restore_discard'
  | 'template_create'
  | 'template_clone'
  | 'generic';

const RESTORE_STALE_OPERATION_CODES = new Set([
  'RESTORE_PREVIEW_STALE',
  'OPERATION_NOT_FOUND',
  'RESTORE_RUN_PREVIEW_OPERATION_INVALID',
  'RESTORE_RUN_PLAN_INVALID',
  'RESTORE_RUN_PLAN_MISMATCH',
  'RESTORE_RUN_PLAN_NOT_PENDING',
  'RESTORE_RUN_PLAN_NOT_CONSUMING',
]);

const WRITER_BLOCKER_OPERATION_CODES = new Set([
  'ACTIVE_WRITER_SESSIONS',
  'STALE_WRITER_SESSION_UNCERTAIN',
  'WRITER_SESSION_FENCE_HELD',
  'RESTORE_RUN_WRITER_SESSIONS_DENIED',
]);

function mappingId(input: FileLibraryStorageLibraryInput): string {
  return `${input.workspaceId}:${input.projectId}:${input.libraryId}`;
}

function normalizeOperationStatus(value: unknown): FileLibraryStorageOperationStatus {
  if (typeof value !== 'string') {
    return 'pending';
  }
  const normalized = value.trim().toLowerCase();
  if (OPERATION_SUCCESS_STATES.has(normalized)) {
    return 'succeeded';
  }
  if (OPERATION_TERMINAL_STATES.has(normalized)) {
    return 'failed';
  }
  return 'pending';
}

function readOperationId(operation: AfscpOperationEnvelope | AfscpOperationRecord): string | null {
  return typeof operation.operation_id === 'string' ? operation.operation_id : null;
}

function readSafeOperationId(value: unknown): string | null {
  return typeof value === 'string' ? sanitizeAfscpOperationId(value) ?? null : null;
}

function readOperationProjectionString(operation: AfscpOperationEnvelope | AfscpOperationRecord, key: string): string | undefined {
  const value = (operation as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readOperationProjectionError(operation: AfscpOperationEnvelope | AfscpOperationRecord): FileLibraryOperationProjection['error'] {
  const error = operation.error;
  if (!isRecord(error)) {
    return null;
  }
  const rawCode = error.code;
  const code = typeof rawCode === 'string' && ERROR_CODE_PATTERN.test(rawCode.trim())
    ? rawCode.trim()
    : 'afscp_operation_failed';
  return {
    code,
    ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
  };
}

function buildOperationProjection(operation: AfscpOperationEnvelope | AfscpOperationRecord): FileLibraryOperationProjection {
  const operationId = readSafeOperationId((operation as Record<string, unknown>).operation_id);
  if (!operationId) {
    throw new Error('file_library_operation_projection_unavailable');
  }
  const operationState = readOperationProjectionString(operation, 'operation_state') ?? 'unknown';
  const operationType = readOperationProjectionString(operation, 'operation_type');
  const resource = isRecord(operation.resource) && typeof operation.resource.type === 'string' && operation.resource.type.trim()
    ? { type: operation.resource.type.trim() }
    : undefined;
  const createdAt = readOperationProjectionString(operation, 'created_at');
  const startedAt = readOperationProjectionString(operation, 'started_at');
  const updatedAt = readOperationProjectionString(operation, 'updated_at');
  const finishedAt = readOperationProjectionString(operation, 'finished_at');
  return {
    operation_id: operationId,
    operation_state: operationState,
    ...(operationType ? { operation_type: operationType } : {}),
    ...(resource ? { resource } : {}),
    error: readOperationProjectionError(operation),
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(startedAt ? { started_at: startedAt } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {}),
    ...(finishedAt ? { finished_at: finishedAt } : {}),
  };
}

function readOperationErrorCode(
  operation: AfscpOperationEnvelope | AfscpOperationRecord,
  fallback: string,
): string {
  if (isRecord(operation.error)) {
    const code = operation.error.code;
    if (typeof code === 'string') {
      const trimmed = code.trim();
      if (ERROR_CODE_PATTERN.test(trimmed)) {
        return trimmed;
      }
    }
  }
  return fallback;
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readOperationResourceId(operation: AfscpOperationEnvelope | AfscpOperationRecord, type: string): string | null {
  const resource = isRecord(operation.resource) ? operation.resource : null;
  if (resource?.type === type && typeof resource.id === 'string' && resource.id.trim()) {
    return resource.id;
  }
  return null;
}

function readOperationValue(operation: AfscpOperationEnvelope | AfscpOperationRecord, key: string): unknown {
  const root = operation as Record<string, unknown>;
  if (root[key] !== undefined) {
    return root[key];
  }
  for (const containerKey of ['external_resource_ids', 'verification_result', 'result', 'metadata']) {
    const container = root[containerKey];
    if (isRecord(container) && container[key] !== undefined) {
      return container[key];
    }
  }
  const jvsOutput = root.jvs_json_output;
  if (isRecord(jvsOutput) && jvsOutput[key] !== undefined) {
    return jvsOutput[key];
  }
  if (typeof jvsOutput === 'string' && jvsOutput.trim()) {
    try {
      const parsed = JSON.parse(jvsOutput) as unknown;
      if (isRecord(parsed)) {
        return parsed[key];
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function readOperationString(operation: AfscpOperationEnvelope | AfscpOperationRecord, key: string): string | null {
  const value = readOperationValue(operation, key);
  return typeof value === 'string' && value.trim() ? value : null;
}

function readSavePointId(operation: AfscpOperationEnvelope | AfscpOperationRecord): string | null {
  return readOperationString(operation, 'save_point_id')
    ?? readOperationResourceId(operation, 'save_point');
}

function readRestorePlanId(operation: AfscpOperationEnvelope | AfscpOperationRecord): string | null {
  return readOperationString(operation, 'restore_plan_id')
    ?? readOperationResourceId(operation, 'restore_plan');
}

function readSourceSavePointId(operation: AfscpOperationEnvelope | AfscpOperationRecord): string | null {
  return readOperationString(operation, 'source_save_point_id');
}

function readTemplateId(operation: AfscpOperationEnvelope | AfscpOperationRecord): string | null {
  return readOperationString(operation, 'template_id')
    ?? readOperationResourceId(operation, 'repo_template');
}

function isRepoDeleteOperation(operation: AfscpOperationEnvelope | AfscpOperationRecord): boolean {
  const operationType = readOperationProjectionString(operation, 'operation_type')?.toLowerCase();
  return !operationType || operationType === 'repo_delete' || operationType === 'delete_repo';
}

function readSavePointCreatedAt(operation: AfscpOperationEnvelope | AfscpOperationRecord): string | undefined {
  return readOperationString(operation, 'created_at') ?? undefined;
}

function readOperationBoolean(operation: AfscpOperationEnvelope | AfscpOperationRecord, key: string): boolean | undefined {
  const value = readOperationValue(operation, key);
  return typeof value === 'boolean' ? value : undefined;
}

function readRestorePreviewSummary(
  operation: AfscpOperationEnvelope | AfscpOperationRecord,
): FileLibraryRestorePreviewSummary | undefined {
  const value = readOperationValue(operation, 'summary');
  if (!isRecord(value)) {
    return undefined;
  }
  const added = readRestorePreviewChangeSummary(value.added);
  const changed = readRestorePreviewChangeSummary(value.changed);
  const removed = readRestorePreviewChangeSummary(value.removed);
  if (!added || !changed || !removed || typeof value.destructive !== 'boolean') {
    return undefined;
  }
  return {
    added,
    changed,
    removed,
    destructive: value.destructive,
  };
}

function readRestorePreviewChangeSummary(value: unknown): FileLibraryRestorePreviewSummary['added'] | null {
  if (!isRecord(value)) {
    return null;
  }
  const count = value.count;
  const samplesValue = value.samples;
  if (!Number.isSafeInteger(count) || typeof count !== 'number' || count < 0 || !Array.isArray(samplesValue)) {
    return null;
  }
  const samples = samplesValue.filter((sample): sample is string => typeof sample === 'string' && sample.trim() !== '');
  if (samples.length !== samplesValue.length) {
    return null;
  }
  return { count, samples };
}

const RESTORE_PREVIEW_BLOCKER_CODES = new Set<FileLibraryRestorePreviewBlockerCode>([
  'active_writer_sessions',
  'stale_writer_session_uncertain',
  'restore_preview_stale',
  'restore_plan_requires_recovery',
]);

function readRestorePreviewBlockers(
  operation: AfscpOperationEnvelope | AfscpOperationRecord,
): FileLibraryRestorePreviewBlocker[] | undefined {
  const value = readOperationValue(operation, 'blockers');
  if (!Array.isArray(value)) {
    return undefined;
  }
  const blockers: FileLibraryRestorePreviewBlocker[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.code !== 'string') {
      return undefined;
    }
    const code = normalizeRestorePreviewBlockerCode(item.code);
    if (!code) {
      return undefined;
    }
    const message = typeof item.message === 'string' && item.message.trim() ? item.message : undefined;
    blockers.push({
      code,
      ...(message ? { message } : {}),
    });
  }
  return blockers;
}

function normalizeRestorePreviewBlockerCode(value: string): FileLibraryRestorePreviewBlockerCode | null {
  const normalized = value.trim().toLowerCase();
  if (RESTORE_PREVIEW_BLOCKER_CODES.has(normalized as FileLibraryRestorePreviewBlockerCode)) {
    return normalized as FileLibraryRestorePreviewBlockerCode;
  }
  switch (value.trim()) {
    case 'ACTIVE_WRITER_SESSIONS':
      return 'active_writer_sessions';
    case 'STALE_WRITER_SESSION_UNCERTAIN':
      return 'stale_writer_session_uncertain';
    case 'RESTORE_PREVIEW_STALE':
      return 'restore_preview_stale';
    case 'OPERATION_RECOVERY_REQUIRED':
      return 'restore_plan_requires_recovery';
    default:
      return null;
  }
}

function normalizeAfscpSavePoint(record: AfscpSavePoint): FileLibraryAfscpSavePoint | null {
  const savePointId = readStringField(record, 'save_point_id');
  const createdAt = readStringField(record, 'created_at');
  if (!savePointId || !createdAt) {
    return null;
  }
  const message = readStringField(record, 'message') ?? undefined;
  return {
    savePointId,
    repoId: readStringField(record, 'repo_id') ?? '',
    ...(message ? { message } : {}),
    createdAt,
  };
}

function safeStorageErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (PUBLIC_STORAGE_ERROR_MESSAGES.has(message)) {
    return message;
  }
  return fallback;
}

function isRestoreRunContext(context: AfscpStorageFailureContext | undefined): boolean {
  return context === 'restore_run' || context === 'restore_discard';
}

function mapAfscpClientErrorToStorageMessage(
  error: unknown,
  fallback: string,
  context: AfscpStorageFailureContext = 'generic',
): string {
  if (!(error instanceof AfscpClientError)) {
    return fallback;
  }

  switch (error.code) {
    case 'afscp_restore_preview_stale':
      return 'file_library_restore_preview_stale';
    case 'afscp_active_writer_blocks_restore':
      return 'file_library_active_writer_blocked';
    case 'afscp_resource_not_found':
      return isRestoreRunContext(context)
        ? 'file_library_restore_preview_stale'
        : 'file_library_namespace_project_mismatch';
    case 'afscp_template_clone_not_allowed':
      return 'file_library_template_clone_not_allowed';
    case 'afscp_capability_denied':
      return 'file_library_capability_denied';
    case 'afscp_service_permission_denied':
    case 'afscp_volume_mismatch_requires_admin':
    case 'afscp_operator_recovery_required':
    case 'afscp_service_configuration_error':
      return 'file_library_storage_admin_action_required';
    case 'unavailable':
      return 'file_library_backend_unavailable';
    default:
      return fallback;
  }
}

function mapAfscpOperationFailureMessage(
  operation: AfscpOperationEnvelope | AfscpOperationRecord,
  fallback: string,
): string {
  const code = readOperationErrorCode(operation, fallback);
  const writerGateFamily = readOperationString(operation, 'writer_gate_error_family');
  if (
    WRITER_BLOCKER_OPERATION_CODES.has(code)
    || writerGateFamily === 'ACTIVE_WRITER_SESSIONS'
    || writerGateFamily === 'STALE_WRITER_SESSION_UNCERTAIN'
  ) {
    return 'file_library_active_writer_blocked';
  }

  if (RESTORE_STALE_OPERATION_CODES.has(code)) {
    return 'file_library_restore_preview_stale';
  }

  if (code === 'CAPABILITY_DENIED') {
    return 'file_library_capability_denied';
  }

  if (code === 'VOLUME_MISMATCH_REQUIRES_IMPORT' || code === 'OPERATION_RECOVERY_REQUIRED') {
    return 'file_library_storage_admin_action_required';
  }

  return fallback;
}

function requireProjectStorageGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('file_library_project_storage_generation_required');
  }
  return value;
}

function buildProductClientBoundary(client: AfscpProductClientPort): AfscpProductClientPort {
  return {
    createRepo: (input) => client.createRepo(input),
    listRepos: (input) => client.listRepos(input),
    getRepo: (input) => client.getRepo(input),
    deleteRepo: (input) => client.deleteRepo(input),
    listSavePoints: (input) => client.listSavePoints(input),
    createSavePoint: (input) => client.createSavePoint(input),
    createRestorePreview: (input) => client.createRestorePreview(input),
    runRestorePreview: (input) => client.runRestorePreview(input),
    discardRestorePreview: (input) => client.discardRestorePreview(input),
    createRepoTemplate: (input) => client.createRepoTemplate(input),
    cloneRepoTemplate: (input) => client.cloneRepoTemplate(input),
    createExport: (input) => client.createExport(input),
    getExport: (input) => client.getExport(input),
    revokeExport: (input) => client.revokeExport(input),
    createWorkloadMountBinding: (input) => client.createWorkloadMountBinding(input),
    getWorkloadMountBinding: (input) => client.getWorkloadMountBinding(input),
    revokeWorkloadMountBinding: (input) => client.revokeWorkloadMountBinding(input),
    getOperation: (input) => client.getOperation(input),
    pollOperation: (input) => client.pollOperation(input),
  };
}

function buildRepoId(libraryId: string): string {
  const suffix = libraryId
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 58);
  return `repo_${suffix || randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function safeIdempotencyKey(parts: string[]): string {
  const joined = parts
    .map((part) => part.trim().replace(/[^A-Za-z0-9._:-]+/g, '-'))
    .filter(Boolean)
    .join(':')
    .slice(0, 180);
  if (HEADER_SAFE_ID_PATTERN.test(joined)) {
    return joined;
  }
  return `file-library:${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function resolveCorrelationId(requestId: string | undefined, fallbackPrefix: string): string {
  const fromRequest = normalizeAfscpValidatedValue('correlation_id', requestId);
  if (fromRequest) {
    return fromRequest;
  }
  return `${fallbackPrefix}-${Date.now().toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readExportAccess(envelope: AfscpExportCreateOperationEnvelope): {
  exportId: string;
  access: AfscpExportAccessCredential;
} {
  const result = envelope.result;
  if (!isRecord(result) || !isRecord(result.access)) {
    throw new Error('file_library_export_access_unavailable');
  }
  const access = result.access;
  const url = typeof access.url === 'string' ? access.url : '';
  const mode = access.mode === 'read_only' || access.mode === 'read_write' ? access.mode : null;
  const expiresAt = typeof access.expires_at === 'string' ? access.expires_at : '';
  const auth = isRecord(access.auth) ? access.auth : null;
  const username = typeof auth?.username === 'string' ? auth.username : '';
  const password = typeof auth?.password === 'string' ? auth.password : '';
  const authType = auth?.type;
  const exportSession = isRecord(result.export) ? result.export : null;
  const exportId = typeof exportSession?.export_id === 'string'
    ? exportSession.export_id
    : typeof envelope.resource?.id === 'string'
      ? envelope.resource.id
      : '';
  if (!url || !mode || !expiresAt || authType !== 'basic' || !username || !password || !exportId) {
    throw new Error('file_library_export_access_unavailable');
  }
  return {
    exportId,
    access: {
      url,
      mode,
      expires_at: expiresAt,
      auth: {
        type: 'basic',
        username,
        password,
      },
    },
  };
}

function ensureOk(response: Response, fallbackMessage: string): void {
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('file_library_object_not_found');
    }
    if (response.status === 409 || response.status === 412) {
      throw new Error('file_library_destination_exists');
    }
    throw new Error(fallbackMessage);
  }
}

function basicAuthorization(access: AfscpExportAccessCredential): string {
  return `Basic ${Buffer.from(`${access.auth.username}:${access.auth.password}`, 'utf8').toString('base64')}`;
}

export function normalizeAfscpFileLibraryPath(input: string): string {
  const trimmed = input.trim().replace(/^\/+/, '');
  const decoded = decodeURIComponent(trimmed);
  const segments = decoded
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.some((segment) => segment === '..' || segment.includes('\\'))) {
    throw new Error('invalid_file_library_path');
  }
  return segments.join('/');
}

function ensureDirectoryPath(path: string): string {
  const normalized = normalizeAfscpFileLibraryPath(path);
  if (!normalized) {
    throw new Error('invalid_file_library_directory_path');
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function pathName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.split('/').at(-1) ?? trimmed;
}

function buildWebdavUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, '');
  if (!normalizedPath) {
    return normalizedBase;
  }
  const encoded = normalizedPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${normalizedBase}${encoded}${normalizedPath.endsWith('/') ? '/' : ''}`;
}

function parseHttpDate(value: string | null): string {
  if (!value) {
    return new Date().toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function responseMeta(path: string, response: Response): FileLibraryObjectMeta {
  const contentType = response.headers.get('Content-Type') ?? guessFileLibraryContentType(path) ?? 'application/octet-stream';
  return {
    key: path,
    size_bytes: Number.parseInt(response.headers.get('Content-Length') ?? '0', 10) || 0,
    content_type: contentType,
    etag: response.headers.get('ETag') ?? undefined,
    last_modified: parseHttpDate(response.headers.get('Last-Modified')),
    user_metadata: {
      ...(contentType ? { 'content-type': contentType } : {}),
    },
  };
}

function textContent(input: string, tag: string): string | undefined {
  const match = input.match(new RegExp(`<[^>]*:?${tag}[^>]*>([\\s\\S]*?)</[^>]*:?${tag}>`, 'i'));
  return match?.[1]?.replace(/<[^>]+>/g, '').trim();
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseWebdavEntries(xml: string, basePath: string): FileLibraryEntry[] {
  const entries: FileLibraryEntry[] = [];
  const responsePattern = /<[^>]*:?response[^>]*>([\s\S]*?)<\/[^>]*:?response>/gi;
  let match: RegExpExecArray | null;
  while ((match = responsePattern.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const href = textContent(block, 'href');
    if (!href) continue;
    const urlPath = decodeXmlText(href).split('?')[0] ?? '';
    const decodedPath = decodeURIComponent(urlPath).replace(/^\/+/, '');
    const normalizedPath = decodedPath.endsWith('/') ? decodedPath : normalizeAfscpFileLibraryPath(decodedPath);
    const path = normalizedPath.startsWith(basePath) || !basePath
      ? normalizedPath
      : `${basePath}${pathName(normalizedPath)}`;
    if (path === basePath) {
      continue;
    }
    const isDirectory = /<[^>]*:?collection(?:\s[^>]*)?\/?>/i.test(block);
    if (isDirectory) {
      const directoryPath = path.endsWith('/') ? path : `${path}/`;
      entries.push({
        kind: 'directory',
        path: directoryPath,
        name: pathName(directoryPath),
      });
      continue;
    }
    const size = Number.parseInt(textContent(block, 'getcontentlength') ?? '0', 10) || 0;
    const modified = textContent(block, 'getlastmodified');
    entries.push({
      kind: 'file',
      path,
      name: pathName(path),
      size_bytes: size,
      content_type: textContent(block, 'getcontenttype') ?? guessFileLibraryContentType(path),
      modified_at: parseHttpDate(modified ?? null),
      etag: textContent(block, 'getetag'),
    });
  }
  return entries;
}

class DisabledFileLibraryStorageAdapter implements FileLibraryStoragePort {
  readonly enabled = false;

  async getOperationProjection(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async createRepoForLibrary(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async deleteRepoForLibrary(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async assertEmpty(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async listSavePoints(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async createSavePoint(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async createRestorePreview(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async runRestorePreview(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async discardRestorePreview(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async createTemplateFromLibrary(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async cloneTemplateToLibrary(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async listEntries(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async createFolder(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async deletePaths(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async moveEntry(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async uploadObject(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async downloadObject(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }

  async getObjectMeta(): Promise<never> {
    throw new Error('file_library_backend_unavailable');
  }
}

export class JsonDocProjectFileLibraryAfscpMappingRepo {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async getByLibraryId(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<ProjectFileLibraryAfscpMapping | null> {
    const record = await this.docStore.get<ProjectFileLibraryAfscpMapping>(
      FILE_LIBRARY_AFSCP_MAPPING_COLLECTION,
      mappingId({ workspaceId, projectId, libraryId }),
    );
    if (!record || record.workspace_id !== workspaceId || record.project_id !== projectId) {
      return null;
    }
    return record;
  }

  async saveReady(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    namespaceId: string;
    repoId: string;
    projectStorageGeneration: number;
    operationId: string | null;
    operationStatus?: FileLibraryStorageOperationStatus;
    lastErrorCode?: string | null;
  }): Promise<ProjectFileLibraryAfscpMapping> {
    const existing = await this.getByLibraryId(input.workspaceId, input.projectId, input.libraryId);
    const now = this.nowIso();
    const record: ProjectFileLibraryAfscpMapping = {
      id: mappingId(input),
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      library_id: input.libraryId,
      namespace_id: input.namespaceId,
      repo_id: input.repoId,
      project_storage_generation: input.projectStorageGeneration,
      operation_id: input.operationId,
      operation_status: input.operationStatus ?? 'succeeded',
      last_error_code: input.lastErrorCode ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.docStore.upsert(FILE_LIBRARY_AFSCP_MAPPING_COLLECTION, record.id, record);
    return record;
  }

  async updateOperation(input: FileLibraryStorageLibraryInput & {
    operationId: string | null;
    operationStatus: FileLibraryStorageOperationStatus;
    lastErrorCode?: string | null;
  }): Promise<ProjectFileLibraryAfscpMapping | null> {
    const existing = await this.getByLibraryId(input.workspaceId, input.projectId, input.libraryId);
    if (!existing) return null;
    const next: ProjectFileLibraryAfscpMapping = {
      ...existing,
      operation_id: input.operationId,
      operation_status: input.operationStatus,
      last_error_code: input.lastErrorCode ?? null,
      updated_at: this.nowIso(),
    };
    await this.docStore.upsert(FILE_LIBRARY_AFSCP_MAPPING_COLLECTION, next.id, next);
    return next;
  }

  async delete(workspaceId: string, projectId: string, libraryId: string): Promise<void> {
    await this.docStore.delete(FILE_LIBRARY_AFSCP_MAPPING_COLLECTION, mappingId({ workspaceId, projectId, libraryId }));
  }
}

export class AfscpFileLibraryStorageAdapter implements FileLibraryStoragePort {
  readonly enabled = true;
  private readonly client: AfscpProductClientPort;
  private readonly mappingRepo: JsonDocProjectFileLibraryAfscpMappingRepo;
  private readonly projectAfscpNamespaceStore: ProjectAfscpNamespaceStore;
  private readonly resourceOwnershipStore: ProjectAfscpResourceOwnershipStore;
  private readonly fetchFn: typeof fetch;

  static disabled(): FileLibraryStoragePort {
    return new DisabledFileLibraryStorageAdapter();
  }

  constructor(options: AfscpFileLibraryStorageAdapterOptions) {
    this.client = buildProductClientBoundary(options.client);
    this.mappingRepo = options.mappingRepo;
    this.projectAfscpNamespaceStore = options.projectAfscpNamespaceStore;
    this.resourceOwnershipStore = options.resourceOwnershipStore;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async getOperationProjection(input: {
    workspaceId: string;
    projectId: string;
    operationId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryOperationProjection> {
    const operationId = sanitizeAfscpOperationId(input.operationId) ?? null;
    if (!operationId) {
      throw new Error('file_library_operation_not_found');
    }
    const ownership = await this.resourceOwnershipStore.getResourceOwnership({
      resourceKind: 'operation',
      resourceId: operationId,
    });
    if (
      !ownership
      || ownership.workspace_id !== input.workspaceId
      || ownership.project_id !== input.projectId
    ) {
      throw new Error('file_library_operation_not_found');
    }
    const namespace = await this.projectAfscpNamespaceStore.getProjectNamespace({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
    if (
      !namespace
      || namespace.namespace_id !== ownership.namespace_id
      || (
        namespace.status !== 'ready'
        && namespace.status !== 'deleting'
        && namespace.status !== 'tombstoned'
      )
    ) {
      throw new Error('file_library_operation_not_found');
    }

    let operation: AfscpOperationRecord;
    try {
      operation = await this.client.getOperation({
        operationId,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-operation-projection'),
        signal: input.signal,
      });
    } catch (error) {
      if (error instanceof AfscpClientError && error.code === 'afscp_resource_not_found') {
        throw new Error('file_library_operation_not_found');
      }
      throw new Error('file_library_operation_projection_failed');
    }
    const operationNamespaceId = readOperationProjectionString(operation, 'namespace_id');
    if (operationNamespaceId && operationNamespaceId !== ownership.namespace_id) {
      throw new Error('file_library_operation_not_found');
    }
    return buildOperationProjection(operation);
  }

  async createRepoForLibrary(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    namespaceId: string;
    projectStorageGeneration: number;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<{
    namespaceId: string;
    repoId: string;
    operationId: string | null;
    operationStatus: FileLibraryStorageOperationStatus;
    projectStorageGeneration: number;
  }> {
    const repoId = buildRepoId(input.libraryId);
    const projectStorageGeneration = requireProjectStorageGeneration(input.projectStorageGeneration);
    let operation: AfscpOperationEnvelope;
    try {
      operation = await this.client.createRepo({
        namespaceId: input.namespaceId,
        repoId,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-create-repo'),
        idempotencyKey: safeIdempotencyKey(['file-library', input.libraryId, 'create-repo']),
        actor: { type: 'user', id: input.actorUserId },
        signal: input.signal,
      });
    } catch {
      await this.mappingRepo.saveReady({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
        namespaceId: input.namespaceId,
        repoId,
        projectStorageGeneration,
        operationId: null,
        operationStatus: 'failed',
        lastErrorCode: 'file_library_repo_create_failed',
      });
      throw new Error('file_library_repo_create_failed');
    }

    let operationId = readOperationId(operation);
    const initialStatus = normalizeOperationStatus(operation.operation_state);
    await this.mappingRepo.saveReady({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      namespaceId: input.namespaceId,
      repoId,
      projectStorageGeneration,
      operationId,
      operationStatus: initialStatus,
      lastErrorCode: initialStatus === 'failed'
        ? readOperationErrorCode(operation, 'file_library_repo_create_failed')
        : null,
    });
    await this.ensureRepoAndOperationOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: input.namespaceId,
      repoId,
      operationId,
    });

    let finalOperation: AfscpOperationEnvelope | AfscpOperationRecord = operation;
    if (operationId) {
      try {
        finalOperation = await this.client.pollOperation({
          operationId,
          correlationId: resolveCorrelationId(input.requestId, 'file-library-create-repo-poll'),
          signal: input.signal,
        });
      } catch {
        await this.mappingRepo.updateOperation({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          libraryId: input.libraryId,
          operationId,
          operationStatus: 'failed',
          lastErrorCode: 'file_library_repo_create_failed',
        });
        throw new Error('file_library_repo_create_failed');
      }
    }

    operationId = readOperationId(finalOperation) ?? operationId;
    await this.ensureRepoAndOperationOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: input.namespaceId,
      repoId,
      operationId,
    });
    const status = normalizeOperationStatus(finalOperation.operation_state);
    await this.mappingRepo.updateOperation({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      operationId,
      operationStatus: status,
      lastErrorCode: status === 'failed'
        ? readOperationErrorCode(finalOperation, 'file_library_repo_create_failed')
        : null,
    });
    if (status !== 'succeeded') {
      throw new Error(status === 'pending' ? 'file_library_repo_create_pending' : 'file_library_repo_create_failed');
    }
    return {
      namespaceId: input.namespaceId,
      repoId,
      operationId,
      operationStatus: status,
      projectStorageGeneration,
    };
  }

  async deleteRepoForLibrary(input: FileLibraryStorageLibraryInput & {
    actorUserId: string;
    requestId?: string;
    reason?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const mapping = await this.requireStoredMapping(input);
    if (mapping.operation_status === 'pending' && mapping.operation_id) {
      const reconciled = await this.reconcilePendingRepoDeleteOperation({
        input,
        mapping,
        operationId: mapping.operation_id,
      });
      if (reconciled) {
        return;
      }
    }

    let operation: AfscpOperationEnvelope;
    try {
      operation = await this.client.deleteRepo({
        namespaceId: mapping.namespace_id,
        repoId: mapping.repo_id,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-delete-repo'),
        idempotencyKey: safeIdempotencyKey(['file-library', input.libraryId, 'delete-repo']),
        actor: { type: 'user', id: input.actorUserId },
        reason: input.reason ?? 'file_library_delete',
        signal: input.signal,
      });
    } catch {
      await this.mappingRepo.updateOperation({
        ...input,
        operationId: mapping.operation_id,
        operationStatus: 'failed',
        lastErrorCode: 'file_library_repo_delete_failed',
      });
      throw new Error('file_library_repo_delete_failed');
    }

    let operationId = readOperationId(operation);
    const initialStatus = normalizeOperationStatus(operation.operation_state);
    await this.ensureOperationOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: mapping.namespace_id,
      operationId,
    });
    await this.mappingRepo.updateOperation({
      ...input,
      operationId,
      operationStatus: initialStatus,
      lastErrorCode: initialStatus === 'failed'
        ? readOperationErrorCode(operation, 'file_library_repo_delete_failed')
        : null,
    });

    let finalOperation: AfscpOperationEnvelope | AfscpOperationRecord = operation;
    if (operationId) {
      try {
        finalOperation = await this.client.pollOperation({
          operationId,
          correlationId: resolveCorrelationId(input.requestId, 'file-library-delete-repo-poll'),
          signal: input.signal,
        });
      } catch {
        await this.mappingRepo.updateOperation({
          ...input,
          operationId,
          operationStatus: 'failed',
          lastErrorCode: 'file_library_repo_delete_failed',
        });
        throw new Error('file_library_repo_delete_failed');
      }
    }

    operationId = readOperationId(finalOperation) ?? operationId;
    await this.ensureOperationOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: mapping.namespace_id,
      operationId,
    });
    const status = normalizeOperationStatus(finalOperation.operation_state);
    if (status === 'succeeded') {
      await this.mappingRepo.delete(input.workspaceId, input.projectId, input.libraryId);
      return;
    }

    await this.mappingRepo.updateOperation({
      ...input,
      operationId,
      operationStatus: status,
      lastErrorCode: status === 'failed'
        ? readOperationErrorCode(finalOperation, 'file_library_repo_delete_failed')
        : null,
    });
    if (status === 'pending') {
      throw new FileLibraryStorageOperationPendingError({
        message: 'file_library_repo_delete_pending',
        operationId,
      });
    }
    throw new Error('file_library_repo_delete_failed');
  }

  async assertEmpty(input: FileLibraryStorageLibraryInput & { requestId?: string; signal?: AbortSignal }): Promise<void> {
    const listed = await this.listEntries({
      ...input,
      path: '',
      pageSize: 1,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    if (listed.items.length > 0) {
      throw new Error('file_library_not_empty');
    }
  }

  async listSavePoints(input: FileLibraryStorageLibraryInput & {
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryAfscpSavePoint[]> {
    const mapping = await this.requireActiveMapping(input);
    try {
      const listed = await this.client.listSavePoints({
        namespaceId: mapping.namespace_id,
        repoId: mapping.repo_id,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-save-points-list'),
        signal: input.signal,
      });
      return listed.save_points
        .map((record) => normalizeAfscpSavePoint(record))
        .filter((record): record is FileLibraryAfscpSavePoint => record !== null);
    } catch {
      throw new Error('file_library_save_point_list_failed');
    }
  }

  async createSavePoint(input: FileLibraryStorageLibraryInput & {
    message: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibrarySavePointCreateResult> {
    const mapping = await this.requireActiveMapping(input);
    let operation: AfscpOperationEnvelope;
    try {
      operation = await this.client.createSavePoint({
        namespaceId: mapping.namespace_id,
        repoId: mapping.repo_id,
        message: input.message,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-save-point-create'),
        idempotencyKey: safeIdempotencyKey([
          'file-library',
          input.libraryId,
          'save-point',
          input.requestId ?? randomUUID().replace(/-/g, '').slice(0, 12),
        ]),
        actor: { type: 'user', id: input.actorUserId },
        signal: input.signal,
      });
    } catch {
      throw new Error('file_library_save_point_create_failed');
    }
    const finalOperation = await this.pollMutationOperation({
      operation,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: mapping.namespace_id,
      requestId: input.requestId,
      signal: input.signal,
      fallbackPrefix: 'file-library-save-point-create-poll',
      failureMessage: 'file_library_save_point_create_failed',
    });
    const operationId = readOperationId(finalOperation) ?? readOperationId(operation);
    const operationStatus = normalizeOperationStatus(finalOperation.operation_state);
    const savePointId = readSavePointId(finalOperation) ?? readSavePointId(operation);
    if (savePointId) {
      await this.ensureSavePointOwnership({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        namespaceId: mapping.namespace_id,
        savePointId,
      });
    }
    if (operationStatus !== 'succeeded') {
      throw new Error(operationStatus === 'pending'
        ? 'file_library_save_point_create_pending'
        : 'file_library_save_point_create_failed');
    }
    return {
      operationId,
      operationStatus,
      savePointId,
      createdAt: readSavePointCreatedAt(finalOperation) ?? readSavePointCreatedAt(operation),
    };
  }

  async createRestorePreview(input: FileLibraryStorageLibraryInput & {
    savePointId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryRestoreOperationResult> {
    const mapping = await this.requireActiveMapping(input);
    let operation: AfscpOperationEnvelope;
    try {
      operation = await this.client.createRestorePreview({
        namespaceId: mapping.namespace_id,
        repoId: mapping.repo_id,
        savePointId: input.savePointId,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-restore-preview'),
        idempotencyKey: safeIdempotencyKey([
          'file-library',
          input.libraryId,
          'restore-preview',
          input.savePointId,
          input.requestId ?? randomUUID().replace(/-/g, '').slice(0, 12),
        ]),
        actor: { type: 'user', id: input.actorUserId },
        signal: input.signal,
      });
    } catch (error) {
      throw new Error(mapAfscpClientErrorToStorageMessage(
        error,
        'file_library_restore_preview_failed',
        'restore_preview',
      ));
    }
    return this.finalizeRestoreOperation({
      operation,
      input,
      namespaceId: mapping.namespace_id,
      fallbackPrefix: 'file-library-restore-preview-poll',
      failureMessage: 'file_library_restore_preview_failed',
      failureContext: 'restore_preview',
    });
  }

  async runRestorePreview(input: FileLibraryStorageLibraryInput & {
    previewOperationId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryRestoreOperationResult> {
    const mapping = await this.requireActiveMapping(input);
    let operation: AfscpOperationEnvelope;
    try {
      operation = await this.client.runRestorePreview({
        namespaceId: mapping.namespace_id,
        repoId: mapping.repo_id,
        previewOperationId: input.previewOperationId,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-restore-run'),
        idempotencyKey: safeIdempotencyKey([
          'file-library',
          input.libraryId,
          'restore-run',
          input.previewOperationId,
          input.requestId ?? randomUUID().replace(/-/g, '').slice(0, 12),
        ]),
        actor: { type: 'user', id: input.actorUserId },
        signal: input.signal,
      });
    } catch (error) {
      throw new Error(mapAfscpClientErrorToStorageMessage(
        error,
        'file_library_restore_run_failed',
        'restore_run',
      ));
    }
    return this.finalizeRestoreOperation({
      operation,
      input,
      namespaceId: mapping.namespace_id,
      fallbackPrefix: 'file-library-restore-run-poll',
      failureMessage: 'file_library_restore_run_failed',
      failureContext: 'restore_run',
    });
  }

  async discardRestorePreview(input: FileLibraryStorageLibraryInput & {
    previewOperationId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryRestoreOperationResult> {
    const mapping = await this.requireActiveMapping(input);
    let operation: AfscpOperationEnvelope;
    try {
      operation = await this.client.discardRestorePreview({
        namespaceId: mapping.namespace_id,
        repoId: mapping.repo_id,
        previewOperationId: input.previewOperationId,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-restore-discard'),
        idempotencyKey: safeIdempotencyKey([
          'file-library',
          input.libraryId,
          'restore-discard',
          input.previewOperationId,
          input.requestId ?? randomUUID().replace(/-/g, '').slice(0, 12),
        ]),
        actor: { type: 'user', id: input.actorUserId },
        signal: input.signal,
      });
    } catch (error) {
      throw new Error(mapAfscpClientErrorToStorageMessage(
        error,
        'file_library_restore_discard_failed',
        'restore_discard',
      ));
    }
    return this.finalizeRestoreOperation({
      operation,
      input,
      namespaceId: mapping.namespace_id,
      fallbackPrefix: 'file-library-restore-discard-poll',
      failureMessage: 'file_library_restore_discard_failed',
      failureContext: 'restore_discard',
    });
  }

  async createTemplateFromLibrary(input: FileLibraryStorageLibraryInput & {
    templateId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryTemplateCreateResult> {
    const mapping = await this.requireActiveMapping(input);
    let operation: AfscpOperationEnvelope;
    try {
      operation = await this.client.createRepoTemplate({
        namespaceId: mapping.namespace_id,
        sourceRepoId: mapping.repo_id,
        templateId: input.templateId,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-template-create'),
        idempotencyKey: safeIdempotencyKey([
          'file-library',
          input.libraryId,
          'template-create',
          input.templateId,
          input.requestId ?? randomUUID().replace(/-/g, '').slice(0, 12),
        ]),
        actor: { type: 'user', id: input.actorUserId },
        signal: input.signal,
      });
    } catch (error) {
      throw new Error(mapAfscpClientErrorToStorageMessage(
        error,
        'file_library_template_create_failed',
        'template_create',
      ));
    }
    const finalOperation = await this.pollMutationOperation({
      operation,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: mapping.namespace_id,
      requestId: input.requestId,
      signal: input.signal,
      fallbackPrefix: 'file-library-template-create-poll',
      failureMessage: 'file_library_template_create_failed',
      failureContext: 'template_create',
    });
    const operationId = readOperationId(finalOperation) ?? readOperationId(operation);
    const operationStatus = normalizeOperationStatus(finalOperation.operation_state);
    const templateId = readTemplateId(finalOperation) ?? input.templateId;
    await this.ensureTemplateOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: mapping.namespace_id,
      templateId,
    });
    const sourceSavePointId = readSourceSavePointId(finalOperation)
      ?? readSourceSavePointId(operation)
      ?? readSavePointId(finalOperation)
      ?? readSavePointId(operation);
    if (sourceSavePointId) {
      await this.ensureSavePointOwnership({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        namespaceId: mapping.namespace_id,
        savePointId: sourceSavePointId,
      });
    }
    if (operationStatus !== 'succeeded') {
      throw new Error(operationStatus === 'pending'
        ? 'file_library_template_create_pending'
        : mapAfscpOperationFailureMessage(finalOperation, 'file_library_template_create_failed'));
    }
    return {
      operationId,
      operationStatus,
      templateId,
      sourceSavePointId,
    };
  }

  async cloneTemplateToLibrary(input: FileLibraryStorageLibraryInput & {
    namespaceId: string;
    projectStorageGeneration: number;
    templateId: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<{
    namespaceId: string;
    repoId: string;
    operationId: string | null;
    operationStatus: FileLibraryStorageOperationStatus;
    projectStorageGeneration: number;
  }> {
    const repoId = buildRepoId(input.libraryId);
    const projectStorageGeneration = requireProjectStorageGeneration(input.projectStorageGeneration);
    let operation: AfscpOperationEnvelope;
    try {
      operation = await this.client.cloneRepoTemplate({
        namespaceId: input.namespaceId,
        templateId: input.templateId,
        targetRepoId: repoId,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-template-clone'),
        idempotencyKey: safeIdempotencyKey([
          'file-library',
          input.libraryId,
          'template-clone',
          input.templateId,
          input.requestId ?? randomUUID().replace(/-/g, '').slice(0, 12),
        ]),
        actor: { type: 'user', id: input.actorUserId },
        signal: input.signal,
      });
    } catch (error) {
      const message = mapAfscpClientErrorToStorageMessage(
        error,
        'file_library_template_clone_failed',
        'template_clone',
      );
      await this.mappingRepo.saveReady({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        libraryId: input.libraryId,
        namespaceId: input.namespaceId,
        repoId,
        projectStorageGeneration,
        operationId: null,
        operationStatus: 'failed',
        lastErrorCode: message,
      });
      throw new Error(message);
    }

    let operationId = readOperationId(operation);
    const initialStatus = normalizeOperationStatus(operation.operation_state);
    await this.mappingRepo.saveReady({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      namespaceId: input.namespaceId,
      repoId,
      projectStorageGeneration,
      operationId,
      operationStatus: initialStatus,
      lastErrorCode: initialStatus === 'failed'
        ? readOperationErrorCode(operation, 'file_library_template_clone_failed')
        : null,
    });
    await this.ensureRepoAndOperationOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: input.namespaceId,
      repoId,
      operationId,
    });
    await this.ensureTemplateOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: input.namespaceId,
      templateId: input.templateId,
    });

    const finalOperation = await this.pollMutationOperation({
      operation,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: input.namespaceId,
      requestId: input.requestId,
      signal: input.signal,
      fallbackPrefix: 'file-library-template-clone-poll',
      failureMessage: 'file_library_template_clone_failed',
      failureContext: 'template_clone',
    });
    operationId = readOperationId(finalOperation) ?? operationId;
    await this.ensureRepoAndOperationOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: input.namespaceId,
      repoId,
      operationId,
    });
    const status = normalizeOperationStatus(finalOperation.operation_state);
    const failureMessage = status === 'failed'
      ? mapAfscpOperationFailureMessage(finalOperation, 'file_library_template_clone_failed')
      : null;
    await this.mappingRepo.updateOperation({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: input.libraryId,
      operationId,
      operationStatus: status,
      lastErrorCode: failureMessage,
    });
    if (status !== 'succeeded') {
      throw new Error(status === 'pending'
        ? 'file_library_template_clone_pending'
        : failureMessage ?? 'file_library_template_clone_failed');
    }
    return {
      namespaceId: input.namespaceId,
      repoId,
      operationId,
      operationStatus: status,
      projectStorageGeneration,
    };
  }

  async listEntries(input: FileLibraryStorageLibraryInput & {
    path: string;
    pageSize: number;
    continuationToken?: string;
    search?: string;
    sortBy: 'name' | 'size_bytes' | 'modified_at';
    sortOrder: 'asc' | 'desc';
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<{
    path: string;
    items: FileLibraryEntry[];
    nextContinuationToken: string | null;
  }> {
    const path = input.path ? ensureDirectoryPath(input.path) : '';
    return this.withExport(input, 'read_only', async (context) => {
      const response = await this.webdavFetch(context.access, path, {
        method: 'PROPFIND',
        headers: { Depth: '1' },
        signal: input.signal,
      });
      ensureOk(response, 'file_library_list_failed');
      let items = parseWebdavEntries(await response.text(), path);
      if (input.search) {
        const needle = input.search.toLowerCase();
        items = items.filter((item) => item.name.toLowerCase().includes(needle));
      }
      const direction = input.sortOrder === 'desc' ? -1 : 1;
      items.sort((left, right) => {
        if (input.sortBy === 'size_bytes') {
          const leftSize = left.kind === 'file' ? left.size_bytes : -1;
          const rightSize = right.kind === 'file' ? right.size_bytes : -1;
          return (leftSize - rightSize) * direction;
        }
        if (input.sortBy === 'modified_at') {
          const leftModified = left.kind === 'file' ? Date.parse(left.modified_at) : 0;
          const rightModified = right.kind === 'file' ? Date.parse(right.modified_at) : 0;
          return (leftModified - rightModified) * direction;
        }
        return left.name.localeCompare(right.name) * direction;
      });
      return {
        path,
        items: items.slice(0, input.pageSize),
        nextContinuationToken: items.length > input.pageSize ? items[input.pageSize - 1]?.path ?? null : null,
      };
    });
  }

  async createFolder(input: FileLibraryStorageLibraryInput & {
    folderPath: string;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const folderPath = ensureDirectoryPath(input.folderPath);
    await this.withExport(input, 'read_write', async (context) => {
      const response = await this.webdavFetch(context.access, folderPath, {
        method: 'MKCOL',
        signal: input.signal,
      });
      if (response.status !== 405) {
        ensureOk(response, 'file_library_folder_create_failed');
      }
    });
  }

  async deletePaths(input: FileLibraryStorageLibraryInput & {
    paths: string[];
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<Array<{ path: string; status: 'deleted' | 'not_found' | 'error'; error_code?: string; message?: string }>> {
    return this.withExport(input, 'read_write', async (context) => {
      const results: Array<{ path: string; status: 'deleted' | 'not_found' | 'error'; error_code?: string; message?: string }> = [];
      for (const rawPath of input.paths) {
        const path = rawPath.endsWith('/') ? ensureDirectoryPath(rawPath) : normalizeAfscpFileLibraryPath(rawPath);
        try {
          const response = await this.webdavFetch(context.access, path, {
            method: 'DELETE',
            signal: input.signal,
          });
          if (response.status === 404) {
            results.push({ path: rawPath, status: 'not_found' });
          } else {
            ensureOk(response, 'file_library_delete_failed');
            results.push({ path: rawPath, status: 'deleted' });
          }
        } catch (error) {
          results.push({
            path: rawPath,
            status: 'error',
            error_code: 'file_library_delete_failed',
            message: safeStorageErrorMessage(error, 'file_library_delete_failed'),
          });
        }
      }
      return results;
    });
  }

  async moveEntry(input: FileLibraryStorageLibraryInput & {
    fromPath: string;
    toPath: string;
    overwrite: boolean;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const fromPath = input.fromPath.endsWith('/') ? ensureDirectoryPath(input.fromPath) : normalizeAfscpFileLibraryPath(input.fromPath);
    const toPath = input.toPath.endsWith('/') ? ensureDirectoryPath(input.toPath) : normalizeAfscpFileLibraryPath(input.toPath);
    await this.withExport(input, 'read_write', async (context) => {
      const response = await this.webdavFetch(context.access, fromPath, {
        method: 'MOVE',
        headers: {
          Destination: buildWebdavUrl(context.access.url, toPath),
          Overwrite: input.overwrite ? 'T' : 'F',
        },
        signal: input.signal,
      });
      ensureOk(response, 'file_library_move_failed');
    });
  }

  async uploadObject(input: FileLibraryStorageLibraryInput & {
    objectPath: string;
    body: WebReadableStream<Uint8Array>;
    contentType?: string;
    overwrite: boolean;
    actorUserId: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<Extract<FileLibraryEntry, { kind: 'file' }>> {
    const objectPath = normalizeAfscpFileLibraryPath(input.objectPath);
    return this.withExport(input, 'read_write', async (context) => {
      if (!input.overwrite) {
        const headResponse = await this.webdavFetch(context.access, objectPath, {
          method: 'HEAD',
          signal: input.signal,
        });
        if (headResponse.ok) {
          throw new Error('file_library_destination_exists');
        }
        if (headResponse.status !== 404) {
          ensureOk(headResponse, 'file_library_upload_preflight_failed');
        }
      }
      const response = await this.webdavFetch(context.access, objectPath, {
        method: 'PUT',
        headers: {
          'Content-Type': input.contentType ?? guessFileLibraryContentType(objectPath) ?? 'application/octet-stream',
        },
        body: input.body,
        signal: input.signal,
      });
      ensureOk(response, 'file_library_upload_failed');
      const meta = responseMeta(objectPath, response);
      return {
        kind: 'file',
        path: objectPath,
        name: pathName(objectPath),
        size_bytes: meta.size_bytes,
        content_type: meta.content_type,
        modified_at: meta.last_modified,
        etag: meta.etag,
      };
    });
  }

  async downloadObject(input: FileLibraryStorageLibraryInput & {
    objectPath: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryDownloadResult> {
    const objectPath = normalizeAfscpFileLibraryPath(input.objectPath);
    const context = await this.createExportContext(input, 'read_only');
    try {
      const response = await this.webdavFetch(context.access, objectPath, {
        method: 'GET',
        signal: input.signal,
      });
      ensureOk(response, 'file_library_download_failed');
      if (!response.body) {
        throw new Error('file_library_download_failed');
      }
      const stream = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
      const release = this.bindExportReleaseToDownloadStream({
        stream,
        input,
        context,
      });
      let cancelled = false;
      return {
        meta: responseMeta(objectPath, response),
        download: {
          stream,
          cancel: async (reason?: unknown) => {
            if (!cancelled && !stream.destroyed) {
              cancelled = true;
              stream.once('error', () => undefined);
              stream.destroy(createAbortError(reason, 'file_library_download_aborted'));
            }
            await release();
          },
        },
      };
    } catch (error) {
      await this.revokeExportAfterUse(input, context);
      throw error;
    }
  }

  async getObjectMeta(input: FileLibraryStorageLibraryInput & {
    objectPath: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<FileLibraryObjectMeta> {
    const objectPath = normalizeAfscpFileLibraryPath(input.objectPath);
    return this.withExport(input, 'read_only', async (context) => {
      const response = await this.webdavFetch(context.access, objectPath, {
        method: 'HEAD',
        signal: input.signal,
      });
      ensureOk(response, 'file_library_meta_failed');
      return responseMeta(objectPath, response);
    });
  }

  private async reconcilePendingRepoDeleteOperation(input: {
    input: FileLibraryStorageLibraryInput & {
      requestId?: string;
      signal?: AbortSignal;
    };
    mapping: ProjectFileLibraryAfscpMapping;
    operationId: string;
  }): Promise<boolean> {
    let finalOperation: AfscpOperationRecord;
    try {
      finalOperation = await this.client.pollOperation({
        operationId: input.operationId,
        correlationId: resolveCorrelationId(input.input.requestId, 'file-library-delete-repo-reconcile'),
        signal: input.input.signal,
      });
    } catch {
      await this.mappingRepo.updateOperation({
        ...input.input,
        operationId: input.operationId,
        operationStatus: 'failed',
        lastErrorCode: 'file_library_repo_delete_failed',
      });
      throw new Error('file_library_repo_delete_failed');
    }

    if (!isRepoDeleteOperation(finalOperation)) {
      return false;
    }

    const operationId = readOperationId(finalOperation) ?? input.operationId;
    await this.ensureOperationOwnership({
      workspaceId: input.input.workspaceId,
      projectId: input.input.projectId,
      namespaceId: input.mapping.namespace_id,
      operationId,
    });
    const status = normalizeOperationStatus(finalOperation.operation_state);
    if (status === 'succeeded') {
      await this.mappingRepo.delete(input.input.workspaceId, input.input.projectId, input.input.libraryId);
      return true;
    }

    await this.mappingRepo.updateOperation({
      ...input.input,
      operationId,
      operationStatus: status,
      lastErrorCode: status === 'failed'
        ? readOperationErrorCode(finalOperation, 'file_library_repo_delete_failed')
        : null,
    });
    if (status === 'pending') {
      throw new FileLibraryStorageOperationPendingError({
        message: 'file_library_repo_delete_pending',
        operationId,
      });
    }
    throw new Error('file_library_repo_delete_failed');
  }

  private async requireStoredMapping(input: FileLibraryStorageLibraryInput): Promise<ProjectFileLibraryAfscpMapping> {
    const mapping = await this.mappingRepo.getByLibraryId(input.workspaceId, input.projectId, input.libraryId);
    if (!mapping) {
      throw new Error('file_library_afscp_mapping_not_found');
    }
    return mapping;
  }

  private async requireActiveMapping(input: FileLibraryStorageLibraryInput): Promise<ProjectFileLibraryAfscpMapping> {
    const mapping = await this.requireStoredMapping(input);
    if (mapping.operation_status !== 'succeeded') {
      throw new Error('file_library_afscp_mapping_not_ready');
    }
    const namespace = await this.projectAfscpNamespaceStore.getProjectNamespace({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
    if (
      !namespace
      || namespace.status !== 'ready'
      || namespace.stage !== 'ready'
      || namespace.namespace_id !== mapping.namespace_id
    ) {
      throw new Error('file_library_project_storage_not_ready');
    }
    if (namespace.generation !== mapping.project_storage_generation) {
      throw new Error('file_library_project_storage_generation_mismatch');
    }
    return mapping;
  }

  private async ensureOperationOwnership(input: {
    workspaceId: string;
    projectId: string;
    namespaceId: string;
    operationId: string | null;
  }): Promise<void> {
    if (!input.operationId) {
      return;
    }
    await this.resourceOwnershipStore.ensureResourceOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      resourceKind: 'operation',
      resourceId: input.operationId,
      namespaceId: input.namespaceId,
    });
  }

  private async ensureRepoAndOperationOwnership(input: {
    workspaceId: string;
    projectId: string;
    namespaceId: string;
    repoId: string;
    operationId: string | null;
  }): Promise<void> {
    await this.ensureOperationOwnership(input);
    await this.resourceOwnershipStore.ensureResourceOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      resourceKind: 'repo',
      resourceId: input.repoId,
      namespaceId: input.namespaceId,
    });
  }

  private async ensureSavePointOwnership(input: {
    workspaceId: string;
    projectId: string;
    namespaceId: string;
    savePointId: string;
  }): Promise<void> {
    await this.resourceOwnershipStore.ensureResourceOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      resourceKind: 'save_point',
      resourceId: input.savePointId,
      namespaceId: input.namespaceId,
    });
  }

  private async ensureRestorePlanOwnership(input: {
    workspaceId: string;
    projectId: string;
    namespaceId: string;
    restorePlanId: string;
  }): Promise<void> {
    await this.resourceOwnershipStore.ensureResourceOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      resourceKind: 'restore_plan',
      resourceId: input.restorePlanId,
      namespaceId: input.namespaceId,
    });
  }

  private async ensureTemplateOwnership(input: {
    workspaceId: string;
    projectId: string;
    namespaceId: string;
    templateId: string;
  }): Promise<void> {
    await this.resourceOwnershipStore.ensureResourceOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      resourceKind: 'repo_template',
      resourceId: input.templateId,
      namespaceId: input.namespaceId,
    });
  }

  private async pollMutationOperation(input: {
    operation: AfscpOperationEnvelope;
    workspaceId: string;
    projectId: string;
    namespaceId: string;
    requestId?: string;
    signal?: AbortSignal;
    fallbackPrefix: string;
    failureMessage: string;
    failureContext?: AfscpStorageFailureContext;
  }): Promise<AfscpOperationEnvelope | AfscpOperationRecord> {
    const operationId = readOperationId(input.operation);
    await this.ensureOperationOwnership({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      namespaceId: input.namespaceId,
      operationId,
    });
    if (!operationId) {
      return input.operation;
    }
    try {
      const finalOperation = await this.client.pollOperation({
        operationId,
        correlationId: resolveCorrelationId(input.requestId, input.fallbackPrefix),
        signal: input.signal,
      });
      await this.ensureOperationOwnership({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        namespaceId: input.namespaceId,
        operationId: readOperationId(finalOperation) ?? operationId,
      });
      return finalOperation;
    } catch (error) {
      throw new Error(mapAfscpClientErrorToStorageMessage(
        error,
        input.failureMessage,
        input.failureContext,
      ));
    }
  }

  private async finalizeRestoreOperation(input: {
    operation: AfscpOperationEnvelope;
    input: FileLibraryStorageLibraryInput & {
      actorUserId: string;
      requestId?: string;
      signal?: AbortSignal;
    };
    namespaceId: string;
    fallbackPrefix: string;
    failureMessage: string;
    failureContext: AfscpStorageFailureContext;
  }): Promise<FileLibraryRestoreOperationResult> {
    const finalOperation = await this.pollMutationOperation({
      operation: input.operation,
      workspaceId: input.input.workspaceId,
      projectId: input.input.projectId,
      namespaceId: input.namespaceId,
      requestId: input.input.requestId,
      signal: input.input.signal,
      fallbackPrefix: input.fallbackPrefix,
      failureMessage: input.failureMessage,
      failureContext: input.failureContext,
    });
    const operationStatus = normalizeOperationStatus(finalOperation.operation_state);
    const restorePlanId = readRestorePlanId(finalOperation) ?? readRestorePlanId(input.operation);
    if (restorePlanId) {
      await this.ensureRestorePlanOwnership({
        workspaceId: input.input.workspaceId,
        projectId: input.input.projectId,
        namespaceId: input.namespaceId,
        restorePlanId,
      });
    }
    const sourceSavePointId = readSourceSavePointId(finalOperation)
      ?? readSourceSavePointId(input.operation)
      ?? readSavePointId(finalOperation)
      ?? readSavePointId(input.operation);
    if (sourceSavePointId) {
      await this.ensureSavePointOwnership({
        workspaceId: input.input.workspaceId,
        projectId: input.input.projectId,
        namespaceId: input.namespaceId,
        savePointId: sourceSavePointId,
      });
    }
    if (operationStatus !== 'succeeded') {
      throw new Error(operationStatus === 'pending'
        ? input.failureMessage.replace(/_failed$/, '_pending')
        : mapAfscpOperationFailureMessage(finalOperation, input.failureMessage));
    }
    const summary = readRestorePreviewSummary(finalOperation) ?? readRestorePreviewSummary(input.operation);
    const blockers = readRestorePreviewBlockers(finalOperation) ?? readRestorePreviewBlockers(input.operation);
    const stale = readOperationBoolean(finalOperation, 'stale') ?? readOperationBoolean(input.operation, 'stale');
    return {
      operationId: readOperationId(finalOperation) ?? readOperationId(input.operation),
      operationStatus,
      restorePlanId,
      sourceSavePointId,
      ...(summary ? { summary } : {}),
      ...(blockers ? { blockers } : {}),
      ...(stale !== undefined ? { stale } : {}),
    };
  }

  private async withExport<T>(
    input: FileLibraryStorageLibraryInput & { actorUserId?: string; requestId?: string; signal?: AbortSignal },
    mode: AfscpExportMode,
    run: (context: WebdavExportContext) => Promise<T>,
  ): Promise<T> {
    const context = await this.createExportContext(input, mode);
    try {
      return await run(context);
    } finally {
      await this.revokeExportAfterUse(input, context);
    }
  }

  private async createExportContext(
    input: FileLibraryStorageLibraryInput & { actorUserId?: string; requestId?: string; signal?: AbortSignal },
    mode: AfscpExportMode,
  ): Promise<WebdavExportContext> {
    const mapping = await this.requireActiveMapping(input);
    const exportEnvelope = await this.client.createExport({
      namespaceId: mapping.namespace_id,
      repoId: mapping.repo_id,
      mode,
      ttlSeconds: 60,
      correlationId: resolveCorrelationId(input.requestId, 'file-library-export'),
      idempotencyKey: safeIdempotencyKey(['file-library', input.libraryId, mode, randomUUID().replace(/-/g, '').slice(0, 12)]),
      actor: { type: 'user', id: input.actorUserId ?? 'system' },
      signal: input.signal,
    });
    const exportAccess = readExportAccess(exportEnvelope);
    return {
      mapping,
      access: exportAccess.access,
      exportId: exportAccess.exportId,
    };
  }

  private async revokeExportAfterUse(
    input: FileLibraryStorageLibraryInput & { actorUserId?: string; requestId?: string },
    context: WebdavExportContext,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error('file_library_export_revoke_timeout'));
    }, EXPORT_REVOKE_TIMEOUT_MS);
    try {
      await this.client.revokeExport({
        namespaceId: context.mapping.namespace_id,
        exportId: context.exportId,
        correlationId: resolveCorrelationId(input.requestId, 'file-library-export-revoke'),
        idempotencyKey: safeIdempotencyKey(['file-library', input.libraryId, 'revoke-export', context.exportId]),
        actor: { type: 'user', id: input.actorUserId ?? 'system' },
        signal: controller.signal,
      });
    } catch {
      // Best-effort cleanup: request responses must never leak revoke internals.
    } finally {
      clearTimeout(timeout);
    }
  }

  private bindExportReleaseToDownloadStream(input: {
    stream: Readable;
    context: WebdavExportContext;
    input: FileLibraryStorageLibraryInput & { actorUserId?: string; requestId?: string };
  }): () => Promise<void> {
    const { stream, context } = input;
    let releasePromise: Promise<void> | null = null;
    const cleanup = () => {
      stream.removeListener('end', handleEnd);
      stream.removeListener('error', handleError);
      stream.removeListener('close', handleClose);
    };
    const release = () => {
      if (!releasePromise) {
        cleanup();
        releasePromise = this.revokeExportAfterUse(input.input, context);
      }
      return releasePromise;
    };
    const handleEnd = () => {
      void release();
    };
    const handleError = () => {
      void release();
    };
    const handleClose = () => {
      void release();
    };

    stream.once('end', handleEnd);
    stream.once('error', handleError);
    stream.once('close', handleClose);
    return release;
  }

  private async webdavFetch(
    access: AfscpExportAccessCredential,
    path: string,
    init: {
      method: string;
      headers?: Record<string, string>;
      body?: WebReadableStream<Uint8Array>;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    const requestInit: RequestInit & { duplex?: 'half' } = {
      method: init.method,
      headers: {
        Authorization: basicAuthorization(access),
        ...(init.headers ?? {}),
      },
      body: init.body as unknown as BodyInit | undefined,
      signal: init.signal,
      ...(init.body ? { duplex: 'half' as const } : {}),
    };
    return this.fetchFn(buildWebdavUrl(access.url, path), requestInit);
  }
}
