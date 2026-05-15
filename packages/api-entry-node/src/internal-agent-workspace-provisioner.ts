import { createHash } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import {
  JsonDocProjectFileLibraryCatalogRepo,
} from './file-library-persistence.js';
import type {
  AfscpActor,
  AfscpOperationEnvelope,
  AfscpOperationRecord,
  AfscpWorkloadMountBinding,
  AfscpWorkloadMountBindingStatus,
} from './afscp-client.js';
import { AfscpClientError, sanitizeAfscpCorrelationId, sanitizeAfscpOperationId } from './afscp-error-mapper.js';
import { AfscpConfigError } from './afscp-config.js';
import {
  JsonDocProjectFileLibraryAfscpMappingRepo,
  type ProjectFileLibraryAfscpMapping,
} from './file-library-afscp-storage.js';
import { buildTaskHomePaths, buildTaskHomeSegment } from './notebook-task/task-models.js';
import type { ProjectAfscpResourceOwnershipStore } from './project-afscp-namespace-store.js';
import type { ProjectStorageBootstrapServicePort } from './project-storage-bootstrap-service.js';
import type { SandboxWorkspaceBindingBody, SandboxWorkspaceBindingResponse } from './sandbox-manager-client.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

const INTERNAL_AGENT_WORKSPACE_COLLECTION = 'internal_agent_file_library_workspaces';
const DEFAULT_WORKLOAD_MOUNT_LEASE_SECONDS = 3600;
const MAX_LEGACY_MISSING_TOMBSTONE_CREATE_ROTATIONS = 8;

export interface InternalAgentWorkspaceBinding {
  file_library_id: string;
  workspace_id: string;
  project_id: string;
  provider: 'afscp';
  task_home_binding_id: string;
  afscp_mount_binding_id?: string;
  afscp_namespace_id?: string;
  afscp_repo_id?: string;
  afscp_volume_id?: string;
  mount_binding_generation?: number;
  previous_afscp_mount_binding_id?: string;
  project_storage_generation?: number;
  status: string;
  mount_binding_status?: AfscpWorkloadMountBindingStatus;
  lease_expires_at?: string | null;
  release_operation_id?: string | null;
  release_requested_at?: string | null;
  drain_started_at?: string | null;
  drain_completed_at?: string | null;
  task_home_path: string;
  workspace_path: string;
  artifacts_path: string;
  library_root_path: '.';
  created_at: string;
  updated_at: string;
}

export interface InternalAgentWorkspaceMount {
  bindingId: string;
  mountPath: string;
  taskHomePath: string;
  workspacePath: string;
  artifactsPath: string;
  libraryRootPath: '.';
  readOnly?: boolean;
}

export interface InternalAgentWorkspaceProvisioner {
  ensureWorkspaceBinding(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    taskId: string;
    taskHomeSegment?: string;
    actorUserId?: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<{
    workspaceMount: InternalAgentWorkspaceMount;
    binding: InternalAgentWorkspaceBinding;
  }>;
  deleteWorkspaceBinding(input: {
    workspaceId: string;
    fileLibraryId: string;
  }): Promise<void>;
  findWorkspaceBinding?(input: {
    workspaceId: string;
    fileLibraryId: string;
  }): Promise<InternalAgentWorkspaceBinding | null>;
}

export type InternalAgentWorkspaceBindingManager = InternalAgentWorkspaceProvisioner;

interface InternalAgentWorkspaceK8sClient {
  ensureWorkspaceBinding(
    workspaceId: string,
    projectId: string,
    bindingId: string,
    body: SandboxWorkspaceBindingBody,
  ): Promise<SandboxWorkspaceBindingResponse>;
  deleteWorkspaceBinding(workspaceId: string, projectId: string, bindingId: string): Promise<void>;
}

interface InternalAgentWorkspaceAfscpClient {
  createWorkloadMountBinding(input: {
    namespaceId: string;
    repoId: string;
    mountPath: string;
    readOnly: boolean;
    leaseSeconds: number;
    correlationId: string;
    idempotencyKey: string;
    actor: AfscpActor;
    signal?: AbortSignal;
  }): Promise<AfscpOperationEnvelope>;
  getWorkloadMountBinding(input: {
    namespaceId: string;
    mountBindingId: string;
    correlationId: string;
    signal?: AbortSignal;
  }): Promise<AfscpWorkloadMountBinding>;
  revokeWorkloadMountBinding(input: {
    namespaceId: string;
    mountBindingId: string;
    correlationId: string;
    idempotencyKey: string;
    actor: AfscpActor;
    signal?: AbortSignal;
  }): Promise<AfscpOperationEnvelope>;
  pollOperation?(input: {
    operationId: string;
    correlationId: string;
    signal?: AbortSignal;
    intervalMs?: number;
    timeoutMs?: number;
  }): Promise<AfscpOperationRecord>;
}

interface InternalAgentWorkspaceProvisionerOptions {
  afscpProductClient?: InternalAgentWorkspaceAfscpClient;
  projectStorageBootstrapService?: ProjectStorageBootstrapServicePort;
  mappingRepo?: JsonDocProjectFileLibraryAfscpMappingRepo;
  resourceOwnershipStore?: ProjectAfscpResourceOwnershipStore;
  workloadMountLeaseSeconds?: number;
}

interface EnsuredAfscpMountBinding {
  mountBinding: AfscpWorkloadMountBinding;
  mountBindingGeneration: number;
  previousMountBindingId?: string;
}

export type InternalAgentWorkspaceProvisioningErrorCode =
  | 'AGENT_WORKSPACE_AFSCP_CONFIG_ERROR'
  | 'AGENT_WORKSPACE_AFSCP_PROJECT_STORAGE_NOT_READY'
  | 'AGENT_WORKSPACE_AFSCP_MAPPING_NOT_READY'
  | 'AGENT_WORKSPACE_AFSCP_GENERATION_MISMATCH'
  | 'AGENT_WORKSPACE_AFSCP_UNAVAILABLE'
  | 'AGENT_WORKSPACE_AFSCP_PERMISSION_DENIED'
  | 'AGENT_WORKSPACE_AFSCP_ERROR';

export class InternalAgentWorkspaceProvisioningError extends Error {
  readonly code: InternalAgentWorkspaceProvisioningErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly metadata?: Record<string, unknown>;

  constructor(input: {
    code: InternalAgentWorkspaceProvisioningErrorCode;
    statusCode: number;
    retryable: boolean;
    metadata?: Record<string, unknown>;
  }) {
    super(input.code);
    this.name = 'InternalAgentWorkspaceProvisioningError';
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.retryable = input.retryable;
    this.metadata = input.metadata;
  }
}

function bindingsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(INTERNAL_AGENT_WORKSPACE_COLLECTION, workspaceId);
}

function stableDigest(input: string): string {
  return createHash('sha256').update(input).digest('base64url').slice(0, 48);
}

function buildCorrelationId(input: {
  requestId?: string;
  workspaceId: string;
  projectId: string;
  fileLibraryId: string;
  taskId: string;
}): string {
  return sanitizeAfscpCorrelationId(input.requestId)
    ?? `workspace-mount-${stableDigest(`${input.workspaceId}:${input.projectId}:${input.fileLibraryId}:${input.taskId}`)}`;
}

function buildIdempotencyKey(input: {
  workspaceId: string;
  projectId: string;
  fileLibraryId: string;
  taskHomePath: string;
  operation: 'create' | 'revoke';
  mountBindingGeneration?: number;
}): string {
  const stableInput = `${input.workspaceId}:${input.projectId}:${input.fileLibraryId}:${input.taskHomePath}`;
  if (input.operation === 'create') {
    const generation = normalizeMountBindingGeneration(input.mountBindingGeneration, 1);
    return `workspace-mount-create:g${generation}:${stableDigest(`${stableInput}:mount-binding-generation:${generation}`)}`;
  }
  return `workspace-mount-revoke:${stableDigest(stableInput)}`;
}

function buildActor(actorUserId: string | undefined): AfscpActor {
  const trimmed = actorUserId?.trim();
  if (trimmed) {
    return { type: 'user', id: trimmed };
  }
  return { type: 'system', id: 'agentsmith-managed-runner' };
}

function isSuccessOperationState(value: unknown): boolean {
  return typeof value === 'string' && ['succeeded', 'success', 'completed', 'ready'].includes(value.trim().toLowerCase());
}

function isFailedOperationState(value: unknown): boolean {
  return typeof value === 'string' && ['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled'].includes(value.trim().toLowerCase());
}

function isUsableMountBindingStatus(value: AfscpWorkloadMountBindingStatus): boolean {
  return value === 'issued' || value === 'active';
}

function isRotatableMountBindingStatus(value: AfscpWorkloadMountBindingStatus): boolean {
  return value === 'released' || value === 'revoked';
}

function mountBindingStatusRetryable(value: AfscpWorkloadMountBindingStatus): boolean {
  return value === 'pending' || value === 'releasing';
}

function isLocalWorkspaceBindingReleasing(binding: InternalAgentWorkspaceBinding): boolean {
  if (isTerminalWorkspaceBindingStatus(binding.mount_binding_status)) {
    return false;
  }
  const status = binding.status.trim().toLowerCase();
  return status === 'releasing' || status === 'release_pending';
}

function isTerminalWorkspaceBindingStatus(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const status = value.trim().toLowerCase();
  return status === 'released' || status === 'revoked' || status === 'expired' || status === 'deleted';
}

function isLocalWorkspaceBindingStatusTerminal(binding: InternalAgentWorkspaceBinding): boolean {
  return isTerminalWorkspaceBindingStatus(binding.status);
}

function isLocalMountBindingStatusTerminal(binding: InternalAgentWorkspaceBinding): boolean {
  return isTerminalWorkspaceBindingStatus(binding.mount_binding_status);
}

function isLocalWorkspaceBindingTerminal(binding: InternalAgentWorkspaceBinding): boolean {
  return isLocalWorkspaceBindingStatusTerminal(binding) || isLocalMountBindingStatusTerminal(binding);
}

function isLegacyMissingTombstoneCreateReplay(input: {
  existing: InternalAgentWorkspaceBinding | null | undefined;
  mountBinding: AfscpWorkloadMountBinding;
}): boolean {
  return !input.existing && isRotatableMountBindingStatus(input.mountBinding.status);
}

function isAfscpResourceNotFoundError(error: unknown): boolean {
  return error instanceof AfscpClientError
    && (
      error.status === 404
      || error.code === 'afscp_resource_not_found'
      || error.code === 'not_found'
    );
}

function normalizeMountBindingGeneration(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function currentMountBindingGeneration(existing: InternalAgentWorkspaceBinding | null | undefined): number {
  const hasExistingBinding = Boolean(
    existing?.afscp_mount_binding_id?.trim()
    || existing?.task_home_binding_id?.trim(),
  );
  return normalizeMountBindingGeneration(existing?.mount_binding_generation, hasExistingBinding ? 1 : 0);
}

function nextMountBindingGeneration(existing: InternalAgentWorkspaceBinding | null | undefined): number {
  return Math.max(1, currentMountBindingGeneration(existing) + 1);
}

function releasedWorkspaceBindingTombstone(input: {
  binding: InternalAgentWorkspaceBinding;
  releaseOperationId: string | null;
  completedAt: string;
}): InternalAgentWorkspaceBinding {
  return {
    ...input.binding,
    status: 'released',
    mount_binding_status: 'released',
    release_operation_id: input.releaseOperationId,
    drain_completed_at: input.completedAt,
    updated_at: input.completedAt,
  };
}

function throwUnusableMountBinding(input: {
  status: AfscpWorkloadMountBindingStatus;
  mountBindingId?: string;
  reason?: string;
}): never {
  throwProvisioningError({
    code: 'AGENT_WORKSPACE_AFSCP_ERROR',
    statusCode: 409,
    retryable: mountBindingStatusRetryable(input.status),
    metadata: {
      reason: input.reason ?? 'mount_binding_status_unusable',
      mount_binding_id: input.mountBindingId,
      mount_binding_status: input.status,
    },
  });
}

function readOperationMountBindingId(operation: AfscpOperationEnvelope | AfscpOperationRecord): string | null {
  const resource = (operation as { resource?: unknown }).resource;
  const resourceId = typeof resource === 'object' && resource !== null && !Array.isArray(resource)
    && (resource as { type?: unknown }).type === 'workload_mount_binding'
    && typeof (resource as { id?: unknown }).id === 'string'
    ? (resource as { id: string }).id
    : '';
  if (resourceId.startsWith('wmb_')) {
    return resourceId;
  }
  const mountBindingId = (operation as { mount_binding_id?: unknown }).mount_binding_id;
  if (typeof mountBindingId === 'string' && mountBindingId.startsWith('wmb_')) {
    return mountBindingId;
  }
  const result = operation.result;
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    const binding = (result as { mount_binding?: unknown }).mount_binding;
    if (typeof binding === 'object' && binding !== null && !Array.isArray(binding)) {
      const id = (binding as { mount_binding_id?: unknown }).mount_binding_id;
      if (typeof id === 'string' && id.startsWith('wmb_')) {
        return id;
      }
    }
  }
  return null;
}

function mapAfscpProvisioningError(error: unknown): InternalAgentWorkspaceProvisioningError {
  if (error instanceof InternalAgentWorkspaceProvisioningError) {
    return error;
  }
  if (error instanceof AfscpConfigError) {
    return new InternalAgentWorkspaceProvisioningError({
      code: 'AGENT_WORKSPACE_AFSCP_CONFIG_ERROR',
      statusCode: 500,
      retryable: false,
      metadata: { afscp_config_error: error.toJSON() },
    });
  }
  if (error instanceof AfscpClientError) {
    if (error.code === 'unavailable') {
      return new InternalAgentWorkspaceProvisioningError({
        code: 'AGENT_WORKSPACE_AFSCP_UNAVAILABLE',
        statusCode: 503,
        retryable: error.retryable,
        metadata: { afscp_error: error.toJSON() },
      });
    }
    if (
      error.code === 'afscp_service_permission_denied'
      || error.code === 'afscp_capability_denied'
    ) {
      return new InternalAgentWorkspaceProvisioningError({
        code: 'AGENT_WORKSPACE_AFSCP_PERMISSION_DENIED',
        statusCode: 403,
        retryable: false,
        metadata: { afscp_error: error.toJSON() },
      });
    }
    if (error.code === 'afscp_service_configuration_error') {
      return new InternalAgentWorkspaceProvisioningError({
        code: 'AGENT_WORKSPACE_AFSCP_CONFIG_ERROR',
        statusCode: 500,
        retryable: false,
        metadata: { afscp_error: error.toJSON() },
      });
    }
    return new InternalAgentWorkspaceProvisioningError({
      code: 'AGENT_WORKSPACE_AFSCP_ERROR',
      statusCode: error.status,
      retryable: error.retryable,
      metadata: { afscp_error: error.toJSON() },
    });
  }
  return new InternalAgentWorkspaceProvisioningError({
    code: 'AGENT_WORKSPACE_AFSCP_ERROR',
    statusCode: 500,
    retryable: false,
  });
}

function throwProvisioningError(input: {
  code: InternalAgentWorkspaceProvisioningErrorCode;
  statusCode: number;
  retryable: boolean;
  metadata?: Record<string, unknown>;
}): never {
  throw new InternalAgentWorkspaceProvisioningError(input);
}

function requireConfiguredOptions(options: InternalAgentWorkspaceProvisionerOptions | undefined): Required<Pick<
  InternalAgentWorkspaceProvisionerOptions,
  'afscpProductClient' | 'projectStorageBootstrapService' | 'mappingRepo'
>> & Pick<InternalAgentWorkspaceProvisionerOptions, 'resourceOwnershipStore' | 'workloadMountLeaseSeconds'> {
  if (!options?.afscpProductClient || !options.projectStorageBootstrapService || !options.mappingRepo) {
    throwProvisioningError({
      code: 'AGENT_WORKSPACE_AFSCP_CONFIG_ERROR',
      statusCode: 500,
      retryable: false,
    });
  }
  return {
    afscpProductClient: options.afscpProductClient,
    projectStorageBootstrapService: options.projectStorageBootstrapService,
    mappingRepo: options.mappingRepo,
    resourceOwnershipStore: options.resourceOwnershipStore,
    workloadMountLeaseSeconds: options.workloadMountLeaseSeconds,
  };
}

export class InternalAgentWorkspaceProvisionerImpl implements InternalAgentWorkspaceProvisioner {
  private readonly catalogRepo: JsonDocProjectFileLibraryCatalogRepo;

  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly k8sClient: InternalAgentWorkspaceK8sClient,
    private readonly options?: InternalAgentWorkspaceProvisionerOptions,
  ) {
    this.catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
  }

  async ensureWorkspaceBinding(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    taskId: string;
    taskHomeSegment?: string;
    actorUserId?: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<{
    workspaceMount: InternalAgentWorkspaceMount;
    binding: InternalAgentWorkspaceBinding;
  }> {
    const options = requireConfiguredOptions(this.options);
    const library = await this.catalogRepo.getById(input.workspaceId, input.projectId, input.fileLibraryId);
    if (!library) {
      throw Object.assign(new Error('file_library_not_found'), { code: 'FILE_LIBRARY_NOT_FOUND' });
    }
    if (library.status !== 'ready') {
      throwProvisioningError({
        code: 'AGENT_WORKSPACE_AFSCP_MAPPING_NOT_READY',
        statusCode: 409,
        retryable: false,
        metadata: {
          file_library_id: input.fileLibraryId,
          file_library_status: library.status,
        },
      });
    }

    const collection = bindingsCollection(input.workspaceId);
    const existing = await this.docStore.get<InternalAgentWorkspaceBinding>(collection, input.fileLibraryId);
    if (existing && isLocalWorkspaceBindingReleasing(existing)) {
      throwProvisioningError({
        code: 'AGENT_WORKSPACE_AFSCP_ERROR',
        statusCode: 409,
        retryable: true,
        metadata: {
          reason: 'workspace_binding_releasing',
          workspace_binding_status: existing.status,
        },
      });
    }
    const now = new Date().toISOString();
    const taskHomeSegment = input.taskHomeSegment?.trim() || buildTaskHomeSegment({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
    });
    const taskHomePaths = buildTaskHomePaths(taskHomeSegment);
    const binding: InternalAgentWorkspaceBinding = existing ?? {
      file_library_id: input.fileLibraryId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      provider: 'afscp',
      task_home_binding_id: '',
      status: 'pending',
      task_home_path: taskHomePaths.taskHomePath,
      workspace_path: taskHomePaths.workspacePath,
      artifacts_path: taskHomePaths.artifactsPath,
      library_root_path: taskHomePaths.libraryRootPath,
      created_at: now,
      updated_at: now,
    };
    binding.updated_at = now;
    binding.provider = 'afscp';
    binding.task_home_path = taskHomePaths.taskHomePath;
    binding.workspace_path = taskHomePaths.workspacePath;
    binding.artifacts_path = taskHomePaths.artifactsPath;
    binding.library_root_path = taskHomePaths.libraryRootPath;

    const correlationId = buildCorrelationId(input);
    const preflight = await options.projectStorageBootstrapService.ensureProjectStorageReady({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: input.actorUserId ?? 'agentsmith-managed-runner',
      requestId: input.requestId,
      signal: input.signal,
    }).catch((error: unknown) => {
      throw mapAfscpProvisioningError(error);
    });
    if (preflight.status !== 'ready') {
      throwProvisioningError({
        code: 'AGENT_WORKSPACE_AFSCP_PROJECT_STORAGE_NOT_READY',
        statusCode: 409,
        retryable: preflight.status === 'pending' ? preflight.retryable : false,
        metadata: {
          stage: preflight.stage,
          generation: preflight.generation,
          next_action: preflight.nextAction,
          last_error_code: preflight.lastErrorCode,
        },
      });
    }

    const mapping = await this.requireActiveMapping({
      mappingRepo: options.mappingRepo,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      fileLibraryId: input.fileLibraryId,
      namespaceId: preflight.namespaceId,
      projectStorageGeneration: preflight.generation,
    });
    const ensuredMountBinding = await this.ensureAfscpMountBinding({
      client: options.afscpProductClient,
      resourceOwnershipStore: options.resourceOwnershipStore,
      existing,
      mapping,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      fileLibraryId: input.fileLibraryId,
      taskHomePath: taskHomePaths.taskHomePath,
      actor: buildActor(input.actorUserId),
      correlationId,
      signal: input.signal,
      leaseSeconds: options.workloadMountLeaseSeconds ?? DEFAULT_WORKLOAD_MOUNT_LEASE_SECONDS,
    });
    const mountBinding = ensuredMountBinding.mountBinding;

    binding.task_home_binding_id = mountBinding.mount_binding_id;
    binding.afscp_mount_binding_id = mountBinding.mount_binding_id;
    binding.afscp_namespace_id = mountBinding.namespace_id;
    binding.afscp_repo_id = mountBinding.repo_id;
    binding.afscp_volume_id = mountBinding.volume_id;
    binding.mount_binding_generation = ensuredMountBinding.mountBindingGeneration;
    if (ensuredMountBinding.previousMountBindingId) {
      binding.previous_afscp_mount_binding_id = ensuredMountBinding.previousMountBindingId;
    }
    binding.project_storage_generation = mapping.project_storage_generation;
    binding.mount_binding_status = mountBinding.status;
    binding.lease_expires_at = mountBinding.lease_expires_at;
    await this.docStore.upsert(collection, input.fileLibraryId, binding);
    const remoteBinding = await this.k8sClient.ensureWorkspaceBinding(input.workspaceId, input.projectId, mountBinding.mount_binding_id, {
      namespace_id: mapping.namespace_id,
      mount_binding_id: mountBinding.mount_binding_id,
    });
    binding.status = remoteBinding.status || binding.status;
    await this.docStore.upsert(collection, input.fileLibraryId, binding);

    return {
      workspaceMount: {
        bindingId: mountBinding.mount_binding_id,
        mountPath: taskHomePaths.taskHomePath,
        taskHomePath: taskHomePaths.taskHomePath,
        workspacePath: taskHomePaths.workspacePath,
        artifactsPath: taskHomePaths.artifactsPath,
        libraryRootPath: taskHomePaths.libraryRootPath,
      },
      binding,
    };
  }

  async deleteWorkspaceBinding(input: {
    workspaceId: string;
    fileLibraryId: string;
  }): Promise<void> {
    const collection = bindingsCollection(input.workspaceId);
    const existing = await this.docStore.get<InternalAgentWorkspaceBinding>(collection, input.fileLibraryId);
    if (!existing) return;
    if (isLocalWorkspaceBindingTerminal(existing)) return;
    const mountBindingId = existing.afscp_mount_binding_id?.trim() || existing.task_home_binding_id.trim() || input.fileLibraryId;
    const now = new Date().toISOString();
    const releasing: InternalAgentWorkspaceBinding = {
      ...existing,
      status: 'releasing',
      mount_binding_status: 'releasing',
      release_requested_at: now,
      drain_started_at: existing.drain_started_at ?? now,
      updated_at: now,
    };
    await this.docStore.upsert(collection, input.fileLibraryId, releasing);
    await this.k8sClient.deleteWorkspaceBinding(input.workspaceId, existing.project_id, mountBindingId);
    const options = this.options;
    if (options?.afscpProductClient && existing.afscp_namespace_id && mountBindingId.startsWith('wmb_')) {
      const correlationId = buildCorrelationId({
        workspaceId: input.workspaceId,
        projectId: existing.project_id,
        fileLibraryId: input.fileLibraryId,
        taskId: mountBindingId,
      });
      let revokeOperation: AfscpOperationEnvelope | AfscpOperationRecord;
      try {
        revokeOperation = await options.afscpProductClient.revokeWorkloadMountBinding({
          namespaceId: existing.afscp_namespace_id,
          mountBindingId,
          correlationId,
          idempotencyKey: buildIdempotencyKey({
            workspaceId: input.workspaceId,
            projectId: existing.project_id,
            fileLibraryId: input.fileLibraryId,
            taskHomePath: existing.task_home_path,
            operation: 'revoke',
          }),
          actor: { type: 'system', id: 'agentsmith-managed-runner' },
        });
        const operationId = typeof revokeOperation.operation_id === 'string'
          ? sanitizeAfscpOperationId(revokeOperation.operation_id)
          : undefined;
        if (operationId && !isSuccessOperationState(revokeOperation.operation_state) && options.afscpProductClient.pollOperation) {
          revokeOperation = await options.afscpProductClient.pollOperation({
            operationId,
            correlationId,
            intervalMs: 250,
            timeoutMs: 30_000,
          });
        }
      } catch (error) {
        if (isAfscpResourceNotFoundError(error)) {
          const completedAt = new Date().toISOString();
          await this.docStore.upsert(collection, input.fileLibraryId, releasedWorkspaceBindingTombstone({
            binding: releasing,
            releaseOperationId: null,
            completedAt,
          }));
          return;
        }
        throw mapAfscpProvisioningError(error);
      }
      const releaseOperationId = typeof revokeOperation.operation_id === 'string'
        ? sanitizeAfscpOperationId(revokeOperation.operation_id) ?? null
        : null;
      if (isFailedOperationState(revokeOperation.operation_state)) {
        await this.docStore.upsert(collection, input.fileLibraryId, {
          ...releasing,
          status: 'failed',
          mount_binding_status: 'failed',
          release_operation_id: releaseOperationId,
          updated_at: new Date().toISOString(),
        });
        throwProvisioningError({
          code: 'AGENT_WORKSPACE_AFSCP_ERROR',
          statusCode: 502,
          retryable: false,
          metadata: {
            operation_id: releaseOperationId ?? undefined,
            operation_state: typeof revokeOperation.operation_state === 'string'
              ? revokeOperation.operation_state
              : 'unknown',
          },
        });
      }
      if (!isSuccessOperationState(revokeOperation.operation_state)) {
        await this.docStore.upsert(collection, input.fileLibraryId, {
          ...releasing,
          release_operation_id: releaseOperationId,
          updated_at: new Date().toISOString(),
        });
        return;
      }
      const completedAt = new Date().toISOString();
      await this.docStore.upsert(collection, input.fileLibraryId, releasedWorkspaceBindingTombstone({
        binding: releasing,
        releaseOperationId,
        completedAt,
      }));
      return;
    }
    await this.docStore.delete(collection, input.fileLibraryId);
  }

  async findWorkspaceBinding(input: {
    workspaceId: string;
    fileLibraryId: string;
  }): Promise<InternalAgentWorkspaceBinding | null> {
    const binding = await this.docStore.get<InternalAgentWorkspaceBinding>(
      bindingsCollection(input.workspaceId),
      input.fileLibraryId,
    );
    if (!binding || binding.workspace_id !== input.workspaceId || binding.file_library_id !== input.fileLibraryId) {
      return null;
    }
    return binding;
  }

  private async requireActiveMapping(input: {
    mappingRepo: JsonDocProjectFileLibraryAfscpMappingRepo;
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    namespaceId: string;
    projectStorageGeneration: number;
  }): Promise<ProjectFileLibraryAfscpMapping> {
    const mapping = await input.mappingRepo.getByLibraryId(input.workspaceId, input.projectId, input.fileLibraryId);
    if (!mapping || mapping.operation_status !== 'succeeded') {
      throwProvisioningError({
        code: 'AGENT_WORKSPACE_AFSCP_MAPPING_NOT_READY',
        statusCode: 409,
        retryable: false,
        metadata: {
          file_library_id: input.fileLibraryId,
          mapping_status: mapping?.operation_status ?? 'missing',
        },
      });
    }
    if (mapping.namespace_id !== input.namespaceId || mapping.project_storage_generation !== input.projectStorageGeneration) {
      throwProvisioningError({
        code: 'AGENT_WORKSPACE_AFSCP_GENERATION_MISMATCH',
        statusCode: 409,
        retryable: false,
        metadata: {
          file_library_id: input.fileLibraryId,
          namespace_id: input.namespaceId,
          mapping_namespace_id: mapping.namespace_id,
          project_storage_generation: input.projectStorageGeneration,
          mapping_project_storage_generation: mapping.project_storage_generation,
        },
      });
    }
    return mapping;
  }

  private async ensureAfscpMountBinding(input: {
    client: InternalAgentWorkspaceAfscpClient;
    resourceOwnershipStore?: ProjectAfscpResourceOwnershipStore;
    existing: InternalAgentWorkspaceBinding | null | undefined;
    mapping: ProjectFileLibraryAfscpMapping;
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    taskHomePath: string;
    actor: AfscpActor;
    correlationId: string;
    signal?: AbortSignal;
    leaseSeconds: number;
  }): Promise<EnsuredAfscpMountBinding> {
    const existingMountBindingId = input.existing?.afscp_mount_binding_id?.trim();
    let mountBindingGeneration = nextMountBindingGeneration(input.existing);
    let previousMountBindingId: string | undefined;
    if (
      existingMountBindingId
      && input.existing?.afscp_namespace_id === input.mapping.namespace_id
      && input.existing?.afscp_repo_id === input.mapping.repo_id
      && input.existing?.project_storage_generation === input.mapping.project_storage_generation
      && input.existing?.task_home_path === input.taskHomePath
    ) {
      try {
        const existingBinding = await input.client.getWorkloadMountBinding({
          namespaceId: input.mapping.namespace_id,
          mountBindingId: existingMountBindingId,
          correlationId: input.correlationId,
          signal: input.signal,
        });
        if (existingBinding.mount_path !== input.taskHomePath) {
          throwUnusableMountBinding({
            status: existingBinding.status,
            mountBindingId: existingBinding.mount_binding_id,
            reason: 'mount_binding_target_mismatch',
          });
        }
        if (isUsableMountBindingStatus(existingBinding.status)) {
          return {
            mountBinding: existingBinding,
            mountBindingGeneration: Math.max(1, currentMountBindingGeneration(input.existing)),
          };
        }
        if (!isRotatableMountBindingStatus(existingBinding.status)) {
          throwUnusableMountBinding({
            status: existingBinding.status,
            mountBindingId: existingBinding.mount_binding_id,
          });
        }
        previousMountBindingId = existingBinding.mount_binding_id;
        mountBindingGeneration = nextMountBindingGeneration(input.existing);
      } catch (error) {
        if (isAfscpResourceNotFoundError(error) && isLocalWorkspaceBindingTerminal(input.existing)) {
          previousMountBindingId = existingMountBindingId;
          mountBindingGeneration = nextMountBindingGeneration(input.existing);
        } else {
          throw mapAfscpProvisioningError(error);
        }
      }
    }

    let legacyMissingTombstoneRotations = 0;
    while (true) {
      let operation: AfscpOperationEnvelope | AfscpOperationRecord;
      try {
        operation = await input.client.createWorkloadMountBinding({
          namespaceId: input.mapping.namespace_id,
          repoId: input.mapping.repo_id,
          mountPath: input.taskHomePath,
          readOnly: false,
          leaseSeconds: input.leaseSeconds,
          correlationId: input.correlationId,
          idempotencyKey: buildIdempotencyKey({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            fileLibraryId: input.fileLibraryId,
            taskHomePath: input.taskHomePath,
            operation: 'create',
            mountBindingGeneration,
          }),
          actor: input.actor,
          signal: input.signal,
        });
        const operationId = sanitizeAfscpOperationId(operation.operation_id);
        if (operationId && !isSuccessOperationState(operation.operation_state) && input.client.pollOperation) {
          operation = await input.client.pollOperation({
            operationId,
            correlationId: input.correlationId,
            signal: input.signal,
            intervalMs: 250,
            timeoutMs: 30_000,
          });
        }
      } catch (error) {
        throw mapAfscpProvisioningError(error);
      }

      if (isFailedOperationState(operation.operation_state)) {
        throwProvisioningError({
          code: 'AGENT_WORKSPACE_AFSCP_ERROR',
          statusCode: 502,
          retryable: false,
          metadata: {
            operation_id: typeof operation.operation_id === 'string'
              ? sanitizeAfscpOperationId(operation.operation_id)
              : undefined,
            operation_state: typeof operation.operation_state === 'string' ? operation.operation_state : 'unknown',
          },
        });
      }
      const mountBindingId = readOperationMountBindingId(operation);
      if (!mountBindingId) {
        throwProvisioningError({
          code: 'AGENT_WORKSPACE_AFSCP_ERROR',
          statusCode: 502,
          retryable: false,
          metadata: {
            operation_id: typeof operation.operation_id === 'string'
              ? sanitizeAfscpOperationId(operation.operation_id)
              : undefined,
            reason: 'mount_binding_id_missing',
          },
        });
      }
      await input.resourceOwnershipStore?.ensureResourceOwnership({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        resourceKind: 'workload_mount_binding',
        resourceId: mountBindingId,
        namespaceId: input.mapping.namespace_id,
      });
      try {
        const mountBinding = await input.client.getWorkloadMountBinding({
          namespaceId: input.mapping.namespace_id,
          mountBindingId,
          correlationId: input.correlationId,
          signal: input.signal,
        });
        if (mountBinding.mount_path !== input.taskHomePath) {
          throwUnusableMountBinding({
            status: mountBinding.status,
            mountBindingId: mountBinding.mount_binding_id,
            reason: 'mount_binding_target_mismatch',
          });
        }
        if (isUsableMountBindingStatus(mountBinding.status)) {
          return {
            mountBinding,
            mountBindingGeneration,
            ...(previousMountBindingId ? { previousMountBindingId } : {}),
          };
        }
        if (
          isLegacyMissingTombstoneCreateReplay({ existing: input.existing, mountBinding })
          && legacyMissingTombstoneRotations < MAX_LEGACY_MISSING_TOMBSTONE_CREATE_ROTATIONS
        ) {
          previousMountBindingId = mountBinding.mount_binding_id;
          mountBindingGeneration += 1;
          legacyMissingTombstoneRotations += 1;
          continue;
        }
        throwUnusableMountBinding({
          status: mountBinding.status,
          mountBindingId: mountBinding.mount_binding_id,
        });
      } catch (error) {
        throw mapAfscpProvisioningError(error);
      }
    }
  }
}
