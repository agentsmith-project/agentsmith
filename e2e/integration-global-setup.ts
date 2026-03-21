function buildDefaultWorkspaceRecord() {
  const now = new Date().toISOString();
  return {
    id: 'ws_default',
    name: 'Default Workspace',
    provisioning_status: 'ready',
    workspace_admin: 'dev-admin@example.com',
    workspace_admin_user_id: 'dev-admin',
    workspace_admin_name: 'Dev Admin',
    project_creators: [
      { user_id: 'dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
      { user_id: 'integration-user', email: 'integration-user@example.com', name: 'Integration User' },
    ],
    idp: {
      kind: 'keycloak',
      url: process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080',
      realm: process.env.KEYCLOAK_REALM ?? 'mbos',
      client_id: process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith',
    },
    tenant: {
      workspace_id: 'ws_default',
      workspace_name: 'Default Workspace',
      substrate_label: 'default',
      database_name: 'agentsmith_ws_default',
      collection_prefix: 'ws_default_',
      key_prefix: 'ws_default:',
    },
    last_initialized_at: now,
    last_init_error: null,
    created_at: now,
    updated_at: now,
  };
}

async function seedPersistedWorkspaces(): Promise<void> {
  const baseUrl = process.env.BASE_URL?.trim() || 'http://localhost:3001';
  const response = await fetch(`${baseUrl}/api/test/system/workspaces/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ records: [buildDefaultWorkspaceRecord()] }),
  }).catch(() => null);
  if (!response?.ok) {
    const status = response?.status ?? 'n/a';
    throw new Error(
      `failed_to_seed_system_workspaces status=${status}; ensure the running web server enables AGENTSMITH_ENABLE_TEST_ROUTES`,
    );
  }
}

async function verifyPreseededWorkspaces(): Promise<void> {
  const baseUrl = process.env.BASE_URL?.trim() || 'http://localhost:3001';
  const response = await fetch(`${baseUrl}/api/public/workspaces`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  }).catch(() => null);
  if (!response?.ok) {
    const status = response?.status ?? 'n/a';
    throw new Error(`failed_to_read_public_workspaces status=${status}`);
  }
  const payload = (await response.json()) as {
    items?: Array<{ id?: string; provisioning_status?: string }>;
  };
  const hasDefaultWorkspace = payload.items?.some((item) => item.id === 'ws_default');
  if (!hasDefaultWorkspace) {
    throw new Error('preseeded_workspace_missing:ws_default');
  }
}

export default async function globalSetup(): Promise<void> {
  if (process.env.INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES?.trim() === 'true') {
    await verifyPreseededWorkspaces();
    return;
  }
  await seedPersistedWorkspaces();
}
