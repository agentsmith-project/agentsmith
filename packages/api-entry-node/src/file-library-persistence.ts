import type { JsonDocStorePort } from '@mbos/ports';
import { createHash, randomUUID } from 'node:crypto';
import type {
  FileLibraryRecord,
} from './file-library-model.js';

export const FILE_LIBRARY_CATALOG_COLLECTION = 'project_file_libraries';
const FILE_LIBRARY_SAVE_POINT_MAPPING_COLLECTION = 'project_file_library_save_point_mappings';
const FILE_LIBRARY_RESTORE_PREVIEW_COLLECTION = 'project_file_library_restore_previews';
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

type FileLibraryStoredRecord = FileLibraryRecord & FileLibraryLifecycleFenceFields & FileLibraryProvisioningFields;

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
  'created_by_user_id',
  'created_at',
  'updated_at',
]);

const FILE_LIBRARY_STORED_RECORD_KEYS = new Set<string>([
  ...FILE_LIBRARY_PUBLIC_RECORD_KEYS,
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
  assertCatalogRecordKeys(raw, FILE_LIBRARY_STORED_RECORD_KEYS);
  const publicRecord = normalizeFileLibraryPublicFields(raw);
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
  return {
    ...publicRecord,
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

export type FileLibrarySavePointPurpose = 'user' | 'task_template_source' | 'restore_preview_fence';

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

export type FileLibraryRestorePreviewStatus =
  | 'previewing'
  | 'ready'
  | 'failed'
  | 'canceling'
  | 'canceled'
  | 'restoring'
  | 'restored';

export interface FileLibraryRestorePreviewChangeSummary {
  count: number;
  samples: string[];
}

export interface FileLibraryRestorePreviewSummary {
  added: FileLibraryRestorePreviewChangeSummary;
  changed: FileLibraryRestorePreviewChangeSummary;
  removed: FileLibraryRestorePreviewChangeSummary;
  destructive: boolean;
}

export type FileLibraryRestorePreviewBlockerCode =
  | 'active_writer_sessions'
  | 'stale_writer_session_uncertain'
  | 'restore_preview_stale'
  | 'restore_plan_requires_recovery';

export interface FileLibraryRestorePreviewBlocker {
  code: FileLibraryRestorePreviewBlockerCode;
  message?: string;
}

export interface FileLibraryRestorePreviewPublicRecord {
  id: string;
  file_library_id: string;
  source_save_point_id: string;
  status: FileLibraryRestorePreviewStatus;
  message?: string;
  summary?: FileLibraryRestorePreviewSummary;
  blockers?: FileLibraryRestorePreviewBlocker[];
  stale?: boolean;
  created_at: string;
  updated_at: string;
}

export interface FileLibraryRestorePreviewRecord extends FileLibraryRestorePreviewPublicRecord {
  workspace_id: string;
  project_id: string;
  library_id: string;
  afscp_preview_operation_id: string;
  afscp_active_operation_id?: string;
  source_afscp_save_point_id: string;
  restore_plan_id?: string;
}

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

export function generateFileLibraryRestorePreviewId(): string {
  return `flrp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export function generateFileLibraryRestoreRunId(): string {
  return `flrr_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
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

function publicSavePoint(record: FileLibrarySavePointMappingRecord): FileLibrarySavePointPublicRecord {
  return {
    id: record.id,
    file_library_id: record.file_library_id,
    ...(record.message ? { message: record.message } : {}),
    created_at: record.created_at,
  };
}

function publicRestorePreview(record: FileLibraryRestorePreviewRecord): FileLibraryRestorePreviewPublicRecord {
  return {
    id: record.id,
    file_library_id: record.file_library_id,
    source_save_point_id: record.source_save_point_id,
    status: record.status,
    ...(record.message ? { message: record.message } : {}),
    ...(record.summary ? { summary: normalizeRestorePreviewSummary(record.summary) } : {}),
    ...(record.blockers ? { blockers: normalizeRestorePreviewBlockers(record.blockers) } : {}),
    ...(record.stale !== undefined ? { stale: record.stale } : {}),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function normalizeRestorePreviewChangeSummary(
  summary: FileLibraryRestorePreviewChangeSummary,
): FileLibraryRestorePreviewChangeSummary {
  if (!Number.isSafeInteger(summary.count) || summary.count < 0 || !Array.isArray(summary.samples)) {
    throw new Error('invalid_file_library_restore_preview_record');
  }
  const samples = summary.samples.map((sample) => {
    if (typeof sample !== 'string' || sample.trim() === '') {
      throw new Error('invalid_file_library_restore_preview_record');
    }
    return sample;
  });
  return { count: summary.count, samples };
}

function normalizeRestorePreviewSummary(
  summary: FileLibraryRestorePreviewSummary,
): FileLibraryRestorePreviewSummary {
  if (typeof summary !== 'object' || summary === null || typeof summary.destructive !== 'boolean') {
    throw new Error('invalid_file_library_restore_preview_record');
  }
  return {
    added: normalizeRestorePreviewChangeSummary(summary.added),
    changed: normalizeRestorePreviewChangeSummary(summary.changed),
    removed: normalizeRestorePreviewChangeSummary(summary.removed),
    destructive: summary.destructive,
  };
}

const RESTORE_PREVIEW_BLOCKER_CODES = new Set<FileLibraryRestorePreviewBlockerCode>([
  'active_writer_sessions',
  'stale_writer_session_uncertain',
  'restore_preview_stale',
  'restore_plan_requires_recovery',
]);

function normalizeRestorePreviewBlockers(
  blockers: FileLibraryRestorePreviewBlocker[],
): FileLibraryRestorePreviewBlocker[] {
  if (!Array.isArray(blockers)) {
    throw new Error('invalid_file_library_restore_preview_record');
  }
  return blockers.map((blocker) => {
    if (
      typeof blocker !== 'object'
      || blocker === null
      || !RESTORE_PREVIEW_BLOCKER_CODES.has(blocker.code)
      || (blocker.message !== undefined && (typeof blocker.message !== 'string' || blocker.message.trim() === ''))
    ) {
      throw new Error('invalid_file_library_restore_preview_record');
    }
    return {
      code: blocker.code,
      ...(blocker.message ? { message: blocker.message } : {}),
    };
  });
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
      purpose: input.purpose ?? existing?.purpose ?? 'user',
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
    return records.filter((record) => (
      input.includeTemplateSources
        ? record.purpose !== 'restore_preview_fence'
        : record.purpose === 'user'
    ));
  }

  toPublic(record: FileLibrarySavePointMappingRecord): FileLibrarySavePointPublicRecord {
    return publicSavePoint(record);
  }
}

export class JsonDocFileLibraryRestorePreviewRepo {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async create(input: {
    id?: string;
    workspaceId: string;
    projectId: string;
    libraryId: string;
    afscpPreviewOperationId: string;
    activeAfscpOperationId?: string | null;
    sourceSavePointId: string;
    sourceAfscpSavePointId: string;
    status: FileLibraryRestorePreviewStatus;
    restorePlanId?: string;
    summary?: FileLibraryRestorePreviewSummary;
    blockers?: FileLibraryRestorePreviewBlocker[];
    stale?: boolean;
    message?: string;
  }): Promise<FileLibraryRestorePreviewRecord> {
    const now = this.nowIso();
    const record: FileLibraryRestorePreviewRecord = {
      id: input.id ?? generateFileLibraryRestorePreviewId(),
      file_library_id: input.libraryId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      library_id: input.libraryId,
      afscp_preview_operation_id: input.afscpPreviewOperationId,
      ...(input.activeAfscpOperationId ? { afscp_active_operation_id: input.activeAfscpOperationId } : {}),
      source_save_point_id: input.sourceSavePointId,
      source_afscp_save_point_id: input.sourceAfscpSavePointId,
      status: input.status,
      ...(input.restorePlanId ? { restore_plan_id: input.restorePlanId } : {}),
      ...(input.message ? { message: input.message } : {}),
      ...(input.summary ? { summary: normalizeRestorePreviewSummary(input.summary) } : {}),
      ...(input.blockers ? { blockers: normalizeRestorePreviewBlockers(input.blockers) } : {}),
      ...(input.stale !== undefined ? { stale: input.stale } : {}),
      created_at: now,
      updated_at: now,
    };
    await this.docStore.upsert(FILE_LIBRARY_RESTORE_PREVIEW_COLLECTION, record.id, record);
    return record;
  }

  async findActiveByLibrary(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryRestorePreviewRecord | null> {
    const records = await this.docStore.list<FileLibraryRestorePreviewRecord>(
      FILE_LIBRARY_RESTORE_PREVIEW_COLLECTION,
      {
        workspace_id: workspaceId,
        project_id: projectId,
        library_id: libraryId,
      },
    );
    const active = records
      .filter((record) => (
        record.status === 'previewing'
        || record.status === 'ready'
        || record.status === 'canceling'
        || record.status === 'restoring'
      ))
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
  ): Promise<FileLibraryRestorePreviewRecord | null> {
    const records = await this.docStore.list<FileLibraryRestorePreviewRecord>(
      FILE_LIBRARY_RESTORE_PREVIEW_COLLECTION,
      {
        workspace_id: workspaceId,
        project_id: projectId,
        library_id: libraryId,
      },
    );
    const latest = records
      .sort((left, right) => {
        const updated = right.updated_at.localeCompare(left.updated_at);
        return updated !== 0 ? updated : right.created_at.localeCompare(left.created_at);
      });
    return latest[0] ?? null;
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    restorePreviewId: string,
  ): Promise<FileLibraryRestorePreviewRecord | null> {
    const record = await this.docStore.get<FileLibraryRestorePreviewRecord>(
      FILE_LIBRARY_RESTORE_PREVIEW_COLLECTION,
      restorePreviewId,
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

  async updateStatus(input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    restorePreviewId: string;
    status: FileLibraryRestorePreviewStatus;
    activeAfscpOperationId?: string | null;
    restorePlanId?: string | null;
    summary?: FileLibraryRestorePreviewSummary;
    blockers?: FileLibraryRestorePreviewBlocker[];
    stale?: boolean;
  }): Promise<FileLibraryRestorePreviewRecord | null> {
    const existing = await this.getById(
      input.workspaceId,
      input.projectId,
      input.libraryId,
      input.restorePreviewId,
    );
    if (!existing) {
      return null;
    }
    const next: FileLibraryRestorePreviewRecord = {
      ...existing,
      status: input.status,
      ...(input.summary ? { summary: normalizeRestorePreviewSummary(input.summary) } : {}),
      ...(input.blockers ? { blockers: normalizeRestorePreviewBlockers(input.blockers) } : {}),
      ...(input.stale !== undefined ? { stale: input.stale } : {}),
      updated_at: this.nowIso(),
    };
    if (input.activeAfscpOperationId !== undefined) {
      if (input.activeAfscpOperationId) {
        next.afscp_active_operation_id = input.activeAfscpOperationId;
      } else {
        delete next.afscp_active_operation_id;
      }
    }
    if (input.restorePlanId !== undefined) {
      if (input.restorePlanId) {
        next.restore_plan_id = input.restorePlanId;
      } else {
        delete next.restore_plan_id;
      }
    }
    await this.docStore.upsert(FILE_LIBRARY_RESTORE_PREVIEW_COLLECTION, next.id, next);
    return next;
  }

  toPublic(record: FileLibraryRestorePreviewRecord): FileLibraryRestorePreviewPublicRecord {
    return publicRestorePreview(record);
  }
}

export class JsonDocProjectTaskFileTemplateRepo {
  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async create(input: {
    id?: string;
    workspaceId: string;
    projectId: string;
    name: string;
    description?: string;
    sourceLibraryId: string;
    sourceSavePointId?: string;
    createdByUserId: string;
    afscpTemplateId: string;
    afscpCreateOperationId?: string;
    sourceAfscpSavePointId?: string;
  }): Promise<TaskFileTemplateRecord> {
    const now = this.nowIso();
    const id = input.id ?? generateTaskFileTemplateId();
    const record: TaskFileTemplateRecord = {
      id,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      status: 'unpublished',
      source_library_id: input.sourceLibraryId,
      ...(input.sourceSavePointId ? { source_save_point_id: input.sourceSavePointId } : {}),
      created_by_user_id: input.createdByUserId,
      afscp_template_id: input.afscpTemplateId,
      ...(input.afscpCreateOperationId ? { afscp_create_operation_id: input.afscpCreateOperationId } : {}),
      ...(input.sourceAfscpSavePointId ? { source_afscp_save_point_id: input.sourceAfscpSavePointId } : {}),
      created_at: now,
      updated_at: now,
    };
    await this.docStore.upsert(TASK_FILE_TEMPLATE_COLLECTION, record.id, record);
    return record;
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
