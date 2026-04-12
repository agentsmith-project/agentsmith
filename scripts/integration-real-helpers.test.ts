import { describe, expect, it, vi } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import { createExternalConnectionViaApi } from '../e2e/integration-real-helpers';

describe('integration-real-helpers', () => {
  it('creates an external connection through the API without mutating page state', async () => {
    const post = vi.fn().mockResolvedValue({
      ok: () => true,
      status: 201,
      json: async () => ({ id: 'uec_seed_1' }),
    });
    const request = { post } as unknown as APIRequestContext;

    const id = await createExternalConnectionViaApi({
      request,
      token: 'mock_token_user_001_12345',
      provider: 'custom',
      kind: 'secret_bundle',
      displayName: 'Seeded Connection',
      note: 'seeded via api',
      fields: [
        { key: 'base_url', value: 'https://api.visual.example.com', description: 'Base URL', secret: false },
      ],
    });

    expect(id).toBe('uec_seed_1');
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/me/external-connections'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock_token_user_001_12345',
        }),
      }),
    );
  });

  it('fails when the explicit token is missing', async () => {
    const request = { post: vi.fn() } as unknown as APIRequestContext;

    await expect(createExternalConnectionViaApi({
      request,
      token: '   ',
      provider: 'custom',
      kind: 'secret_bundle',
      displayName: 'Seeded Connection',
      fields: [],
    })).rejects.toThrow('auth_token_not_found_for_external_connection_seed');
  });
});
