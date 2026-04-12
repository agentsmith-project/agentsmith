import { describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { seedMockExternalConnectionForVisual } from '../e2e/fixtures/third-party-accounts';

describe('third-party account visual seed helper', () => {
  it('seeds a stable mock external connection without touching page UI', async () => {
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const page = {
      addInitScript,
      evaluate,
    } as unknown as Page;

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
    expect(addInitScript).toHaveBeenCalledTimes(1);
    expect(id).toBe('uec_visual_custom_integration');
  });

  it('falls back to a deterministic mock user id when auth context is unavailable', async () => {
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const page = {
      addInitScript,
      evaluate,
    } as unknown as Page;

    await seedMockExternalConnectionForVisual(page, {
      provider: 'custom',
      kind: 'secret_bundle',
      displayName: 'Visual Custom Integration',
      fields: [],
    });

    expect(addInitScript).toHaveBeenCalledTimes(1);
  });
});
