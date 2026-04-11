import { afterEach, describe, expect, it, vi } from 'vitest';

import { getInjectedTestNow, getReferenceNow, getRequestReferenceNow, MBOS_TEST_NOW_HEADER } from '../reference-now';

declare global {
  interface Window {
    __MBOS_TEST_NOW__?: string;
  }
}

describe('reference-now', () => {
  afterEach(() => {
    delete window.__MBOS_TEST_NOW__;
    vi.useRealTimers();
  });

  it('uses the real clock when no test clock is injected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T15:30:00.000Z'));

    expect(getReferenceNow().toISOString()).toBe('2026-05-01T15:30:00.000Z');
    expect(getInjectedTestNow()).toBeNull();
  });

  it('uses the injected browser test clock when present', () => {
    window.__MBOS_TEST_NOW__ = '2026-04-10T12:00:00.000Z';

    expect(getInjectedTestNow()?.toISOString()).toBe('2026-04-10T12:00:00.000Z');
    expect(getReferenceNow().toISOString()).toBe('2026-04-10T12:00:00.000Z');
  });

  it('uses the request header test clock when present', () => {
    const request = new Request('http://localhost/test', {
      headers: {
        [MBOS_TEST_NOW_HEADER]: '2026-04-10T12:00:00.000Z',
      },
    });

    expect(getRequestReferenceNow(request).toISOString()).toBe('2026-04-10T12:00:00.000Z');
  });
});
