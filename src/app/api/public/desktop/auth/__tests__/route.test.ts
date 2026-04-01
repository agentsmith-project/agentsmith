import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

describe('/api/public/desktop/auth', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_API_BASE', 'http://localhost:20000');
    vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_URL', 'https://login.example.com');
    vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_REALM', 'mbos');
    vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_CLIENT_ID', 'agentsmith-desktop');
  });

  it('returns desktop auth config from public runtime config', async () => {
    const response = await GET(new Request('https://agentsmith.example.com/api/public/desktop/auth'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deployment_base_url: 'https://agentsmith.example.com',
      api_base_url: 'http://localhost:20000/api/v1',
      issuer: 'https://login.example.com/realms/mbos',
      authorization_endpoint: 'https://login.example.com/realms/mbos/protocol/openid-connect/auth',
      token_endpoint: 'https://login.example.com/realms/mbos/protocol/openid-connect/token',
      client_id: 'agentsmith-desktop',
      scopes: ['openid', 'profile', 'email'],
      response_type: 'code',
      pkce_method: 'S256',
      suggested_callback_origin: 'http://127.0.0.1',
      suggested_callback_path: '/desktop/auth/callback',
    });
  });

  it('returns 503 when keycloak config is incomplete', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_URL', '');
    const response = await GET(new Request('https://agentsmith.example.com/api/public/desktop/auth'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error_code: 'DESKTOP_AUTH_NOT_CONFIGURED',
      error_message: 'desktop_auth_not_configured',
    });
  });
});
