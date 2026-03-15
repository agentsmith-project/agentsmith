export function createWorkspacePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Alpha Workspace',
    workspace_admin_user_id: 'kc-alpha-admin',
    idp_url: 'https://login.example.com',
    idp_realm: 'alpha',
    idp_client_id: 'alpha-client',
    ...overrides,
  };
}
