import { afterEach, describe, expect, it, vi } from 'vitest';

describe('public runtime config', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('reads config from process env on the server', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE', 'https://api.example.com');
    vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_URL', 'https://login.example.com/realms');
    vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_REALM', 'mbos');
    vi.stubEnv('NEXT_PUBLIC_KEYCLOAK_CLIENT_ID', 'agentsmith');
    vi.stubEnv('NEXT_PUBLIC_USE_MSW', 'false');
    vi.stubEnv('NEXT_PUBLIC_TRUSTED_IMAGE_DOMAINS', 'cdn.example.com, images.example.com');

    const { getPublicRuntimeConfig } = await import('../public-runtime-config');

    expect(getPublicRuntimeConfig()).toMatchObject({
      apiBase: 'https://api.example.com',
      keycloakUrl: 'https://login.example.com/realms',
      keycloakRealm: 'mbos',
      keycloakClientId: 'agentsmith',
      useMsw: false,
      trustedImageDomains: ['cdn.example.com', 'images.example.com'],
    });
  });

  it('prefers browser-injected runtime config over process env', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE', 'http://localhost:20000');
    vi.stubGlobal('window', {
      __MBOS_PUBLIC_RUNTIME_CONFIG__: {
        apiBase: 'http://mbos.imotion.ai:20000',
        keycloakUrl: 'http://mbos.imotion.ai:18080/realms',
        keycloakRealm: 'mbos',
        keycloakClientId: 'agentsmith',
        useMsw: false,
        mswStrictReady: false,
        sseTicketEnabled: false,
        sseTicketPercentage: 0,
        sseAllowJwtFallback: false,
        trustedImageDomains: [],
        bypassAuth: false,
        agentTaskSseDebugPanel: false,
        docFixtures: false,
      },
    });

    const { getPublicRuntimeConfig } = await import('../public-runtime-config');

    expect(getPublicRuntimeConfig().apiBase).toBe('http://mbos.imotion.ai:20000');
  });

  it('normalizes a public api base ending with /api to /api/v1', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE', 'https://mbos.imotion.ai/api');

    const { getPublicApiBaseUrl } = await import('../public-runtime-config');

    expect(getPublicApiBaseUrl()).toBe('https://mbos.imotion.ai/api/v1');
  });
});
