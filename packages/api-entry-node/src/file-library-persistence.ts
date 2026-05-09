import type { JsonDocStorePort } from '@mbos/ports';
import { createHash, randomUUID } from 'node:crypto';
import { encryptSecretValue, decryptSecretValue } from './secret-crypto.js';
import type {
  FileLibraryBackendRecord,
  FileLibraryMountAccess,
  FileLibraryRecord,
} from './file-library-model.js';

const FILE_LIBRARY_CATALOG_COLLECTION = 'project_file_libraries';
const FILE_LIBRARY_BACKEND_COLLECTION = 'project_file_library_backends';
const FILE_LIBRARY_MOUNT_ACCESS_COLLECTION = 'project_file_library_mount_access';
const FILE_LIBRARY_HOME_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type FileLibraryLifecycleFenceKind = 'binding_acquire';

type FileLibraryLifecycleFenceFields = {
  lifecycle_fence_token?: string | null;
  lifecycle_fence_kind?: FileLibraryLifecycleFenceKind | null;
  lifecycle_fence_owner_task_id?: string | null;
  lifecycle_fence_correlation_id?: string | null;
  lifecycle_fence_expires_at?: string | null;
};

type FileLibraryStoredRecord = FileLibraryRecord & FileLibraryLifecycleFenceFields;

export type FileLibraryLifecycleFence = {
  token: string;
  version: number;
  library: FileLibraryRecord;
};

type FileLibraryBackendSecretRecord = Omit<FileLibraryBackendRecord, 'postgres'> & {
  postgres: FileLibraryBackendRecord['postgres'] & {
    encrypted_metadata_url?: string;
    encrypted_internal_metadata_url?: string;
  };
};

type FileLibraryMountAccessSecretRecord = Omit<FileLibraryMountAccess, 'metadata_url'> & {
  encrypted_metadata_url: string;
};

export function normalizeFileLibraryMetadataUrl(metadataUrl: string): string {
  try {
    const parsed = new URL(metadataUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return metadataUrl;
    }
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return metadataUrl;
    }
    if (!parsed.searchParams.has('sslmode')) {
      parsed.searchParams.set('sslmode', 'disable');
    }
    return parsed.toString();
  } catch {
    return metadataUrl;
  }
}

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

function deriveLegacyFileLibraryHomeSegment(input: {
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): string {
  const hash = createHash('sha256')
    .update(`${input.workspaceId}/${input.projectId}/${input.libraryId}`)
    .digest('hex')
    .slice(0, 32);
  return assertFileLibraryHomeSegment(`flibhome_${hash}`);
}

export function normalizeFileLibraryRecord(record: FileLibraryRecord): FileLibraryRecord {
  const raw = record as FileLibraryRecord & {
    version?: unknown;
    file_library_home_segment?: unknown;
    source?: unknown;
  } & FileLibraryLifecycleFenceFields;
  const version = typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version > 0
    ? raw.version
    : 1;
  const fileLibraryHomeSegment = typeof raw.file_library_home_segment === 'string' && raw.file_library_home_segment.trim()
    ? assertFileLibraryHomeSegment(raw.file_library_home_segment)
    : deriveLegacyFileLibraryHomeSegment({
        workspaceId: record.workspace_id,
        projectId: record.project_id,
        libraryId: record.id,
      });
  const source = raw.source === 'agent_task_auto' ? 'agent_task_auto' : 'manual';
  const {
    lifecycle_fence_token: _lifecycleFenceToken,
    lifecycle_fence_kind: _lifecycleFenceKind,
    lifecycle_fence_owner_task_id: _lifecycleFenceOwnerTaskId,
    lifecycle_fence_correlation_id: _lifecycleFenceCorrelationId,
    lifecycle_fence_expires_at: _lifecycleFenceExpiresAt,
    ...publicRecord
  } = record as FileLibraryRecord & FileLibraryLifecycleFenceFields;
  return {
    ...publicRecord,
    version,
    file_library_home_segment: fileLibraryHomeSegment,
    source,
  };
}

function normalizeFileLibraryStoredRecord(record: FileLibraryRecord | FileLibraryStoredRecord): FileLibraryStoredRecord {
  const publicRecord = normalizeFileLibraryRecord(record as FileLibraryRecord);
  const raw = record as FileLibraryStoredRecord;
  const token = typeof raw.lifecycle_fence_token === 'string' && raw.lifecycle_fence_token.trim()
    ? raw.lifecycle_fence_token.trim()
    : null;
  return {
    ...publicRecord,
    lifecycle_fence_token: token,
    lifecycle_fence_kind: token && raw.lifecycle_fence_kind === 'binding_acquire' ? 'binding_acquire' : null,
    lifecycle_fence_owner_task_id: token && typeof raw.lifecycle_fence_owner_task_id === 'string'
      ? raw.lifecycle_fence_owner_task_id
      : null,
    lifecycle_fence_correlation_id: token && typeof raw.lifecycle_fence_correlation_id === 'string'
      ? raw.lifecycle_fence_correlation_id
      : null,
    lifecycle_fence_expires_at: token && typeof raw.lifecycle_fence_expires_at === 'string'
      ? raw.lifecycle_fence_expires_at
      : null,
  };
}

function hasStoredRecordDrift(
  record: FileLibraryStoredRecord,
  normalized: FileLibraryStoredRecord,
): boolean {
  return normalized.version !== record.version
    || normalized.file_library_home_segment !== record.file_library_home_segment
    || normalized.source !== record.source
    || normalized.lifecycle_fence_token !== record.lifecycle_fence_token
    || normalized.lifecycle_fence_kind !== record.lifecycle_fence_kind
    || normalized.lifecycle_fence_owner_task_id !== record.lifecycle_fence_owner_task_id
    || normalized.lifecycle_fence_correlation_id !== record.lifecycle_fence_correlation_id
    || normalized.lifecycle_fence_expires_at !== record.lifecycle_fence_expires_at;
}

export function buildFileLibraryRecord(input: {
  id?: string;
  workspaceId: string;
  projectId: string;
  name: string;
  description?: string;
  filesystemName: string;
  createdByUserId: string;
  status?: FileLibraryRecord['status'];
  source?: FileLibraryRecord['source'];
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
    filesystem_name: input.filesystemName,
    file_library_home_segment: input.fileLibraryHomeSegment
      ? assertFileLibraryHomeSegment(input.fileLibraryHomeSegment)
      : generateFileLibraryHomeSegment(),
    source: input.source ?? 'manual',
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
    const normalized = normalizeFileLibraryStoredRecord(record);
    if (normalized.workspace_id !== workspaceId || normalized.project_id !== projectId) {
      return null;
    }
    if (hasStoredRecordDrift(record, normalized)) {
      await this.saveStored(normalized);
    }
    return normalized;
  }

  private async saveStored(record: FileLibraryStoredRecord): Promise<void> {
    await this.docStore.upsert<FileLibraryStoredRecord>(
      FILE_LIBRARY_CATALOG_COLLECTION,
      record.id,
      normalizeFileLibraryStoredRecord(record),
    );
  }

  async listByOwner(ownerUserId: string): Promise<FileLibraryRecord[]> {
    const records = await this.docStore.list<FileLibraryRecord>(FILE_LIBRARY_CATALOG_COLLECTION, {
      created_by_user_id: ownerUserId,
    });
    return records.map(normalizeFileLibraryRecord);
  }

  async listByProject(workspaceId: string, projectId: string): Promise<FileLibraryRecord[]> {
    const records = await this.docStore.list<FileLibraryRecord>(FILE_LIBRARY_CATALOG_COLLECTION, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    return records.map(normalizeFileLibraryRecord);
  }

  async listByProjectForOwner(
    workspaceId: string,
    projectId: string,
    ownerUserId: string,
  ): Promise<FileLibraryRecord[]> {
    const records = await this.docStore.list<FileLibraryRecord>(FILE_LIBRARY_CATALOG_COLLECTION, {
      workspace_id: workspaceId,
      project_id: projectId,
      created_by_user_id: ownerUserId,
    });
    return records.map(normalizeFileLibraryRecord);
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryRecord | null> {
    const record = await this.getStoredById(workspaceId, projectId, libraryId);
    return record ? normalizeFileLibraryRecord(record) : null;
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
    await this.saveStored(normalizeFileLibraryStoredRecord(record));
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
      | 'filesystem_name'
      | 'updated_at'
      | 'version'
      | 'file_library_home_segment'
      | 'source'
      | 'delete_correlation_id'
    >>,
  ): Promise<FileLibraryRecord | null> {
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
    return normalizeFileLibraryRecord(updated);
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
      return { ok: false, code: 'FILE_LIBRARY_DELETING', library: normalizeFileLibraryRecord(existing) };
    }
    if (
      existing.status !== 'ready'
      || existing.version !== input.expectedVersion
      || existing.lifecycle_fence_token !== null
    ) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_READY', library: normalizeFileLibraryRecord(existing) };
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
          library: normalizeFileLibraryRecord(stored),
        },
      };
    }
    const current = result.current ? normalizeFileLibraryStoredRecord(result.current) : null;
    if (!current) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    return {
      ok: false,
      code: current.status === 'deleting' || current.status === 'deleted'
        ? 'FILE_LIBRARY_DELETING'
        : 'FILE_LIBRARY_NOT_READY',
      library: normalizeFileLibraryRecord(current),
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
      return { ok: true, library: normalizeFileLibraryRecord(normalizeFileLibraryStoredRecord(result.doc)) };
    }
    const current = result.current ? normalizeFileLibraryStoredRecord(result.current) : null;
    if (!current) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    return {
      ok: false,
      code: current.status === 'deleting' || current.status === 'deleted'
        ? 'FILE_LIBRARY_DELETING'
        : 'FILE_LIBRARY_NOT_READY',
      library: normalizeFileLibraryRecord(current),
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
      return { ok: true, released: false, library: normalizeFileLibraryRecord(existing) };
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
        library: normalizeFileLibraryRecord(normalizeFileLibraryStoredRecord(result.doc)),
      };
    }
    const current = result.current ? normalizeFileLibraryStoredRecord(result.current) : null;
    if (!current) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    return {
      ok: false,
      code: current.status === 'deleting' || current.status === 'deleted'
        ? 'FILE_LIBRARY_DELETING'
        : 'FILE_LIBRARY_NOT_READY',
      library: normalizeFileLibraryRecord(current),
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
      return { ok: false, code: 'FILE_LIBRARY_DELETING', library: normalizeFileLibraryRecord(existing) };
    }
    if (
      existing.status !== 'ready'
      || existing.version !== input.expectedVersion
      || existing.lifecycle_fence_token !== null
    ) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_READY', library: normalizeFileLibraryRecord(existing) };
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
      return { ok: true, library: normalizeFileLibraryRecord(normalizeFileLibraryStoredRecord(result.doc)) };
    }
    const current = result.current ? normalizeFileLibraryStoredRecord(result.current) : null;
    if (!current) {
      return { ok: false, code: 'FILE_LIBRARY_NOT_FOUND', library: null };
    }
    return {
      ok: false,
      code: current.status === 'deleting' || current.status === 'deleted'
        ? 'FILE_LIBRARY_DELETING'
        : 'FILE_LIBRARY_NOT_READY',
      library: normalizeFileLibraryRecord(current),
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
      return normalizeFileLibraryRecord(normalizeFileLibraryStoredRecord(result.doc));
    }
    return result.current ? normalizeFileLibraryRecord(normalizeFileLibraryStoredRecord(result.current)) : null;
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

export class JsonDocProjectFileLibraryBackendRepo {
  constructor(private readonly docStore: JsonDocStorePort) {}

  async save(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    backend: FileLibraryBackendRecord & { metadata_url?: string; internal_metadata_url?: string },
  ): Promise<void> {
    const normalizedMetadataUrl = backend.metadata_url
      ? normalizeFileLibraryMetadataUrl(backend.metadata_url)
      : undefined;
    const normalizedInternalMetadataUrl = backend.internal_metadata_url
      ? normalizeFileLibraryMetadataUrl(backend.internal_metadata_url)
      : undefined;
    const { metadata_url: _metadataUrl, internal_metadata_url: _internalMetadataUrl, ...publicBackend } = backend;
    const stored: FileLibraryBackendSecretRecord = {
      ...publicBackend,
      postgres: {
        ...publicBackend.postgres,
        encrypted_metadata_url: normalizedMetadataUrl ? encryptSecretValue(normalizedMetadataUrl) : undefined,
        encrypted_internal_metadata_url: normalizedInternalMetadataUrl
          ? encryptSecretValue(normalizedInternalMetadataUrl)
          : undefined,
      },
    };
    await this.docStore.upsert(FILE_LIBRARY_BACKEND_COLLECTION, libraryId, {
      ...stored,
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getPublic(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryBackendRecord | null> {
    const stored = await this.getStored(workspaceId, projectId, libraryId);
    if (!stored) return null;
    return {
      ...stored,
      postgres: {
        host: stored.postgres.host,
        port: stored.postgres.port,
        database: stored.postgres.database,
        username: stored.postgres.username,
      },
    };
  }

  async getInternal(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<(FileLibraryBackendRecord & { metadata_url?: string; internal_metadata_url?: string }) | null> {
    const stored = await this.getStored(workspaceId, projectId, libraryId);
    if (!stored) return null;
    return {
      ...stored,
      postgres: {
        host: stored.postgres.host,
        port: stored.postgres.port,
        database: stored.postgres.database,
        username: stored.postgres.username,
      },
      metadata_url: stored.postgres.encrypted_metadata_url
        ? decryptSecretValue(stored.postgres.encrypted_metadata_url)
        : undefined,
      internal_metadata_url: stored.postgres.encrypted_internal_metadata_url
        ? decryptSecretValue(stored.postgres.encrypted_internal_metadata_url)
        : undefined,
    };
  }

  async delete(workspaceId: string, projectId: string, libraryId: string): Promise<void> {
    const stored = await this.getStored(workspaceId, projectId, libraryId);
    if (!stored) return;
    await this.docStore.delete(FILE_LIBRARY_BACKEND_COLLECTION, libraryId);
  }

  private async getStored(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryBackendSecretRecord | null> {
    const stored = await this.docStore.get<(FileLibraryBackendSecretRecord & { workspace_id: string; project_id: string })>(
      FILE_LIBRARY_BACKEND_COLLECTION,
      libraryId,
    );
    if (!stored) return null;
    if (stored.workspace_id !== workspaceId || stored.project_id !== projectId) {
      return null;
    }
    const { workspace_id: _workspaceId, project_id: _projectId, ...backend } = stored;
    return backend;
  }
}

export class JsonDocProjectFileLibraryMountAccessRepo {
  constructor(private readonly docStore: JsonDocStorePort) {}

  async save(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    access: FileLibraryMountAccess,
  ): Promise<void> {
    const normalizedMetadataUrl = normalizeFileLibraryMetadataUrl(access.metadata_url);
    const { metadata_url: _metadataUrl, ...publicAccess } = access;
    const stored: FileLibraryMountAccessSecretRecord = {
      ...publicAccess,
      encrypted_metadata_url: encryptSecretValue(normalizedMetadataUrl),
    };
    await this.docStore.upsert(FILE_LIBRARY_MOUNT_ACCESS_COLLECTION, libraryId, {
      ...stored,
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryMountAccess | null> {
    const stored = await this.docStore.get<
      FileLibraryMountAccessSecretRecord & { workspace_id: string; project_id: string }
    >(FILE_LIBRARY_MOUNT_ACCESS_COLLECTION, libraryId);
    if (!stored) return null;
    if (stored.workspace_id !== workspaceId || stored.project_id !== projectId) {
      return null;
    }
    return {
      filesystem_name: stored.filesystem_name,
      metadata_url: decryptSecretValue(stored.encrypted_metadata_url),
      storage_bucket_url: stored.storage_bucket_url,
      recommended_mount_path: stored.recommended_mount_path,
      platform_notes: stored.platform_notes,
      recommended_mount_commands: stored.recommended_mount_commands,
      created_at: stored.created_at,
    };
  }

  async delete(workspaceId: string, projectId: string, libraryId: string): Promise<void> {
    const stored = await this.docStore.get<{ workspace_id: string; project_id: string }>(
      FILE_LIBRARY_MOUNT_ACCESS_COLLECTION,
      libraryId,
    );
    if (!stored) return;
    if (stored.workspace_id !== workspaceId || stored.project_id !== projectId) {
      return;
    }
    await this.docStore.delete(FILE_LIBRARY_MOUNT_ACCESS_COLLECTION, libraryId);
  }
}
