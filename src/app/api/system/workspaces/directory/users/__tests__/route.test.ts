import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionModule = vi.hoisted(() => ({
  isSystemAdminAuthenticated: vi.fn(),
}));

const directoryModule = vi.hoisted(() => ({
  searchKeycloakUsers: vi.fn(),
}));

vi.mock('@/lib/system-admin/session', () => sessionModule);
vi.mock('@/lib/system-admin/keycloak-user-directory', () => directoryModule);

import { POST } from '../route';

describe('/api/system/workspaces/directory/users', () => {
  beforeEach(() => {
    sessionModule.isSystemAdminAuthenticated.mockReset();
    directoryModule.searchKeycloakUsers.mockReset();
  });

  it('returns 401 when system admin session is missing', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(false);

    const response = await POST(
      new Request('http://localhost/api/system/workspaces/directory/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idp_url: 'https://login.example.com/realms', idp_realm: 'alpha', query: 'admin' }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it('searches directory users for authenticated system admins', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    directoryModule.searchKeycloakUsers.mockResolvedValue([
      { user_id: 'kc-alpha-admin', email: 'alpha-admin@example.com', name: 'Alpha Admin' },
    ]);

    const response = await POST(
      new Request('http://localhost/api/system/workspaces/directory/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idp_url: 'https://login.example.com/realms', idp_realm: 'alpha', query: 'alpha' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(directoryModule.searchKeycloakUsers).toHaveBeenCalledWith({
      idpUrl: 'https://login.example.com/realms',
      realm: 'alpha',
      query: 'alpha',
    });
    await expect(response.json()).resolves.toEqual({
      items: [{ user_id: 'kc-alpha-admin', email: 'alpha-admin@example.com', name: 'Alpha Admin' }],
      total: 1,
    });
  });
});
