import type {
  AfscpBootstrapClientPort,
  AfscpActor,
  AfscpNamespaceVolumeBinding,
  AfscpOperationEnvelope,
  AfscpOperationRecord,
} from './afscp-client.js';
import {
  AfscpClientError,
  sanitizeAfscpCorrelationId,
  sanitizeAfscpOperationId,
} from './afscp-error-mapper.js';
import { AfscpConfigError } from './afscp-config.js';
import { normalizeAfscpValidatedValue } from './afscp-validation.js';
import type {
  ProjectAfscpNamespaceMapping,
  ProjectAfscpNamespaceStage,
  ProjectAfscpNamespaceStore,
  ProjectAfscpResourceOwnershipStore,
} from './project-afscp-namespace-store.js';

export type ProjectStorageBootstrapAfscpClient = AfscpBootstrapClientPort;

export interface BootstrapProjectStorageInput {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  requestId?: string;
  signal?: AbortSignal;
}

export interface ReconcileProjectStorageInput {
  workspaceId: string;
  projectId: string;
  requestId?: string;
  signal?: AbortSignal;
}

export interface EnsureProjectStorageReadyInput {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  requestId?: string;
  signal?: AbortSignal;
}

export type ProjectStoragePreflightResult =
  | {
      status: 'ready';
      namespaceId: string;
      stage: 'ready';
      generation: number;
      nextAction: 'none';
      retryable: false;
      lastErrorCode: null;
    }
  | {
      status: 'pending';
      stage: Exclude<ProjectAfscpNamespaceStage, 'ready' | 'terminal_lifecycle' | 'tombstoned'>;
      generation: number;
      nextAction: 'wait' | 'retry_now';
      retryable: boolean;
      lastErrorCode: string | null;
    }
  | {
      status: 'blocked';
      stage: Exclude<ProjectAfscpNamespaceStage, 'ready'> | null;
      generation: number | null;
      nextAction: 'admin_repair' | 'retry_now' | 'wait' | 'none';
      retryable: boolean;
      lastErrorCode: string;
    };

export interface ProjectStorageBootstrapServicePort {
  readonly enabled: boolean;
  bootstrapProjectStorage(input: BootstrapProjectStorageInput): Promise<void>;
  reconcileProjectStorage(input: ReconcileProjectStorageInput): Promise<void>;
  ensureProjectStorageReady(input: EnsureProjectStorageReadyInput): Promise<ProjectStoragePreflightResult>;
}

interface ProjectStorageBootstrapServiceOptions {
  namespaceStore: ProjectAfscpNamespaceStore;
  resourceOwnershipStore: ProjectAfscpResourceOwnershipStore;
  client: ProjectStorageBootstrapAfscpClient;
  defaultVolumeId: string;
  productCallerService: string;
  correlationIdFactory?: () => string;
}

class DisabledProjectStorageBootstrapService implements ProjectStorageBootstrapServicePort {
  readonly enabled = false;

  async bootstrapProjectStorage(): Promise<void> {
    return undefined;
  }

  async reconcileProjectStorage(): Promise<void> {
    return undefined;
  }

  async ensureProjectStorageReady(): Promise<ProjectStoragePreflightResult> {
    return {
      status: 'blocked',
      stage: null,
      generation: null,
      nextAction: 'admin_repair',
      retryable: false,
      lastErrorCode: 'project_storage_bootstrap_disabled',
    };
  }
}

function defaultCorrelationId(): string {
  return `project-storage-bootstrap-${Date.now().toString(36)}`;
}

function buildIdempotencyKey(namespaceId: string, operation: 'namespace-upsert' | 'volume-binding'): string {
  return `project-storage-bootstrap:${namespaceId}:${operation}`;
}

const DEFAULT_PROJECT_AFSCP_PRODUCT_CALLER_ROLES = [
  'repo_admin',
  'repo_lifecycle_admin',
  'restore_admin',
  'template_admin',
  'export_admin',
  'mount_admin',
  'operation_inspector',
] as const;

function buildDefaultVolumeBinding(input: {
  namespaceId: string;
  defaultVolumeId: string;
  productCallerService: string;
}): AfscpNamespaceVolumeBinding {
  return {
    namespace_id: input.namespaceId,
    default_volume_id: input.defaultVolumeId,
    allowed_callers: [
      { caller_service: input.productCallerService, roles: [...DEFAULT_PROJECT_AFSCP_PRODUCT_CALLER_ROLES] },
    ],
    quota_bytes_default: 0,
    export_policy: {
      webdav_enabled: true,
      max_session_seconds: 900,
    },
    lifecycle_policy: {
      tombstone_retention_seconds: 604800,
      purge_requires_lifecycle_admin: true,
      break_glass_purge_enabled: false,
    },
    mount_policy: {
      workload_mount_enabled: true,
      workload_mount_requires_jvs_external_control_root: true,
      allow_privileged_workload: false,
    },
    template_policy: {
      namespace_templates_enabled: true,
      cross_namespace_clone_enabled: false,
    },
    status: 'active',
  };
}

type BootstrapOperationState = 'pending' | 'ready' | 'failed';
type BootstrapOperationStage = 'namespace_upsert' | 'volume_binding';

const PENDING_OPERATION_STATES = new Set(['queued', 'running', 'pending']);
const READY_OPERATION_STATES = new Set(['succeeded', 'success', 'completed', 'ready']);
const FAILED_OPERATION_STATES = new Set(['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled']);
const ERROR_CODE_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

function classifyOperationState(operationState: unknown): BootstrapOperationState {
  if (typeof operationState !== 'string') {
    return 'pending';
  }
  const normalized = operationState.trim().toLowerCase();
  if (READY_OPERATION_STATES.has(normalized)) {
    return 'ready';
  }
  if (FAILED_OPERATION_STATES.has(normalized)) {
    return 'failed';
  }
  if (PENDING_OPERATION_STATES.has(normalized)) {
    return 'pending';
  }
  return 'pending';
}

function readOperationId(operation: AfscpOperationEnvelope | AfscpOperationRecord): string | null {
  const operationId = operation.operation_id;
  return typeof operationId === 'string' ? sanitizeAfscpOperationId(operationId) ?? null : null;
}

function readOperationErrorCode(operation: AfscpOperationEnvelope | AfscpOperationRecord): string {
  if (operation.error && typeof operation.error === 'object' && !Array.isArray(operation.error)) {
    const code = (operation.error as { code?: unknown }).code;
    if (typeof code === 'string') {
      const trimmed = code.trim();
      if (ERROR_CODE_PATTERN.test(trimmed)) {
        return trimmed;
      }
    }
  }
  return 'afscp_operation_failed';
}

function normalizeBootstrapFailure(error: unknown): {
  lastErrorCode: string;
  operationId: string | null;
  retryable: boolean;
} {
  if (error instanceof AfscpClientError) {
    return {
      lastErrorCode: error.code,
      operationId: sanitizeAfscpOperationId(error.operation_id) ?? null,
      retryable: error.retryable,
    };
  }

  return {
    lastErrorCode: 'project_storage_bootstrap_failed',
    operationId: null,
    retryable: false,
  };
}

function resolvePendingStage(mapping: ProjectAfscpNamespaceMapping): BootstrapOperationStage {
  return mapping.stage === 'volume_binding' ? 'volume_binding' : 'namespace_upsert';
}

function validateBootstrapServiceOptions(options: {
  defaultVolumeId: string;
  productCallerService: string;
}): {
  defaultVolumeId: string;
  productCallerService: string;
} {
  const normalizedDefaultVolumeId = normalizeAfscpValidatedValue('volume_id', options.defaultVolumeId);
  const normalizedProductCallerService = normalizeAfscpValidatedValue('caller_service', options.productCallerService);
  const invalid: string[] = [];
  if (!normalizedDefaultVolumeId) {
    invalid.push('AFSCP_DEFAULT_VOLUME_ID');
  }
  if (!normalizedProductCallerService) {
    invalid.push('AFSCP_CALLER_SERVICE');
  }
  if (invalid.length > 0 || !normalizedDefaultVolumeId || !normalizedProductCallerService) {
    throw new AfscpConfigError({ code: 'AFSCP_CONFIG_INVALID', invalid });
  }

  return {
    defaultVolumeId: normalizedDefaultVolumeId,
    productCallerService: normalizedProductCallerService,
  };
}

function buildProjectStoragePreflightResult(
  mapping: ProjectAfscpNamespaceMapping,
): ProjectStoragePreflightResult {
  if (mapping.status === 'ready' && mapping.stage === 'ready' && mapping.next_action === 'none') {
    return {
      status: 'ready',
      namespaceId: mapping.namespace_id,
      stage: 'ready',
      generation: mapping.generation,
      nextAction: 'none',
      retryable: false,
      lastErrorCode: null,
    };
  }

  if (
    mapping.status === 'pending'
    && mapping.stage !== 'ready'
    && mapping.stage !== 'terminal_lifecycle'
    && mapping.stage !== 'tombstoned'
    && (mapping.next_action === 'wait' || mapping.next_action === 'retry_now')
  ) {
    return {
      status: 'pending',
      stage: mapping.stage,
      generation: mapping.generation,
      nextAction: mapping.next_action === 'retry_now' ? 'retry_now' : 'wait',
      retryable: mapping.retryable,
      lastErrorCode: mapping.last_error_code,
    };
  }

  if (mapping.status === 'deleting') {
    return {
      status: 'blocked',
      stage: 'terminal_lifecycle',
      generation: mapping.generation,
      nextAction: mapping.next_action === 'wait' ? 'wait' : 'retry_now',
      retryable: mapping.retryable,
      lastErrorCode: mapping.last_error_code ?? 'project_storage_teardown_in_progress',
    };
  }

  if (mapping.status === 'tombstoned') {
    return {
      status: 'blocked',
      stage: 'tombstoned',
      generation: mapping.generation,
      nextAction: 'none',
      retryable: false,
      lastErrorCode: 'project_storage_tombstoned',
    };
  }

  return {
    status: 'blocked',
    stage: mapping.stage === 'ready' ? null : mapping.stage,
    generation: mapping.generation,
    nextAction: 'admin_repair',
    retryable: false,
    lastErrorCode: mapping.last_error_code ?? 'project_storage_state_blocked',
  };
}

export class ProjectStorageBootstrapService implements ProjectStorageBootstrapServicePort {
  readonly enabled = true;
  private readonly namespaceStore: ProjectAfscpNamespaceStore;
  private readonly resourceOwnershipStore: ProjectAfscpResourceOwnershipStore;
  private readonly client: ProjectStorageBootstrapAfscpClient;
  private readonly defaultVolumeId: string;
  private readonly productCallerService: string;
  private readonly correlationIdFactory: () => string;

  static disabled(): ProjectStorageBootstrapServicePort {
    return new DisabledProjectStorageBootstrapService();
  }

  constructor(options: ProjectStorageBootstrapServiceOptions) {
    const validatedOptions = validateBootstrapServiceOptions({
      defaultVolumeId: options.defaultVolumeId,
      productCallerService: options.productCallerService,
    });
    this.namespaceStore = options.namespaceStore;
    this.resourceOwnershipStore = options.resourceOwnershipStore;
    this.client = options.client;
    this.defaultVolumeId = validatedOptions.defaultVolumeId;
    this.productCallerService = validatedOptions.productCallerService;
    this.correlationIdFactory = options.correlationIdFactory ?? defaultCorrelationId;
  }

  private resolveCorrelationId(requestId: string | undefined): string {
    return sanitizeAfscpCorrelationId(requestId)
      ?? sanitizeAfscpCorrelationId(this.correlationIdFactory())
      ?? defaultCorrelationId();
  }

  async bootstrapProjectStorage(input: BootstrapProjectStorageInput): Promise<void> {
    await this.advanceProjectStorage({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      requestId: input.requestId,
      signal: input.signal,
      actor: { type: 'user', id: input.actorUserId },
    });
  }

  async reconcileProjectStorage(input: ReconcileProjectStorageInput): Promise<void> {
    const mapping = await this.namespaceStore.getProjectNamespace({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
    if (!mapping || mapping.status !== 'pending') {
      return;
    }

    await this.preflightProjectStorageWithActor({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      requestId: input.requestId,
      signal: input.signal,
      actor: { type: 'admin_job', id: 'project-storage-bootstrap' },
    });
  }

  async ensureProjectStorageReady(input: EnsureProjectStorageReadyInput): Promise<ProjectStoragePreflightResult> {
    return this.preflightProjectStorageWithActor({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      requestId: input.requestId,
      signal: input.signal,
      actor: { type: 'user', id: input.actorUserId },
    });
  }

  private async preflightProjectStorageWithActor(input: {
    workspaceId: string;
    projectId: string;
    requestId?: string;
    signal?: AbortSignal;
    actor: AfscpActor;
  }): Promise<ProjectStoragePreflightResult> {
    const mapping = await this.advanceProjectStorage(input);
    return buildProjectStoragePreflightResult(mapping);
  }

  private async advanceProjectStorage(input: {
    workspaceId: string;
    projectId: string;
    requestId?: string;
    signal?: AbortSignal;
    actor: AfscpActor;
  }): Promise<ProjectAfscpNamespaceMapping> {
    const mapping = await this.namespaceStore.ensureProjectNamespace({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
    if (mapping.status !== 'pending') {
      return mapping;
    }

    const namespaceId = mapping.namespace_id;
    const correlationId = this.resolveCorrelationId(input.requestId);
    let operationStage: BootstrapOperationStage = resolvePendingStage(mapping);
    let namespaceUpsertOperationId = mapping.namespace_upsert_operation_id;
    let volumeBindingOperationId = mapping.volume_binding_operation_id;

    try {
      await this.resourceOwnershipStore.ensureResourceOwnership({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        resourceKind: 'namespace',
        resourceId: namespaceId,
        namespaceId,
      });

      if (operationStage === 'namespace_upsert') {
        const namespaceOperation = namespaceUpsertOperationId
          ? await this.client.getOperation({
              operationId: namespaceUpsertOperationId,
              correlationId,
              signal: input.signal,
            })
          : await this.client.upsertNamespace({
              namespaceId,
              correlationId,
              idempotencyKey: buildIdempotencyKey(namespaceId, 'namespace-upsert'),
              actor: input.actor,
              signal: input.signal,
            });
        namespaceUpsertOperationId = readOperationId(namespaceOperation) ?? namespaceUpsertOperationId;
        await this.ensureOperationOwnership({
          input,
          namespaceId,
          operationId: namespaceUpsertOperationId,
        });
        const namespaceState = classifyOperationState(namespaceOperation.operation_state);
        if (namespaceState === 'failed') {
          return this.namespaceStore.markProjectNamespaceBlocked({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            stage: 'namespace_upsert',
            namespaceUpsertOperationId,
            volumeBindingOperationId,
            lastErrorCode: readOperationErrorCode(namespaceOperation),
          });
        }
        if (namespaceState === 'pending') {
          return this.namespaceStore.markProjectNamespacePending({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            stage: 'namespace_upsert',
            retryable: false,
            namespaceUpsertOperationId,
            volumeBindingOperationId,
            lastErrorCode: null,
          });
        }
      }

      operationStage = 'volume_binding';
      const volumeOperation = volumeBindingOperationId
        ? await this.client.getOperation({
            operationId: volumeBindingOperationId,
            correlationId,
            signal: input.signal,
          })
        : await this.client.putNamespaceVolumeBinding({
            namespaceId,
            correlationId,
            idempotencyKey: buildIdempotencyKey(namespaceId, 'volume-binding'),
            actor: input.actor,
            binding: buildDefaultVolumeBinding({
              namespaceId,
              defaultVolumeId: this.defaultVolumeId,
              productCallerService: this.productCallerService,
            }),
            signal: input.signal,
          });
      volumeBindingOperationId = readOperationId(volumeOperation) ?? volumeBindingOperationId;
      await this.ensureOperationOwnership({
        input,
        namespaceId,
        operationId: volumeBindingOperationId,
      });
      const volumeState = classifyOperationState(volumeOperation.operation_state);
      if (volumeState === 'failed') {
        return this.namespaceStore.markProjectNamespaceBlocked({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          stage: 'volume_binding',
          namespaceUpsertOperationId,
          volumeBindingOperationId,
          lastErrorCode: readOperationErrorCode(volumeOperation),
        });
      }
      if (volumeState === 'pending') {
        return this.namespaceStore.markProjectNamespacePending({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          stage: 'volume_binding',
          retryable: false,
          namespaceUpsertOperationId,
          volumeBindingOperationId,
          lastErrorCode: null,
        });
      }

      return this.namespaceStore.markProjectNamespaceReady({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        namespaceUpsertOperationId,
        volumeBindingOperationId,
      });
    } catch (error) {
      const normalized = normalizeBootstrapFailure(error);
      if (operationStage === 'namespace_upsert' && !namespaceUpsertOperationId) {
        namespaceUpsertOperationId = normalized.operationId;
      }
      if (operationStage === 'volume_binding' && !volumeBindingOperationId) {
        volumeBindingOperationId = normalized.operationId;
      }
      await this.ensureOperationOwnership({
        input,
        namespaceId,
        operationId: normalized.operationId,
      });
      if (normalized.retryable) {
        return this.namespaceStore.markProjectNamespacePending({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          stage: operationStage,
          retryable: true,
          namespaceUpsertOperationId,
          volumeBindingOperationId,
          lastErrorCode: normalized.lastErrorCode,
        });
      }
      return this.namespaceStore.markProjectNamespaceBlocked({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        stage: operationStage,
        namespaceUpsertOperationId,
        volumeBindingOperationId,
        lastErrorCode: normalized.lastErrorCode,
      });
    }
  }

  private async ensureOperationOwnership(input: {
    input: { workspaceId: string; projectId: string };
    namespaceId: string;
    operationId: string | null;
  }): Promise<void> {
    if (!input.operationId) {
      return;
    }
    await this.resourceOwnershipStore.ensureResourceOwnership({
      workspaceId: input.input.workspaceId,
      projectId: input.input.projectId,
      resourceKind: 'operation',
      resourceId: input.operationId,
      namespaceId: input.namespaceId,
    });
  }
}
