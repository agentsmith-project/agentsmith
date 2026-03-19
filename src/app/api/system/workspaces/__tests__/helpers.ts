export function createWorkspacePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Alpha Workspace',
    workspace_admin_mode: 'directory_user',
    workspace_admin_user_id: 'kc-alpha-admin',
    workspace_admin_email: 'alpha-admin@example.com',
    login_idp_url: 'https://login.example.com',
    login_idp_realm: 'alpha',
    login_client_id: 'alpha-login-client',
    directory_client_id: 'alpha-directory-client',
    directory_client_secret: 'alpha-secret',
    ...overrides,
  };
}
