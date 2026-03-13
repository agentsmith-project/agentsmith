import type { PublicSystemWorkspaceRecord } from '@/lib/system-admin/workspace-registry';

type WorkspaceOverrides = Partial<PublicSystemWorkspaceRecord>;

export function makeWorkspace(overrides: WorkspaceOverrides = {}): PublicSystemWorkspaceRecord {
  const id = overrides.id ?? 'ws_alpha';
  const name = overrides.name ?? 'Alpha Workspace';
  const workspaceKey = id.replace(/^ws_/, '');

  return {
    id,
    name,
    provisioning_status: 'ready',
    last_initialized_at: '2026-03-10T01:00:00.000Z',
    last_init_error: null,
    workspace_admin: `${workspaceKey}-admin@example.com`,
    project_creators: [],
    idp: {
      kind: 'keycloak',
      url: `https://${workspaceKey}.example.com`,
      realm: workspaceKey,
      client_id: `${workspaceKey}-client`,
      has_client_secret: true,
    },
    tenant: {
      workspace_id: id,
      workspace_name: name,
      substrate_label: 'primary',
      database_name: `agentsmith_ws_${id}`,
      collection_prefix: `${id}_`,
      key_prefix: `${id}:`,
    },
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-10T00:00:00.000Z',
    ...overrides,
  };
}

export function mockWorkspaceListResponse(items: PublicSystemWorkspaceRecord[]) {
  return {
    ok: true,
    json: async () => ({ items }),
  };
}
