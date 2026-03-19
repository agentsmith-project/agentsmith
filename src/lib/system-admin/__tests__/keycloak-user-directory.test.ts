import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveKeycloakUserById,
  searchKeycloakUsers,
  verifyKeycloakIdentityProvider,
} from '../keycloak-user-directory';

describe('searchKeycloakUsers', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NEXT_PUBLIC_USE_MSW: 'false' };
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('returns mock directory users in mock lane without calling fetch', async () => {
    process.env.NEXT_PUBLIC_USE_MSW = 'true';

    const items = await searchKeycloakUsers({
      idpUrl: 'http://localhost:18080',
      realm: 'mbos',
      clientId: 'agentsmith',
      clientSecret: 'secret-1',
      query: 'dev-admin',
    });

    expect(items).toEqual([
      {
        user_id: 'kc-dev-admin',
        email: 'dev-admin@example.com',
        name: 'Dev Admin',
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers exact email lookup for email queries', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            id: 'kc-dev-admin',
            email: 'dev-admin@example.com',
            firstName: 'Dev',
            lastName: 'Admin',
            username: 'dev-admin',
          },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const items = await searchKeycloakUsers({
      idpUrl: 'http://localhost:18080',
      realm: 'mbos',
      clientId: 'agentsmith',
      clientSecret: 'secret-1',
      query: 'dev-admin@example.com',
    });

    expect(items).toEqual([
      {
        user_id: 'kc-dev-admin',
        email: 'dev-admin@example.com',
        name: 'Dev Admin',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/realms/mbos/protocol/openid-connect/token');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('email=dev-admin%40example.com');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('exact=true');
  });

  it('falls back to generic search when exact email lookup returns no results', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token-123' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            id: 'kc-dev-admin',
            email: 'dev-admin@example.com',
            username: 'dev-admin',
          },
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const items = await searchKeycloakUsers({
      idpUrl: 'http://localhost:18080',
      realm: 'mbos',
      clientId: 'agentsmith',
      clientSecret: 'secret-1',
      query: 'dev-admin@example.com',
    });

    expect(items).toEqual([
      {
        user_id: 'kc-dev-admin',
        email: 'dev-admin@example.com',
        name: 'dev-admin',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('search=dev-admin%40example.com');
  });
});

describe('resolveKeycloakUserById', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns mock users in mock lane', async () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_USE_MSW: 'true' };

    await expect(resolveKeycloakUserById({
      idpUrl: 'http://localhost:18080',
      realm: 'mbos',
      clientId: 'agentsmith',
      clientSecret: 'secret-1',
      userId: 'kc-integration-user',
    })).resolves.toEqual({
      user_id: 'kc-integration-user',
      email: 'integration-user@example.com',
      name: 'Integration User',
    });
  });
});

describe('verifyKeycloakIdentityProvider', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NEXT_PUBLIC_USE_MSW: 'false' };
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('reports directory search support when client can query users', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await expect(verifyKeycloakIdentityProvider({
      idpUrl: 'http://localhost:18080',
      realm: 'mbos',
      clientId: 'agentsmith',
      clientSecret: 'secret-1',
    })).resolves.toEqual({
      idp_ok: true,
      directory_search_supported: true,
    });
  });

  it('returns recommendation when client token works but directory query is forbidden', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    await expect(verifyKeycloakIdentityProvider({
      idpUrl: 'http://localhost:18080',
      realm: 'mbos',
      clientId: 'agentsmith',
      clientSecret: 'secret-1',
    })).resolves.toEqual({
      idp_ok: true,
      directory_search_supported: false,
      advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
    });
  });
});
