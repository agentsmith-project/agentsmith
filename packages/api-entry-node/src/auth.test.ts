import type http from 'node:http';
import { InMemoryCache } from '@mbos/adapters-private';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractBearerToken, verifyBearerToken } from './auth.js';
import { issueSSETicket, resetSSETicketsForTest } from './sse-ticket-store.js';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => Symbol('jwks')),
  jwtVerify: vi.fn(),
}));

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
  const issuer = 'http://issuer.test/realms/mbos';
  const createRemoteJWKSetMock = vi.mocked(createRemoteJWKSet);
  const jwtVerifyMock = vi.mocked(jwtVerify);

  beforeEach(() => {
    process.env.KEYCLOAK_ISSUER_URL = issuer;
    delete process.env.INTERNAL_KEYCLOAK_BASE_URL;
    createRemoteJWKSetMock.mockReset();
    createRemoteJWKSetMock.mockReturnValue(Symbol('jwks') as never);
    jwtVerifyMock.mockReset();
  });

  afterEach(() => {
    return Promise.all([
      resetSSETicketsForTest(cache, issuedTickets.splice(0)),
      Promise.resolve().then(() => {
        vi.restoreAllMocks();
        delete process.env.INTERNAL_KEYCLOAK_BASE_URL;
        delete process.env.KEYCLOAK_REALM;
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
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_test',
        email: 'test@example.com',
        name: 'Test User',
      },
    } as never);
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-123' });
    issuedTickets.push(issued.ticket);

    const user = await verifyBearerToken(makeRequest({
      url: `/api/v1/events?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });

    expect(user).toMatchObject({ id: 'user_test' });
    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL('http://issuer.test/realms/mbos/protocol/openid-connect/certs'),
    );
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'jwt-token-123',
      expect.any(Symbol),
      expect.objectContaining({ issuer }),
    );
  });

  it('prefers internal keycloak base url over public issuer url for jwks discovery', async () => {
    process.env.INTERNAL_KEYCLOAK_BASE_URL = 'http://keycloak:8080';
    process.env.KEYCLOAK_REALM = 'mbos';
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_internal',
        email: 'test@example.com',
        name: 'Test User',
      },
    } as never);

    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/me/profile',
      authorization: 'Bearer jwt-token-internal',
    }));

    expect(user).toMatchObject({ id: 'user_internal' });
    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL('http://keycloak:8080/realms/mbos/protocol/openid-connect/certs'),
    );
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'jwt-token-internal',
      expect.any(Symbol),
      expect.objectContaining({ issuer }),
    );
  });

  it('consumes single-use sse tickets after the first successful resolve', async () => {
    const bearerToken = 'jwt-token-single-use';
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_single_use',
        email: 'test@example.com',
        name: 'Test User',
      },
    } as never);
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
    expect(jwtVerifyMock).toHaveBeenCalledTimes(1);
  });

  it('rejects query-token fallback', async () => {
    const user = await verifyBearerToken(makeRequest({
      url: '/api/v1/events?token=jwt-token-123',
    }));

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('rejects ticket query on non-sse routes', async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: 'user_test',
        email: 'test@example.com',
        name: 'Test User',
      },
    } as never);
    const issued = await issueSSETicket(cache, { bearerToken: 'jwt-token-123' });
    issuedTickets.push(issued.ticket);

    const user = await verifyBearerToken(makeRequest({
      url: `/api/v1/me/notifications?ticket=${encodeURIComponent(issued.ticket)}`,
    }), { cache });

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });
});
