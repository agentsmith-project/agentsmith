import {
  AfscpConfigError,
  normalizeAfscpBaseUrl,
} from './afscp-config.js';
import {
  AfscpClientError,
  mapAfscpErrorEnvelope,
  sanitizeAfscpCorrelationId,
  type AfscpMappedError,
} from './afscp-error-mapper.js';
import {
  normalizeAfscpActorType,
  normalizeAfscpValidatedValue,
  type AfscpActorType,
  type AfscpValidatedValueKind,
} from './afscp-validation.js';

export type AfscpCaller = 'product' | 'bootstrap';

export interface AfscpActor {
  type: AfscpActorType;
  id: string;
}

export interface AfscpClientConfig {
  baseUrl: string;
  callerService: string;
  serviceToken: string;
  bootstrapServiceToken: string;
  bootstrapCallerService: string;
}

export interface AfscpOperationEnvelope {
  operation_id: string;
  operation_state: string;
  resource: {
    type: string;
    id: string;
  };
  result: unknown;
  error: unknown;
}

export type AfscpNamespaceVolumeBinding = Record<string, unknown>;
export type AfscpOperationRecord = Record<string, unknown>;
export type AfscpRepo = Record<string, unknown>;
export type AfscpSavePoint = Record<string, unknown>;
export type AfscpExportSession = Record<string, unknown>;
export type AfscpWorkloadMountBindingStatus =
  | 'issued'
  | 'pending'
  | 'active'
  | 'releasing'
  | 'released'
  | 'revoked'
  | 'expired'
  | 'failed'
  | 'uncertain';

export interface AfscpWorkloadMountBinding {
  mount_binding_id: string;
  namespace_id: string;
  repo_id: string;
  volume_id: string;
  mount_path: string;
  read_only: boolean;
  status: AfscpWorkloadMountBindingStatus;
  lease_expires_at: string;
}
export type AfscpExportCreateOperationEnvelope = AfscpOperationEnvelope & {
  result: {
    export?: AfscpExportSession;
    access?: AfscpExportAccessCredential;
  } | null;
};

export interface AfscpExportAccessCredential {
  url: string;
  auth: {
    type: 'basic';
    username: string;
    password: string;
  };
  mode: 'read_only' | 'read_write';
  expires_at: string;
}

export type AfscpRepoLifecycleStatus =
  | 'active'
  | 'archiving'
  | 'archived'
  | 'restoring_archived'
  | 'deleting'
  | 'tombstoned'
  | 'restoring_tombstoned'
  | 'purging'
  | 'purged'
  | 'operator_intervention_required';

export type AfscpExportMode = 'read_only' | 'read_write';

interface AfscpBaseRequest {
  correlationId: string;
  signal?: AbortSignal;
  caller?: AfscpCaller;
}

interface AfscpMutationRequest extends AfscpBaseRequest {
  idempotencyKey: string;
  actor: AfscpActor;
}

interface AfscpBootstrapMutationRequest extends AfscpMutationRequest {
  caller: 'bootstrap';
}

export interface UpsertNamespaceInput extends AfscpBootstrapMutationRequest {
  namespaceId: string;
}

export interface PutNamespaceVolumeBindingInput extends AfscpBootstrapMutationRequest {
  namespaceId: string;
  binding: AfscpNamespaceVolumeBinding;
}

export interface GetNamespaceVolumeBindingInput extends AfscpBaseRequest {
  namespaceId: string;
}

export interface GetOperationInput extends AfscpBaseRequest {
  operationId: string;
}

export interface CreateRepoInput extends AfscpMutationRequest {
  namespaceId: string;
  repoId: string;
}

export interface ListReposInput extends AfscpBaseRequest {
  namespaceId: string;
  lifecycleStatus?: AfscpRepoLifecycleStatus;
}

export interface GetRepoInput extends AfscpBaseRequest {
  namespaceId: string;
  repoId: string;
}

export interface DeleteRepoInput extends AfscpMutationRequest {
  namespaceId: string;
  repoId: string;
  reason?: string;
}

export interface ListSavePointsInput extends AfscpBaseRequest {
  namespaceId: string;
  repoId: string;
}

export interface CreateSavePointInput extends AfscpMutationRequest {
  namespaceId: string;
  repoId: string;
  message: string;
}

export interface CreateRestorePreviewInput extends AfscpMutationRequest {
  namespaceId: string;
  repoId: string;
  savePointId: string;
}

export interface RunRestorePreviewInput extends AfscpMutationRequest {
  namespaceId: string;
  repoId: string;
  previewOperationId: string;
}

export interface DiscardRestorePreviewInput extends AfscpMutationRequest {
  namespaceId: string;
  repoId: string;
  previewOperationId: string;
}

export interface CreateRepoTemplateInput extends AfscpMutationRequest {
  namespaceId: string;
  sourceRepoId: string;
  templateId: string;
}

export interface CloneRepoTemplateInput extends AfscpMutationRequest {
  namespaceId: string;
  templateId: string;
  targetRepoId: string;
}

export interface CreateExportInput extends AfscpMutationRequest {
  namespaceId: string;
  repoId: string;
  mode: AfscpExportMode;
  ttlSeconds?: number;
}

export interface GetExportInput extends AfscpBaseRequest {
  namespaceId: string;
  exportId: string;
}

export interface RevokeExportInput extends AfscpMutationRequest {
  namespaceId: string;
  exportId: string;
}

export interface CreateWorkloadMountBindingInput extends AfscpMutationRequest {
  namespaceId: string;
  repoId: string;
  mountPath: string;
  readOnly: boolean;
  leaseSeconds: number;
}

export interface GetWorkloadMountBindingInput extends AfscpBaseRequest {
  namespaceId: string;
  mountBindingId: string;
}

export interface RevokeWorkloadMountBindingInput extends AfscpMutationRequest {
  namespaceId: string;
  mountBindingId: string;
}

export interface PollOperationInput extends GetOperationInput {
  isTerminal?: (operation: AfscpOperationRecord) => boolean;
  intervalMs?: number;
  timeoutMs?: number;
}

export type AfscpBootstrapUpsertNamespaceInput = Omit<UpsertNamespaceInput, 'caller'>;
export type AfscpBootstrapPutNamespaceVolumeBindingInput = Omit<PutNamespaceVolumeBindingInput, 'caller'>;
export type AfscpBootstrapGetOperationInput = Omit<GetOperationInput, 'caller'>;

export interface AfscpBootstrapClientPort {
  upsertNamespace(input: AfscpBootstrapUpsertNamespaceInput): Promise<AfscpOperationEnvelope>;
  putNamespaceVolumeBinding(input: AfscpBootstrapPutNamespaceVolumeBindingInput): Promise<AfscpOperationEnvelope>;
  getOperation(input: AfscpBootstrapGetOperationInput): Promise<AfscpOperationRecord>;
}

export interface AfscpProductClientPort {
  createRepo(input: Omit<CreateRepoInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  listRepos(input: Omit<ListReposInput, 'caller'>): Promise<{ repos: AfscpRepo[] }>;
  getRepo(input: Omit<GetRepoInput, 'caller'>): Promise<AfscpRepo>;
  deleteRepo(input: Omit<DeleteRepoInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  listSavePoints(input: Omit<ListSavePointsInput, 'caller'>): Promise<{ save_points: AfscpSavePoint[] }>;
  createSavePoint(input: Omit<CreateSavePointInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  createRestorePreview(input: Omit<CreateRestorePreviewInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  runRestorePreview(input: Omit<RunRestorePreviewInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  discardRestorePreview(input: Omit<DiscardRestorePreviewInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  createRepoTemplate(input: Omit<CreateRepoTemplateInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  cloneRepoTemplate(input: Omit<CloneRepoTemplateInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  createExport(input: Omit<CreateExportInput, 'caller'>): Promise<AfscpExportCreateOperationEnvelope>;
  getExport(input: Omit<GetExportInput, 'caller'>): Promise<AfscpExportSession>;
  revokeExport(input: Omit<RevokeExportInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  createWorkloadMountBinding(input: Omit<CreateWorkloadMountBindingInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  getWorkloadMountBinding(input: Omit<GetWorkloadMountBindingInput, 'caller'>): Promise<AfscpWorkloadMountBinding>;
  revokeWorkloadMountBinding(input: Omit<RevokeWorkloadMountBindingInput, 'caller'>): Promise<AfscpOperationEnvelope>;
  getOperation(input: Omit<GetOperationInput, 'caller'>): Promise<AfscpOperationRecord>;
  pollOperation(input: Omit<PollOperationInput, 'caller'>): Promise<AfscpOperationRecord>;
}

interface RequestOptions {
  method: 'DELETE' | 'GET' | 'POST' | 'PUT';
  path: string;
  correlationId: string;
  namespaceId?: string;
  caller?: AfscpCaller;
  mutation?: {
    idempotencyKey: string;
    actor: AfscpActor;
  };
  body?: unknown;
  signal?: AbortSignal;
}

const TERMINAL_OPERATION_STATES = new Set(['succeeded', 'success', 'completed', 'ready', 'failed', 'failure', 'error', 'errored', 'cancelled', 'canceled']);

function isTerminalOperationState(value: unknown): boolean {
  return typeof value === 'string' && TERMINAL_OPERATION_STATES.has(value.trim().toLowerCase());
}

async function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    return;
  }
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('afscp_poll_aborted');
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', handleAbort);
      reject(signal.reason instanceof Error ? signal.reason : new Error('afscp_poll_aborted'));
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export class AfscpClient {
  private readonly baseUrl: string;
  private readonly callerService: string;
  private readonly serviceToken: string;
  private readonly bootstrapServiceToken: string;
  private readonly bootstrapCallerService: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: AfscpClientConfig, fetchFn: typeof fetch = globalThis.fetch) {
    const callerService = normalizeAfscpValidatedValue('caller_service', config.callerService);
    const bootstrapCallerService = normalizeAfscpValidatedValue('caller_service', config.bootstrapCallerService);
    const serviceToken = config.serviceToken.trim();
    const bootstrapServiceToken = config.bootstrapServiceToken.trim();
    const invalid: string[] = [];
    if (!callerService) {
      invalid.push('AFSCP_CALLER_SERVICE');
    }
    if (!bootstrapCallerService) {
      invalid.push('AFSCP_BOOTSTRAP_CALLER_SERVICE');
    }
    if (!serviceToken) {
      invalid.push('AFSCP_SERVICE_TOKEN');
    }
    if (!bootstrapServiceToken) {
      invalid.push('AFSCP_BOOTSTRAP_SERVICE_TOKEN');
    }
    if (invalid.length > 0) {
      throw new AfscpConfigError({ code: 'AFSCP_CONFIG_INVALID', invalid });
    }
    if (!callerService || !bootstrapCallerService) {
      throw new AfscpConfigError({ code: 'AFSCP_CONFIG_INVALID', invalid });
    }
    if (callerService === bootstrapCallerService) {
      throw new AfscpConfigError({
        code: 'AFSCP_CONFIG_INVALID',
        invalid: ['AFSCP_BOOTSTRAP_CALLER_SERVICE'],
      });
    }
    if (serviceToken === bootstrapServiceToken) {
      throw new AfscpConfigError({
        code: 'AFSCP_CONFIG_INVALID',
        invalid: ['AFSCP_BOOTSTRAP_SERVICE_TOKEN'],
      });
    }

    this.baseUrl = normalizeAfscpBaseUrl(config.baseUrl);
    this.callerService = callerService;
    this.serviceToken = serviceToken;
    this.bootstrapServiceToken = bootstrapServiceToken;
    this.bootstrapCallerService = bootstrapCallerService;
    this.fetchFn = fetchFn;
  }

  async upsertNamespace(input: UpsertNamespaceInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const caller = this.requireBootstrapCaller(input.caller, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'PUT',
      path: `/internal/v1/namespaces/${encodeURIComponent(namespaceId)}`,
      correlationId: input.correlationId,
      namespaceId,
      caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: { namespace_id: namespaceId },
      signal: input.signal,
    });
  }

  async putNamespaceVolumeBinding(input: PutNamespaceVolumeBindingInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const caller = this.requireBootstrapCaller(input.caller, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'PUT',
      path: `/internal/v1/namespaces/${encodeURIComponent(namespaceId)}/volume-binding`,
      correlationId: input.correlationId,
      namespaceId,
      caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: input.binding,
      signal: input.signal,
    });
  }

  async getNamespaceVolumeBinding(input: GetNamespaceVolumeBindingInput): Promise<AfscpNamespaceVolumeBinding> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    return this.requestJson<AfscpNamespaceVolumeBinding>({
      method: 'GET',
      path: `/internal/v1/namespaces/${encodeURIComponent(namespaceId)}/volume-binding`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      signal: input.signal,
    });
  }

  async getOperation(input: GetOperationInput): Promise<AfscpOperationRecord> {
    const operationId = this.requireValidatedValue('operation_id', input.operationId, input.correlationId);
    return this.requestJson<AfscpOperationRecord>({
      method: 'GET',
      path: `/internal/v1/operations/${encodeURIComponent(operationId)}`,
      correlationId: input.correlationId,
      caller: input.caller,
      signal: input.signal,
    });
  }

  async pollOperation(input: PollOperationInput): Promise<AfscpOperationRecord> {
    const timeoutMs = input.timeoutMs ?? 30_000;
    const intervalMs = input.intervalMs ?? 250;
    const startedAt = Date.now();
    let lastOperation: AfscpOperationRecord | null = null;
    while (Date.now() - startedAt <= timeoutMs) {
      lastOperation = await this.getOperation(input);
      if (input.isTerminal ? input.isTerminal(lastOperation) : isTerminalOperationState(lastOperation.operation_state)) {
        return lastOperation;
      }
      await abortableDelay(intervalMs, input.signal);
    }
    return lastOperation ?? this.getOperation(input);
  }

  async createRepo(input: CreateRepoInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: '/internal/v1/repos',
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: {
        namespace_id: namespaceId,
        target_repo_id: repoId,
      },
      signal: input.signal,
    });
  }

  async listRepos(input: ListReposInput): Promise<{ repos: AfscpRepo[] }> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const search = new URLSearchParams({ namespace_id: namespaceId });
    if (input.lifecycleStatus) {
      search.set('lifecycle_status', input.lifecycleStatus);
    }
    return this.requestJson<{ repos: AfscpRepo[] }>({
      method: 'GET',
      path: `/internal/v1/repos?${search.toString()}`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      signal: input.signal,
    });
  }

  async getRepo(input: GetRepoInput): Promise<AfscpRepo> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    return this.requestJson<AfscpRepo>({
      method: 'GET',
      path: `/internal/v1/repos/${encodeURIComponent(repoId)}`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      signal: input.signal,
    });
  }

  async deleteRepo(input: DeleteRepoInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: `/internal/v1/repos/${encodeURIComponent(repoId)}:delete`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: input.reason ? { reason: input.reason } : {},
      signal: input.signal,
    });
  }

  async listSavePoints(input: ListSavePointsInput): Promise<{ save_points: AfscpSavePoint[] }> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    return this.requestJson<{ save_points: AfscpSavePoint[] }>({
      method: 'GET',
      path: `/internal/v1/repos/${encodeURIComponent(repoId)}/save-points`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      signal: input.signal,
    });
  }

  async createSavePoint(input: CreateSavePointInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: `/internal/v1/repos/${encodeURIComponent(repoId)}/save-points`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: {
        message: input.message,
      },
      signal: input.signal,
    });
  }

  async createRestorePreview(input: CreateRestorePreviewInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    const savePointId = this.requireValidatedValue('save_point_id', input.savePointId, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: `/internal/v1/repos/${encodeURIComponent(repoId)}/restore-preview`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: {
        save_point_id: savePointId,
      },
      signal: input.signal,
    });
  }

  async runRestorePreview(input: RunRestorePreviewInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    const previewOperationId = this.requireValidatedValue(
      'operation_id',
      input.previewOperationId,
      input.correlationId,
    );
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: `/internal/v1/repos/${encodeURIComponent(repoId)}/restore-run`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: {
        preview_operation_id: previewOperationId,
      },
      signal: input.signal,
    });
  }

  async discardRestorePreview(input: DiscardRestorePreviewInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    const previewOperationId = this.requireValidatedValue(
      'operation_id',
      input.previewOperationId,
      input.correlationId,
    );
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: `/internal/v1/repos/${encodeURIComponent(repoId)}/restore-preview:discard`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: {
        preview_operation_id: previewOperationId,
      },
      signal: input.signal,
    });
  }

  async createRepoTemplate(input: CreateRepoTemplateInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const sourceRepoId = this.requireValidatedValue('repo_id', input.sourceRepoId, input.correlationId);
    const templateId = this.requireValidatedValue('template_id', input.templateId, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: '/internal/v1/repo-templates',
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: {
        namespace_id: namespaceId,
        source_repo_id: sourceRepoId,
        target_template_id: templateId,
        clone_history_mode: 'main',
      },
      signal: input.signal,
    });
  }

  async cloneRepoTemplate(input: CloneRepoTemplateInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const templateId = this.requireValidatedValue('template_id', input.templateId, input.correlationId);
    const targetRepoId = this.requireValidatedValue('repo_id', input.targetRepoId, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: `/internal/v1/repo-templates/${encodeURIComponent(templateId)}:clone`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: {
        namespace_id: namespaceId,
        template_id: templateId,
        target_repo_id: targetRepoId,
      },
      signal: input.signal,
    });
  }

  async createExport(input: CreateExportInput): Promise<AfscpExportCreateOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    return this.requestJson<AfscpExportCreateOperationEnvelope>({
      method: 'POST',
      path: `/internal/v1/repos/${encodeURIComponent(repoId)}/exports`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: {
        mode: input.mode,
        ...(input.ttlSeconds ? { ttl_seconds: input.ttlSeconds } : {}),
      },
      signal: input.signal,
    });
  }

  async getExport(input: GetExportInput): Promise<AfscpExportSession> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const exportId = this.requireValidatedValue('export_id', input.exportId, input.correlationId);
    return this.requestJson<AfscpExportSession>({
      method: 'GET',
      path: `/internal/v1/exports/${encodeURIComponent(exportId)}`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      signal: input.signal,
    });
  }

  async revokeExport(input: RevokeExportInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const exportId = this.requireValidatedValue('export_id', input.exportId, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'DELETE',
      path: `/internal/v1/exports/${encodeURIComponent(exportId)}`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      signal: input.signal,
    });
  }

  async createWorkloadMountBinding(input: CreateWorkloadMountBindingInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const repoId = this.requireValidatedValue('repo_id', input.repoId, input.correlationId);
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: `/internal/v1/repos/${encodeURIComponent(repoId)}/workload-mount-bindings`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      body: {
        mount_path: input.mountPath,
        read_only: input.readOnly,
        lease_seconds: input.leaseSeconds,
      },
      signal: input.signal,
    });
  }

  async getWorkloadMountBinding(input: GetWorkloadMountBindingInput): Promise<AfscpWorkloadMountBinding> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const mountBindingId = this.requireValidatedValue(
      'mount_binding_id',
      input.mountBindingId,
      input.correlationId,
    );
    return this.requestJson<AfscpWorkloadMountBinding>({
      method: 'GET',
      path: `/internal/v1/workload-mount-bindings/${encodeURIComponent(mountBindingId)}`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      signal: input.signal,
    });
  }

  async revokeWorkloadMountBinding(input: RevokeWorkloadMountBindingInput): Promise<AfscpOperationEnvelope> {
    const namespaceId = this.requireValidatedValue('namespace_id', input.namespaceId, input.correlationId);
    const mountBindingId = this.requireValidatedValue(
      'mount_binding_id',
      input.mountBindingId,
      input.correlationId,
    );
    return this.requestJson<AfscpOperationEnvelope>({
      method: 'POST',
      path: `/internal/v1/workload-mount-bindings/${encodeURIComponent(mountBindingId)}:revoke`,
      correlationId: input.correlationId,
      namespaceId,
      caller: input.caller,
      mutation: {
        idempotencyKey: input.idempotencyKey,
        actor: input.actor,
      },
      signal: input.signal,
    });
  }

  private resolveCallerContext(caller: AfscpCaller | undefined): { callerService: string; serviceToken: string } {
    if (caller !== 'bootstrap') {
      return {
        callerService: this.callerService,
        serviceToken: this.serviceToken,
      };
    }
    return {
      callerService: this.bootstrapCallerService,
      serviceToken: this.bootstrapServiceToken,
    };
  }

  private buildValidationError(correlationId: string | undefined): AfscpClientError {
    return new AfscpClientError({
      status: 400,
      code: 'afscp_error',
      message: 'afscp_error',
      retryable: false,
      correlation_id: sanitizeAfscpCorrelationId(correlationId) ?? 'afscp-request',
    });
  }

  private requireBootstrapCaller(caller: AfscpCaller | undefined, correlationId: string | undefined): 'bootstrap' {
    if (caller !== 'bootstrap') {
      throw this.buildValidationError(correlationId);
    }
    return caller;
  }

  private requireValidatedValue(
    kind: AfscpValidatedValueKind,
    value: string,
    correlationId: string | undefined,
  ): string {
    const normalized = normalizeAfscpValidatedValue(kind, value);
    if (!normalized) {
      throw this.buildValidationError(correlationId);
    }
    return normalized;
  }

  private buildHeaders(options: RequestOptions): Record<string, string> {
    const correlationId = this.requireValidatedValue('correlation_id', options.correlationId, options.correlationId);
    const callerContext = this.resolveCallerContext(options.caller);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${callerContext.serviceToken}`,
      'X-AFSCP-Caller-Service': callerContext.callerService,
      'X-Correlation-Id': correlationId,
    };

    if (options.namespaceId) {
      headers['X-AFSCP-Namespace-Id'] = this.requireValidatedValue(
        'namespace_id',
        options.namespaceId,
        correlationId,
      );
    }

    if (options.mutation) {
      const actorType = normalizeAfscpActorType(options.mutation.actor.type);
      if (!actorType) {
        throw this.buildValidationError(correlationId);
      }
      headers['Idempotency-Key'] = this.requireValidatedValue(
        'idempotency_key',
        options.mutation.idempotencyKey,
        correlationId,
      );
      headers['X-AFSCP-Actor-Type'] = actorType;
      headers['X-AFSCP-Actor-Id'] = this.requireValidatedValue(
        'actor_id',
        options.mutation.actor.id,
        correlationId,
      );
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }

  private buildNetworkError(correlationId: string): AfscpClientError {
    const sanitizedCorrelationId = sanitizeAfscpCorrelationId(correlationId) ?? 'afscp-request';
    return new AfscpClientError({
      status: 503,
      code: 'unavailable',
      message: 'unavailable',
      retryable: true,
      correlation_id: sanitizedCorrelationId,
    });
  }

  private async readErrorPayload(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  private async requestJson<T>(options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${options.path}`;
    const requestInit: RequestInit = {
      method: options.method,
      headers: this.buildHeaders(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    };
    let response: Response;
    try {
      response = await this.fetchFn(url, requestInit);
    } catch {
      throw this.buildNetworkError(options.correlationId);
    }

    if (!response.ok) {
      const payload = await this.readErrorPayload(response);
      throw new AfscpClientError(mapAfscpErrorEnvelope(response.status, payload));
    }

    try {
      return await response.json() as T;
    } catch {
      const mapped: AfscpMappedError = {
        status: 502,
        code: 'afscp_error',
        message: 'afscp_error',
        retryable: false,
        correlation_id: sanitizeAfscpCorrelationId(options.correlationId) ?? 'afscp-request',
      };
      throw new AfscpClientError(mapped);
    }
  }
}

export class AfscpBootstrapClient implements AfscpBootstrapClientPort {
  constructor(private readonly client: Pick<AfscpClient, 'upsertNamespace' | 'putNamespaceVolumeBinding' | 'getOperation'>) {}

  async upsertNamespace(input: AfscpBootstrapUpsertNamespaceInput): Promise<AfscpOperationEnvelope> {
    return this.client.upsertNamespace({
      ...input,
      caller: 'bootstrap',
    });
  }

  async putNamespaceVolumeBinding(input: AfscpBootstrapPutNamespaceVolumeBindingInput): Promise<AfscpOperationEnvelope> {
    return this.client.putNamespaceVolumeBinding({
      ...input,
      caller: 'bootstrap',
    });
  }

  async getOperation(input: AfscpBootstrapGetOperationInput): Promise<AfscpOperationRecord> {
    return this.client.getOperation({
      ...input,
      caller: 'bootstrap',
    });
  }
}

export class AfscpProductClient implements AfscpProductClientPort {
  constructor(
    private readonly client: Pick<
      AfscpClient,
      | 'createRepo'
      | 'listRepos'
      | 'getRepo'
      | 'deleteRepo'
      | 'listSavePoints'
      | 'createSavePoint'
      | 'createRestorePreview'
      | 'runRestorePreview'
      | 'discardRestorePreview'
      | 'createRepoTemplate'
      | 'cloneRepoTemplate'
      | 'createExport'
      | 'getExport'
      | 'revokeExport'
      | 'createWorkloadMountBinding'
      | 'getWorkloadMountBinding'
      | 'revokeWorkloadMountBinding'
      | 'getOperation'
      | 'pollOperation'
    >,
  ) {}

  async createRepo(input: Omit<CreateRepoInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.createRepo({
      ...input,
      caller: 'product',
    });
  }

  async listRepos(input: Omit<ListReposInput, 'caller'>): Promise<{ repos: AfscpRepo[] }> {
    return this.client.listRepos({
      ...input,
      caller: 'product',
    });
  }

  async getRepo(input: Omit<GetRepoInput, 'caller'>): Promise<AfscpRepo> {
    return this.client.getRepo({
      ...input,
      caller: 'product',
    });
  }

  async deleteRepo(input: Omit<DeleteRepoInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.deleteRepo({
      ...input,
      caller: 'product',
    });
  }

  async listSavePoints(input: Omit<ListSavePointsInput, 'caller'>): Promise<{ save_points: AfscpSavePoint[] }> {
    return this.client.listSavePoints({
      ...input,
      caller: 'product',
    });
  }

  async createSavePoint(input: Omit<CreateSavePointInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.createSavePoint({
      ...input,
      caller: 'product',
    });
  }

  async createRestorePreview(input: Omit<CreateRestorePreviewInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.createRestorePreview({
      ...input,
      caller: 'product',
    });
  }

  async runRestorePreview(input: Omit<RunRestorePreviewInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.runRestorePreview({
      ...input,
      caller: 'product',
    });
  }

  async discardRestorePreview(input: Omit<DiscardRestorePreviewInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.discardRestorePreview({
      ...input,
      caller: 'product',
    });
  }

  async createRepoTemplate(input: Omit<CreateRepoTemplateInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.createRepoTemplate({
      ...input,
      caller: 'product',
    });
  }

  async cloneRepoTemplate(input: Omit<CloneRepoTemplateInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.cloneRepoTemplate({
      ...input,
      caller: 'product',
    });
  }

  async createExport(input: Omit<CreateExportInput, 'caller'>): Promise<AfscpExportCreateOperationEnvelope> {
    return this.client.createExport({
      ...input,
      caller: 'product',
    });
  }

  async getExport(input: Omit<GetExportInput, 'caller'>): Promise<AfscpExportSession> {
    return this.client.getExport({
      ...input,
      caller: 'product',
    });
  }

  async revokeExport(input: Omit<RevokeExportInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.revokeExport({
      ...input,
      caller: 'product',
    });
  }

  async createWorkloadMountBinding(input: Omit<CreateWorkloadMountBindingInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.createWorkloadMountBinding({
      ...input,
      caller: 'product',
    });
  }

  async getWorkloadMountBinding(input: Omit<GetWorkloadMountBindingInput, 'caller'>): Promise<AfscpWorkloadMountBinding> {
    return this.client.getWorkloadMountBinding({
      ...input,
      caller: 'product',
    });
  }

  async revokeWorkloadMountBinding(input: Omit<RevokeWorkloadMountBindingInput, 'caller'>): Promise<AfscpOperationEnvelope> {
    return this.client.revokeWorkloadMountBinding({
      ...input,
      caller: 'product',
    });
  }

  async getOperation(input: Omit<GetOperationInput, 'caller'>): Promise<AfscpOperationRecord> {
    return this.client.getOperation({
      ...input,
      caller: 'product',
    });
  }

  async pollOperation(input: Omit<PollOperationInput, 'caller'>): Promise<AfscpOperationRecord> {
    return this.client.pollOperation({
      ...input,
      caller: 'product',
    });
  }
}
