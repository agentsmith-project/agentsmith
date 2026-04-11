import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MSWApiClient } from '../msw-adapter';
import { MBOS_TEST_NOW_HEADER } from '@/lib/reference-now';

declare global {
  interface Window {
    __MBOS_TEST_NOW__?: string;
  }
}

describe('MSWApiClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    delete window.__MBOS_TEST_NOW__;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.__MBOS_TEST_NOW__;
  });

  it('forwards the injected test clock header when present', async () => {
    const client = new MSWApiClient();
    window.__MBOS_TEST_NOW__ = '2026-04-10T12:00:00.000Z';

    await client.get('/usage');

    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect((init.headers as Record<string, string>)[MBOS_TEST_NOW_HEADER]).toBe('2026-04-10T12:00:00.000Z');
  });
});
