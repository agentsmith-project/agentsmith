import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchKeycloakUsers } from '../keycloak-user-directory';

describe('searchKeycloakUsers', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
