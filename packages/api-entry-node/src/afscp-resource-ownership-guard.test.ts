import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { describe, expect, it } from 'vitest';
import { AfscpResourceOwnershipGuard } from './afscp-resource-ownership-guard.js';
import {
  PROJECT_AFSCP_NAMESPACE_COLLECTION,
  ProjectAfscpNamespaceStore,
  ProjectAfscpResourceOwnershipStore,
  type ProjectAfscpOwnedResourceKind,
} from './project-afscp-namespace-store.js';

function createStores(): {
  docStore: InMemoryJsonDocStore;
  namespaceStore: ProjectAfscpNamespaceStore;
  resourceOwnershipStore: ProjectAfscpResourceOwnershipStore;
} {
  const docStore = new InMemoryJsonDocStore();
  const nowIso = () => '2026-05-09T00:00:00.000Z';
  return {
    docStore,
    namespaceStore: new ProjectAfscpNamespaceStore(docStore, nowIso),
    resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore, nowIso),
  };
}

describe('AfscpResourceOwnershipGuard', () => {
  it('returns the namespace for ready project storage', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const mapping = await namespaceStore.ensureProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
    });
    await namespaceStore.markProjectNamespaceReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
      namespaceUpsertOperationId: 'op_namespace_ready',
      volumeBindingOperationId: 'op_binding_ready',
    });
    const guard = new AfscpResourceOwnershipGuard(namespaceStore, resourceOwnershipStore);

    await expect(guard.verifyReadyNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
      namespaceId: mapping.namespace_id,
    })).resolves.toEqual({
      ok: true,
      namespaceId: mapping.namespace_id,
    });
  });

  it('fails closed for pending and failed project storage namespaces', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const pending = await namespaceStore.ensureProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_pending',
    });
    const failed = await namespaceStore.ensureProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_failed',
    });
    await namespaceStore.markProjectNamespaceBlocked({
      workspaceId: 'ws_alpha',
      projectId: 'proj_failed',
      namespaceUpsertOperationId: 'op_namespace_failed',
      volumeBindingOperationId: null,
      lastErrorCode: 'conflict',
    });
    const guard = new AfscpResourceOwnershipGuard(namespaceStore, resourceOwnershipStore);

    await expect(guard.verifyReadyNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_pending',
      namespaceId: pending.namespace_id,
    })).resolves.toEqual({
      ok: false,
      code: 'not_found',
      message: 'not_found',
    });
    await expect(guard.verifyNamespaceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_failed',
      namespaceId: failed.namespace_id,
    })).resolves.toEqual({
      ok: false,
      code: 'not_found',
      message: 'not_found',
    });

    await resourceOwnershipStore.ensureResourceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_pending',
      resourceKind: 'repo',
      resourceId: 'repo_pending_storage',
      namespaceId: pending.namespace_id,
    });
    await expect(guard.verifyResourceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_pending',
      resourceKind: 'repo',
      resourceId: 'repo_pending_storage',
    })).resolves.toEqual({
      ok: false,
      code: 'not_found',
      message: 'not_found',
    });
  });

  it('fails closed for records that claim ready but still require operator action', async () => {
    const { docStore, namespaceStore, resourceOwnershipStore } = createStores();
    const mapping = await namespaceStore.ensureProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_inconsistent',
    });
    await docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, mapping.id, {
      ...mapping,
      status: 'ready',
      stage: 'ready',
      generation: 2,
      next_action: 'admin_repair',
      updated_at: '2026-05-09T00:00:01.000Z',
    });
    const guard = new AfscpResourceOwnershipGuard(namespaceStore, resourceOwnershipStore);

    await expect(guard.verifyReadyNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_inconsistent',
      namespaceId: mapping.namespace_id,
    })).resolves.toEqual({
      ok: false,
      code: 'not_found',
      message: 'not_found',
    });
  });

  it('verifies all locally mapped AFSCP resource kinds without consulting AFSCP', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const current = await namespaceStore.ensureProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
    });
    await namespaceStore.markProjectNamespaceReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
      namespaceUpsertOperationId: 'op_namespace_ready',
      volumeBindingOperationId: 'op_binding_ready',
    });
    const guard = new AfscpResourceOwnershipGuard(namespaceStore, resourceOwnershipStore);
    const resourceKinds: ProjectAfscpOwnedResourceKind[] = [
      'namespace',
      'repo',
      'repo_template',
      'save_point',
      'export',
      'workload_mount_binding',
      'operation',
    ];

    for (const resourceKind of resourceKinds) {
      const resourceId = resourceKind === 'namespace' ? current.namespace_id : `${resourceKind}_owned_1`;
      if (resourceKind !== 'namespace') {
        await resourceOwnershipStore.ensureResourceOwnership({
          workspaceId: 'ws_alpha',
          projectId: 'proj_current',
          resourceKind,
          resourceId,
          namespaceId: current.namespace_id,
        });
      }

      await expect(guard.verifyResourceOwnership({
        workspaceId: 'ws_alpha',
        projectId: 'proj_current',
        resourceKind,
        resourceId,
      })).resolves.toEqual({
        ok: true,
        namespaceId: current.namespace_id,
      });
    }
  });

  it('returns non-leaking not_found for namespace mismatch and unmapped resources', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const current = await namespaceStore.ensureProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
    });
    await namespaceStore.markProjectNamespaceReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
      namespaceUpsertOperationId: 'op_namespace_current_ready',
      volumeBindingOperationId: 'op_binding_current_ready',
    });
    const other = await namespaceStore.ensureProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_other',
    });
    await namespaceStore.markProjectNamespaceReady({
      workspaceId: 'ws_alpha',
      projectId: 'proj_other',
      namespaceUpsertOperationId: 'op_namespace_other_ready',
      volumeBindingOperationId: 'op_binding_other_ready',
    });
    await resourceOwnershipStore.ensureResourceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_other',
      resourceKind: 'repo',
      resourceId: 'repo_hidden_elsewhere',
      namespaceId: other.namespace_id,
    });
    const guard = new AfscpResourceOwnershipGuard(namespaceStore, resourceOwnershipStore);

    await expect(guard.verifyNamespaceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
      namespaceId: other.namespace_id,
    })).resolves.toEqual({
      ok: false,
      code: 'not_found',
      message: 'not_found',
    });
    await expect(guard.verifyResourceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
      resourceKind: 'repo',
      resourceId: 'repo_hidden_elsewhere',
    })).resolves.toEqual({
      ok: false,
      code: 'not_found',
      message: 'not_found',
    });
    expect(JSON.stringify(current)).not.toContain('repo_hidden_elsewhere');
  });

  it('returns not_found for resource kinds AgentSmith does not own locally', async () => {
    const { namespaceStore, resourceOwnershipStore } = createStores();
    const guard = new AfscpResourceOwnershipGuard(namespaceStore, resourceOwnershipStore);

    await expect(guard.verifyResourceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_current',
      resourceKind: 'volume',
      resourceId: 'vol_shared',
    })).resolves.toEqual({
      ok: false,
      code: 'not_found',
      message: 'not_found',
    });
  });
});
