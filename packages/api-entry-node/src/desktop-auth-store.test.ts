import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import {
  completeDesktopAuthRequest,
  exchangeDesktopAuthRequest,
  getDesktopAuthRequest,
  resetDesktopAuthForTest,
  resolveDesktopAccessToken,
  startDesktopAuthRequest,
} from './desktop-auth-store.js';

describe('desktop-auth-store', () => {
  const cache = new InMemoryCache();
  const requestIds: string[] = [];
  const accessTokens: string[] = [];

  afterEach(async () => {
    await resetDesktopAuthForTest(cache, {
      requestIds: requestIds.splice(0),
      accessTokens: accessTokens.splice(0),
    });
    vi.useRealTimers();
  });

  it('starts pending requests and completes then exchanges into desktop access tokens', async () => {
    const started = await startDesktopAuthRequest(cache, {
      deploymentBaseUrl: 'https://agentsmith.example.com',
    });
    requestIds.push(started.request_id);

    expect(started.status).toBe('pending');
    expect(started.exchange_ticket).toBeNull();

    const completed = await completeDesktopAuthRequest(cache, {
      requestId: started.request_id,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        name: 'User One',
      },
    });

    expect(completed).toMatchObject({
      request_id: started.request_id,
      status: 'authenticated',
      authenticated_user: {
        id: 'user_1',
      },
      exchange_ticket: expect.stringMatching(/^dext_/),
    });

    const exchanged = await exchangeDesktopAuthRequest(cache, {
      requestId: started.request_id,
      exchangeTicket: completed?.exchange_ticket ?? '',
    });
    accessTokens.push(exchanged?.accessToken ?? '');

    expect(exchanged).toMatchObject({
      accessToken: expect.stringMatching(/^dsk_/),
      signedInUser: {
        id: 'user_1',
      },
    });

    await expect(resolveDesktopAccessToken(cache, exchanged?.accessToken ?? '')).resolves.toMatchObject({
      access_token: exchanged?.accessToken,
      user: {
        email: 'user@example.com',
      },
    });

    await expect(getDesktopAuthRequest(cache, started.request_id)).resolves.toMatchObject({
      status: 'exchanged',
      exchange_ticket: null,
    });
  });

  it('marks expired requests as expired and rejects exchange', async () => {
    vi.useFakeTimers();
    const started = await startDesktopAuthRequest(cache, {
      deploymentBaseUrl: 'https://agentsmith.example.com',
      ttlMs: 5,
    });
    requestIds.push(started.request_id);

    vi.advanceTimersByTime(10);

    await expect(getDesktopAuthRequest(cache, started.request_id)).resolves.toMatchObject({
      status: 'expired',
    });
    await expect(completeDesktopAuthRequest(cache, {
      requestId: started.request_id,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        name: 'User One',
      },
    })).resolves.toBeNull();
  });

  it('rejects exchange with the wrong ticket without issuing a desktop token', async () => {
    const started = await startDesktopAuthRequest(cache, {
      deploymentBaseUrl: 'https://agentsmith.example.com',
    });
    requestIds.push(started.request_id);
    const completed = await completeDesktopAuthRequest(cache, {
      requestId: started.request_id,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        name: 'User One',
      },
    });

    await expect(exchangeDesktopAuthRequest(cache, {
      requestId: started.request_id,
      exchangeTicket: 'dext_invalid',
    })).resolves.toBeNull();

    await expect(resolveDesktopAccessToken(cache, completed?.exchange_ticket ?? '')).resolves.toBeNull();
  });
});
