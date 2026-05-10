import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { describe, expect, it, vi } from 'vitest';
import { AfscpConfigError } from './afscp-config.js';
import { AfscpClientError } from './afscp-error-mapper.js';
import {
  ProjectAfscpNamespaceStore,
  ProjectAfscpResourceOwnershipStore,
} from './project-afscp-namespace-store.js';
import {
  ProjectStorageBootstrapService,
  type ProjectStorageBootstrapAfscpClient,
} from './project-storage-bootstrap-service.js';

function createOperationEnvelope(
  operationId: string,
  namespaceId: string,
  operationState = 'succeeded',
  error: unknown = null,
) {
  return {
    operation_id: operationId,
    operation_state: operationState,
    resource: { type: 'namespace', id: namespaceId },
    result: null,
    error,
  };
}

function createStores(): {
  namespaceStore: ProjectAfscpNamespaceStore;
  resourceOwnershipStore: ProjectAfscpResourceOwnershipStore;
} {
  const docStore = new InMemoryJsonDocStore();
  const nowIso = () => '2026-05-09T00:00:00.000Z';
  return {
    namespaceStore: new ProjectAfscpNamespaceStore(docStore, nowIso),
    resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore, nowIso),
  };
}

function expectNoStorageIdentity(result: Record<string, unknown>): void {
  expect(result).not.toHaveProperty('namespaceId');
}

describe('ProjectStorageBootstrapService', () => {
  it('calls AFSCP through a bootstrap-only port with actor, idempotency, correlation, namespace id, and default volume binding', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_1', input.namespaceId),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_1', input.namespaceId),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_bootstrap',
      actorUserId: 'user_creator',
      requestId: 'req-create-1',
    });

    const mapping = await namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_bootstrap',
    });
    expect(mapping).toMatchObject({
      status: 'ready',
      stage: 'ready',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_1',
      volume_binding_operation_id: 'op_binding_1',
      last_error_code: null,
    });
    expect(mapping?.namespace_id).toMatch(/^ns_[A-Za-z0-9_-]{20,}$/);
    const namespaceId = mapping?.namespace_id ?? '';

    expect(upsertNamespace).toHaveBeenCalledWith({
      namespaceId,
      correlationId: 'req-create-1',
      idempotencyKey: `project-storage-bootstrap:${namespaceId}:namespace-upsert`,
      actor: { type: 'user', id: 'user_creator' },
      signal: undefined,
    });
    expect(putNamespaceVolumeBinding).toHaveBeenCalledWith({
      namespaceId,
      correlationId: 'req-create-1',
      idempotencyKey: `project-storage-bootstrap:${namespaceId}:volume-binding`,
      actor: { type: 'user', id: 'user_creator' },
      binding: expect.objectContaining({
        namespace_id: namespaceId,
        default_volume_id: 'vol_default',
        allowed_callers: [{
          caller_service: 'agentsmith-api',
          roles: [
            'repo_admin',
            'repo_lifecycle_admin',
            'restore_admin',
            'template_admin',
            'export_admin',
            'mount_admin',
            'operation_inspector',
          ],
        }],
        status: 'active',
      }),
      signal: undefined,
    });
    await expect(resourceOwnershipStore.getResourceOwnership({
      resourceKind: 'namespace',
      resourceId: namespaceId,
    })).resolves.toMatchObject({
      workspace_id: 'ws_alpha',
      project_id: 'proj_bootstrap',
      namespace_id: namespaceId,
    });
    await expect(resourceOwnershipStore.getResourceOwnership({
      resourceKind: 'operation',
      resourceId: 'op_namespace_1',
    })).resolves.toMatchObject({
      workspace_id: 'ws_alpha',
      project_id: 'proj_bootstrap',
      namespace_id: namespaceId,
    });
  });

  it('is a disabled no-op when AFSCP is not configured', async () => {
    const service = ProjectStorageBootstrapService.disabled();

    await expect(service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_disabled',
      actorUserId: 'user_creator',
      requestId: 'req-disabled',
    })).resolves.toBeUndefined();
    await expect(service.reconcileProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_disabled',
      requestId: 'req-disabled',
    })).resolves.toBeUndefined();
    const result = await service.ensureProjectStorageReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_disabled',
      actorUserId: 'user_creator',
      requestId: 'req-disabled',
    });
    expect(result).toEqual({
      status: 'blocked',
      stage: null,
      generation: null,
      nextAction: 'admin_repair',
      retryable: false,
      lastErrorCode: 'project_storage_bootstrap_disabled',
    });
    expectNoStorageIdentity(result);
    expect(service.enabled).toBe(false);
  });

  it('blocks storage preflight for deleting and tombstoned namespace mappings without creating new AFSCP resources', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_unexpected', input.namespaceId),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_unexpected', input.namespaceId),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await namespaceStore.markProjectNamespaceDeleting({
      workspaceId: 'ws_alpha',
      projectId: 'proj_teardown',
      lastErrorCode: null,
    });

    await expect(service.ensureProjectStorageReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_teardown',
      actorUserId: 'user_creator',
      requestId: 'req-preflight-deleting',
    })).resolves.toEqual({
      status: 'blocked',
      stage: 'terminal_lifecycle',
      generation: 1,
      nextAction: 'retry_now',
      retryable: true,
      lastErrorCode: 'project_storage_teardown_in_progress',
    });

    const deleting = await namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_teardown',
    });
    await namespaceStore.markProjectNamespaceTombstoned({
      workspaceId: 'ws_alpha',
      projectId: 'proj_teardown',
    });

    await expect(service.ensureProjectStorageReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_teardown',
      actorUserId: 'user_creator',
      requestId: 'req-preflight-tombstoned',
    })).resolves.toEqual({
      status: 'blocked',
      stage: 'tombstoned',
      generation: (deleting?.generation ?? 1) + 1,
      nextAction: 'none',
      retryable: false,
      lastErrorCode: 'project_storage_tombstoned',
    });
    expect(upsertNamespace).not.toHaveBeenCalled();
    expect(putNamespaceVolumeBinding).not.toHaveBeenCalled();
  });

  it('fails fast with sanitized config errors when constructed with invalid non-env wiring', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();

    let caught: unknown;
    try {
      new ProjectStorageBootstrapService({
        namespaceStore,
        resourceOwnershipStore,
        client: {
          upsertNamespace: vi.fn(),
          putNamespaceVolumeBinding: vi.fn(),
          getOperation: vi.fn(),
        },
        defaultVolumeId: 'raw\nsvc-secret-token',
        productCallerService: 'agentsmith api',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AfscpConfigError);
    expect(caught).toMatchObject({
      code: 'AFSCP_CONFIG_INVALID',
      invalid: ['AFSCP_DEFAULT_VOLUME_ID', 'AFSCP_CALLER_SERVICE'],
    });
    expect(JSON.stringify(caught)).not.toContain('svc-secret-token');
    expect(JSON.stringify(caught)).not.toContain('agentsmith api');
  });

  it('preflights not-started project storage by advancing it idempotently to ready', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_preflight_ready', input.namespaceId),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_preflight_ready', input.namespaceId),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    const result = await service.ensureProjectStorageReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_preflight_ready',
      actorUserId: 'user_reader',
      requestId: 'req-preflight-ready',
    });
    expect(result).toMatchObject({
      status: 'ready',
      namespaceId: expect.stringMatching(/^ns_[A-Za-z0-9_-]{20,}$/),
      stage: 'ready',
      nextAction: 'none',
      retryable: false,
      lastErrorCode: null,
      generation: expect.any(Number),
    });
    expect(upsertNamespace).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: 'user', id: 'user_reader' },
      correlationId: 'req-preflight-ready',
    }));
    expect(putNamespaceVolumeBinding).toHaveBeenCalledOnce();
  });

  it('uses a generated correlation id instead of forwarding an unsafe request id', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_1', input.namespaceId),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_1', input.namespaceId),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_correlation',
      actorUserId: 'user_creator',
      requestId: 'raw\r\nx-token=svc-secret-token',
    });

    expect(upsertNamespace).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'corr-generated',
    }));
    expect(putNamespaceVolumeBinding).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: 'corr-generated',
    }));
  });

  it('keeps a queued namespace upsert pending without submitting the volume binding early', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_queued', input.namespaceId, 'queued'),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>();
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_pending',
      actorUserId: 'user_creator',
      requestId: 'req-create-pending',
    });

    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_pending',
    })).resolves.toMatchObject({
      status: 'pending',
      stage: 'namespace_upsert',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_queued',
      volume_binding_operation_id: null,
      last_error_code: null,
    });
    expect(putNamespaceVolumeBinding).not.toHaveBeenCalled();
  });

  it('marks terminal success AFSCP operations ready', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_success', input.namespaceId, 'success'),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_completed', input.namespaceId, 'completed'),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_ready',
      actorUserId: 'user_creator',
      requestId: 'req-create-ready',
    });

    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_ready',
    })).resolves.toMatchObject({
      status: 'ready',
      stage: 'ready',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_success',
      volume_binding_operation_id: 'op_binding_completed',
      last_error_code: null,
    });
  });

  it('keeps retryable namespace upsert client errors pending with operation ids for reconcile', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async () => {
        throw new AfscpClientError({
          status: 503,
          code: 'unavailable',
          message: 'unavailable',
          retryable: true,
          correlation_id: 'corr-afscp',
          operation_id: 'op_namespace_failed',
        });
      },
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>();
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await expect(service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_namespace_failure',
      actorUserId: 'user_creator',
      requestId: 'req-create-namespace-failed',
    })).resolves.toBeUndefined();

    expect(putNamespaceVolumeBinding).not.toHaveBeenCalled();
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_namespace_failure',
    })).resolves.toMatchObject({
      status: 'pending',
      stage: 'namespace_upsert',
      retryable: true,
      namespace_upsert_operation_id: 'op_namespace_failed',
      volume_binding_operation_id: null,
      last_error_code: 'unavailable',
    });
  });

  it('keeps retryable volume binding client errors pending with operation ids for reconcile', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_1', input.namespaceId),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async () => {
        throw new AfscpClientError({
          status: 503,
          code: 'unavailable',
          message: 'unavailable',
          retryable: true,
          correlation_id: 'corr-afscp',
          operation_id: 'op_binding_failed',
        });
      },
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await expect(service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_failure',
      actorUserId: 'user_creator',
      requestId: 'req-create-2',
    })).resolves.toBeUndefined();

    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_failure',
    })).resolves.toMatchObject({
      status: 'pending',
      stage: 'volume_binding',
      retryable: true,
      namespace_upsert_operation_id: 'op_namespace_1',
      volume_binding_operation_id: 'op_binding_failed',
      last_error_code: 'unavailable',
    });
  });

  it('marks non-retryable client errors failed internally', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async () => {
        throw new AfscpClientError({
          status: 409,
          code: 'conflict',
          message: 'conflict',
          retryable: false,
          correlation_id: 'corr-afscp',
          operation_id: 'op_namespace_conflict',
        });
      },
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>();
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_namespace_conflict',
      actorUserId: 'user_creator',
      requestId: 'req-create-namespace-conflict',
    });

    expect(putNamespaceVolumeBinding).not.toHaveBeenCalled();
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_namespace_conflict',
    })).resolves.toMatchObject({
      status: 'blocked',
      stage: 'namespace_upsert',
      next_action: 'admin_repair',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_conflict',
      volume_binding_operation_id: null,
      last_error_code: 'conflict',
    });
  });

  it('records unexpected bootstrap errors as sanitized blocked state without leaking raw messages', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async () => {
        throw new Error('bootstrap_programmer_error token=svc-secret-token /internal/v1/namespaces/ns_secret');
      },
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>();
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await expect(service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_programmer_error',
      actorUserId: 'user_creator',
      requestId: 'req-create-programmer-error',
    })).resolves.toBeUndefined();

    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_programmer_error',
    })).resolves.toMatchObject({
      status: 'blocked',
      stage: 'namespace_upsert',
      next_action: 'admin_repair',
      retryable: false,
      namespace_upsert_operation_id: null,
      volume_binding_operation_id: null,
      last_error_code: 'project_storage_bootstrap_failed',
    });
    const mapping = await namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_programmer_error',
    });
    expect(JSON.stringify(mapping)).not.toContain('svc-secret-token');
    expect(JSON.stringify(mapping)).not.toContain('/internal/v1');
    expect(JSON.stringify(mapping)).not.toContain('ns_secret');
  });

  it('reconciles a ready namespace operation by submitting the volume binding and marking ready when it succeeds', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_pending', input.namespaceId, 'queued'),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_reconcile_ready', input.namespaceId, 'completed'),
    );
    const getOperation = vi.fn<ProjectStorageBootstrapAfscpClient['getOperation']>(
      async (input) => createOperationEnvelope(input.operationId, 'ns_reconciled', 'succeeded'),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_ready',
      actorUserId: 'user_creator',
      requestId: 'req-create-pending',
    });
    const pendingMapping = await namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_ready',
    });
    const namespaceId = pendingMapping?.namespace_id ?? '';
    await service.reconcileProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_ready',
      requestId: 'req-reconcile-ready',
    });

    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_ready',
    })).resolves.toMatchObject({
      status: 'ready',
      stage: 'ready',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_pending',
      volume_binding_operation_id: 'op_binding_reconcile_ready',
      last_error_code: null,
    });
    expect(getOperation).toHaveBeenCalledWith({
      operationId: 'op_namespace_pending',
      correlationId: 'req-reconcile-ready',
      signal: undefined,
    });
    expect(putNamespaceVolumeBinding).toHaveBeenCalledWith({
      namespaceId,
      correlationId: 'req-reconcile-ready',
      idempotencyKey: `project-storage-bootstrap:${namespaceId}:volume-binding`,
      actor: { type: 'admin_job', id: 'project-storage-bootstrap' },
      binding: expect.objectContaining({
        namespace_id: namespaceId,
        default_volume_id: 'vol_default',
      }),
      signal: undefined,
    });
  });

  it('reconciles pending AFSCP operation ids to failed when a stored operation fails', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_ready', input.namespaceId, 'succeeded'),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_pending', input.namespaceId, 'running'),
    );
    const getOperation = vi.fn<ProjectStorageBootstrapAfscpClient['getOperation']>(
      async (input) => createOperationEnvelope(input.operationId, 'ns_reconciled', 'failed', { code: 'VOLUME_BINDING_FAILED' }),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_failed',
      actorUserId: 'user_creator',
      requestId: 'req-create-pending',
    });
    await service.reconcileProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_failed',
      requestId: 'req-reconcile-failed',
    });

    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_failed',
    })).resolves.toMatchObject({
      status: 'blocked',
      stage: 'volume_binding',
      next_action: 'admin_repair',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_ready',
      volume_binding_operation_id: 'op_binding_pending',
      last_error_code: 'VOLUME_BINDING_FAILED',
    });
  });

  it('keeps pending AFSCP operation ids pending while AFSCP still reports pending states', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_pending', input.namespaceId, 'queued'),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_should_not_submit', input.namespaceId, 'running'),
    );
    const getOperation = vi.fn<ProjectStorageBootstrapAfscpClient['getOperation']>(
      async (input) => createOperationEnvelope(input.operationId, 'ns_reconciled', 'running'),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_pending',
      actorUserId: 'user_creator',
      requestId: 'req-create-pending',
    });
    await service.reconcileProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_pending',
      requestId: 'req-reconcile-pending',
    });

    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_pending',
    })).resolves.toMatchObject({
      status: 'pending',
      stage: 'namespace_upsert',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_pending',
      volume_binding_operation_id: null,
      last_error_code: null,
    });
    expect(putNamespaceVolumeBinding).not.toHaveBeenCalled();
  });

  it('reconciles a ready volume binding operation to project storage ready', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_ready', input.namespaceId, 'succeeded'),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_running', input.namespaceId, 'running'),
    );
    const getOperation = vi.fn<ProjectStorageBootstrapAfscpClient['getOperation']>(
      async (input) => createOperationEnvelope(input.operationId, 'ns_reconciled', 'completed'),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_binding_ready',
      actorUserId: 'user_creator',
      requestId: 'req-create-binding-pending',
    });
    await service.reconcileProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_binding_ready',
      requestId: 'req-reconcile-binding-ready',
    });

    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_reconcile_binding_ready',
    })).resolves.toMatchObject({
      status: 'ready',
      stage: 'ready',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_ready',
      volume_binding_operation_id: 'op_binding_running',
      last_error_code: null,
    });
    expect(getOperation).toHaveBeenCalledWith({
      operationId: 'op_binding_running',
      correlationId: 'req-reconcile-binding-ready',
      signal: undefined,
    });
  });

  it('retries a retryable namespace error on reconcile and advances the saga', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>()
      .mockRejectedValueOnce(new AfscpClientError({
        status: 503,
        code: 'unavailable',
        message: 'unavailable',
        retryable: true,
        correlation_id: 'corr-afscp',
      }))
      .mockImplementationOnce(async (input) => createOperationEnvelope('op_namespace_retry_ready', input.namespaceId, 'succeeded'));
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_retry_ready', input.namespaceId, 'completed'),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_retry_namespace',
      actorUserId: 'user_creator',
      requestId: 'req-create-retry-namespace',
    });
    await service.reconcileProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_retry_namespace',
      requestId: 'req-reconcile-retry-namespace',
    });

    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_retry_namespace',
    })).resolves.toMatchObject({
      status: 'ready',
      stage: 'ready',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_retry_ready',
      volume_binding_operation_id: 'op_binding_retry_ready',
      last_error_code: null,
    });
    expect(upsertNamespace).toHaveBeenLastCalledWith(expect.objectContaining({
      actor: { type: 'admin_job', id: 'project-storage-bootstrap' },
      correlationId: 'req-reconcile-retry-namespace',
    }));
  });

  it('preflights retryable project storage state by advancing it with the requesting user actor', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>()
      .mockRejectedValueOnce(new AfscpClientError({
        status: 503,
        code: 'unavailable',
        message: 'unavailable',
        retryable: true,
        correlation_id: 'corr-afscp',
      }))
      .mockImplementationOnce(async (input) => createOperationEnvelope('op_namespace_preflight_retry_ready', input.namespaceId, 'succeeded'));
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_preflight_retry_ready', input.namespaceId, 'completed'),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_preflight_retry',
      actorUserId: 'user_creator',
      requestId: 'req-create-preflight-retry',
    });

    await expect(service.ensureProjectStorageReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_preflight_retry',
      actorUserId: 'user_reader',
      requestId: 'req-preflight-retry',
    })).resolves.toMatchObject({
      status: 'ready',
      stage: 'ready',
      nextAction: 'none',
      retryable: false,
      lastErrorCode: null,
    });
    expect(upsertNamespace).toHaveBeenLastCalledWith(expect.objectContaining({
      actor: { type: 'user', id: 'user_reader' },
      correlationId: 'req-preflight-retry',
    }));
  });

  it('preflights stale pending operation ids by polling and advancing them', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_preflight_pending', input.namespaceId, 'queued'),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_preflight_polled_ready', input.namespaceId, 'completed'),
    );
    const getOperation = vi.fn<ProjectStorageBootstrapAfscpClient['getOperation']>(
      async (input) => createOperationEnvelope(input.operationId, 'ns_reconciled', 'succeeded'),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_preflight_pending',
      actorUserId: 'user_creator',
      requestId: 'req-create-preflight-pending',
    });

    await expect(service.ensureProjectStorageReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_preflight_pending',
      actorUserId: 'user_reader',
      requestId: 'req-preflight-pending',
    })).resolves.toMatchObject({
      status: 'ready',
      stage: 'ready',
      nextAction: 'none',
      retryable: false,
      lastErrorCode: null,
    });
    expect(getOperation).toHaveBeenCalledWith({
      operationId: 'op_namespace_preflight_pending',
      correlationId: 'req-preflight-pending',
      signal: undefined,
    });
    expect(putNamespaceVolumeBinding).toHaveBeenLastCalledWith(expect.objectContaining({
      actor: { type: 'user', id: 'user_reader' },
      correlationId: 'req-preflight-pending',
    }));
  });

  it('preflights still-pending project storage as product state without storage identity', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_preflight_wait', input.namespaceId, 'queued'),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>();
    const getOperation = vi.fn<ProjectStorageBootstrapAfscpClient['getOperation']>(
      async (input) => createOperationEnvelope(input.operationId, 'ns_reconciled', 'running'),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_preflight_wait',
      actorUserId: 'user_creator',
      requestId: 'req-create-preflight-wait',
    });

    const result = await service.ensureProjectStorageReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_preflight_wait',
      actorUserId: 'user_reader',
      requestId: 'req-preflight-wait',
    });

    expect(result).toEqual({
      status: 'pending',
      stage: 'namespace_upsert',
      generation: expect.any(Number),
      nextAction: 'wait',
      retryable: false,
      lastErrorCode: null,
    });
    expectNoStorageIdentity(result);
    expect(putNamespaceVolumeBinding).not.toHaveBeenCalled();
  });

  it('keeps project storage generation stable across ordinary pending and ready state advances', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async (input) => createOperationEnvelope('op_namespace_generation', input.namespaceId, 'queued'),
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>(
      async (input) => createOperationEnvelope('op_binding_generation', input.namespaceId, 'completed'),
    );
    const getOperation = vi.fn<ProjectStorageBootstrapAfscpClient['getOperation']>(
      async (input) => createOperationEnvelope(input.operationId, 'ns_reconciled', 'succeeded'),
    );
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_generation',
      actorUserId: 'user_creator',
      requestId: 'req-generation-create',
    });
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_generation',
    })).resolves.toMatchObject({
      status: 'pending',
      generation: 1,
    });

    await service.ensureProjectStorageReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_generation',
      actorUserId: 'user_reader',
      requestId: 'req-generation-preflight',
    });
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_generation',
    })).resolves.toMatchObject({
      status: 'ready',
      generation: 1,
    });

    await service.reconcileProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_generation',
      requestId: 'req-generation-reconcile',
    });
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_generation',
    })).resolves.toMatchObject({
      status: 'ready',
      generation: 1,
    });
  });

  it('preflights blocked project storage as a typed admin repair state without retrying AFSCP', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const upsertNamespace = vi.fn<ProjectStorageBootstrapAfscpClient['upsertNamespace']>(
      async () => {
        throw new AfscpClientError({
          status: 409,
          code: 'conflict',
          message: 'conflict',
          retryable: false,
          correlation_id: 'corr-afscp',
          operation_id: 'op_namespace_blocked',
        });
      },
    );
    const putNamespaceVolumeBinding = vi.fn<ProjectStorageBootstrapAfscpClient['putNamespaceVolumeBinding']>();
    const service = new ProjectStorageBootstrapService({
      namespaceStore,
      resourceOwnershipStore,
      client: { upsertNamespace, putNamespaceVolumeBinding, getOperation: vi.fn() },
      defaultVolumeId: 'vol_default',
      productCallerService: 'agentsmith-api',
      correlationIdFactory: () => 'corr-generated',
    });

    await service.bootstrapProjectStorage({
      workspaceId: 'ws_alpha',
      projectId: 'proj_preflight_blocked',
      actorUserId: 'user_creator',
      requestId: 'req-create-preflight-blocked',
    });
    upsertNamespace.mockClear();

    const result = await service.ensureProjectStorageReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_preflight_blocked',
      actorUserId: 'user_reader',
      requestId: 'req-preflight-blocked',
    });
    expect(result).toEqual({
      status: 'blocked',
      stage: 'namespace_upsert',
      generation: expect.any(Number),
      nextAction: 'admin_repair',
      retryable: false,
      lastErrorCode: 'conflict',
    });
    expectNoStorageIdentity(result);
    expect(upsertNamespace).not.toHaveBeenCalled();
    expect(putNamespaceVolumeBinding).not.toHaveBeenCalled();
  });
});
