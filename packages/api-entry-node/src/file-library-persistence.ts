import type { JsonDocConditionalCreateResult, JsonDocStorePort } from '@mbos/ports';
import { createHash, randomUUID } from 'node:crypto';
import type {
  FileLibraryLastRestore,
  FileLibraryRecord,
} from './file-library-model.js';

export const FILE_LIBRARY_CATALOG_COLLECTION = 'project_file_libraries';
const FILE_LIBRARY_SAVE_POINT_MAPPING_COLLECTION = 'project_file_library_save_point_mappings';
const FILE_LIBRARY_VERSION_OPERATION_COLLECTION = 'project_file_library_version_operations';
const FILE_LIBRARY_RESTORE_OPERATION_COLLECTION = 'project_file_library_restore_operations';
const FILE_LIBRARY_RESTORE_OPERATION_ACTIVE_LOCK_COLLECTION = 'project_file_library_restore_operation_active_locks';
const TASK_FILE_TEMPLATE_COLLECTION = 'project_task_file_templates';
const FILE_LIBRARY_HOME_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type FileLibraryLifecycleFenceKind = 'binding_acquire';

type FileLibraryLifecycleFenceFields = {
  lifecycle_fence_token?: string | null;
  lifecycle_fence_kind?: FileLibraryLifecycleFenceKind | null;
  lifecycle_fence_owner_task_id?: string | null;
  lifecycle_fence_correlation_id?: string | null;
  lifecycle_fence_expires_at?: string | null;
};

type FileLibraryProvisioningKind = 'template_clone';

type FileLibraryProvisioningFields = {
  provisioning_kind?: FileLibraryProvisioningKind | null;
  provisioning_operation_id?: string | null;
  provisioning_template_id?: string | null;
  provisioning_request_id?: string | null;
  provisioning_error_code?: string | null;
};

type FileLibraryLastRestoreStoredFields = {
  last_restored_save_point_id?: string | null;
  last_restored_save_point_label?: string | null;
  last_restored_save_point_created_at?: string | null;
  last_restored_at?: string | null;
  last_restore_operation_id?: string | null;
};

type FileLibraryStoredRecord = Omit<FileLibraryRecord, 'last_restore'> & FileLibraryLastRestoreStoredFields & FileLibraryLifecycleFenceFields & FileLibraryProvisioningFields;

export type FileLibraryLifecycleFence = {
  token: string;
  version: number;
  library: FileLibraryRecord;
};

export type FileLibraryProvisioningState = {
  kind: FileLibraryProvisioningKind;
  operationId: string;
  templateId: string;
  requestId: string | null;
  lastErrorCode: string | null;
  library: FileLibraryRecord;
};

const FILE_LIBRARY_PUBLIC_RECORD_KEYS = new Set<string>([
  'id',
  'workspace_id',
  'project_id',
  'name',
  'description',
  'status',
  'version',
  'file_library_home_segment',
  'source',
  'delete_correlation_id',
  'last_restore',
  'created_by_user_id',
  'created_at',
  'updated_at',
]);

const FILE_LIBRARY_STORED_RECORD_KEYS = new Set<string>([
  ...[...FILE_LIBRARY_PUBLIC_RECORD_KEYS].filter((key) => key !== 'last_restore'),
  'last_restored_save_point_id',
  'last_restored_save_point_label',
  'last_restored_save_point_created_at',
  'last_restored_at',
  'last_restore_operation_id',
  'lifecycle_fence_token',
  'lifecycle_fence_kind',
  'lifecycle_fence_owner_task_id',
  'lifecycle_fence_correlation_id',
  'lifecycle_fence_expires_at',
  'provisioning_kind',
  'provisioning_operation_id',
  'provisioning_template_id',
  'provisioning_request_id',
  'provisioning_error_code',
]);

const FILE_LIBRARY_STORED_INPUT_RECORD_KEYS = new Set<string>([
  ...FILE_LIBRARY_STORED_RECORD_KEYS,
  'last_restore',
]);

const FILE_LIBRARY_STATUSES = new Set<FileLibraryRecord['status']>([
  'creating',
  'ready',
  'degraded',
  'failed',
  'deleting',
  'deleted',
]);

const FILE_LIBRARY_UPDATE_PATCH_KEYS = new Set<string>([
  'name',
  'description',
  'status',
  'updated_at',
  'version',
  'file_library_home_segment',
  'source',
  'delete_correlation_id',
]);

function assertFileLibraryHomeSegment(segment: string): string {
  const trimmed = segment.trim();
  if (
    !FILE_LIBRARY_HOME_SEGMENT_PATTERN.test(trimmed)
    || trimmed === '.'
    || trimmed === '..'
    || trimmed.includes('/')
    || trimmed.includes('\\')
  ) {
    throw new Error('invalid_file_library_home_segment');
  }
  return trimmed;
}

export function generateFileLibraryHomeSegment(): string {
  return assertFileLibraryHomeSegment(`flibhome_${randomUUID().replace(/-/g, '').slice(0, 24)}`);
}

function assertCatalogRecordObject(record: unknown): Record<string, unknown> {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new Error('invalid_file_library_catalog_record');
  }
  return record as Record<string, unknown>;
}

function assertCatalogRecordKeys(raw: Record<string, unknown>, allowedKeys: Set<string>): void {
  if (Object.keys(raw).some((key) => !allowedKeys.has(key))) {
    throw new Error('invalid_file_library_catalog_record');
  }
}

function requireStringField(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string') {
    throw new Error('invalid_file_library_catalog_record');
  }
  return value;
}

function optionalStringField(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('invalid_file_library_catalog_record');
  }
  return value;
}

function optionalNonEmptyStringField(raw: Record<string, unknown>, key: string): string | undefined {
  const value = optionalStringField(raw, key);
  if (value === undefined) {
    return undefined;
  }
  if (value.trim() !== value || value.length === 0) {
    throw new Error('invalid_file_library_catalog_record');
  }
  return value;
}

function requireNonEmptyStringField(raw: Record<string, unknown>, key: string): string {
  const value = optionalNonEmptyStringField(raw, key);
  if (value === undefined) {
    throw new Error('invalid_file_library_catalog_record');
  }
  return value;
}

function normalizePublicLastRestore(value: unknown): FileLibraryLastRestore | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid_file_library_catalog_record');
  }
  const raw = value as Record<string, unknown>;
  assertCatalogRecordKeys(raw, new Set([
    'source_save_point_id',
    'source_save_point_label',
    'source_save_point_created_at',
    'restored_at',
    'restore_operation_id',
  ]));
  return {
    source_save_point_id: requireNonEmptyStringField(raw, 'source_save_point_id'),
    source_save_point_label: requireNonEmptyStringField(raw, 'source_save_point_label'),
    source_save_point_created_at: requireNonEmptyStringField(raw, 'source_save_point_created_at'),
    restored_at: requireNonEmptyStringField(raw, 'restored_at'),
    restore_operation_id: requireNonEmptyStringField(raw, 'restore_operation_id'),
  };
}

function readStoredLastRestore(raw: Record<string, unknown>): FileLibraryLastRestore | undefined {
  const values = {
    source_save_point_id: optionalNonEmptyStringField(raw, 'last_restored_save_point_id'),
    source_save_point_label: optionalNonEmptyStringField(raw, 'last_restored_save_point_label'),
    source_save_point_created_at: optionalNonEmptyStringField(raw, 'last_restored_save_point_created_at'),
    restored_at: optionalNonEmptyStringField(raw, 'last_restored_at'),
    restore_operation_id: optionalNonEmptyStringField(raw, 'last_restore_operation_id'),
  };
  const presentCount = Object.values(values).filter((value) => value !== undefined).length;
  if (presentCount === 0) {
    return undefined;
  }
  if (presentCount !== 5) {
    throw new Error('invalid_file_library_catalog_record');
  }
  return values as FileLibraryLastRestore;
}

function readCatalogLastRestore(raw: Record<string, unknown>): FileLibraryLastRestore | undefined {
  const publicLastRestore = normalizePublicLastRestore(raw.last_restore);
  const storedLastRestore = readStoredLastRestore(raw);
  if (publicLastRestore && storedLastRestore) {
    throw new Error('invalid_file_library_catalog_record');
  }
  return publicLastRestore ?? storedLastRestore;
}

function toStoredLastRestoreFields(
  lastRestore: FileLibraryLastRestore | null | undefined,
): Required<FileLibraryLastRestoreStoredFields> {
  return {
    last_restored_save_point_id: lastRestore?.source_save_point_id ?? null,
    last_restored_save_point_label: lastRestore?.source_save_point_label ?? null,
    last_restored_save_point_created_at: lastRestore?.source_save_point_created_at ?? null,
    last_restored_at: lastRestore?.restored_at ?? null,
    last_restore_operation_id: lastRestore?.restore_operation_id ?? null,
  };
}

function requireVersion(raw: Record<string, unknown>): number {
  const value = raw.version;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('invalid_file_library_catalog_record');
  }
  return value;
}

function requireStatus(raw: Record<string, unknown>): FileLibraryRecord['status'] {
  const value = raw.status;
  if (typeof value !== 'string' || !FILE_LIBRARY_STATUSES.has(value as FileLibraryRecord['status'])) {
    throw new Error('invalid_file_library_catalog_record');
  }
  return value as FileLibraryRecord['status'];
}

function requireCurrentSource(raw: Record<string, unknown>): FileLibraryRecord['source'] {
  if (raw.source !== 'agent_task_files') {
    throw new Error('invalid_file_library_catalog_record');
  }
  return 'agent_task_files';
}

function normalizeFileLibraryPublicFields(raw: Record<string, unknown>): FileLibraryRecord {
  const fileLibraryHomeSegment = assertFileLibraryHomeSegment(
    requireStringField(raw, 'file_library_home_segment'),
  );
  const lastRestore = readCatalogLastRestore(raw);
  return {
    id: requireStringField(raw, 'id'),
    workspace_id: requireStringField(raw, 'workspace_id'),
    project_id: requireStringField(raw, 'project_id'),
    name: requireStringField(raw, 'name'),
    description: optionalStringField(raw, 'description'),
    status: requireStatus(raw),
    version: requireVersion(raw),
    file_library_home_segment: fileLibraryHomeSegment,
    source: requireCurrentSource(raw),
    delete_correlation_id: optionalStringField(raw, 'delete_correlation_id'),
    ...(lastRestore ? { last_restore: lastRestore } : {}),
    created_by_user_id: requireStringField(raw, 'created_by_user_id'),
    created_at: requireStringField(raw, 'created_at'),
    updated_at: requireStringField(raw, 'updated_at'),
  };
}

export function normalizeFileLibraryRecord(record: FileLibraryRecord): FileLibraryRecord {
  const raw = assertCatalogRecordObject(record);
  assertCatalogRecordKeys(raw, FILE_LIBRARY_PUBLIC_RECORD_KEYS);
  return normalizeFileLibraryPublicFields(raw);
}

function normalizeFileLibraryStoredRecord(record: FileLibraryRecord | FileLibraryStoredRecord): FileLibraryStoredRecord {
  const raw = assertCatalogRecordObject(record);
  assertCatalogRecordKeys(raw, FILE_LIBRARY_STORED_INPUT_RECORD_KEYS);
  const publicRecord = normalizeFileLibraryPublicFields(raw);
  const storedLastRestoreFields = toStoredLastRestoreFields(publicRecord.last_restore);
  const tokenValue = raw.lifecycle_fence_token;
  const token = tokenValue === undefined || tokenValue === null ? null : requireStringField(raw, 'lifecycle_fence_token');
  if (token !== null && token.trim() !== token) {
    throw new Error('invalid_file_library_catalog_record');
  }
  if (token !== null && token === '') {
    throw new Error('invalid_file_library_catalog_record');
  }
  if (token === null) {
    for (const key of [
      'lifecycle_fence_kind',
      'lifecycle_fence_owner_task_id',
      'lifecycle_fence_correlation_id',
      'lifecycle_fence_expires_at',
    ]) {
      if (raw[key] !== undefined && raw[key] !== null) {
        throw new Error('invalid_file_library_catalog_record');
      }
    }
  } else if (
    raw.lifecycle_fence_kind !== 'binding_acquire'
    || typeof raw.lifecycle_fence_owner_task_id !== 'string'
    || typeof raw.lifecycle_fence_correlation_id !== 'string'
    || typeof raw.lifecycle_fence_expires_at !== 'string'
  ) {
    throw new Error('invalid_file_library_catalog_record');
  }
  const lifecycleFenceOwnerTaskId = token === null
    ? null
    : requireStringField(raw, 'lifecycle_fence_owner_task_id');
  const lifecycleFenceCorrelationId = token === null
    ? null
    : requireStringField(raw, 'lifecycle_fence_correlation_id');
  const lifecycleFenceExpiresAt = token === null
    ? null
    : requireStringField(raw, 'lifecycle_fence_expires_at');
  const provisioningKindValue = raw.provisioning_kind;
  const provisioningKind = provisioningKindValue === undefined || provisioningKindValue === null
    ? null
    : provisioningKindValue;
  if (provisioningKind !== null && provisioningKind !== 'template_clone') {
    throw new Error('invalid_file_library_catalog_record');
  }
  if (provisioningKind === null) {
    for (const key of [
      'provisioning_operation_id',
      'provisioning_template_id',
      'provisioning_request_id',
      'provisioning_error_code',
    ]) {
      if (raw[key] !== undefined && raw[key] !== null) {
        throw new Error('invalid_file_library_catalog_record');
      }
    }
  }
  const provisioningOperationId = provisioningKind === null
    ? null
    : requireStringField(raw, 'provisioning_operation_id');
  const provisioningTemplateId = provisioningKind === null
    ? null
    : requireStringField(raw, 'provisioning_template_id');
  const provisioningRequestId = provisioningKind === null
    ? null
    : optionalStringField(raw, 'provisioning_request_id') ?? null;
  const provisioningErrorCode = provisioningKind === null
    ? null
    : optionalStringField(raw, 'provisioning_error_code') ?? null;
  if (
    (provisioningOperationId !== null && provisioningOperationId.trim() !== provisioningOperationId)
    || (provisioningTemplateId !== null && provisioningTemplateId.trim() !== provisioningTemplateId)
    || (provisioningRequestId !== null && provisioningRequestId.trim() !== provisioningRequestId)
    || (provisioningErrorCode !== null && provisioningErrorCode.trim() !== provisioningErrorCode)
  ) {
    throw new Error('invalid_file_library_catalog_record');
  }
  const publicStoredRecord = { ...publicRecord };
  delete publicStoredRecord.last_restore;
  return {
    ...publicStoredRecord,
    ...storedLastRestoreFields,
    lifecycle_fence_token: token,
    lifecycle_fence_kind: token === null ? null : 'binding_acquire',
    lifecycle_fence_owner_task_id: lifecycleFenceOwnerTaskId,
    lifecycle_fence_correlation_id: lifecycleFenceCorrelationId,
    lifecycle_fence_expires_at: lifecycleFenceExpiresAt,
    provisioning_kind: provisioningKind,
    provisioning_operation_id: provisioningOperationId,
    provisioning_template_id: provisioningTemplateId,
    provisioning_request_id: provisioningRequestId,
    provisioning_error_code: provisioningErrorCode,
  };
}

function tryNormalizeFileLibraryStoredRecord(
  record: FileLibraryRecord | FileLibraryStoredRecord,
): FileLibraryStoredRecord | null {
  try {
    return normalizeFileLibraryStoredRecord(record);
  } catch {
    return null;
  }
}

function toPublicFileLibraryRecord(record: FileLibraryStoredRecord): FileLibraryRecord {
  return normalizeFileLibraryPublicFields(record as unknown as Record<string, unknown>);
}

function toFileLibraryProvisioningState(record: FileLibraryStoredRecord): FileLibraryProvisioningState | null {
  if (
    record.provisioning_kind !== 'template_clone'
    || !record.provisioning_operation_id
    || !record.provisioning_template_id
  ) {
    return null;
  }
  return {
    kind: 'template_clone',
    operationId: record.provisioning_operation_id,
    templateId: record.provisioning_template_id,
    requestId: record.provisioning_request_id ?? null,
    lastErrorCode: record.provisioning_error_code ?? null,
    library: toPublicFileLibraryRecord(record),
  };
}

function toPublicFileLibraryRecords(records: FileLibraryStoredRecord[]): FileLibraryRecord[] {
  const normalized: FileLibraryRecord[] = [];
  for (const record of records) {
    const stored = tryNormalizeFileLibraryStoredRecord(record);
    if (stored) {
      normalized.push(toPublicFileLibraryRecord(stored));
    }
  }
  return normalized;
}

export function buildFileLibraryRecord(input: {
  id?: string;
  workspaceId: string;
  projectId: string;
  name: string;
  description?: string;
  createdByUserId: string;
  status?: FileLibraryRecord['status'];
  fileLibraryHomeSegment?: string;
  now?: string;
}): FileLibraryRecord {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? `flib_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    name: input.name,
    description: input.description,
    status: input.status ?? 'creating',
    version: 1,
    file_library_home_segment: input.fileLibraryHomeSegment
      ? assertFileLibraryHomeSegment(input.fileLibraryHomeSegment)
      : generateFileLibraryHomeSegment(),
    source: 'agent_task_files',
    created_by_user_id: input.createdByUserId,
    created_at: now,
    updated_at: now,
  };
}

export class JsonDocProjectFileLibraryCatalogRepo {
  constructor(private readonly docStore: JsonDocStorePort) {}

  private async getStoredById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryStoredRecord | null> {
    const record = await this.docStore.get<FileLibraryStoredRecord>(FILE_LIBRARY_CATALOG_COLLECTION, libraryId);
    if (!record) return null;
    const stored = tryNormalizeFileLibraryStoredRecord(record);
    if (!stored || stored.workspace_id !== workspaceId || stored.project_id !== projectId) {
      return null;
    }
    return stored;
  }

  private async saveStored(record: FileLibraryStoredRecord): Promise<void> {
    await this.docStore.upsert<FileLibraryStoredRecord>(
      FILE_LIBRARY_CATALOG_COLLECTION,
      record.id,
      normalizeFileLibraryStoredRecord(record),
    );
  }

  async listByOwner(ownerUserId: string): Promise<FileLibraryRecord[]> {
    const records = await this.docStore.list<FileLibraryStoredRecord>(FILE_LIBRARY_CATALOG_COLLECTION, {
      created_by_user_id: ownerUserId,
    });
    return toPublicFileLibraryRecords(records);
  }

  async listByProject(workspaceId: string, projectId: string): Promise<FileLibraryRecord[]> {
    const records = await this.docStore.list<FileLibraryStoredRecord>(FILE_LIBRARY_CATALOG_COLLECTION, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    return toPublicFileLibraryRecords(records);
  }

  async listByProjectForOwner(
    workspaceId: string,
    projectId: string,
    ownerUserId: string,
  ): Promise<FileLibraryRecord[]> {
    const records = await this.docStore.list<FileLibraryStoredRecord>(FILE_LIBRARY_CATALOG_COLLECTION, {
      workspace_id: workspaceId,
      project_id: projectId,
      created_by_user_id: ownerUserId,
    });
    return toPublicFileLibraryRecords(records);
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryRecord | null> {
    const record = await this.getStoredById(workspaceId, projectId, libraryId);
    return record ? toPublicFileLibraryRecord(record) : null;
  }

  async getByIdForOwner(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    ownerUserId: string,
  ): Promise<FileLibraryRecord | null> {
    const record = await this.getById(workspaceId, projectId, libraryId);
    if (!record || record.created_by_user_id !== ownerUserId) {
      return null;
    }
    return record;
  }

  async save(record: FileLibraryRecord): Promise<void> {
    await this.saveStored(normalizeFileLibraryRecord(record));
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<Pick<
      FileLibraryRecord,
      | 'name'
      | 'description'
      | 'status'
      | 'updated_at'
      | 'version'
      | 'file_library_home_segment'
      | 'source'
      | 'delete_correlation_id'
    >>,
  ): Promise<FileLibraryRecord | null> {
    assertCatalogRecordKeys(assertCatalogRecordObject(patch), FILE_LIBRARY_UPDATE_PATCH_KEYS);
    const existing = await this.getStoredById(workspaceId, projectId, libraryId);
    if (!existing) {
      return null;
    }
    const updated: FileLibraryStoredRecord = {
      ...existing,
      ...patch,
      version: patch.version ?? existing.version + 1,
      updated_at: patch.updated_at ?? new Date().toISOString(),
    };
    await this.saveStored(updated);
    return toPublicFileLibraryRecord(normalizeFileLibraryStoredRecord(updated));
  }

  async recordSuccessfulRestore(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    sourceSavePointId: string;
    sourceSavePointLabel: string;
    sourceSavePointCreatedAt: string;
    restoredAt: string;
    restoreOperationId: string;
  }): Promise<FileLibraryRecord | null> {
    const existing = await this.getStoredById(input.workspaceId, input.projectId, input.libraryId);
    if (!existing) {
      return null;
    }
    const existingRestoredAtMs = existing.last_restored_at ? Date.parse(existing.last_restored_at) : null;
    const nextRestoredAtMs = Date.parse(input.restoredAt);
    if (
      existingRestoredAtMs !== null
      && Number.isFinite(existingRestoredAtMs)
      && Number.isFinite(nextRestoredAtMs)
      && existingRestoredAtMs > nextRestoredAtMs
    ) {
      return toPublicFileLibraryRecord(existing);
    }
    const next: FileLibraryStoredRecord = {
      ...existing,
      version: existing.version + 1,
      last_restored_save_point_id: input.sourceSavePointId,
      last_restored_save_point_label: input.sourceSavePointLabel,
      last_restored_save_point_created_at: input.sourceSavePointCreatedAt,
      last_restored_at: input.restoredAt,
      last_restore_operation_id: input.restoreOperationId,
      updated_at: input.restoredAt,
    };
    await this.saveStored(next);
    return toPublicFileLibraryRecord(normalizeFileLibraryStoredRecord(next));
  }

  async markTemplateCloneProvisioning(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    operationId: string;
    templateId: string;
    requestId?: string | null;
  }): Promise<FileLibraryRecord | null> {
    const existing = await this.getStoredById(input.workspaceId, input.projectId, input.libraryId);
    if (!existing) {
      return null;
    }
    const next: FileLibraryStoredRecord = {
      ...existing,
      status: 'creating',
      version: existing.version + 1,
      provisioning_kind: 'template_clone',
      provisioning_operation_id: input.operationId,
      provisioning_template_id: input.templateId,
      provisioning_request_id: input.requestId ?? null,
      provisioning_error_code: null,
      updated_at: new Date().toISOString(),
    };
    await this.saveStored(next);
    return toPublicFileLibraryRecord(normalizeFileLibraryStoredRecord(next));
  }

  async completeTemplateCloneProvisioning(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    status: Extract<FileLibraryRecord['status'], 'ready' | 'failed'>;
    lastErrorCode?: string | null;
  }): Promise<FileLibraryRecord | null> {
    const existing = await this.getStoredById(input.workspaceId, input.projectId, input.libraryId);
    if (!existing) {
      return null;
    }
    const next: FileLibraryStoredRecord = {
      ...existing,
      status: input.status,
      version: existing.version + 1,
      provisioning_kind: null,
      provisioning_operation_id: null,
      provisioning_template_id: null,
      provisioning_request_id: null,
      provisioning_error_code: null,
      updated_at: new Date().toISOString(),
    };
    await this.saveStored(next);
    return toPublicFileLibraryRecord(normalizeFileLibraryStoredRecord(next));
  }

  async getProvisioningState(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryProvisioningState | null> {
    const existing = await this.getStoredById(workspaceId, projectId, libraryId);
    return existing ? toFileLibraryProvisioningState(existing) : null;
  }

  async findTemplateCloneProvisioning(input: {
    workspaceId: string;
    projectId: string;
    createdByUserId: string;
    templateId: string;
    requestId?: string | null;
    name?: string;
  }): Promise<FileLibraryProvisioningState | null> {
    const records = await this.docStore.list<FileLibraryStoredRecord>(FILE_LIBRARY_CATALOG_COLLECTION, {
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      created_by_user_id: input.createdByUserId,
    });
    const candidates = records
      .map((record) => tryNormalizeFileLibraryStoredRecord(record))
      .filter((record): record is FileLibraryStoredRecord => (
        !!record
        && record.status === 'creating'
        && record.provisioning_kind === 'template_clone'
        && record.provisioning_template_id === input.templateId
        && (
          input.requestId
            ? record.provisioning_request_id === input.requestId
            : (!input.name || record.name === input.name)
        )
      ))
      .sort((left, right) => {
        const updated = right.updated_at.localeCompare(left.updated_at);
        return updated !== 0 ? updated : right.created_at.localeCompare(left.created_at);
      });
    return candidates[0] ? toFileLibraryProvisioningState(candidates[0]) : null;
  }

  async acquireReadyLifecycleFence(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    expectedVersion: number;
    taskId: string;
    correlationId: string;
    now?: string;
    ttlMs?: number;
  }): Promise<{
    ok: true;
    fence: FileLibraryLifecycleFence;
  } | {
    ok: false;
    code: 'FILE_LIBRARY_NOT_FOUND' | 'FILE_LIBRARY_DELETING' | 'FILE_LIBRARY_NOT_READY';
    library: FileLibraryRecord | null;
  }> {
    const existing = await this.getStoredById(input.workspaceId, input.projectId, input.libraryId);
    if (!existing) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    if (existing.status === 'deleting' || existing.status === 'deleted') {
      return { ok: false, code: 'FILE_LIBRARY_DELETING', library: toPublicFileLibraryRecord(existing) };
    }
    if (
      existing.status !== 'ready'
      || existing.version !== input.expectedVersion
      || existing.lifecycle_fence_token !== null
    ) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_READY', library: toPublicFileLibraryRecord(existing) };
    }
    const now = input.now ?? new Date().toISOString();
    const token = `bind_${input.taskId}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const next: FileLibraryStoredRecord = {
      ...existing,
      version: existing.version + 1,
      lifecycle_fence_token: token,
      lifecycle_fence_kind: 'binding_acquire',
      lifecycle_fence_owner_task_id: input.taskId,
      lifecycle_fence_correlation_id: input.correlationId,
      lifecycle_fence_expires_at: new Date(Date.parse(now) + (input.ttlMs ?? 5 * 60 * 1000)).toISOString(),
      updated_at: now,
    };
    const result = await this.docStore.updateIfMatch<FileLibraryStoredRecord>(
      FILE_LIBRARY_CATALOG_COLLECTION,
      input.libraryId,
      {
        expected: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          status: 'ready',
          version: input.expectedVersion,
          lifecycle_fence_token: null,
        },
        patch: next,
      },
    );
    if (result.ok) {
      const stored = normalizeFileLibraryStoredRecord(result.doc);
      return {
        ok: true,
        fence: {
          token,
          version: stored.version,
          library: toPublicFileLibraryRecord(stored),
        },
      };
    }
    const current = result.current ? tryNormalizeFileLibraryStoredRecord(result.current) : null;
    if (!current) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    return {
      ok: false,
      code: current.status === 'deleting' || current.status === 'deleted'
        ? 'FILE_LIBRARY_DELETING'
        : 'FILE_LIBRARY_NOT_READY',
      library: toPublicFileLibraryRecord(current),
    };
  }

  async verifyReadyLifecycleFence(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    expectedVersion: number;
    token: string;
  }): Promise<{
    ok: true;
    library: FileLibraryRecord;
  } | {
    ok: false;
    code: 'FILE_LIBRARY_NOT_FOUND' | 'FILE_LIBRARY_DELETING' | 'FILE_LIBRARY_NOT_READY';
    library: FileLibraryRecord | null;
  }> {
    const result = await this.docStore.updateIfMatch<FileLibraryStoredRecord>(
      FILE_LIBRARY_CATALOG_COLLECTION,
      input.libraryId,
      {
        expected: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          status: 'ready',
          version: input.expectedVersion,
          lifecycle_fence_token: input.token,
        },
      },
    );
    if (result.ok) {
      const stored = tryNormalizeFileLibraryStoredRecord(result.doc);
      return stored
        ? { ok: true, library: toPublicFileLibraryRecord(stored) }
        : { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    const current = result.current ? tryNormalizeFileLibraryStoredRecord(result.current) : null;
    if (!current) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    return {
      ok: false,
      code: current.status === 'deleting' || current.status === 'deleted'
        ? 'FILE_LIBRARY_DELETING'
        : 'FILE_LIBRARY_NOT_READY',
      library: toPublicFileLibraryRecord(current),
    };
  }

  async releaseReadyLifecycleFence(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    expectedVersion: number;
    token: string;
    now?: string;
  }): Promise<{
    ok: true;
    library: FileLibraryRecord;
    released: boolean;
  } | {
    ok: false;
    code: 'FILE_LIBRARY_NOT_FOUND' | 'FILE_LIBRARY_DELETING' | 'FILE_LIBRARY_NOT_READY';
    library: FileLibraryRecord | null;
  }> {
    const existing = await this.getStoredById(input.workspaceId, input.projectId, input.libraryId);
    if (!existing) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    if (existing.lifecycle_fence_token === null) {
      return { ok: true, released: false, library: toPublicFileLibraryRecord(existing) };
    }
    const next: FileLibraryStoredRecord = {
      ...existing,
      version: existing.version + 1,
      lifecycle_fence_token: null,
      lifecycle_fence_kind: null,
      lifecycle_fence_owner_task_id: null,
      lifecycle_fence_correlation_id: null,
      lifecycle_fence_expires_at: null,
      updated_at: input.now ?? new Date().toISOString(),
    };
    const result = await this.docStore.updateIfMatch<FileLibraryStoredRecord>(
      FILE_LIBRARY_CATALOG_COLLECTION,
      input.libraryId,
      {
        expected: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          status: 'ready',
          version: input.expectedVersion,
          lifecycle_fence_token: input.token,
        },
        patch: next,
      },
    );
    if (result.ok) {
      return {
        ok: true,
        released: true,
        library: toPublicFileLibraryRecord(normalizeFileLibraryStoredRecord(result.doc)),
      };
    }
    const current = result.current ? tryNormalizeFileLibraryStoredRecord(result.current) : null;
    if (!current) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    return {
      ok: false,
      code: current.status === 'deleting' || current.status === 'deleted'
        ? 'FILE_LIBRARY_DELETING'
        : 'FILE_LIBRARY_NOT_READY',
      library: toPublicFileLibraryRecord(current),
    };
  }

  async transitionReadyToDeleting(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    expectedVersion: number;
    correlationId: string;
    now?: string;
  }): Promise<{
    ok: true;
    library: FileLibraryRecord;
  } | {
    ok: false;
    code: 'FILE_LIBRARY_NOT_FOUND' | 'FILE_LIBRARY_DELETING' | 'FILE_LIBRARY_NOT_READY';
    library: FileLibraryRecord | null;
  }> {
    const existing = await this.getStoredById(input.workspaceId, input.projectId, input.libraryId);
    if (!existing) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    if (existing.status === 'deleting' || existing.status === 'deleted') {
      return { ok: false, code: 'FILE_LIBRARY_DELETING', library: toPublicFileLibraryRecord(existing) };
    }
    if (
      existing.status !== 'ready'
      || existing.version !== input.expectedVersion
      || existing.lifecycle_fence_token !== null
    ) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_READY', library: toPublicFileLibraryRecord(existing) };
    }
    const next: FileLibraryStoredRecord = {
      ...existing,
      status: 'deleting',
      version: existing.version + 1,
      lifecycle_fence_token: null,
      lifecycle_fence_kind: null,
      lifecycle_fence_owner_task_id: null,
      lifecycle_fence_correlation_id: null,
      lifecycle_fence_expires_at: null,
      delete_correlation_id: input.correlationId,
      updated_at: input.now ?? new Date().toISOString(),
    };
    const result = await this.docStore.updateIfMatch<FileLibraryRecord>(
      FILE_LIBRARY_CATALOG_COLLECTION,
      input.libraryId,
      {
        expected: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          status: 'ready',
          version: input.expectedVersion,
          lifecycle_fence_token: null,
        },
        patch: next,
      },
    );
    if (result.ok) {
      return { ok: true, library: toPublicFileLibraryRecord(normalizeFileLibraryStoredRecord(result.doc)) };
    }
    const current = result.current ? tryNormalizeFileLibraryStoredRecord(result.current) : null;
    if (!current) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    return {
      ok: false,
      code: current.status === 'deleting' || current.status === 'deleted'
        ? 'FILE_LIBRARY_DELETING'
        : 'FILE_LIBRARY_NOT_READY',
      library: toPublicFileLibraryRecord(current),
    };
  }

  async rollbackDeletingToReady(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    expectedVersion: number;
    correlationId: string;
    now?: string;
  }): Promise<FileLibraryRecord | null> {
    const existing = await this.getStoredById(input.workspaceId, input.projectId, input.libraryId);
    if (!existing) return null;
    const next: FileLibraryStoredRecord = {
      ...existing,
      status: 'ready',
      version: existing.version + 1,
      lifecycle_fence_token: null,
      lifecycle_fence_kind: null,
      lifecycle_fence_owner_task_id: null,
      lifecycle_fence_correlation_id: null,
      lifecycle_fence_expires_at: null,
      delete_correlation_id: input.correlationId,
      updated_at: input.now ?? new Date().toISOString(),
    };
    const result = await this.docStore.updateIfMatch<FileLibraryRecord>(
      FILE_LIBRARY_CATALOG_COLLECTION,
      input.libraryId,
      {
        expected: {
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          status: 'deleting',
          version: input.expectedVersion,
        },
        patch: next,
      },
    );
    if (result.ok) {
      return toPublicFileLibraryRecord(normalizeFileLibraryStoredRecord(result.doc));
    }
    const current = result.current ? tryNormalizeFileLibraryStoredRecord(result.current) : null;
    return current ? toPublicFileLibraryRecord(current) : null;
  }

  async delete(workspaceId: string, projectId: string, libraryId: string): Promise<boolean> {
    const existing = await this.getById(workspaceId, projectId, libraryId);
    if (!existing) {
      return false;
    }
    await this.docStore.delete(FILE_LIBRARY_CATALOG_COLLECTION, libraryId);
    return true;
  }
}

export type FileLibrarySavePointPurpose = 'user' | 'template_source' | 'task_template_source';

export interface FileLibrarySavePointPublicRecord {
  id: string;
  file_library_id: string;
  message?: string;
  created_at: string;
}

export interface FileLibrarySavePointMappingRecord extends FileLibrarySavePointPublicRecord {
  workspace_id: string;
  project_id: string;
  library_id: string;
  afscp_save_point_id: string;
  purpose: FileLibrarySavePointPurpose;
  updated_at: string;
}

export type FileLibraryRestoreOperationStatus =
  | 'pending'
  | 'restoring'
  | 'succeeded'
  | 'failed'
  | 'recovery_required';
export type FileLibraryVersionOperationKind =
  | 'save_point_create'
  | 'restore';
export type FileLibraryVersionOperationStatus =
  | 'accepted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'recovery_required';

export interface FileLibraryVersionOperationPublicRecord {
  id: string;
  kind: FileLibraryVersionOperationKind;
  status: FileLibraryVersionOperationStatus;
  file_library_id?: string;
  source_save_point_id?: string;
  result_save_point_id?: string;
  message?: string;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface FileLibraryVersionOperationRecord extends FileLibraryVersionOperationPublicRecord {
  workspace_id: string;
  project_id: string;
  library_id: string;
  afscp_operation_id: string | null;
  idempotency_key?: string;
  created_by_user_id: string;
  completed_at?: string;
}

export interface FileLibraryRestoreOperationPublicRecord {
  id: string;
  file_library_id: string;
  source_save_point_id: string;
  status: FileLibraryRestoreOperationStatus;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface FileLibraryRestoreOperationRecord extends FileLibraryRestoreOperationPublicRecord {
  workspace_id: string;
  project_id: string;
  library_id: string;
  afscp_operation_id: string | null;
  source_afscp_save_point_id: string;
  idempotency_key: string;
  created_by_user_id: string;
  failure_reason?: string;
  runtime_access_release_task_id?: string;
  runtime_access_release_binding_generation?: number;
  runtime_access_release_fence_correlation_id?: string;
  runtime_access_release_restore_correlation_id?: string;
}

type FileLibraryRestoreOperationCreateInput = {
  id?: string;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  afscpOperationId?: string | null;
  sourceSavePointId: string;
  sourceAfscpSavePointId: string;
  status: FileLibraryRestoreOperationStatus;
  idempotencyKey: string;
  createdByUserId: string;
  failureReason?: string;
  runtimeAccessReleaseTaskId?: string;
  runtimeAccessReleaseBindingGeneration?: number;
  runtimeAccessReleaseFenceCorrelationId?: string;
  runtimeAccessReleaseRestoreCorrelationId?: string;
};

type FileLibraryRestoreOperationCreateOrReuseResult = {
  operation: FileLibraryRestoreOperationRecord;
  created: boolean;
  reason: 'created' | 'idempotency' | 'active';
};

export type TaskFileTemplateStatus = 'unpublished' | 'published' | 'failed';

export interface TaskFileTemplatePublicRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description?: string;
  status: TaskFileTemplateStatus;
  source_library_id: string;
  source_save_point_id?: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface TaskFileTemplateRecord extends TaskFileTemplatePublicRecord {
  afscp_template_id: string;
  afscp_create_operation_id?: string;
  source_afscp_save_point_id?: string;
  idempotency_key?: string;
  idempotency_request_hash?: string;
}

function scopedDigestId(prefix: string, parts: string[], length = 24): string {
  const digest = createHash('sha256')
    .update(parts.join('\0'))
    .digest('base64url')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, length);
  return `${prefix}_${digest}`;
}

export function buildFileLibrarySavePointPublicId(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  afscpSavePointId: string;
}): string {
  return scopedDigestId('flsp', [
    input.workspaceId,
    input.projectId,
    input.libraryId,
    input.afscpSavePointId,
  ]);
}

export function generateFileLibraryRestoreOperationId(): string {
  return `flro_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function generateFileLibraryVersionOperationId(): string {
  return `flop_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function buildFileLibraryVersionOperationIdempotencyId(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  kind: FileLibraryVersionOperationKind;
  idempotencyKey: string;
}): string {
  return scopedDigestId('flop', [
    input.workspaceId,
    input.projectId,
    input.libraryId,
    input.kind,
    input.idempotencyKey,
  ]);
}

export function buildFileLibraryRestoreOperationIdempotencyId(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  idempotencyKey: string;
}): string {
  return scopedDigestId('flro', [
    input.workspaceId,
    input.projectId,
    input.libraryId,
    input.idempotencyKey,
  ]);
}

export function buildFileLibraryRestoreOperationActiveLockId(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): string {
  return scopedDigestId('flro_active', [
    input.workspaceId,
    input.projectId,
    input.libraryId,
  ]);
}

export function generateTaskFileTemplateId(): string {
  return `tftpl_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function buildAfscpTemplateId(taskFileTemplateId: string): string {
  const segment = taskFileTemplateId
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 58);
  return `tmpl_${segment || randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function buildTaskFileTemplateIdempotencyId(input: {
  workspaceId: string;
  projectId: string;
  idempotencyKey: string;
}): string {
  return scopedDigestId('tftpl', [
    input.workspaceId,
    input.projectId,
    input.idempotencyKey,
  ]);
}

export function buildTaskFileTemplateIdempotencyRequestHash(input: {
  sourceLibraryId: string;
  name: string;
  description?: string;
  publishOnCreate?: boolean;
}): string {
  const canonical = JSON.stringify({
    source_library_id: input.sourceLibraryId,
    name: input.name,
    description: input.description ?? null,
    publish_on_create: input.publishOnCreate === true,
  });
  return createHash('sha256').update(canonical).digest('base64url');
}

const PUBLIC_OPERATION_FAILURE_REASONS = new Set([
  'file_library_active_writer_blocked',
  'file_library_capability_denied',
  'file_library_restore_failed',
  'file_library_save_point_create_failed',
  'file_library_storage_admin_action_required',
  'file_library_template_create_failed',
  'file_library_template_clone_failed',
]);

function publicOperationFailureReason(reason: string | undefined, fallback: string): string | undefined {
  const trimmed = reason?.trim();
  if (!trimmed) return undefined;
  if (PUBLIC_OPERATION_FAILURE_REASONS.has(trimmed)) {
    return trimmed;
  }
  const normalized = trimmed.toLowerCase();
  if (
    normalized.includes('recovery')
    || normalized.includes('operator')
    || normalized.includes('journal')
    || normalized.includes('control_root')
    || normalized.includes('/var/lib')
  ) {
    return 'file_library_storage_admin_action_required';
  }
  if (normalized.includes('writer')) {
    return 'file_library_active_writer_blocked';
  }
  if (normalized.includes('capability')) {
    return 'file_library_capability_denied';
  }
  return fallback;
}

function publicSavePoint(record: FileLibrarySavePointMappingRecord): FileLibrarySavePointPublicRecord {
  return {
    id: record.id,
    file_library_id: record.file_library_id,
    ...(record.message ? { message: record.message } : {}),
    created_at: record.created_at,
  };
}

function resolveFileLibrarySavePointPurpose(input: {
  purpose?: FileLibrarySavePointPurpose;
  existingPurpose?: FileLibrarySavePointPurpose;
}): FileLibrarySavePointPurpose {
  if (input.purpose) return input.purpose;
  return input.existingPurpose ?? 'user';
}

function publicRestoreOperation(
  record: FileLibraryRestoreOperationRecord,
): FileLibraryRestoreOperationPublicRecord {
  const failureReason = publicOperationFailureReason(record.failure_reason, 'file_library_restore_failed');
  return {
    id: record.id,
    file_library_id: record.file_library_id,
    source_save_point_id: record.source_save_point_id,
    status: record.status,
    ...(failureReason ? { failure_reason: failureReason } : {}),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function publicVersionOperation(
  record: FileLibraryVersionOperationRecord,
): FileLibraryVersionOperationPublicRecord {
  const failureReason = publicOperationFailureReason(
    record.failure_reason,
    record.kind === 'save_point_create'
      ? 'file_library_save_point_create_failed'
      : 'file_library_restore_failed',
  );
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    ...(record.file_library_id ? { file_library_id: record.file_library_id } : {}),
    ...(record.source_save_point_id ? { source_save_point_id: record.source_save_point_id } : {}),
    ...(record.result_save_point_id ? { result_save_point_id: record.result_save_point_id } : {}),
    ...(record.message ? { message: record.message } : {}),
    ...(failureReason ? { failure_reason: failureReason } : {}),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export function publicTaskFileTemplate(record: TaskFileTemplateRecord): TaskFileTemplatePublicRecord {
  return {
    id: record.id,
    workspace_id: record.workspace_id,
    project_id: record.project_id,
    name: record.name,
    ...(record.description ? { description: record.description } : {}),
    status: record.status,
    source_library_id: record.source_library_id,
    ...(record.source_save_point_id ? { source_save_point_id: record.source_save_point_id } : {}),
    created_by_user_id: record.created_by_user_id,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export class JsonDocFileLibrarySavePointMappingRepo {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async upsertFromAfscp(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    afscpSavePointId: string;
    message?: string;
    createdAt?: string;
    purpose?: FileLibrarySavePointPurpose;
  }): Promise<FileLibrarySavePointMappingRecord> {
    const id = buildFileLibrarySavePointPublicId(input);
    const existing = await this.getById(input.workspaceId, input.projectId, input.libraryId, id);
    const now = this.nowIso();
    const record: FileLibrarySavePointMappingRecord = {
      id,
      file_library_id: input.libraryId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      library_id: input.libraryId,
      afscp_save_point_id: input.afscpSavePointId,
      purpose: resolveFileLibrarySavePointPurpose({
        purpose: input.purpose,
        existingPurpose: existing?.purpose,
      }),
      ...(input.message ?? existing?.message ? { message: input.message ?? existing?.message } : {}),
      created_at: input.createdAt ?? existing?.created_at ?? now,
      updated_at: now,
    };
    await this.docStore.upsert(FILE_LIBRARY_SAVE_POINT_MAPPING_COLLECTION, id, record);
    return record;
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    savePointId: string,
  ): Promise<FileLibrarySavePointMappingRecord | null> {
    const record = await this.docStore.get<FileLibrarySavePointMappingRecord>(
      FILE_LIBRARY_SAVE_POINT_MAPPING_COLLECTION,
      savePointId,
    );
    if (
      !record
      || record.workspace_id !== workspaceId
      || record.project_id !== projectId
      || record.library_id !== libraryId
    ) {
      return null;
    }
    return record;
  }

  async getByAfscpId(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    afscpSavePointId: string;
  }): Promise<FileLibrarySavePointMappingRecord | null> {
    const id = buildFileLibrarySavePointPublicId(input);
    return this.getById(input.workspaceId, input.projectId, input.libraryId, id);
  }

  async listByLibrary(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    includeTemplateSources?: boolean;
  }): Promise<FileLibrarySavePointMappingRecord[]> {
    const records = await this.docStore.list<FileLibrarySavePointMappingRecord>(
      FILE_LIBRARY_SAVE_POINT_MAPPING_COLLECTION,
      {
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        library_id: input.libraryId,
      },
    );
    return input.includeTemplateSources
      ? records
      : records.filter((record) => record.purpose === 'user');
  }

  toPublic(record: FileLibrarySavePointMappingRecord): FileLibrarySavePointPublicRecord {
    return publicSavePoint(record);
  }
}

function isActiveVersionOperationStatus(status: FileLibraryVersionOperationStatus): boolean {
  return status === 'accepted' || status === 'running';
}

function isSameVersionOperationIdempotencyRequest(
  current: FileLibraryVersionOperationRecord,
  input: {
    message?: string;
    sourceSavePointId?: string;
  },
): boolean {
  return (current.message ?? undefined) === (input.message ?? undefined)
    && (current.source_save_point_id ?? undefined) === (input.sourceSavePointId ?? undefined);
}

export class JsonDocFileLibraryVersionOperationRepo {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async create(input: {
    id?: string;
    workspaceId: string;
    projectId: string;
    libraryId: string;
    kind: FileLibraryVersionOperationKind;
    status: FileLibraryVersionOperationStatus;
    afscpOperationId?: string | null;
    idempotencyKey?: string;
    createdByUserId: string;
    message?: string;
    failureReason?: string;
    sourceSavePointId?: string;
    resultSavePointId?: string;
  }): Promise<FileLibraryVersionOperationRecord> {
    const now = this.nowIso();
    const record: FileLibraryVersionOperationRecord = {
      id: input.id ?? generateFileLibraryVersionOperationId(),
      kind: input.kind,
      status: input.status,
      file_library_id: input.libraryId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      library_id: input.libraryId,
      afscp_operation_id: input.afscpOperationId ?? null,
      ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
      created_by_user_id: input.createdByUserId,
      ...(input.message ? { message: input.message } : {}),
      ...(input.failureReason ? { failure_reason: input.failureReason } : {}),
      ...(input.sourceSavePointId ? { source_save_point_id: input.sourceSavePointId } : {}),
      ...(input.resultSavePointId ? { result_save_point_id: input.resultSavePointId } : {}),
      ...(isActiveVersionOperationStatus(input.status) ? {} : { completed_at: now }),
      created_at: now,
      updated_at: now,
    };
    await this.docStore.upsert(FILE_LIBRARY_VERSION_OPERATION_COLLECTION, record.id, record);
    return record;
  }

  async createOrReuseByIdempotencyKey(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    kind: FileLibraryVersionOperationKind;
    status: FileLibraryVersionOperationStatus;
    afscpOperationId?: string | null;
    idempotencyKey: string;
    createdByUserId: string;
    message?: string;
    failureReason?: string;
    sourceSavePointId?: string;
    resultSavePointId?: string;
  }): Promise<{
    operation: FileLibraryVersionOperationRecord;
    created: boolean;
  }> {
    const now = this.nowIso();
    const record: FileLibraryVersionOperationRecord = {
      id: buildFileLibraryVersionOperationIdempotencyId(input),
      kind: input.kind,
      status: input.status,
      file_library_id: input.libraryId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      library_id: input.libraryId,
      afscp_operation_id: input.afscpOperationId ?? null,
      idempotency_key: input.idempotencyKey,
      created_by_user_id: input.createdByUserId,
      ...(input.message ? { message: input.message } : {}),
      ...(input.failureReason ? { failure_reason: input.failureReason } : {}),
      ...(input.sourceSavePointId ? { source_save_point_id: input.sourceSavePointId } : {}),
      ...(input.resultSavePointId ? { result_save_point_id: input.resultSavePointId } : {}),
      ...(isActiveVersionOperationStatus(input.status) ? {} : { completed_at: now }),
      created_at: now,
      updated_at: now,
    };
    const result = await this.docStore.createIfAbsent(
      FILE_LIBRARY_VERSION_OPERATION_COLLECTION,
      record.id,
      record,
    );
    if (result.ok) {
      return { operation: record, created: true };
    }
    const current = result.current;
    if (
      current.workspace_id !== input.workspaceId
      || current.project_id !== input.projectId
      || current.library_id !== input.libraryId
      || current.kind !== input.kind
      || current.idempotency_key !== input.idempotencyKey
      || !isSameVersionOperationIdempotencyRequest(current, input)
    ) {
      throw new Error('file_library_version_operation_idempotency_conflict');
    }
    return { operation: current, created: false };
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    operationId: string,
  ): Promise<FileLibraryVersionOperationRecord | null> {
    const record = await this.docStore.get<FileLibraryVersionOperationRecord>(
      FILE_LIBRARY_VERSION_OPERATION_COLLECTION,
      operationId,
    );
    if (
      !record
      || record.workspace_id !== workspaceId
      || record.project_id !== projectId
      || record.library_id !== libraryId
    ) {
      return null;
    }
    return record;
  }

  async getByIdInProject(
    workspaceId: string,
    projectId: string,
    operationId: string,
  ): Promise<FileLibraryVersionOperationRecord | null> {
    const record = await this.docStore.get<FileLibraryVersionOperationRecord>(
      FILE_LIBRARY_VERSION_OPERATION_COLLECTION,
      operationId,
    );
    if (
      !record
      || record.workspace_id !== workspaceId
      || record.project_id !== projectId
    ) {
      return null;
    }
    return record;
  }

  async findLatestByLibrary(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryVersionOperationRecord | null> {
    const records = await this.docStore.list<FileLibraryVersionOperationRecord>(
      FILE_LIBRARY_VERSION_OPERATION_COLLECTION,
      {
        workspace_id: workspaceId,
        project_id: projectId,
        library_id: libraryId,
      },
    );
    const sorted = records.sort((left, right) => {
      const activeDelta = Number(isActiveVersionOperationStatus(right.status))
        - Number(isActiveVersionOperationStatus(left.status));
      if (activeDelta !== 0) return activeDelta;
      const updated = right.updated_at.localeCompare(left.updated_at);
      return updated !== 0 ? updated : right.created_at.localeCompare(left.created_at);
    });
    return sorted[0] ?? null;
  }

  async findByIdempotencyKey(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    kind: FileLibraryVersionOperationKind,
    idempotencyKey: string,
  ): Promise<FileLibraryVersionOperationRecord | null> {
    const records = await this.docStore.list<FileLibraryVersionOperationRecord>(
      FILE_LIBRARY_VERSION_OPERATION_COLLECTION,
      {
        workspace_id: workspaceId,
        project_id: projectId,
        library_id: libraryId,
        kind,
        idempotency_key: idempotencyKey,
      },
    );
    return records[0] ?? null;
  }

  async findActiveByLibrary(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryVersionOperationRecord | null> {
    const records = await this.docStore.list<FileLibraryVersionOperationRecord>(
      FILE_LIBRARY_VERSION_OPERATION_COLLECTION,
      {
        workspace_id: workspaceId,
        project_id: projectId,
        library_id: libraryId,
      },
    );
    const active = records
      .filter((record) => isActiveVersionOperationStatus(record.status))
      .sort((left, right) => {
        const updated = right.updated_at.localeCompare(left.updated_at);
        return updated !== 0 ? updated : right.created_at.localeCompare(left.created_at);
      });
    return active[0] ?? null;
  }

  async updateStatus(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    operationId: string;
    status: FileLibraryVersionOperationStatus;
    failureReason?: string | null;
    resultSavePointId?: string | null;
  }): Promise<FileLibraryVersionOperationRecord | null> {
    const existing = await this.getById(
      input.workspaceId,
      input.projectId,
      input.libraryId,
      input.operationId,
    );
    if (!existing) {
      return null;
    }
    const now = this.nowIso();
    const next: FileLibraryVersionOperationRecord = {
      ...existing,
      status: input.status,
      updated_at: now,
      ...(isActiveVersionOperationStatus(input.status)
        ? {}
        : { completed_at: existing.completed_at ?? now }),
    };
    if (input.failureReason !== undefined) {
      if (input.failureReason) {
        next.failure_reason = input.failureReason;
      } else {
        delete next.failure_reason;
      }
    }
    if (input.resultSavePointId !== undefined) {
      if (input.resultSavePointId) {
        next.result_save_point_id = input.resultSavePointId;
      } else {
        delete next.result_save_point_id;
      }
    }
    await this.docStore.upsert(FILE_LIBRARY_VERSION_OPERATION_COLLECTION, next.id, next);
    return next;
  }

  toPublic(record: FileLibraryVersionOperationRecord): FileLibraryVersionOperationPublicRecord {
    return publicVersionOperation(record);
  }
}

export class JsonDocFileLibraryRestoreOperationRepo {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  private buildOperationRecord(
    input: FileLibraryRestoreOperationCreateInput,
    operationId: string,
  ): FileLibraryRestoreOperationRecord {
    const now = this.nowIso();
    return {
      id: operationId,
      file_library_id: input.libraryId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      library_id: input.libraryId,
      afscp_operation_id: input.afscpOperationId ?? null,
      source_save_point_id: input.sourceSavePointId,
      source_afscp_save_point_id: input.sourceAfscpSavePointId,
      status: input.status,
      idempotency_key: input.idempotencyKey,
      created_by_user_id: input.createdByUserId,
      ...(input.failureReason ? { failure_reason: input.failureReason } : {}),
      ...(input.runtimeAccessReleaseTaskId ? { runtime_access_release_task_id: input.runtimeAccessReleaseTaskId } : {}),
      ...(typeof input.runtimeAccessReleaseBindingGeneration === 'number'
        ? { runtime_access_release_binding_generation: input.runtimeAccessReleaseBindingGeneration }
        : {}),
      ...(input.runtimeAccessReleaseFenceCorrelationId
        ? { runtime_access_release_fence_correlation_id: input.runtimeAccessReleaseFenceCorrelationId }
        : {}),
      ...(input.runtimeAccessReleaseRestoreCorrelationId
        ? { runtime_access_release_restore_correlation_id: input.runtimeAccessReleaseRestoreCorrelationId }
        : {}),
      created_at: now,
      updated_at: now,
    };
  }

  private activeLockId(workspaceId: string, projectId: string, libraryId: string): string {
    return buildFileLibraryRestoreOperationActiveLockId({ workspaceId, projectId, libraryId });
  }

  private async getActiveLock(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryRestoreOperationRecord | null> {
    const record = await this.docStore.get<FileLibraryRestoreOperationRecord>(
      FILE_LIBRARY_RESTORE_OPERATION_ACTIVE_LOCK_COLLECTION,
      this.activeLockId(workspaceId, projectId, libraryId),
    );
    if (
      !record
      || record.workspace_id !== workspaceId
      || record.project_id !== projectId
      || record.library_id !== libraryId
    ) {
      return null;
    }
    return record;
  }

  private async releaseActiveLockForOperation(operation: FileLibraryRestoreOperationRecord): Promise<void> {
    await this.docStore.deleteIfMatch<FileLibraryRestoreOperationRecord>(
      FILE_LIBRARY_RESTORE_OPERATION_ACTIVE_LOCK_COLLECTION,
      this.activeLockId(operation.workspace_id, operation.project_id, operation.library_id),
      {
        expected: {
          id: operation.id,
          workspace_id: operation.workspace_id,
          project_id: operation.project_id,
          library_id: operation.library_id,
        },
      },
    );
  }

  private async mirrorActiveLock(operation: FileLibraryRestoreOperationRecord): Promise<void> {
    await this.docStore.updateIfMatch<FileLibraryRestoreOperationRecord>(
      FILE_LIBRARY_RESTORE_OPERATION_ACTIVE_LOCK_COLLECTION,
      this.activeLockId(operation.workspace_id, operation.project_id, operation.library_id),
      {
        expected: {
          id: operation.id,
          workspace_id: operation.workspace_id,
          project_id: operation.project_id,
          library_id: operation.library_id,
        },
        replace: operation,
      },
    );
  }

  private isActiveOperation(record: FileLibraryRestoreOperationRecord): boolean {
    return record.status === 'pending' || record.status === 'restoring';
  }

  private isSameIdempotencyRequest(
    current: FileLibraryRestoreOperationRecord,
    input: {
      sourceSavePointId: string;
      sourceAfscpSavePointId: string;
    },
  ): boolean {
    return current.source_save_point_id === input.sourceSavePointId
      && current.source_afscp_save_point_id === input.sourceAfscpSavePointId;
  }

  async create(input: FileLibraryRestoreOperationCreateInput): Promise<FileLibraryRestoreOperationRecord> {
    const record = this.buildOperationRecord(
      input,
      input.id ?? generateFileLibraryRestoreOperationId(),
    );
    await this.docStore.upsert(FILE_LIBRARY_RESTORE_OPERATION_COLLECTION, record.id, record);
    return record;
  }

  async createOrReuseByIdempotencyKey(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    afscpOperationId?: string | null;
    sourceSavePointId: string;
    sourceAfscpSavePointId: string;
    status: FileLibraryRestoreOperationStatus;
    idempotencyKey: string;
    createdByUserId: string;
    failureReason?: string;
  }): Promise<{
    operation: FileLibraryRestoreOperationRecord;
    created: boolean;
  }> {
    const id = buildFileLibraryRestoreOperationIdempotencyId(input);
    const record = this.buildOperationRecord(input, id);
    const result = await this.docStore.createIfAbsent(
      FILE_LIBRARY_RESTORE_OPERATION_COLLECTION,
      record.id,
      record,
    );
    if (result.ok) {
      return { operation: record, created: true };
    }
    const current = result.current;
    if (
      current.workspace_id !== input.workspaceId
      || current.project_id !== input.projectId
      || current.library_id !== input.libraryId
      || current.idempotency_key !== input.idempotencyKey
      || !this.isSameIdempotencyRequest(current, input)
    ) {
      throw new Error('file_library_restore_operation_idempotency_conflict');
    }
    return { operation: current, created: false };
  }

  async createOrReuseActiveByLibrary(
    input: Omit<FileLibraryRestoreOperationCreateInput, 'id'>,
  ): Promise<FileLibraryRestoreOperationCreateOrReuseResult> {
    const existing = await this.findByIdempotencyKey(
      input.workspaceId,
      input.projectId,
      input.libraryId,
      input.idempotencyKey,
    );
    if (existing) {
      if (!this.isSameIdempotencyRequest(existing, input)) {
        throw new Error('file_library_restore_operation_idempotency_conflict');
      }
      return { operation: existing, created: false, reason: 'idempotency' };
    }

    const operation = this.buildOperationRecord(
      input,
      buildFileLibraryRestoreOperationIdempotencyId(input),
    );
    const lockId = this.activeLockId(input.workspaceId, input.projectId, input.libraryId);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const lockResult = await this.docStore.createIfAbsent(
        FILE_LIBRARY_RESTORE_OPERATION_ACTIVE_LOCK_COLLECTION,
        lockId,
        operation,
      );
      if (lockResult.ok) {
        let operationResult: JsonDocConditionalCreateResult<FileLibraryRestoreOperationRecord>;
        try {
          operationResult = await this.docStore.createIfAbsent(
            FILE_LIBRARY_RESTORE_OPERATION_COLLECTION,
            operation.id,
            operation,
          );
        } catch (error) {
          await this.releaseActiveLockForOperation(operation);
          throw error;
        }
        if (operationResult.ok) {
          return { operation, created: true, reason: 'created' };
        }
        const current = operationResult.current;
        await this.releaseActiveLockForOperation(operation);
        if (
          current.workspace_id === input.workspaceId
          && current.project_id === input.projectId
          && current.library_id === input.libraryId
          && current.idempotency_key === input.idempotencyKey
        ) {
          if (!this.isSameIdempotencyRequest(current, input)) {
            throw new Error('file_library_restore_operation_idempotency_conflict');
          }
          return { operation: current, created: false, reason: 'idempotency' };
        }
        throw new Error('file_library_restore_operation_idempotency_conflict');
      }

      const lockedOperation = lockResult.current;
      if (
        lockedOperation.workspace_id !== input.workspaceId
        || lockedOperation.project_id !== input.projectId
        || lockedOperation.library_id !== input.libraryId
      ) {
        throw new Error('file_library_restore_operation_active_lock_conflict');
      }

      const storedOperation = await this.getById(
        input.workspaceId,
        input.projectId,
        input.libraryId,
        lockedOperation.id,
      );
      if (!storedOperation) {
        await this.releaseActiveLockForOperation(lockedOperation);
        continue;
      }
      if (this.isActiveOperation(storedOperation)) {
        if (
          storedOperation.idempotency_key === input.idempotencyKey
          && !this.isSameIdempotencyRequest(storedOperation, input)
        ) {
          throw new Error('file_library_restore_operation_idempotency_conflict');
        }
        return {
          operation: storedOperation,
          created: false,
          reason: storedOperation.idempotency_key === input.idempotencyKey ? 'idempotency' : 'active',
        };
      }

      await this.releaseActiveLockForOperation(lockedOperation);
    }

    const active = await this.findActiveByLibrary(input.workspaceId, input.projectId, input.libraryId);
    if (active) {
      return {
        operation: active,
        created: false,
        reason: active.idempotency_key === input.idempotencyKey ? 'idempotency' : 'active',
      };
    }
    throw new Error('file_library_restore_operation_active_lock_retry_exhausted');
  }

  async findByIdempotencyKey(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    idempotencyKey: string,
  ): Promise<FileLibraryRestoreOperationRecord | null> {
    const records = await this.docStore.list<FileLibraryRestoreOperationRecord>(
      FILE_LIBRARY_RESTORE_OPERATION_COLLECTION,
      {
        workspace_id: workspaceId,
        project_id: projectId,
        library_id: libraryId,
        idempotency_key: idempotencyKey,
      },
    );
    return records[0] ?? null;
  }

  async findActiveByLibrary(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryRestoreOperationRecord | null> {
    const lockedOperation = await this.getActiveLock(workspaceId, projectId, libraryId);
    if (lockedOperation) {
      const storedOperation = await this.getById(workspaceId, projectId, libraryId, lockedOperation.id);
      if (!storedOperation) {
        await this.releaseActiveLockForOperation(lockedOperation);
      } else if (this.isActiveOperation(storedOperation)) {
        return storedOperation;
      } else {
        await this.releaseActiveLockForOperation(lockedOperation);
      }
    }

    const records = await this.docStore.list<FileLibraryRestoreOperationRecord>(
      FILE_LIBRARY_RESTORE_OPERATION_COLLECTION,
      {
        workspace_id: workspaceId,
        project_id: projectId,
        library_id: libraryId,
      },
    );
    const active = records
      .filter((record) => this.isActiveOperation(record))
      .sort((left, right) => {
        const updated = right.updated_at.localeCompare(left.updated_at);
        return updated !== 0 ? updated : right.created_at.localeCompare(left.created_at);
      });
    return active[0] ?? null;
  }

  async findLatestByLibrary(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryRestoreOperationRecord | null> {
    const records = await this.docStore.list<FileLibraryRestoreOperationRecord>(
      FILE_LIBRARY_RESTORE_OPERATION_COLLECTION,
      {
        workspace_id: workspaceId,
        project_id: projectId,
        library_id: libraryId,
      },
    );
    const sorted = records.sort((left, right) => {
      const activeDelta = Number(this.isActiveOperation(right)) - Number(this.isActiveOperation(left));
      if (activeDelta !== 0) return activeDelta;
      const updated = right.updated_at.localeCompare(left.updated_at);
      return updated !== 0 ? updated : right.created_at.localeCompare(left.created_at);
    });
    return sorted[0] ?? null;
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    operationId: string,
  ): Promise<FileLibraryRestoreOperationRecord | null> {
    const record = await this.docStore.get<FileLibraryRestoreOperationRecord>(
      FILE_LIBRARY_RESTORE_OPERATION_COLLECTION,
      operationId,
    );
    if (
      !record
      || record.workspace_id !== workspaceId
      || record.project_id !== projectId
      || record.library_id !== libraryId
    ) {
      return null;
    }
    return record;
  }

  async getByIdInProject(
    workspaceId: string,
    projectId: string,
    operationId: string,
  ): Promise<FileLibraryRestoreOperationRecord | null> {
    const record = await this.docStore.get<FileLibraryRestoreOperationRecord>(
      FILE_LIBRARY_RESTORE_OPERATION_COLLECTION,
      operationId,
    );
    if (
      !record
      || record.workspace_id !== workspaceId
      || record.project_id !== projectId
    ) {
      return null;
    }
    return record;
  }

  async updateStatus(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    operationId: string;
    status: FileLibraryRestoreOperationStatus;
    afscpOperationId?: string | null;
    failureReason?: string | null;
  }): Promise<FileLibraryRestoreOperationRecord | null> {
    const existing = await this.getById(
      input.workspaceId,
      input.projectId,
      input.libraryId,
      input.operationId,
    );
    if (!existing) {
      return null;
    }
    const next: FileLibraryRestoreOperationRecord = {
      ...existing,
      status: input.status,
      updated_at: this.nowIso(),
    };
    if (input.afscpOperationId !== undefined) {
      next.afscp_operation_id = input.afscpOperationId;
    }
    if (input.failureReason !== undefined) {
      if (input.failureReason) {
        next.failure_reason = input.failureReason;
      } else {
        delete next.failure_reason;
      }
    }
    await this.docStore.upsert(FILE_LIBRARY_RESTORE_OPERATION_COLLECTION, next.id, next);
    if (this.isActiveOperation(next)) {
      await this.mirrorActiveLock(next);
    } else {
      await this.releaseActiveLockForOperation(next);
    }
    return next;
  }

  async updateRuntimeAccessReleaseAssociation(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    operationId: string;
    taskId: string;
    bindingGeneration: number;
    fenceCorrelationId: string;
    restoreCorrelationId: string;
  }): Promise<FileLibraryRestoreOperationRecord | null> {
    const existing = await this.getById(
      input.workspaceId,
      input.projectId,
      input.libraryId,
      input.operationId,
    );
    if (!existing) {
      return null;
    }
    const next: FileLibraryRestoreOperationRecord = {
      ...existing,
      runtime_access_release_task_id: input.taskId,
      runtime_access_release_binding_generation: input.bindingGeneration,
      runtime_access_release_fence_correlation_id: input.fenceCorrelationId,
      runtime_access_release_restore_correlation_id: input.restoreCorrelationId,
      updated_at: this.nowIso(),
    };
    await this.docStore.upsert(FILE_LIBRARY_RESTORE_OPERATION_COLLECTION, next.id, next);
    if (this.isActiveOperation(next)) {
      await this.mirrorActiveLock(next);
    }
    return next;
  }

  toPublic(record: FileLibraryRestoreOperationRecord): FileLibraryRestoreOperationPublicRecord {
    return publicRestoreOperation(record);
  }
}

export class JsonDocProjectTaskFileTemplateRepo {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  private buildCreateRecord(input: {
    id?: string;
    workspaceId: string;
    projectId: string;
    name: string;
    description?: string;
    status?: TaskFileTemplateStatus;
    sourceLibraryId: string;
    sourceSavePointId?: string;
    createdByUserId: string;
    afscpTemplateId: string;
    afscpCreateOperationId?: string;
    sourceAfscpSavePointId?: string;
    idempotencyKey?: string;
    publishOnCreate?: boolean;
  }): TaskFileTemplateRecord {
    const now = this.nowIso();
    const id = input.id ?? generateTaskFileTemplateId();
    return {
      id,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      status: input.status ?? 'unpublished',
      source_library_id: input.sourceLibraryId,
      ...(input.sourceSavePointId ? { source_save_point_id: input.sourceSavePointId } : {}),
      created_by_user_id: input.createdByUserId,
      afscp_template_id: input.afscpTemplateId,
      ...(input.afscpCreateOperationId ? { afscp_create_operation_id: input.afscpCreateOperationId } : {}),
      ...(input.sourceAfscpSavePointId ? { source_afscp_save_point_id: input.sourceAfscpSavePointId } : {}),
      ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
      ...(input.idempotencyKey
        ? { idempotency_request_hash: buildTaskFileTemplateIdempotencyRequestHash(input) }
        : {}),
      created_at: now,
      updated_at: now,
    };
  }

  async create(input: {
    id?: string;
    workspaceId: string;
    projectId: string;
    name: string;
    description?: string;
    status?: TaskFileTemplateStatus;
    sourceLibraryId: string;
    sourceSavePointId?: string;
    createdByUserId: string;
    afscpTemplateId: string;
    afscpCreateOperationId?: string;
    sourceAfscpSavePointId?: string;
    idempotencyKey?: string;
  }): Promise<TaskFileTemplateRecord> {
    const record = this.buildCreateRecord(input);
    await this.docStore.upsert(TASK_FILE_TEMPLATE_COLLECTION, record.id, record);
    return record;
  }

  async createOrReuseByIdempotencyKey(input: {
    workspaceId: string;
    projectId: string;
    name: string;
    description?: string;
    status?: TaskFileTemplateStatus;
    sourceLibraryId: string;
    sourceSavePointId?: string;
    createdByUserId: string;
    afscpTemplateId: string;
    afscpCreateOperationId?: string;
    sourceAfscpSavePointId?: string;
    idempotencyKey: string;
    publishOnCreate?: boolean;
  }): Promise<{ template: TaskFileTemplateRecord; created: boolean }> {
    const record = this.buildCreateRecord({
      ...input,
      id: buildTaskFileTemplateIdempotencyId(input),
    });
    const result = await this.docStore.createIfAbsent(
      TASK_FILE_TEMPLATE_COLLECTION,
      record.id,
      record,
    );
    if (result.ok) {
      return { template: record, created: true };
    }
    const current = result.current;
    if (
      current.workspace_id !== input.workspaceId
      || current.project_id !== input.projectId
      || current.idempotency_key !== input.idempotencyKey
      || !this.isSameIdempotencyRequest(current, input)
    ) {
      throw new Error('task_file_template_idempotency_conflict');
    }
    return { template: current, created: false };
  }

  private isSameIdempotencyRequest(
    current: TaskFileTemplateRecord,
    input: {
      sourceLibraryId: string;
      name: string;
      description?: string;
      publishOnCreate?: boolean;
    },
  ): boolean {
    const requestHash = buildTaskFileTemplateIdempotencyRequestHash(input);
    if (current.idempotency_request_hash) {
      return current.idempotency_request_hash === requestHash;
    }
    return current.source_library_id === input.sourceLibraryId
      && current.name === input.name
      && (current.description ?? undefined) === (input.description ?? undefined);
  }

  async findByIdempotencyKey(input: {
    workspaceId: string;
    projectId: string;
    sourceLibraryId: string;
    idempotencyKey: string;
  }): Promise<TaskFileTemplateRecord | null> {
    const records = await this.docStore.list<TaskFileTemplateRecord>(TASK_FILE_TEMPLATE_COLLECTION, {
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      idempotency_key: input.idempotencyKey,
    });
    return records[0] ?? null;
  }

  async listByProject(workspaceId: string, projectId: string): Promise<TaskFileTemplateRecord[]> {
    return this.docStore.list<TaskFileTemplateRecord>(TASK_FILE_TEMPLATE_COLLECTION, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getById(
    workspaceId: string,
    projectId: string,
    taskFileTemplateId: string,
  ): Promise<TaskFileTemplateRecord | null> {
    const record = await this.docStore.get<TaskFileTemplateRecord>(
      TASK_FILE_TEMPLATE_COLLECTION,
      taskFileTemplateId,
    );
    if (!record || record.workspace_id !== workspaceId || record.project_id !== projectId) {
      return null;
    }
    return record;
  }

  async updateStatus(input: {
    workspaceId: string;
    projectId: string;
    taskFileTemplateId: string;
    status: TaskFileTemplateStatus;
  }): Promise<TaskFileTemplateRecord | null> {
    const existing = await this.getById(input.workspaceId, input.projectId, input.taskFileTemplateId);
    if (!existing) {
      return null;
    }
    const next: TaskFileTemplateRecord = {
      ...existing,
      status: input.status,
      updated_at: this.nowIso(),
    };
    await this.docStore.upsert(TASK_FILE_TEMPLATE_COLLECTION, next.id, next);
    return next;
  }

  async publishWithSnapshot(input: {
    workspaceId: string;
    projectId: string;
    taskFileTemplateId: string;
    afscpTemplateId: string;
    afscpCreateOperationId?: string | null;
    sourceSavePointId?: string | null;
    sourceAfscpSavePointId?: string | null;
  }): Promise<TaskFileTemplateRecord | null> {
    const existing = await this.getById(input.workspaceId, input.projectId, input.taskFileTemplateId);
    if (!existing) {
      return null;
    }
    const next: TaskFileTemplateRecord = {
      ...existing,
      status: 'published',
      afscp_template_id: input.afscpTemplateId,
      updated_at: this.nowIso(),
    };
    if (input.afscpCreateOperationId !== undefined) {
      if (input.afscpCreateOperationId) {
        next.afscp_create_operation_id = input.afscpCreateOperationId;
      } else {
        delete next.afscp_create_operation_id;
      }
    }
    if (input.sourceSavePointId !== undefined) {
      if (input.sourceSavePointId) {
        next.source_save_point_id = input.sourceSavePointId;
      } else {
        delete next.source_save_point_id;
      }
    }
    if (input.sourceAfscpSavePointId !== undefined) {
      if (input.sourceAfscpSavePointId) {
        next.source_afscp_save_point_id = input.sourceAfscpSavePointId;
      } else {
        delete next.source_afscp_save_point_id;
      }
    }
    await this.docStore.upsert(TASK_FILE_TEMPLATE_COLLECTION, next.id, next);
    return next;
  }

  async delete(workspaceId: string, projectId: string, taskFileTemplateId: string): Promise<boolean> {
    const existing = await this.getById(workspaceId, projectId, taskFileTemplateId);
    if (!existing) {
      return false;
    }
    await this.docStore.delete(TASK_FILE_TEMPLATE_COLLECTION, taskFileTemplateId);
    return true;
  }

  toPublic(record: TaskFileTemplateRecord): TaskFileTemplatePublicRecord {
    return publicTaskFileTemplate(record);
  }
}
