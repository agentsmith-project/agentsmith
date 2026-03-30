import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionModule = vi.hoisted(() => ({
  isSystemAdminAuthenticated: vi.fn(),
}));

const keycloakDirectoryModule = vi.hoisted(() => ({
  verifyKeycloakIdentityProvider: vi.fn(),
  verifyKeycloakLoginIdentityProvider: vi.fn(),
}));

vi.mock('@/lib/system-admin/session', () => sessionModule);
vi.mock('@/lib/system-admin/keycloak-user-directory', () => keycloakDirectoryModule);

import { POST } from '../route';

describe('/api/system/workspaces/idp/verify', () => {
  beforeEach(() => {
    sessionModule.isSystemAdminAuthenticated.mockReset();
    keycloakDirectoryModule.verifyKeycloakIdentityProvider.mockReset();
    keycloakDirectoryModule.verifyKeycloakLoginIdentityProvider.mockReset();
  });

  it('returns verification result for authenticated system admin', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    keycloakDirectoryModule.verifyKeycloakLoginIdentityProvider.mockResolvedValue(undefined);
    keycloakDirectoryModule.verifyKeycloakIdentityProvider.mockResolvedValue({
      idp_ok: true,
      directory_search_supported: false,
      advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
    });

    const response = await POST(
      new Request('http://localhost/api/system/workspaces/idp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idp_url: 'https://login.example.com',
          idp_realm: 'alpha',
          idp_client_id: 'alpha-client',
          idp_client_secret: 'secret-1',
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      idp_ok: true,
      directory_search_supported: false,
      advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
    });
  });

  it('allows verification without client secret', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    keycloakDirectoryModule.verifyKeycloakLoginIdentityProvider.mockResolvedValue(undefined);
    keycloakDirectoryModule.verifyKeycloakIdentityProvider.mockResolvedValue({
      idp_ok: true,
      directory_search_supported: false,
      advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
    });

    const response = await POST(
      new Request('http://localhost/api/system/workspaces/idp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idp_url: 'https://login.example.com',
          idp_realm: 'alpha',
          idp_client_id: 'alpha-client',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(keycloakDirectoryModule.verifyKeycloakIdentityProvider).toHaveBeenCalledWith({
      idpUrl: 'https://login.example.com',
      realm: 'alpha',
      clientId: 'alpha-client',
      clientSecret: undefined,
    });
  });
});
