import { randomUUID } from 'node:crypto';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  buildFileLibraryRecord,
  JsonDocProjectFileLibraryCatalogRepo,
  type TaskFileTemplateRecord,
} from './file-library-persistence.js';

export function mapFileLibraryInfraError(error: unknown): {
  statusCode: number;
  errorCode: string;
  message: string;
} {
  if (error instanceof FileLibraryProjectStorageNotReadyError) {
    return {
      statusCode: error.status === 'pending' ? 409 : 503,
      errorCode: error.status === 'pending' ? 'PROJECT_STORAGE_PENDING' : 'PROJECT_STORAGE_BLOCKED',
      message: error.message,
    };
  }
  const rawMessage = error instanceof Error ? error.message : 'file_library_operation_failed';
  const message = safeFileLibraryInfraErrorMessage(rawMessage);
  if (message.startsWith('file_library_env_missing_')) {
    return { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message };
  }
  if (message === 'file_library_backend_unavailable') {
    return { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message };
  }
  if (message === 'file_library_not_empty') {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_NOT_EMPTY', message };
  }
  if (message.endsWith('_pending')) {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_OPERATION_PENDING', message };
  }
  return {
    statusCode: 502,
    errorCode: 'FILE_LIBRARY_OPERATION_FAILED',
    message,
  };
}

export function safeFileLibraryInfraErrorMessage(message: string): string {
  if (
    message === 'file_library_backend_unavailable'
    || message === 'file_library_not_empty'
    || message === 'file_library_template_clone_failed'
    || message === 'file_library_template_clone_pending'
    || message.startsWith('file_library_env_missing_')
  ) {
    return message;
  }
  return 'file_library_operation_failed';
}

export class FileLibraryProjectStorageNotReadyError extends Error {
  readonly status: 'pending' | 'blocked';
  readonly stage: string | null;
  readonly lastErrorCode: string | null;

  constructor(input: {
    status: 'pending' | 'blocked';
    stage: string | null;
    lastErrorCode: string | null;
  }) {
    super(input.status === 'pending' ? 'project_storage_pending' : 'project_storage_blocked');
    this.name = 'FileLibraryProjectStorageNotReadyError';
    this.status = input.status;
    this.stage = input.stage;
    this.lastErrorCode = input.lastErrorCode;
  }
}

export async function createAndProvisionProjectFileLibrary(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  userId: string;
  name: string;
  description?: string;
}) {
  if (!input.deps.fileLibraryStorageAdapter?.enabled) {
    throw new Error('file_library_backend_unavailable');
  }

  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(input.deps.docStore);

  const libraryId = `flib_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const created = buildFileLibraryRecord({
    id: libraryId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    createdByUserId: input.userId,
  });
  await catalogRepo.save(created);

  try {
    const projectStorage = await input.deps.projectStorageBootstrapService.ensureProjectStorageReady({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: input.userId,
    });
    if (projectStorage.status !== 'ready') {
      throw new FileLibraryProjectStorageNotReadyError({
        status: projectStorage.status,
        stage: projectStorage.stage,
        lastErrorCode: projectStorage.lastErrorCode,
      });
    }
    await input.deps.fileLibraryStorageAdapter.createRepoForLibrary({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: created.id,
      namespaceId: projectStorage.namespaceId,
      projectStorageGeneration: projectStorage.generation,
      actorUserId: input.userId,
    });
    const updated = await catalogRepo.update(input.workspaceId, input.projectId, created.id, { status: 'ready' });
    if (!updated) {
      throw new Error('file_library_operation_failed');
    }
    return updated;
  } catch (error) {
    await catalogRepo.update(input.workspaceId, input.projectId, created.id, { status: 'failed' });
    throw error;
  }
}

export async function createAndCloneTaskFileTemplateLibrary(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  userId: string;
  template: TaskFileTemplateRecord;
  name: string;
  description?: string;
  requestId?: string | null;
}) {
  if (!input.deps.fileLibraryStorageAdapter?.enabled) {
    throw new Error('file_library_backend_unavailable');
  }

  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(input.deps.docStore);
  const libraryId = `flib_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const created = buildFileLibraryRecord({
    id: libraryId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    createdByUserId: input.userId,
  });
  await catalogRepo.save(created);

  try {
    const projectStorage = await input.deps.projectStorageBootstrapService.ensureProjectStorageReady({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: input.userId,
    });
    if (projectStorage.status !== 'ready') {
      throw new FileLibraryProjectStorageNotReadyError({
        status: projectStorage.status,
        stage: projectStorage.stage,
        lastErrorCode: projectStorage.lastErrorCode,
      });
    }
    await input.deps.fileLibraryStorageAdapter.cloneTemplateToLibrary({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: created.id,
      namespaceId: projectStorage.namespaceId,
      projectStorageGeneration: projectStorage.generation,
      templateId: input.template.afscp_template_id,
      actorUserId: input.userId,
      requestId: input.requestId ?? undefined,
    });
    const updated = await catalogRepo.update(input.workspaceId, input.projectId, created.id, { status: 'ready' });
    if (!updated) {
      throw new Error('file_library_operation_failed');
    }
    return updated;
  } catch (error) {
    await catalogRepo.update(input.workspaceId, input.projectId, created.id, { status: 'failed' });
    throw error;
  }
}
