import { randomUUID } from 'node:crypto';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  buildFileLibraryRecord,
  JsonDocProjectFileLibraryCatalogRepo,
  type FileLibraryProvisioningState,
  type TaskFileTemplateRecord,
} from './file-library-persistence.js';
import type { FileLibraryRecord } from './file-library-model.js';
import type { ProjectStoragePreflightResult } from './project-storage-bootstrap-service.js';

const FILE_LIBRARY_OPERATION_RETRY_AFTER_MS = 2_000;

export class FileLibraryTemplateClonePendingError extends Error {
  readonly fileLibraryId: string;
  readonly fileLibraryStatus = 'creating';
  readonly operationStatus = 'pending';
  readonly retryAfterMs = FILE_LIBRARY_OPERATION_RETRY_AFTER_MS;

  constructor(input: { fileLibraryId: string }) {
    super('file_library_template_clone_pending');
    this.name = 'FileLibraryTemplateClonePendingError';
    this.fileLibraryId = input.fileLibraryId;
  }
}

export function mapFileLibraryInfraError(error: unknown): {
  statusCode: number;
  errorCode: string;
  message: string;
  context?: Record<string, unknown>;
} {
  if (error instanceof FileLibraryTemplateClonePendingError) {
    return {
      statusCode: 409,
      errorCode: 'FILE_LIBRARY_OPERATION_PENDING',
      message: error.message,
      context: {
        file_library_id: error.fileLibraryId,
        file_library_status: error.fileLibraryStatus,
        operation_status: error.operationStatus,
        retry_after_ms: error.retryAfterMs,
      },
    };
  }
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
  if (message === 'file_library_capability_denied') {
    return { statusCode: 403, errorCode: 'FILE_LIBRARY_CAPABILITY_DENIED', message };
  }
  if (message === 'file_library_template_clone_not_allowed') {
    return { statusCode: 403, errorCode: 'FILE_LIBRARY_TEMPLATE_CLONE_NOT_ALLOWED', message };
  }
  if (message === 'file_library_storage_admin_action_required') {
    return { statusCode: 503, errorCode: 'FILE_LIBRARY_STORAGE_ADMIN_ACTION_REQUIRED', message };
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
  const publicMessages = new Set([
    'file_library_backend_unavailable',
    'file_library_not_empty',
    'file_library_capability_denied',
    'file_library_template_clone_not_allowed',
    'file_library_storage_admin_action_required',
    'file_library_template_clone_failed',
    'file_library_template_clone_pending',
  ]);
  if (publicMessages.has(message)) {
    return message;
  }
  for (const publicMessage of publicMessages) {
    if (message.startsWith(`${publicMessage} `)) {
      return publicMessage;
    }
  }
  if (message.startsWith('file_library_env_missing_')) {
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

type ReadyProjectStoragePreflightResult = Extract<ProjectStoragePreflightResult, { status: 'ready' }>;

async function ensureReadyProjectStorageForFileLibrary(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  userId: string;
  requestId?: string | null;
}): Promise<ReadyProjectStoragePreflightResult> {
  const projectStorage = await input.deps.projectStorageBootstrapService.ensureProjectStorageReady({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorUserId: input.userId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  });
  if (projectStorage.status !== 'ready') {
    throw new FileLibraryProjectStorageNotReadyError({
      status: projectStorage.status,
      stage: projectStorage.stage,
      lastErrorCode: projectStorage.lastErrorCode,
    });
  }
  return projectStorage;
}

async function reconcileTemplateCloneProvisioningState(input: {
  deps: NodeApiDeps;
  catalogRepo: JsonDocProjectFileLibraryCatalogRepo;
  workspaceId: string;
  projectId: string;
  state: FileLibraryProvisioningState;
  requestId?: string | null;
}): Promise<{
  status: 'pending' | 'ready' | 'failed';
  library: FileLibraryRecord;
  lastErrorCode: string | null;
}> {
  if (!input.deps.fileLibraryStorageAdapter?.enabled) {
    return {
      status: 'pending',
      library: input.state.library,
      lastErrorCode: null,
    };
  }
  const result = await input.deps.fileLibraryStorageAdapter.reconcileLibraryProvisioning({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.state.library.id,
    requestId: input.requestId ?? undefined,
  });
  if (result.operationStatus === 'pending') {
    return {
      status: 'pending',
      library: input.state.library,
      lastErrorCode: null,
    };
  }
  const nextStatus = result.operationStatus === 'succeeded' ? 'ready' : 'failed';
  const updated = await input.catalogRepo.completeTemplateCloneProvisioning({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: input.state.library.id,
    status: nextStatus,
    lastErrorCode: result.lastErrorCode,
  });
  return {
    status: nextStatus,
    library: updated ?? input.state.library,
    lastErrorCode: result.lastErrorCode,
  };
}

export async function reconcileProjectFileLibraryProvisioning(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  library: FileLibraryRecord;
  requestId?: string | null;
}): Promise<FileLibraryRecord> {
  if (input.library.status !== 'creating') {
    return input.library;
  }
  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(input.deps.docStore);
  const state = await catalogRepo.getProvisioningState(input.workspaceId, input.projectId, input.library.id);
  if (!state || state.kind !== 'template_clone') {
    return input.library;
  }
  const reconciled = await reconcileTemplateCloneProvisioningState({
    deps: input.deps,
    catalogRepo,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    state,
    requestId: input.requestId,
  });
  return reconciled.library;
}

async function resolveReusableTemplateCloneProvisioning(input: {
  deps: NodeApiDeps;
  catalogRepo: JsonDocProjectFileLibraryCatalogRepo;
  workspaceId: string;
  projectId: string;
  userId: string;
  template: TaskFileTemplateRecord;
  name: string;
  requestId?: string | null;
}): Promise<FileLibraryRecord | null> {
  const state = await input.catalogRepo.findTemplateCloneProvisioning({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    createdByUserId: input.userId,
    templateId: input.template.id,
    requestId: input.requestId,
    name: input.name,
  });
  if (!state) {
    return null;
  }
  const reconciled = await reconcileTemplateCloneProvisioningState({
    deps: input.deps,
    catalogRepo: input.catalogRepo,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    state,
    requestId: input.requestId,
  });
  if (reconciled.status === 'pending') {
    throw new FileLibraryTemplateClonePendingError({ fileLibraryId: state.library.id });
  }
  if (reconciled.status === 'failed') {
    throw new Error(reconciled.lastErrorCode ?? 'file_library_template_clone_failed');
  }
  return reconciled.library;
}

export async function createAndProvisionProjectFileLibrary(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  userId: string;
  name: string;
  description?: string;
  requestId?: string | null;
}) {
  if (!input.deps.fileLibraryStorageAdapter?.enabled) {
    throw new Error('file_library_backend_unavailable');
  }

  const projectStorage = await ensureReadyProjectStorageForFileLibrary(input);
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
    await input.deps.fileLibraryStorageAdapter.createRepoForLibrary({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: created.id,
      namespaceId: projectStorage.namespaceId,
      projectStorageGeneration: projectStorage.generation,
      actorUserId: input.userId,
      ...(input.requestId ? { requestId: input.requestId } : {}),
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
  const reusable = await resolveReusableTemplateCloneProvisioning({
    deps: input.deps,
    catalogRepo,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    userId: input.userId,
    template: input.template,
    name: input.name,
    requestId: input.requestId,
  });
  if (reusable) {
    return reusable;
  }

  const projectStorage = await ensureReadyProjectStorageForFileLibrary(input);
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

  let cloneResult: Awaited<ReturnType<NonNullable<NodeApiDeps['fileLibraryStorageAdapter']>['cloneTemplateToLibrary']>>;
  try {
    cloneResult = await input.deps.fileLibraryStorageAdapter.cloneTemplateToLibrary({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: created.id,
      namespaceId: projectStorage.namespaceId,
      projectStorageGeneration: projectStorage.generation,
      templateId: input.template.afscp_template_id,
      actorUserId: input.userId,
      requestId: input.requestId ?? undefined,
    });
  } catch (error) {
    await catalogRepo.update(input.workspaceId, input.projectId, created.id, { status: 'failed' });
    throw error;
  }
  if (cloneResult.operationStatus === 'pending') {
    if (!cloneResult.operationId) {
      await catalogRepo.update(input.workspaceId, input.projectId, created.id, { status: 'failed' });
      throw new Error('file_library_template_clone_failed');
    }
    await catalogRepo.markTemplateCloneProvisioning({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: created.id,
      operationId: cloneResult.operationId,
      templateId: input.template.id,
      requestId: input.requestId ?? null,
    });
    throw new FileLibraryTemplateClonePendingError({ fileLibraryId: created.id });
  }
  const updated = await catalogRepo.update(input.workspaceId, input.projectId, created.id, { status: 'ready' });
  if (!updated) {
    throw new Error('file_library_operation_failed');
  }
  return updated;
}
