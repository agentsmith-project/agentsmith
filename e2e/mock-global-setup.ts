function buildDefaultWorkspaceRecord() {
  const now = new Date().toISOString();
  return {
    id: 'ws_default',
    name: 'Default Workspace',
    workspace_admin: 'test@example.com',
    workspace_admin_user_id: 'user_001',
    workspace_admin_name: 'Test User',
    project_creators: [
      { user_id: 'user_001', email: 'test@example.com', name: 'Test User' },
      { user_id: 'u_2', email: 'dev2@corp.com', name: 'Dev Two' },
    ],
    idp: {
      kind: 'keycloak',
      url: 'https://login.example.com',
      realm: 'mbos',
      client_id: 'agentsmith-web',
    },
    tenant: {
      workspace_id: 'ws_default',
      workspace_name: 'Default Workspace',
      substrate_label: 'default',
      database_name: 'agentsmith_ws_default',
      collection_prefix: 'ws_default_',
      key_prefix: 'ws_default:',
    },
    provisioning_status: 'ready',
    last_initialized_at: now,
    last_init_error: null,
    created_at: now,
    updated_at: now,
  };
}

async function waitForReady(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${baseUrl}/en-US/login`).catch(() => null);
    if (response && [200, 307, 308].includes(response.status)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`mock_global_setup_web_not_ready ${baseUrl}`);
}

export default async function globalSetup(): Promise<void> {
  const baseUrl = process.env.BASE_URL?.trim() || 'http://localhost:3001';
  await waitForReady(baseUrl);
  const response = await fetch(`${baseUrl}/api/test/system/workspaces/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ records: [buildDefaultWorkspaceRecord()] }),
  }).catch(() => null);
  if (!response?.ok) {
    const status = response?.status ?? 'n/a';
    throw new Error(`mock_global_setup_seed_failed status=${status}`);
  }
}
