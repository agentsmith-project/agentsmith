import { afterEach, describe, expect, it, vi } from 'vitest';

import { searchKeycloakDirectoryUsers } from './keycloak-user-directory.js';

const originalKeycloakAdmin = process.env.KEYCLOAK_ADMIN;
const originalKeycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
const originalKeycloakAdminClientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID;

afterEach(() => {
  if (originalKeycloakAdmin === undefined) {
    delete process.env.KEYCLOAK_ADMIN;
  } else {
    process.env.KEYCLOAK_ADMIN = originalKeycloakAdmin;
  }
  if (originalKeycloakAdminPassword === undefined) {
    delete process.env.KEYCLOAK_ADMIN_PASSWORD;
  } else {
    process.env.KEYCLOAK_ADMIN_PASSWORD = originalKeycloakAdminPassword;
  }
  if (originalKeycloakAdminClientId === undefined) {
    delete process.env.KEYCLOAK_ADMIN_CLIENT_ID;
  } else {
    process.env.KEYCLOAK_ADMIN_CLIENT_ID = originalKeycloakAdminClientId;
  }
  vi.unstubAllGlobals();
});

describe('keycloak user directory', () => {
  it('fails closed instead of falling back to admin/admin when admin credentials are missing', async () => {
    delete process.env.KEYCLOAK_ADMIN;
    delete process.env.KEYCLOAK_ADMIN_PASSWORD;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchKeycloakDirectoryUsers({
      url: 'http://keycloak:8080',
      realm: 'agentsmith',
      query: 'user@example.com',
    })).rejects.toThrow(/KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD must be configured/u);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses explicit admin credentials and the admin-cli client id by default', async () => {
    process.env.KEYCLOAK_ADMIN = 'agentsmith-admin';
    process.env.KEYCLOAK_ADMIN_PASSWORD = 'admin-secret';
    delete process.env.KEYCLOAK_ADMIN_CLIENT_ID;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await searchKeycloakDirectoryUsers({
      url: 'http://keycloak:8080',
      realm: 'agentsmith',
      query: 'user@example.com',
    });

    const body = String(asRecord(fetchMock.mock.calls[0]?.[1]).body);
    expect(body).toContain('client_id=admin-cli');
    expect(body).toContain('username=agentsmith-admin');
    expect(body).toContain('password=admin-secret');
  });
});

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
