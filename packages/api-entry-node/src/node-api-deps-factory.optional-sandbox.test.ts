import { MongoJsonDocStore } from '@mbos/adapters-private';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
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
      expect(deps.internalWorkloadCoordinator).toBeUndefined();
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

  it('uses the constrained default Mongo pool contract for the process docStore', async () => {
    const { deps, lifecycle } = createNodeApiDepsFromEnv({
      ...baseEnv,
      MONGO_URL: 'mongodb://127.0.0.1:17017',
      MONGO_DB_NAME: 'mbos_test',
    });
    try {
      expect(deps.docStore).toBeInstanceOf(MongoJsonDocStore);
      expect((deps.docStore as MongoJsonDocStore & {
        mongoClientOptions?: unknown;
      }).mongoClientOptions).toEqual({
        maxPoolSize: 20,
        minPoolSize: 0,
        maxIdleTimeMS: 10_000,
        maxConnecting: 2,
        waitQueueTimeoutMS: 5_000,
      });
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
      expect(deps.internalWorkloadCoordinator).toBeDefined();
      expect(deps.internalAgentWorkspaceBindingManager).toBeDefined();
      expect(deps.internalAgentWorkspaceProvisioner).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      await shutdownSafe(lifecycle);
    }
  });

  it('uses the sanitized task workload key for terminal lifecycle holders', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ expires_at: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { deps, lifecycle } = createNodeApiDepsFromEnv({
      ...baseEnv,
      SANDBOX_MANAGER_URL: 'http://sandbox-manager:8080',
      SANDBOX_SERVICE_KEY: 'svc-key',
    });
    const rawTaskId = 'TASK_ABC.123###';
    const expectedWorkloadId = sanitizeWorkloadId(rawTaskId);

    try {
      expect(deps.internalWorkloadCoordinator).toBeDefined();

      const created = await deps.notebookTerminalService.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: rawTaskId,
        agentId: 'agent_1',
        runnerSessionId: rawTaskId,
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });

      expect(deps.internalWorkloadCoordinator?.readSnapshotForTests()).toEqual([
        {
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          workloadId: expectedWorkloadId,
          holders: [`terminal_session:${created.sessionId}`],
          hardTeardownRequested: false,
        },
      ]);
      expect(deps.internalWorkloadCoordinator?.readSnapshotForTests()[0]?.workloadId).not.toBe(rawTaskId);

      (
        deps.notebookTerminalService as unknown as {
          finishSession: (
            sessionId: string,
            status: 'closed' | 'failed',
            closeReason?: string,
            exitCode?: number | null,
          ) => void;
        }
      ).finishSession(created.sessionId, 'closed', 'process_exited', 0);

      await vi.waitFor(() => {
        expect(deps.internalWorkloadCoordinator?.readSnapshotForTests()).toEqual([]);
      });
    } finally {
      await shutdownSafe(lifecycle);
    }
  });
});
