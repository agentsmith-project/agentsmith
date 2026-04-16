import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeApiDepsFromEnv } from './node-api-deps-factory.js';

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
};

async function shutdownSafe(lifecycle: { shutdown: () => Promise<void> | void }): Promise<void> {
  await lifecycle.shutdown();
}

describe('createNodeApiDepsFromEnv optional sandbox integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts successfully without sandbox env and does not wire internalAgentPodManager', async () => {
    const { deps, lifecycle } = createNodeApiDepsFromEnv({ ...baseEnv });
    try {
      expect(deps.internalAgentPodManager).toBeUndefined();
      expect(deps.internalAgentWorkspaceBindingManager).toBeUndefined();
      expect(deps.internalAgentWorkspaceProvisioner).toBeUndefined();
    } finally {
      await shutdownSafe(lifecycle);
    }
  });

  it('wires REDIS_URL dependencies with a CAS-capable agent presence store', async () => {
    const { deps, lifecycle } = createNodeApiDepsFromEnv({
      ...baseEnv,
      REDIS_URL: 'redis://127.0.0.1:1',
    });
    try {
      expect((deps.cache as { compareAndSet?: unknown }).compareAndSet).toBeTypeOf('function');
      const presenceStore = (deps.agentResourceService as unknown as {
        agentPresenceStore?: { kind?: string };
      }).agentPresenceStore;
      expect(presenceStore?.kind).toBe('cache_cas');
    } finally {
      await shutdownSafe(lifecycle);
      await (deps.cache as { close?: () => Promise<void> }).close?.();
    }
  });

  it('fails fast when sandbox env is partially configured', () => {
    expect(() => createNodeApiDepsFromEnv({
      ...baseEnv,
      SANDBOX_MANAGER_URL: 'http://sandbox-manager:8080',
    })).toThrowError('sandbox_manager_config_incomplete');
  });

  it('does not fail startup when sandbox readyz preflight fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('sandbox_down'));

    const { deps, lifecycle } = createNodeApiDepsFromEnv({
      ...baseEnv,
      SANDBOX_MANAGER_URL: 'http://sandbox-manager:8080',
      SANDBOX_SERVICE_KEY: 'svc-key',
    });

    try {
      expect(deps.internalAgentPodManager).toBeDefined();
      expect(deps.internalAgentWorkspaceBindingManager).toBeDefined();
      expect(deps.internalAgentWorkspaceProvisioner).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      await shutdownSafe(lifecycle);
    }
  });
});
