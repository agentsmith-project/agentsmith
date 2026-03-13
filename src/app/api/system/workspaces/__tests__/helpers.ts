export function createWorkspacePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Alpha Workspace',
    workspace_admin: 'alpha-admin@example.com',
    project_creators: ['creator@example.com'],
    idp_url: 'https://login.example.com',
    idp_realm: 'alpha',
    idp_client_id: 'alpha-client',
    ...overrides,
  };
}
