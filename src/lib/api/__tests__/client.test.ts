import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_USE_MSW = process.env.NEXT_PUBLIC_USE_MSW;
const ORIGINAL_API_BASE = process.env.NEXT_PUBLIC_API_BASE;

describe('API_BASE', () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_USE_MSW = ORIGINAL_USE_MSW;
    process.env.NEXT_PUBLIC_API_BASE = ORIGINAL_API_BASE;
    vi.resetModules();
  });

  it('uses /api/v1 when MSW is enabled', async () => {
    process.env.NEXT_PUBLIC_USE_MSW = 'true';
    vi.resetModules();

    const { API_BASE } = await import('../client');

    expect(API_BASE).toBe('/api/v1');
  });
});
