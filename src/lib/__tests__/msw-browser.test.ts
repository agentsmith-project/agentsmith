import { describe, it, expect } from 'vitest';

describe('msw browser init', () => {
  it('does not throw when imported in non-browser environments', async () => {
    const mod = await import('@/mocks/browser');
    await expect(mod.initMSW()).resolves.toBeUndefined();
  });
});
