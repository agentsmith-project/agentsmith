import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { describe, expect, it } from 'vitest';
import {
  ProjectAfscpResourceOwnershipConflictError,
  ProjectAfscpNamespaceStore,
  ProjectAfscpResourceOwnershipStore,
} from './project-afscp-namespace-store.js';

function createStore(now = '2026-05-09T00:00:00.000Z'): ProjectAfscpNamespaceStore {
  return new ProjectAfscpNamespaceStore(new InMemoryJsonDocStore(), () => now);
}

describe('ProjectAfscpNamespaceStore', () => {
  it('keeps namespace ids stable across repeated ensure calls and project rename-irrelevant inputs', async () => {
    const store = createStore();

    const first = await store.ensureProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_same',
    });
    const second = await store.ensureProjectNamespace({
      workspaceId: 'ws_alpha',
      projectId: 'proj_same',
    });

    expect(first.namespace_id).toMatch(/^ns_[A-Za-z0-9_-]{20,}$/);
    expect(second.namespace_id).toBe(first.namespace_id);
    expect(second.workspace_id).toBe('ws_alpha');
    expect(second.project_id).toBe('proj_same');
    expect(second.status).toBe('pending');
    expect(second.namespace_id).not.toContain('ws_alpha');
    expect(second.namespace_id).not.toContain('proj_same');
  });

  it('keeps project storage generation stable while tracking next action, status, operation ids, and last error code', async () => {
    const store = createStore();
    const key = { workspaceId: 'ws_alpha', projectId: 'proj_ops' };

    const pending = await store.ensureProjectNamespace(key);
    expect(pending).toMatchObject({
      status: 'pending',
      stage: 'namespace_upsert',
      generation: 1,
      next_action: 'retry_now',
      retryable: false,
      namespace_upsert_operation_id: null,
      volume_binding_operation_id: null,
      last_error_code: null,
    });

    await store.markProjectNamespaceReady({
      ...key,
      namespaceUpsertOperationId: 'op_namespace_1',
      volumeBindingOperationId: 'op_binding_1',
    });
    await expect(store.getProjectNamespace(key)).resolves.toMatchObject({
      status: 'ready',
      stage: 'ready',
      generation: 1,
      next_action: 'none',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_1',
      volume_binding_operation_id: 'op_binding_1',
      last_error_code: null,
    });

    await store.markProjectNamespacePending({
      ...key,
      stage: 'volume_binding',
      retryable: true,
      lastErrorCode: 'unavailable',
      namespaceUpsertOperationId: 'op_namespace_pending',
      volumeBindingOperationId: 'op_binding_pending',
    });
    await expect(store.getProjectNamespace(key)).resolves.toMatchObject({
      status: 'pending',
      stage: 'volume_binding',
      generation: 1,
      next_action: 'retry_now',
      retryable: true,
      namespace_upsert_operation_id: 'op_namespace_pending',
      volume_binding_operation_id: 'op_binding_pending',
      last_error_code: 'unavailable',
    });

    await store.markProjectNamespaceBlocked({
      ...key,
      namespaceUpsertOperationId: 'op_namespace_2',
      volumeBindingOperationId: 'op_binding_2',
      lastErrorCode: 'unavailable',
    });
    await expect(store.getProjectNamespace(key)).resolves.toMatchObject({
      status: 'blocked',
      stage: 'volume_binding',
      generation: 1,
      next_action: 'admin_repair',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_2',
      volume_binding_operation_id: 'op_binding_2',
      last_error_code: 'unavailable',
    });
  });

  it('stores generic AFSCP resource ownership without exposing raw resource ids in document ids', async () => {
    const docStore = new InMemoryJsonDocStore();
    const store = new ProjectAfscpResourceOwnershipStore(docStore, () => '2026-05-09T00:00:00.000Z');

    const mapping = await store.ensureResourceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_ops',
      resourceKind: 'save_point',
      resourceId: 'sp_secret_payload',
      namespaceId: 'ns_project',
    });
    const repeated = await store.ensureResourceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_ops',
      resourceKind: 'save_point',
      resourceId: 'sp_secret_payload',
      namespaceId: 'ns_project',
    });

    expect(mapping).toMatchObject({
      workspace_id: 'ws_alpha',
      project_id: 'proj_ops',
      resource_kind: 'save_point',
      resource_id: 'sp_secret_payload',
      namespace_id: 'ns_project',
    });
    expect(mapping.id).not.toContain('sp_secret_payload');
    expect(repeated).toEqual(mapping);
    await expect(store.getResourceOwnership({
      resourceKind: 'save_point',
      resourceId: 'sp_secret_payload',
    })).resolves.toEqual(mapping);
  });

  it('throws a typed conflict when the same AFSCP resource is bound to another owner', async () => {
    const docStore = new InMemoryJsonDocStore();
    const store = new ProjectAfscpResourceOwnershipStore(docStore, () => '2026-05-09T00:00:00.000Z');

    await store.ensureResourceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_ops',
      resourceKind: 'save_point',
      resourceId: 'sp_secret_payload',
      namespaceId: 'ns_project',
    });

    await expect(store.ensureResourceOwnership({
      workspaceId: 'ws_other',
      projectId: 'proj_other',
      resourceKind: 'save_point',
      resourceId: 'sp_secret_payload',
      namespaceId: 'ns_other',
    })).rejects.toMatchObject({
      name: 'ProjectAfscpResourceOwnershipConflictError',
      code: 'PROJECT_AFSCP_RESOURCE_OWNERSHIP_CONFLICT',
      resource_kind: 'save_point',
    });

    await expect(store.ensureResourceOwnership({
      workspaceId: 'ws_alpha',
      projectId: 'proj_ops',
      resourceKind: 'save_point',
      resourceId: 'sp_secret_payload',
      namespaceId: 'ns_other',
    })).rejects.toBeInstanceOf(ProjectAfscpResourceOwnershipConflictError);
  });
});
