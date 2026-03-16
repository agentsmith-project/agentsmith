import { randomUUID } from 'node:crypto';
import { encryptSecretValue, decryptSecretValue } from './secret-crypto.js';
import type {
  FileLibraryBackendRecord,
  FileLibraryMountAccess,
  FileLibraryRecord,
} from './file-library-model.js';

type ProjectScopedState = {
  libraries: FileLibraryRecord[];
  backends: Map<string, FileLibraryBackendSecretRecord>;
  mounts: Map<string, FileLibraryMountAccessSecretRecord>;
};

type FileLibraryBackendSecretRecord = Omit<FileLibraryBackendRecord, 'postgres'> & {
  postgres: FileLibraryBackendRecord['postgres'] & {
    encrypted_metadata_url?: string;
  };
};

type FileLibraryMountAccessSecretRecord = Omit<FileLibraryMountAccess, 'metadata_url'> & {
  encrypted_metadata_url: string;
};

const FILE_LIBRARIES_BY_PROJECT = new Map<string, ProjectScopedState>();

function projectScopedKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

function ensureProjectScopedState(workspaceId: string, projectId: string): ProjectScopedState {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = FILE_LIBRARIES_BY_PROJECT.get(key);
  if (existing) return existing;
  const created: ProjectScopedState = {
    libraries: [],
    backends: new Map(),
    mounts: new Map(),
  };
  FILE_LIBRARIES_BY_PROJECT.set(key, created);
  return created;
}

export function listFileLibraries(workspaceId: string, projectId: string): FileLibraryRecord[] {
  return [...ensureProjectScopedState(workspaceId, projectId).libraries];
}

export function getFileLibrary(
  workspaceId: string,
  projectId: string,
  libraryId: string,
): FileLibraryRecord | null {
  return ensureProjectScopedState(workspaceId, projectId).libraries.find((item) => item.id === libraryId) ?? null;
}

export function createFileLibraryRecord(input: {
  workspaceId: string;
  projectId: string;
  name: string;
  description?: string;
  filesystemName: string;
  createdByUserId: string;
  status?: FileLibraryRecord['status'];
}): FileLibraryRecord {
  const state = ensureProjectScopedState(input.workspaceId, input.projectId);
  const now = new Date().toISOString();
  const record: FileLibraryRecord = {
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
  state.libraries.push(record);
  return record;
}

export function updateFileLibraryRecord(
  workspaceId: string,
  projectId: string,
  libraryId: string,
  patch: Partial<Pick<FileLibraryRecord, 'name' | 'description' | 'status' | 'filesystem_name'>>,
): FileLibraryRecord {
  const record = getFileLibrary(workspaceId, projectId, libraryId);
  if (!record) {
    throw new Error('file_library_not_found');
  }
  if (typeof patch.name === 'string') record.name = patch.name;
  if ('description' in patch) record.description = patch.description;
  if (patch.status) record.status = patch.status;
  if (patch.filesystem_name) record.filesystem_name = patch.filesystem_name;
  record.updated_at = new Date().toISOString();
  return record;
}

export function deleteFileLibraryRecord(workspaceId: string, projectId: string, libraryId: string): void {
  const state = ensureProjectScopedState(workspaceId, projectId);
  state.libraries = state.libraries.filter((item) => item.id !== libraryId);
  state.backends.delete(libraryId);
  state.mounts.delete(libraryId);
}

export function setFileLibraryBackend(
  workspaceId: string,
  projectId: string,
  libraryId: string,
  backend: FileLibraryBackendRecord & { metadata_url?: string },
): void {
  const state = ensureProjectScopedState(workspaceId, projectId);
  const { metadata_url, ...publicBackend } = backend;
  state.backends.set(libraryId, {
    ...publicBackend,
    postgres: {
      ...publicBackend.postgres,
      encrypted_metadata_url: metadata_url ? encryptSecretValue(metadata_url) : undefined,
    },
  });
}

export function getFileLibraryBackend(
  workspaceId: string,
  projectId: string,
  libraryId: string,
): FileLibraryBackendRecord | null {
  const state = ensureProjectScopedState(workspaceId, projectId);
  const backend = state.backends.get(libraryId);
  if (!backend) return null;
  return {
    ...backend,
    postgres: {
      host: backend.postgres.host,
      port: backend.postgres.port,
      database: backend.postgres.database,
      username: backend.postgres.username,
    },
  };
}

export function getFileLibraryBackendInternal(
  workspaceId: string,
  projectId: string,
  libraryId: string,
): (FileLibraryBackendRecord & { metadata_url?: string }) | null {
  const state = ensureProjectScopedState(workspaceId, projectId);
  const backend = state.backends.get(libraryId);
  if (!backend) return null;
  return {
    ...backend,
    postgres: {
      host: backend.postgres.host,
      port: backend.postgres.port,
      database: backend.postgres.database,
      username: backend.postgres.username,
    },
    metadata_url: backend.postgres.encrypted_metadata_url
      ? decryptSecretValue(backend.postgres.encrypted_metadata_url)
      : undefined,
  };
}

export function setFileLibraryMountAccess(
  workspaceId: string,
  projectId: string,
  libraryId: string,
  access: FileLibraryMountAccess,
): void {
  const state = ensureProjectScopedState(workspaceId, projectId);
  state.mounts.set(libraryId, {
    ...access,
    encrypted_metadata_url: encryptSecretValue(access.metadata_url),
  });
}

export function getFileLibraryMountAccess(
  workspaceId: string,
  projectId: string,
  libraryId: string,
): FileLibraryMountAccess | null {
  const state = ensureProjectScopedState(workspaceId, projectId);
  const access = state.mounts.get(libraryId);
  if (!access) return null;
  return {
    filesystem_name: access.filesystem_name,
    metadata_url: decryptSecretValue(access.encrypted_metadata_url),
    recommended_mount_path: access.recommended_mount_path,
    platform_notes: access.platform_notes,
    recommended_mount_commands: access.recommended_mount_commands,
    created_at: access.created_at,
  };
}
