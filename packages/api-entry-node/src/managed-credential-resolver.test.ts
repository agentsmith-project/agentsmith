import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { putContextEntry } from './context-store.js';
import { createUserExternalConnection } from './user-external-connections-store.js';
import { upsertProjectMembershipRecord } from './project-member-governance-persistence.js';
import {
  resolveManagedCredentialConnection,
  syncManagedCredentialBinding,
} from './managed-credential-resolver.js';

describe('managed credential resolver', () => {
  it('prefers project-member bindings over member defaults and workspace active connections', async () => {
    const docStore = new InMemoryJsonDocStore();
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'workspace active',
      status: 'active',
      fields: [{ key: 'access_token', value: 'workspace_active_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    const memberBoundConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'member default',
      status: 'active',
      fields: [{ key: 'access_token', value: 'member_default_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    const projectBoundConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'project override',
      status: 'reauth_required',
      fields: [{ key: 'access_token', value: 'project_override_token', secret: true }],
      scopes: ['search:docs:read'],
      reauth_reason: 'missing_scopes',
    });
    await upsertProjectMembershipRecord(docStore, 'ws_default', 'proj_1', {
      project_id: 'proj_1',
      user_id: 'user_1',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    await syncManagedCredentialBinding({
      docStore,
      userId: 'user_1',
      workspaceId: 'ws_default',
      provider: 'feishu',
      connectionId: memberBoundConnection.id,
      updatedBy: 'user_1',
      scope: 'member',
    });
    await putContextEntry(docStore, {
      scope: 'project_member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: projectBoundConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      updated_by: 'user_1',
    });

    const resolved = await resolveManagedCredentialConnection({
      docStore,
      userId: 'user_1',
      provider: 'feishu',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    expect(resolved?.connection.id).toBe(projectBoundConnection.id);
    expect(resolved?.source).toBe('project_member_binding');
  });

  it('falls back to member defaults when project-member bindings are missing', async () => {
    const docStore = new InMemoryJsonDocStore();
    const memberBoundConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'member default',
      status: 'active',
      fields: [{ key: 'access_token', value: 'member_default_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'workspace active',
      status: 'active',
      fields: [{ key: 'access_token', value: 'workspace_active_token', secret: true }],
      scopes: ['search:docs:read'],
    });

    await syncManagedCredentialBinding({
      docStore,
      userId: 'user_1',
      workspaceId: 'ws_default',
      provider: 'feishu',
      connectionId: memberBoundConnection.id,
      updatedBy: 'user_1',
      scope: 'member',
    });

    const resolved = await resolveManagedCredentialConnection({
      docStore,
      userId: 'user_1',
      provider: 'feishu',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    expect(resolved?.connection.id).toBe(memberBoundConnection.id);
    expect(resolved?.source).toBe('member_binding');
  });

  it('falls back to the current workspace active connection when no bindings exist', async () => {
    const docStore = new InMemoryJsonDocStore();
    const activeConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'workspace active',
      status: 'active',
      fields: [{ key: 'access_token', value: 'workspace_active_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_other',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'other workspace active',
      status: 'active',
      fields: [{ key: 'access_token', value: 'other_workspace_token', secret: true }],
      scopes: ['search:docs:read'],
    });

    const resolved = await resolveManagedCredentialConnection({
      docStore,
      userId: 'user_1',
      provider: 'feishu',
      workspaceId: 'ws_default',
    });

    expect(resolved?.connection.id).toBe(activeConnection.id);
    expect(resolved?.source).toBe('workspace_active_connection');
  });

  it('does not cross workspaces when resolving workspace-scoped managed credentials', async () => {
    const docStore = new InMemoryJsonDocStore();
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_other',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'other workspace active',
      status: 'active',
      fields: [{ key: 'access_token', value: 'other_workspace_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: null,
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'global active',
      status: 'active',
      fields: [{ key: 'access_token', value: 'global_workspace_token', secret: true }],
      scopes: ['search:docs:read'],
    });

    const resolved = await resolveManagedCredentialConnection({
      docStore,
      userId: 'user_1',
      provider: 'feishu',
      workspaceId: 'ws_default',
    });

    expect(resolved).toBeNull();
  });

  it('does not resolve project-member bindings for non-active members', async () => {
    const docStore = new InMemoryJsonDocStore();
    const memberBoundConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'member default',
      status: 'active',
      fields: [{ key: 'access_token', value: 'member_default_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    const projectBoundConnection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'project binding',
      status: 'active',
      fields: [{ key: 'access_token', value: 'project_token', secret: true }],
      scopes: ['search:docs:read'],
    });
    await upsertProjectMembershipRecord(docStore, 'ws_default', 'proj_1', {
      project_id: 'proj_1',
      user_id: 'user_1',
      status: 'suspended',
      joined_at: new Date().toISOString(),
    });
    await syncManagedCredentialBinding({
      docStore,
      userId: 'user_1',
      workspaceId: 'ws_default',
      provider: 'feishu',
      connectionId: memberBoundConnection.id,
      updatedBy: 'user_1',
      scope: 'member',
    });
    await putContextEntry(docStore, {
      scope: 'project_member',
      key: 'managed_credential_bindings.feishu',
      content: JSON.stringify({
        provider: 'feishu',
        connection_id: projectBoundConnection.id,
      }),
      content_type: 'json',
      user_id: 'user_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      updated_by: 'user_1',
    });

    const resolved = await resolveManagedCredentialConnection({
      docStore,
      userId: 'user_1',
      provider: 'feishu',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });

    expect(resolved?.connection.id).toBe(memberBoundConnection.id);
    expect(resolved?.source).toBe('member_binding');
  });
});
