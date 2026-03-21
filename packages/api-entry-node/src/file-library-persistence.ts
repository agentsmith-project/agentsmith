import type { JsonDocStorePort } from '@mbos/ports';
import { randomUUID } from 'node:crypto';
import { encryptSecretValue, decryptSecretValue } from './secret-crypto.js';
import type {
  FileLibraryBackendRecord,
  FileLibraryMountAccess,
  FileLibraryRecord,
} from './file-library-model.js';

const FILE_LIBRARY_CATALOG_COLLECTION = 'project_file_libraries';
const FILE_LIBRARY_BACKEND_COLLECTION = 'project_file_library_backends';
const FILE_LIBRARY_MOUNT_ACCESS_COLLECTION = 'project_file_library_mount_access';

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

export function buildFileLibraryRecord(input: {
  workspaceId: string;
  projectId: string;
  name: string;
  description?: string;
  filesystemName: string;
  createdByUserId: string;
  status?: FileLibraryRecord['status'];
  now?: string;
}): FileLibraryRecord {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `flib_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    name: input.name,
    description: input.description,
    status: input.status ?? 'creating',
    filesystem_name: input.filesystemName,
    created_by_user_id: input.createdByUserId,
    created_at: now,
    updated_at: now,
  };
}

export class JsonDocProjectFileLibraryCatalogRepo {
  constructor(private readonly docStore: JsonDocStorePort) {}

  async listByProject(workspaceId: string, projectId: string): Promise<FileLibraryRecord[]> {
    return this.docStore.list<FileLibraryRecord>(FILE_LIBRARY_CATALOG_COLLECTION, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getById(
    workspaceId: string,
    projectId: string,
    libraryId: string,
  ): Promise<FileLibraryRecord | null> {
    const record = await this.docStore.get<FileLibraryRecord>(FILE_LIBRARY_CATALOG_COLLECTION, libraryId);
    if (!record) return null;
    if (record.workspace_id !== workspaceId || record.project_id !== projectId) {
      return null;
    }
    return record;
  }

  async save(record: FileLibraryRecord): Promise<void> {
    await this.docStore.upsert<FileLibraryRecord>(FILE_LIBRARY_CATALOG_COLLECTION, record.id, record);
  }

  async update(
    workspaceId: string,
    projectId: string,
    libraryId: string,
    patch: Partial<Pick<FileLibraryRecord, 'name' | 'description' | 'status' | 'filesystem_name' | 'updated_at'>>,
  ): Promise<FileLibraryRecord | null> {
    const existing = await this.getById(workspaceId, projectId, libraryId);
    if (!existing) {
      return null;
    }
    const updated: FileLibraryRecord = {
      ...existing,
      ...patch,
      updated_at: patch.updated_at ?? new Date().toISOString(),
    };
    await this.save(updated);
    return updated;
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
