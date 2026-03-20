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
