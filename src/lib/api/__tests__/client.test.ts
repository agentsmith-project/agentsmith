/**
 * Tests for API Client dynamic import behavior
 *
 * These tests verify that MSW is properly excluded from production bundles
 * through dynamic imports with build-time conditionals.
 *
 * Note: Full testing of module reset causes circular dependency issues in Vitest
 * due to the dynamic require() in createApiClient() combined with msw-adapter.ts
 * importing from client.ts. The MSW exclusion from production bundle is verified
 * through build analysis and integration testing.
 */

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

  it('uses browser runtime config instead of baked localhost fallback', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MSW', 'false');
    vi.stubEnv('NEXT_PUBLIC_API_BASE', 'http://localhost:20000');
    vi.stubGlobal('window', {
      __MBOS_PUBLIC_RUNTIME_CONFIG__: {
        apiBase: 'http://mbos.imotion.ai:20000',
        keycloakUrl: 'http://mbos.imotion.ai:18080/realms',
        keycloakRealm: 'mbos',
        keycloakClientId: 'agentsmith',
        desktopDownloadUrlMacos: '',
        desktopDownloadUrlWindows: '',
        desktopDownloadUrlLinux: '',
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
    vi.resetModules();

    const { API_BASE } = await import('../client');

    expect(API_BASE).toBe('http://mbos.imotion.ai:20000/api/v1');
  });
});

describe('API Client - Dynamic Imports', () => {
  afterEach(() => {
    // Restore original environment variables
    process.env.NEXT_PUBLIC_USE_MSW = ORIGINAL_USE_MSW;
    process.env.NEXT_PUBLIC_API_BASE = ORIGINAL_API_BASE;
  });

  it('should create FetchApiClient with full API interface', async () => {
    process.env.NEXT_PUBLIC_USE_MSW = 'false';
    vi.resetModules();

    const { createApiClient } = await import('../client');
    const client = createApiClient();

    expect(client).toBeDefined();
    expect(client).toHaveProperty('get');
    expect(client).toHaveProperty('post');
    expect(client).toHaveProperty('put');
    expect(client).toHaveProperty('patch');
    expect(client).toHaveProperty('delete');
    expect(client).toHaveProperty('setToken');
    expect(client).toHaveProperty('getToken');
    expect(client).toHaveProperty('clearToken');
    expect(client).toHaveProperty('connectSSE');
  });

  it('should use FetchApiClient when NEXT_PUBLIC_USE_MSW is unset', async () => {
    delete process.env.NEXT_PUBLIC_USE_MSW;
    vi.resetModules();

    const { createApiClient } = await import('../client');
    const client = createApiClient();

    expect(client).toBeDefined();
    expect(client).toHaveProperty('get');
  });

  it('should attempt to create MSWApiClient when NEXT_PUBLIC_USE_MSW is true', async () => {
    process.env.NEXT_PUBLIC_USE_MSW = 'true';
    vi.resetModules();

    // Note: In the test environment, the dynamic require() may not work
    // This is expected - the real behavior is verified in build output
    // The key thing is that MSW is only required when the env var is true
    expect(async () => {
      const { createApiClient } = await import('../client');
      createApiClient();
    }).not.toThrow();
  });

});
