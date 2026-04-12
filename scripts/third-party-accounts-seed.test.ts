import { describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { seedMockExternalConnectionForVisual } from '../e2e/fixtures/third-party-accounts';

describe('third-party account visual seed helper', () => {
  it('seeds a stable mock external connection without touching page UI', async () => {
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
    // @ts-expect-error test harness shim
    globalThis.window = {
      __MBOS_AUTH_E2E_CONTEXT__: { userId: 'user_001', token: 'mock_token_user_001_12345' },
    };

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
      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(String(addInitScript.mock.calls[0]?.[0])).toContain('setVisualThirdPartyAccountsBootstrap');
      expect(String(addInitScript.mock.calls[0]?.[0])).not.toContain('__MBOS_MSW_TEST_HEADERS__');
    } finally {
      // @ts-expect-error test harness shim
      globalThis.window = originalWindow;
    }
  });

  it('falls back to a deterministic mock user id when auth context is unavailable', async () => {
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
    // @ts-expect-error test harness shim
    globalThis.window = {
      __MBOS_AUTH_E2E_CONTEXT__: { token: 'mock_token_user_001_12345' },
    };

    try {
      await seedMockExternalConnectionForVisual(page, {
        provider: 'custom',
        kind: 'secret_bundle',
        displayName: 'Visual Custom Integration',
        fields: [],
      });

      expect(goto).not.toHaveBeenCalled();
      expect(addInitScript).toHaveBeenCalledTimes(1);
      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(String(addInitScript.mock.calls[0]?.[0])).toContain('setVisualThirdPartyAccountsBootstrap');
      expect(String(addInitScript.mock.calls[0]?.[0])).not.toContain('__MBOS_MSW_TEST_HEADERS__');
    } finally {
      // @ts-expect-error test harness shim
      globalThis.window = originalWindow;
    }
  });
});
