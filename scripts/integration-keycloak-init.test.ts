import { describe, expect, it, vi } from 'vitest';

import {
  isRetryableKeycloakInitError,
  runKeycloakInitOnce,
  runKeycloakInitWithRetry,
} from './integration-keycloak-init';

describe('integration-keycloak-init', () => {
  it('exports a zero-argument single-run entrypoint', () => {
    expect(runKeycloakInitOnce).toHaveLength(0);
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
