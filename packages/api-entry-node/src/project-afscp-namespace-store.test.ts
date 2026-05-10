import { createHash } from 'node:crypto';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { describe, expect, it } from 'vitest';
import { sanitizeAfscpNamespaceId } from './afscp-validation.js';
import {
  deriveProjectAfscpNamespaceId,
  PROJECT_AFSCP_NAMESPACE_COLLECTION,
  type ProjectAfscpNamespaceMapping,
  ProjectAfscpResourceOwnershipConflictError,
  ProjectAfscpNamespaceStore,
  ProjectAfscpResourceOwnershipStore,
} from './project-afscp-namespace-store.js';

const AFSCP_NAMESPACE_ID_PATTERN = /^ns_[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/;

function createStore(now = '2026-05-09T00:00:00.000Z'): ProjectAfscpNamespaceStore {
  return new ProjectAfscpNamespaceStore(new InMemoryJsonDocStore(), () => now);
}

function deriveLegacyBase64urlNamespaceId(input: { workspaceId: string; projectId: string }): string {
  const digest = createHash('sha256')
    .update(input.workspaceId)
    .update('\0')
    .update(input.projectId)
    .digest('base64url')
    .slice(0, 40);
  return `ns_${digest}`;
}

describe('ProjectAfscpNamespaceStore', () => {
  it('derives namespace ids that always satisfy AFSCP namespace validation', () => {
    const workspaceIds = ['ws_alpha', 'ws_default', 'ws-prod-001', '工作区-alpha'];
    const projectIds = ['proj_75', 'proj_15', 'proj_file_library', 'project.storage:2026', '项目-files'];
    const generations = [1, 2, 3, 7, 42];
    const cases = workspaceIds.flatMap((workspaceId) => projectIds.flatMap((projectId) => (
      generations.map((generation) => ({ workspaceId, projectId, generation }))
    )));
    const legacyHyphen = { workspaceId: 'ws_alpha', projectId: 'proj_75' };
    const legacyUnderscore = { workspaceId: 'ws_alpha', projectId: 'proj_15' };

    expect(deriveLegacyBase64urlNamespaceId(legacyHyphen)).toMatch(/^ns_-/);
    expect(sanitizeAfscpNamespaceId(deriveLegacyBase64urlNamespaceId(legacyHyphen))).toBeUndefined();
    expect(deriveLegacyBase64urlNamespaceId(legacyUnderscore)).toMatch(/^ns__/);
    expect(sanitizeAfscpNamespaceId(deriveLegacyBase64urlNamespaceId(legacyUnderscore))).toBeUndefined();

    for (const input of cases) {
      const namespaceId = deriveProjectAfscpNamespaceId(input);
      expect(namespaceId, `${input.workspaceId}/${input.projectId}/${input.generation}`).toMatch(AFSCP_NAMESPACE_ID_PATTERN);
      expect(sanitizeAfscpNamespaceId(namespaceId)).toBe(namespaceId);
      expect(namespaceId).not.toContain(input.workspaceId);
      expect(namespaceId).not.toContain(input.projectId);
    }
  });

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

    expect(first.namespace_id).toMatch(AFSCP_NAMESPACE_ID_PATTERN);
    expect(sanitizeAfscpNamespaceId(first.namespace_id)).toBe(first.namespace_id);
    expect(second.namespace_id).toBe(first.namespace_id);
    expect(second.workspace_id).toBe('ws_alpha');
    expect(second.project_id).toBe('proj_same');
    expect(second.status).toBe('pending');
    expect(second.namespace_id).not.toContain('ws_alpha');
    expect(second.namespace_id).not.toContain('proj_same');
  });

  it('regenerates a blocked invalid namespace mapping when no upstream operation was created', async () => {
    const docStore = new InMemoryJsonDocStore();
    const store = new ProjectAfscpNamespaceStore(docStore, () => '2026-05-09T01:00:00.000Z');
    const key = { workspaceId: 'ws_alpha', projectId: 'proj_75' };
    const blocked: ProjectAfscpNamespaceMapping = {
      id: 'ws_alpha:proj_75',
      workspace_id: key.workspaceId,
      project_id: key.projectId,
      namespace_id: deriveLegacyBase64urlNamespaceId(key),
      status: 'blocked',
      stage: 'namespace_upsert',
      generation: 1,
      next_action: 'admin_repair',
      retryable: false,
      namespace_upsert_operation_id: null,
      volume_binding_operation_id: null,
      last_error_code: 'afscp_error',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
    };
    expect(blocked.namespace_id).toMatch(/^ns_-/);
    await docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, blocked.id, blocked);

    const repaired = await store.ensureProjectNamespace(key);

    expect(repaired).toMatchObject({
      id: blocked.id,
      workspace_id: key.workspaceId,
      project_id: key.projectId,
      status: 'pending',
      stage: 'namespace_upsert',
      generation: 2,
      next_action: 'retry_now',
      retryable: false,
      namespace_upsert_operation_id: null,
      volume_binding_operation_id: null,
      last_error_code: null,
      created_at: blocked.created_at,
      updated_at: '2026-05-09T01:00:00.000Z',
    });
    expect(repaired.namespace_id).toBe(deriveProjectAfscpNamespaceId(key));
    expect(repaired.namespace_id).toMatch(AFSCP_NAMESPACE_ID_PATTERN);
    expect(sanitizeAfscpNamespaceId(repaired.namespace_id)).toBe(repaired.namespace_id);
  });

  it('keeps invalid blocked namespace mappings blocked once an upstream operation is recorded', async () => {
    const docStore = new InMemoryJsonDocStore();
    const store = new ProjectAfscpNamespaceStore(docStore, () => '2026-05-09T01:00:00.000Z');
    const key = { workspaceId: 'ws_alpha', projectId: 'proj_75' };
    const blocked: ProjectAfscpNamespaceMapping = {
      id: 'ws_alpha:proj_75',
      workspace_id: key.workspaceId,
      project_id: key.projectId,
      namespace_id: deriveLegacyBase64urlNamespaceId(key),
      status: 'blocked',
      stage: 'namespace_upsert',
      generation: 1,
      next_action: 'admin_repair',
      retryable: false,
      namespace_upsert_operation_id: 'op_namespace_recorded',
      volume_binding_operation_id: null,
      last_error_code: 'conflict',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
    };
    await docStore.upsert(PROJECT_AFSCP_NAMESPACE_COLLECTION, blocked.id, blocked);

    await expect(store.ensureProjectNamespace(key)).resolves.toEqual(blocked);
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
