import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

describe('/api/public/desktop/auth', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_API_BASE', 'http://localhost:20000');
  });

  it('returns desktop auth bootstrap config from public runtime config', async () => {
    const response = await GET(new Request('https://agentsmith.example.com/api/public/desktop/auth'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deployment_base_url: 'https://agentsmith.example.com',
      api_base_url: 'http://localhost:20000/api/v1',
    });
  });

  it('falls back to localhost api base when explicit public api base is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE', '');
    const response = await GET(new Request('https://agentsmith.example.com/api/public/desktop/auth'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deployment_base_url: 'https://agentsmith.example.com',
      api_base_url: 'http://localhost:3000/api/v1',
    });
  });
});
