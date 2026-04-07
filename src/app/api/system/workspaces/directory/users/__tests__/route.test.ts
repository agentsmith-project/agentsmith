import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionModule = vi.hoisted(() => ({
  isSystemAdminAuthenticated: vi.fn(),
}));

const keycloakDirectoryModule = vi.hoisted(() => ({
  searchKeycloakUsers: vi.fn(),
}));

vi.mock('@/lib/system-admin/session', () => sessionModule);
vi.mock('@/lib/system-admin/keycloak-user-directory', () => keycloakDirectoryModule);

import { POST } from '../route';

describe('/api/system/workspaces/directory/users', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    sessionModule.isSystemAdminAuthenticated.mockReset();
    keycloakDirectoryModule.searchKeycloakUsers.mockReset();
  });

  it('returns mock directory users in mock lane', async () => {
    process.env.NEXT_PUBLIC_USE_MSW = 'true';
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);

    const response = await POST(
      new Request('http://localhost/api/system/workspaces/directory/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login_idp_url: 'https://login.example.com',
          login_idp_realm: 'mainline',
          login_client_id: 'agentsmith',
          directory_client_secret: 'secret-1',
          query: 'dev-admin',
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' }],
      total: 1,
    });
    expect(keycloakDirectoryModule.searchKeycloakUsers).not.toHaveBeenCalled();
  });
});
