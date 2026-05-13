import { afterEach, describe, expect, it, vi } from 'vitest';

import { searchKeycloakDirectoryUsers } from './keycloak-user-directory.js';

const originalPublicKeycloakBaseUrl = process.env.PUBLIC_KEYCLOAK_BASE_URL;
const originalInternalKeycloakBaseUrl = process.env.INTERNAL_KEYCLOAK_BASE_URL;

afterEach(() => {
  if (originalPublicKeycloakBaseUrl === undefined) {
    delete process.env.PUBLIC_KEYCLOAK_BASE_URL;
  } else {
    process.env.PUBLIC_KEYCLOAK_BASE_URL = originalPublicKeycloakBaseUrl;
  }
  if (originalInternalKeycloakBaseUrl === undefined) {
    delete process.env.INTERNAL_KEYCLOAK_BASE_URL;
  } else {
    process.env.INTERNAL_KEYCLOAK_BASE_URL = originalInternalKeycloakBaseUrl;
  }
  vi.unstubAllGlobals();
});

describe('keycloak user directory', () => {
  it('fails closed when workspace directory client credentials are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchKeycloakDirectoryUsers({
      url: 'http://keycloak:8080',
      realm: 'agentsmith',
      clientId: 'agentsmith-directory',
      query: 'user@example.com',
    })).rejects.toThrow(/workspace directory client credentials must be configured/u);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the workspace directory client credentials against the configured realm', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await searchKeycloakDirectoryUsers({
      url: 'http://keycloak:8080',
      realm: 'agentsmith',
      clientId: 'agentsmith-directory',
      clientSecret: 'directory-secret',
      query: 'user@example.com',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://keycloak:8080/realms/agentsmith/protocol/openid-connect/token');
    const body = String(asRecord(fetchMock.mock.calls[0]?.[1]).body);
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('client_id=agentsmith-directory');
    expect(body).toContain('client_secret=directory-secret');
  });

  it('uses the internal keycloak base when the workspace stores the public base', async () => {
    process.env.PUBLIC_KEYCLOAK_BASE_URL = 'http://public-keycloak.example';
    process.env.INTERNAL_KEYCLOAK_BASE_URL = 'http://keycloak:8080';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await searchKeycloakDirectoryUsers({
      url: 'http://public-keycloak.example',
      realm: 'agentsmith',
      clientId: 'agentsmith-directory',
      clientSecret: 'directory-secret',
      query: 'user',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://keycloak:8080/realms/agentsmith/protocol/openid-connect/token');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://keycloak:8080/admin/realms/agentsmith/users?search=user&max=10');
  });
});

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
