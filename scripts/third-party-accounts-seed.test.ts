import { describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { seedMockExternalConnectionForVisual } from '../e2e/fixtures/third-party-accounts';

describe('third-party account visual seed helper', () => {
  it('seeds a stable mock external connection without touching page UI', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue(JSON.stringify({ id: 'uec_visual_custom_integration' })),
    });
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn(async (callback: (arg?: unknown) => unknown, arg?: unknown) => {
      if (typeof callback === 'function') {
        return callback(arg);
      }
      return undefined;
    });
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = {
      url: vi.fn().mockReturnValue('about:blank'),
      goto,
      addInitScript,
      evaluate,
    } as unknown as Page;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    // @ts-expect-error test harness shim
    globalThis.window = {
      __MBOS_AUTH_E2E_CONTEXT__: { userId: 'user_001', token: 'mock_token_user_001_12345' },
    };
    // @ts-expect-error test harness shim
    globalThis.fetch = fetch;

    try {
      const id = await seedMockExternalConnectionForVisual(page, {
        provider: 'custom',
        kind: 'secret_bundle',
        displayName: 'Visual Custom Integration',
        note: 'Visual seed',
        fields: [
          { key: 'base_url', value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
          { key: 'token', value: 'tok-visual-secret', description: 'API token', secret: true },
        ],
      });

      expect(id).toBe('uec_visual_custom_integration');
      expect(goto).not.toHaveBeenCalled();
      expect(addInitScript).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith('/api/test/me/external-connections/seed', expect.objectContaining({
        method: 'POST',
      }));
      expect(evaluate).toHaveBeenCalledTimes(3);
    } finally {
      // @ts-expect-error test harness shim
      globalThis.window = originalWindow;
      // @ts-expect-error test harness shim
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to a deterministic mock user id when auth context is unavailable', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue(JSON.stringify({ id: 'uec_visual_custom_integration' })),
    });
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn(async (callback: (arg?: unknown) => unknown, arg?: unknown) => {
      if (typeof callback === 'function') {
        return callback(arg);
      }
      return undefined;
    });
    const goto = vi.fn().mockResolvedValue(undefined);
    const page = {
      url: vi.fn().mockReturnValue('about:blank'),
      goto,
      addInitScript,
      evaluate,
    } as unknown as Page;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    // @ts-expect-error test harness shim
    globalThis.window = {
      __MBOS_AUTH_E2E_CONTEXT__: { token: 'mock_token_user_001_12345' },
    };
    // @ts-expect-error test harness shim
    globalThis.fetch = fetch;

    try {
      await seedMockExternalConnectionForVisual(page, {
        provider: 'custom',
        kind: 'secret_bundle',
        displayName: 'Visual Custom Integration',
        fields: [],
      });

      expect(goto).not.toHaveBeenCalled();
      expect(addInitScript).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(evaluate).toHaveBeenCalledTimes(3);
    } finally {
      // @ts-expect-error test harness shim
      globalThis.window = originalWindow;
      // @ts-expect-error test harness shim
      globalThis.fetch = originalFetch;
    }
  });
});
