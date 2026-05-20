import { describe, expect, it, vi } from 'vitest';

import {
  isRetryableKeycloakInitError,
  resolveIntegrationKeycloakRedirectBases,
  runKeycloakInitOnce,
  runKeycloakInitWithRetry,
} from './integration-keycloak-init';

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
