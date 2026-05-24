import { describe, expect, it, vi } from 'vitest';

import {
  isRetryableKeycloakInitError,
  resolveIntegrationKeycloakRedirectBases,
  runKeycloakInitOnce,
  runKeycloakInitWithRetry,
} from './integration-keycloak-init';

const dynamicImportEnvKeys = [
  'INTERNAL_KEYCLOAK_BASE_URL',
  'PUBLIC_KEYCLOAK_BASE_URL',
  'KEYCLOAK_REALM',
] as const;

function restoreEnvSnapshot(snapshot: Map<(typeof dynamicImportEnvKeys)[number], string | undefined>): void {
  for (const key of dynamicImportEnvKeys) {
    const value = snapshot.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function parseJsonBody(body: RequestInit['body']): Record<string, unknown> {
  if (typeof body !== 'string') {
    throw new Error('expected string JSON request body');
  }
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected object JSON request body');
  }
  return parsed as Record<string, unknown>;
}

describe('integration-keycloak-init', () => {
  it('exports a zero-argument single-run entrypoint', () => {
    expect(runKeycloakInitOnce).toHaveLength(0);
  });

  it('includes actual runtime web origins instead of relying only on a fixed port list', () => {
    const bases = resolveIntegrationKeycloakRedirectBases({
      INTEGRATION_WEB_PORT: '3065',
      WEB_PORT: '3091',
      PORT_WEB: '3105',
      INTEGRATION_WEB_PORTS: '3201',
      INTEGRATION_BASE_URL: 'http://localhost:3065/zh-CN/workspaces/ws_default/login',
      BASE_URL: 'http://127.0.0.1:33077/en-US/login',
      RUNTIME_BROWSER_WEB_BASE_URL: 'http://localhost:38191',
      RUNTIME_HOST_WEB_BASE_URL: 'http://127.0.0.1:38191',
      KEYCLOAK_REDIRECT_BASE_URL: 'http://localhost:39091',
      INTEGRATION_PUBLIC_WEB_BASES: 'https://agentsmith.example.test/app,http://localhost:4101/path',
    });

    expect(bases).toContain('http://localhost:3065');
    expect(bases).toContain('http://127.0.0.1:3065');
    expect(bases).toContain('http://localhost:3091');
    expect(bases).toContain('http://127.0.0.1:3091');
    expect(bases).toContain('http://localhost:3105');
    expect(bases).toContain('http://127.0.0.1:3105');
    expect(bases).toContain('http://localhost:3201');
    expect(bases).toContain('http://127.0.0.1:3201');
    expect(bases).toContain('http://127.0.0.1:33077');
    expect(bases).toContain('http://localhost:38191');
    expect(bases).toContain('http://127.0.0.1:38191');
    expect(bases).toContain('http://localhost:39091');
    expect(bases).toContain('https://agentsmith.example.test');
    expect(bases).toContain('http://localhost:4101');
  });

  it('updates realm frontendUrl during redirects-only sync so tokens follow the current runtime issuer', async () => {
    const envSnapshot = new Map(dynamicImportEnvKeys.map((key) => [key, process.env[key]]));
    const realmUpdates: Record<string, unknown>[] = [];
    const clientUpdates: Record<string, unknown>[] = [];
    const runtimeKeycloakBaseUrl = 'http://127.0.0.1:28081';

    vi.resetModules();
    delete process.env.INTERNAL_KEYCLOAK_BASE_URL;
    process.env.PUBLIC_KEYCLOAK_BASE_URL = runtimeKeycloakBaseUrl;
    process.env.KEYCLOAK_REALM = 'mbos';

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (method === 'POST' && url === `${runtimeKeycloakBaseUrl}/realms/master/protocol/openid-connect/token`) {
        return jsonResponse({ access_token: 'admin-token' });
      }

      if (url === `${runtimeKeycloakBaseUrl}/admin/realms/mbos`) {
        if (method === 'GET') {
          return jsonResponse({
            realm: 'mbos',
            attributes: {
              frontendUrl: 'http://localhost:18080',
              retained: 'yes',
            },
          });
        }
        if (method === 'PUT') {
          realmUpdates.push(parseJsonBody(init?.body));
          return new Response(null, { status: 204 });
        }
      }

      if (method === 'GET' && url === `${runtimeKeycloakBaseUrl}/admin/realms/mbos/clients?clientId=agentsmith`) {
        return jsonResponse([{ id: 'agentsmith-client-uuid', clientId: 'agentsmith' }]);
      }

      if (url === `${runtimeKeycloakBaseUrl}/admin/realms/mbos/clients/agentsmith-client-uuid`) {
        if (method === 'GET') {
          return jsonResponse({
            id: 'agentsmith-client-uuid',
            clientId: 'agentsmith',
            redirectUris: [],
            webOrigins: [],
          });
        }
        if (method === 'PUT') {
          clientUpdates.push(parseJsonBody(init?.body));
          return new Response(null, { status: 204 });
        }
      }

      throw new Error(`unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const module = await import('./integration-keycloak-init');
      await module.runKeycloakRedirectsOnlyOnce();
    } finally {
      vi.unstubAllGlobals();
      restoreEnvSnapshot(envSnapshot);
      vi.resetModules();
    }

    expect(fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? 'GET'} ${requestUrl(input)}`)).toEqual([
      `POST ${runtimeKeycloakBaseUrl}/realms/master/protocol/openid-connect/token`,
      `GET ${runtimeKeycloakBaseUrl}/admin/realms/mbos`,
      `PUT ${runtimeKeycloakBaseUrl}/admin/realms/mbos`,
      `GET ${runtimeKeycloakBaseUrl}/admin/realms/mbos/clients?clientId=agentsmith`,
      `GET ${runtimeKeycloakBaseUrl}/admin/realms/mbos/clients/agentsmith-client-uuid`,
      `PUT ${runtimeKeycloakBaseUrl}/admin/realms/mbos/clients/agentsmith-client-uuid`,
    ]);
    expect(realmUpdates).toHaveLength(1);
    expect(realmUpdates[0]).toMatchObject({
      attributes: {
        frontendUrl: runtimeKeycloakBaseUrl,
        retained: 'yes',
      },
      accessTokenLifespan: 28800,
      sslRequired: 'NONE',
    });
    expect(clientUpdates).toHaveLength(1);
  });

  it('retries a transient realm update failure once and then succeeds', async () => {
    const retryableError = new Error(
      'keycloak_update_realm_failed:mbos:500:Database operation failed',
    );
    const run = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn(async (_delayMs: number) => undefined);

    await expect(runKeycloakInitWithRetry({
      attempts: 5,
      delayMs: 1000,
      run,
      sleep,
    })).resolves.toBeUndefined();

    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(isRetryableKeycloakInitError(retryableError)).toBe(true);
  });

  it('does not retry a non-retryable error', async () => {
    const nonRetryableError = new Error('keycloak_update_client_failed:agentsmith:500:boom');
    const run = vi.fn<() => Promise<void>>().mockRejectedValue(nonRetryableError);
    const sleep = vi.fn(async (_delayMs: number) => undefined);

    await expect(runKeycloakInitWithRetry({
      attempts: 5,
      delayMs: 1000,
      run,
      sleep,
    })).rejects.toBe(nonRetryableError);

    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(isRetryableKeycloakInitError(nonRetryableError)).toBe(false);
  });

  it('stops after the configured retry budget for transient realm update failures', async () => {
    const retryableError = new Error(
      'keycloak_update_realm_failed:mbos:500:Database operation failed',
    );
    const run = vi.fn<() => Promise<void>>().mockRejectedValue(retryableError);
    const sleep = vi.fn(async (_delayMs: number) => undefined);

    await expect(runKeycloakInitWithRetry({
      attempts: 4,
      delayMs: 250,
      run,
      sleep,
    })).rejects.toBe(retryableError);

    expect(run).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
    expect(sleep).toHaveBeenNthCalledWith(3, 750);
  });
});
