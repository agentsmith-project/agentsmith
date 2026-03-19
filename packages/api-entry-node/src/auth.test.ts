import type http from 'node:http';
import { InMemoryCache } from '@mbos/adapters-private';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractBearerToken, verifyBearerToken } from './auth.js';
import { issueSSETicket, resetSSETicketsForTest } from './sse-ticket-store.js';

function makeRequest(args: {
  url: string;
  authorization?: string;
}): http.IncomingMessage {
  return {
    url: args.url,
    headers: args.authorization ? { authorization: args.authorization } : {},
  } as http.IncomingMessage;
}

describe('auth', () => {
  const cache = new InMemoryCache();
  const issuedTickets: string[] = [];

  beforeEach(() => {
    process.env.KEYCLOAK_ISSUER_URL = 'http://issuer.test/realms/mbos';
  });

  afterEach(() => {
    return Promise.all([
      resetSSETicketsForTest(cache, issuedTickets.splice(0)),
      Promise.resolve().then(() => {
        vi.restoreAllMocks();
        delete process.env.KEYCLOAK_ISSUER_URL;
      }),
    ]);
  });

  it('extracts bearer token only from authorization header', () => {
    expect(extractBearerToken(makeRequest({
      url: '/api/v1/events?ticket=sse_123',
      authorization: 'Bearer jwt-token-123',
    }))).toBe('jwt-token-123');
    expect(extractBearerToken(makeRequest({
      url: '/api/v1/events?ticket=sse_123',
    }))).toBeNull();
  });

  it('accepts issued sse tickets on sse routes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        sub: 'user_test',
        email: 'test@example.com',
        name: 'Test User',
      }),
    } as Response);
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-123' });
    issuedTickets.push(issued.ticket);

    const user = await verifyBearerToken(makeRequest({
      url: `/api/v1/events?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });

    expect(user).toMatchObject({ id: 'user_test' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://issuer.test/realms/mbos/protocol/openid-connect/userinfo',
      expect.objectContaining({
        headers: { Authorization: 'Bearer jwt-token-123' },
      }),
    );
  });

  it('consumes single-use sse tickets after the first successful resolve', async () => {
    const bearerToken = 'jwt-token-single-use';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        sub: 'user_single_use',
        email: 'test@example.com',
        name: 'Test User',
      }),
    } as Response);
    const issued = await issueSSETicket(cache, { bearerToken });
    issuedTickets.push(issued.ticket);

    const first = await verifyBearerToken(makeRequest({
      url: `/api/v1/events?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });
    const second = await verifyBearerToken(makeRequest({
      url: `/api/v1/events?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });

    expect(first).toMatchObject({ id: 'user_single_use' });
    expect(second).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects query-token fallback', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        sub: 'user_test',
        email: 'test@example.com',
        name: 'Test User',
      }),
    } as Response);

    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/events?token=jwt-token-123',
    }));

    expect(user).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects ticket query on non-sse routes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        sub: 'user_test',
        email: 'test@example.com',
        name: 'Test User',
      }),
    } as Response);
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-123' });
    issuedTickets.push(issued.ticket);

    const user = await verifyBearerToken(makeRequest({
      url: `/api/v1/me/notifications?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });

    expect(user).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
