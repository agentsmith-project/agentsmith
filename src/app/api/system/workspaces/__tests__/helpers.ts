export function createWorkspacePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Alpha Workspace',
    workspace_admin_mode: 'directory_user',
    workspace_admin_user_id: 'kc-alpha-admin',
    workspace_admin_email: 'alpha-admin@example.com',
    idp_url: 'https://login.example.com',
    idp_realm: 'alpha',
    idp_client_id: 'alpha-client',
    idp_client_secret: 'alpha-secret',
    ...overrides,
  };
}
