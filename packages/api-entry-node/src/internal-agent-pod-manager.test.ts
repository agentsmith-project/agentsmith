import { describe, expect, it, vi } from 'vitest';
import { InternalAgentPodManagerImpl, sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import type { AgentRecord } from './resource-models.js';
import {
  INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
} from '@mbos/contracts';

function buildAgent(config: Record<string, unknown>): AgentRecord {
  return {
    id: 'ag_1',
    workspace_id: 'ws_1',
    project_id: 'proj_1',
    name: 'internal-agent',
    mode: 'internal',
    presence: 'managed',
    status: 'enabled',
    config,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('internal-agent-pod-manager', () => {
  it('sanitizes workload id for k8s naming constraints', () => {
    expect(sanitizeWorkloadId('TASK_ABC.123###')).toBe('task-abc-123');
    expect(sanitizeWorkloadId('---')).toBe('workload');
  });

  it('creates pod with image command enabled and waits for online', async () => {
    const getPodStatus = vi.fn()
      .mockResolvedValueOnce({ phase: 'offline' })
      .mockResolvedValueOnce({ phase: 'Running' });
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
    const onlineStateStore = {
      getAgentOnlineState: vi.fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      getAgentSessionOnlineState: vi.fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
    };
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus,
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      onlineStateStore,
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
      },
    );

    await manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(createOrEnsurePod).toHaveBeenCalledWith(
      'ws_1',
      'proj_1',
      'task_1',
      expect.objectContaining({
        workspace_binding_id: 'flib_demo',
        env: expect.objectContaining({
          MBOS_AGENT_BUILTIN_SKILLS_DIR: '/etc/codex/skills',
          MBOS_AGENT_BUILTIN_SKILLS: 'mbos-context,feishu-docs,jira-ops',
          MBOS_AGENT_BUILTIN_SKILLS_REQUIRED: '1',
        }),
      }),
      undefined,
    );
    expect(onlineStateStore.getAgentSessionOnlineState).toHaveBeenCalledWith('ag_1', 'task_1');
  });

  it('fails fast when internal key is missing', async () => {
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: vi.fn(),
      },
      { getAgentOnlineState: vi.fn().mockReturnValue(false) },
      'ws://api:20000',
    );

    await expect(
      manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({ image: 'runner:v1' }),
        workspaceMount: {
          bindingId: 'flib_demo',
          mountPath: '/workspace/task_1',
        },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_SANDBOX_NOT_CONFIGURED' });
  });

  it('fails fast when workspace binding is missing', async () => {
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: vi.fn(),
      },
      { getAgentOnlineState: vi.fn().mockReturnValue(false) },
      'ws://api:20000',
    );

    await expect(
      manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({ image: 'runner:v1', _internal_raw_key: 'ask_test' }),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
      message: 'workspace_binding_id_required',
    });
  });

  it('fails with AGENT_SANDBOX_UNAVAILABLE when sandbox readyz preflight fails', async () => {
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockRejectedValue(new Error('sandbox_not_ready')),
        getPodStatus: vi.fn(),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: vi.fn(),
      },
      { getAgentOnlineState: vi.fn().mockReturnValue(false) },
      'ws://api:20000',
    );

    await expect(
      manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({ image: 'runner:v1', _internal_raw_key: 'ask_test' }),
        workspaceMount: {
          bindingId: 'flib_demo',
          mountPath: '/workspace/task_1',
        },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_SANDBOX_UNAVAILABLE' });
  });

  it('uses env default resource limits when agent config omits them', async () => {
    const previous = {
      cpuRequest: process.env.INTERNAL_AGENT_DEFAULT_CPU_REQUEST,
      cpuLimit: process.env.INTERNAL_AGENT_DEFAULT_CPU_LIMIT,
      memoryRequest: process.env.INTERNAL_AGENT_DEFAULT_MEMORY_REQUEST,
      memoryLimit: process.env.INTERNAL_AGENT_DEFAULT_MEMORY_LIMIT,
    };
    process.env.INTERNAL_AGENT_DEFAULT_CPU_REQUEST = '1';
    process.env.INTERNAL_AGENT_DEFAULT_CPU_LIMIT = '2';
    process.env.INTERNAL_AGENT_DEFAULT_MEMORY_REQUEST = '2Gi';
    process.env.INTERNAL_AGENT_DEFAULT_MEMORY_LIMIT = '4Gi';

    try {
      const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValueOnce({ phase: 'offline' })
            .mockResolvedValueOnce({ phase: 'Running' }),
          createOrEnsurePod,
          deletePod: vi.fn().mockResolvedValue(undefined),
          keepalive: vi.fn().mockResolvedValue(null),
          exec: vi.fn(),
        },
        {
          getAgentOnlineState: vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true),
          getAgentSessionOnlineState: vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true),
        },
        'ws://api:20000',
        {
          phasePollIntervalMs: 1,
          onlinePollIntervalMs: 1,
        },
      );

      await manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({
          image: 'runner:v1',
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: {
          bindingId: 'flib_demo',
          mountPath: '/workspace/task_1',
        },
      });

      expect(createOrEnsurePod).toHaveBeenCalledWith(
        'ws_1',
        'proj_1',
        'task_1',
        expect.objectContaining({
          cpu_request: '1',
          cpu_limit: '2',
          memory_request: '2Gi',
          memory_limit: '4Gi',
        }),
        undefined,
      );
    } finally {
      if (previous.cpuRequest === undefined) delete process.env.INTERNAL_AGENT_DEFAULT_CPU_REQUEST;
      else process.env.INTERNAL_AGENT_DEFAULT_CPU_REQUEST = previous.cpuRequest;
      if (previous.cpuLimit === undefined) delete process.env.INTERNAL_AGENT_DEFAULT_CPU_LIMIT;
      else process.env.INTERNAL_AGENT_DEFAULT_CPU_LIMIT = previous.cpuLimit;
      if (previous.memoryRequest === undefined) delete process.env.INTERNAL_AGENT_DEFAULT_MEMORY_REQUEST;
      else process.env.INTERNAL_AGENT_DEFAULT_MEMORY_REQUEST = previous.memoryRequest;
      if (previous.memoryLimit === undefined) delete process.env.INTERNAL_AGENT_DEFAULT_MEMORY_LIMIT;
      else process.env.INTERNAL_AGENT_DEFAULT_MEMORY_LIMIT = previous.memoryLimit;
    }
  });

  it('uses normalized sandbox lifecycle defaults when agent config omits them', async () => {
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'offline' })
          .mockResolvedValueOnce({ phase: 'Running' }),
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      {
        getAgentOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
        getAgentSessionOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
      },
    );

    await manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
    });

    expect(createOrEnsurePod).toHaveBeenCalledWith(
      'ws_1',
      'proj_1',
      'task_1',
      expect.objectContaining({
        idle_timeout_sec: INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
        max_lifetime_sec: INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
      }),
      undefined,
    );
  });

  it('recreates completed workload pods before waiting for session online', async () => {
    const deletePod = vi.fn().mockResolvedValue(undefined);
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'Completed' })
          .mockResolvedValueOnce({ phase: 'offline' })
          .mockResolvedValueOnce({ phase: 'Running' }),
        createOrEnsurePod,
        deletePod,
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      {
        getAgentOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
        getAgentSessionOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
      },
    );

    await manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
    });

    expect(deletePod).toHaveBeenCalledWith('ws_1', 'proj_1', 'task_1', undefined);
    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
  });

  it('maps remote-owned session authority to a distinct sandbox outcome instead of sandbox_startup_timeout', async () => {
    const internalAgentPodManagerModule = await import('./internal-agent-pod-manager.js') as typeof import('./internal-agent-pod-manager.js') & {
      mapRunnerSessionAuthorityToSandboxError?: (authority: string) => string | null;
    };

    expect(
      internalAgentPodManagerModule.mapRunnerSessionAuthorityToSandboxError?.('remote_owned_not_local_dispatchable'),
    ).toBe('sandbox_remote_owned');
  });

  it('does not trust a local session-online signal when dispatch authority is already remote-owned', async () => {
    const createOrEnsurePod = vi.fn();
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      {
        getAgentOnlineState: vi.fn().mockReturnValue(false),
        getAgentSessionOnlineState: vi.fn().mockReturnValue(true),
        getAgentSessionDispatchAuthority: vi.fn().mockResolvedValue('remote_owned_not_local_dispatchable'),
      },
      'ws://api:20000',
    );

    await expect(
      manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({
          image: 'runner:v1',
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: {
          bindingId: 'flib_demo',
          mountPath: '/workspace/task_1',
        },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_SANDBOX_REMOTE_OWNED' });
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('treats local dispatch authority as ready even if the weaker local session-online boolean has not caught up yet', async () => {
    const createOrEnsurePod = vi.fn();
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      {
        getAgentOnlineState: vi.fn().mockReturnValue(false),
        getAgentSessionOnlineState: vi.fn().mockReturnValue(false),
        getAgentSessionDispatchAuthority: vi.fn().mockResolvedValue('local_dispatchable'),
      },
      'ws://api:20000',
    );

    await expect(
      manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({
          image: 'runner:v1',
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: {
          bindingId: 'flib_demo',
          mountPath: '/workspace/task_1',
        },
      }),
    ).resolves.toBeUndefined();
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('aborts a session-online wait quickly and releases the workload lock for a later ensure', async () => {
    const sleepGate = new Promise<void>(() => {});
    let sessionOnline = false;
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'offline' })
          .mockResolvedValueOnce({ phase: 'Running' }),
        createOrEnsurePod: vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } }),
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      {
        getAgentOnlineState: vi.fn(() => sessionOnline),
        getAgentSessionOnlineState: vi.fn(() => sessionOnline),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
        sleep: vi.fn(async () => sleepGate),
      },
    );

    const controller = new AbortController();
    let abortedError: unknown;
    void (manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
      signal: controller.signal,
    } as never).catch((error: unknown) => {
      abortedError = error;
    }));

    await vi.waitFor(() => {
      expect(abortedError).toBeUndefined();
    });
    controller.abort('user_cancel_requested');

    await vi.waitFor(() => {
      expect(abortedError).toMatchObject({ code: 'AGENT_CANCELLED' });
    });

    sessionOnline = true;

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
    })).resolves.toBeUndefined();
  });

  it('aborts a phase wait quickly and releases the workload lock for a later ensure', async () => {
    const sleepGate = new Promise<void>(() => {});
    let phase: 'offline' | 'Pending' | 'Running' = 'offline';
    let sessionOnline = false;
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn(async () => ({ phase })),
        createOrEnsurePod: vi.fn(async () => {
          phase = 'Pending';
          return { httpStatus: 201, pod: { phase } };
        }),
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      {
        getAgentOnlineState: vi.fn(() => sessionOnline),
        getAgentSessionOnlineState: vi.fn(() => sessionOnline),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
        sleep: vi.fn(async () => sleepGate),
      },
    );

    const controller = new AbortController();
    let abortedError: unknown;
    void (manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
      signal: controller.signal,
    } as never).catch((error: unknown) => {
      abortedError = error;
    }));

    controller.abort('user_cancel_requested');

    await vi.waitFor(() => {
      expect(abortedError).toMatchObject({ code: 'AGENT_CANCELLED' });
    });

    phase = 'Running';
    sessionOnline = true;

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
    })).resolves.toBeUndefined();
  });

  it('aborts a hung getPodStatus rpc quickly and releases the workload lock for a later ensure', async () => {
    const getPodStatusObserved = createDeferred<void>();
    let sessionOnline = false;
    let firstGetPodStatus = true;
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn(async (_workspaceId, _projectId, _workloadId, signal?: AbortSignal) => {
          if (firstGetPodStatus) {
            firstGetPodStatus = false;
            getPodStatusObserved.resolve();
            await new Promise<never>((_resolve, reject) => {
              signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('get_pod_status_aborted'), {
                  name: 'AbortError',
                }));
              }, { once: true });
            });
          }
          sessionOnline = true;
          return { phase: 'Running' };
        }),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      {
        getAgentOnlineState: vi.fn(() => sessionOnline),
        getAgentSessionOnlineState: vi.fn(() => sessionOnline),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
      },
    );

    const controller = new AbortController();
    let abortedError: unknown;
    void manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
      signal: controller.signal,
    }).catch((error: unknown) => {
      abortedError = error;
    });

    await getPodStatusObserved.promise;
    controller.abort('user_cancel_requested');

    await vi.waitFor(() => {
      expect(abortedError).toMatchObject({ code: 'AGENT_CANCELLED' });
    });

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
    })).resolves.toBeUndefined();
  });

  it('aborts a hung createOrEnsurePod rpc quickly and releases the workload lock for a later ensure', async () => {
    const createObserved = createDeferred<void>();
    let phase: 'offline' | 'Running' = 'offline';
    let firstCreate = true;
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn(async () => ({ phase })),
        createOrEnsurePod: vi.fn(async (_workspaceId, _projectId, _workloadId, _body, signal?: AbortSignal) => {
          if (firstCreate) {
            firstCreate = false;
            createObserved.resolve();
            await new Promise<never>((_resolve, reject) => {
              signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('create_or_ensure_pod_aborted'), {
                  name: 'AbortError',
                }));
              }, { once: true });
            });
          }
          phase = 'Running';
          return { httpStatus: 201, pod: { phase } };
        }),
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      {
        getAgentOnlineState: vi.fn(() => phase === 'Running'),
        getAgentSessionOnlineState: vi.fn(() => phase === 'Running'),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
      },
    );

    const controller = new AbortController();
    let abortedError: unknown;
    void manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
      signal: controller.signal,
    }).catch((error: unknown) => {
      abortedError = error;
    });

    await createObserved.promise;
    controller.abort('user_cancel_requested');

    await vi.waitFor(() => {
      expect(abortedError).toMatchObject({ code: 'AGENT_CANCELLED' });
    });

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
    })).resolves.toBeUndefined();
  });

  it('aborts a follower waiting on an existing workload lock without leaving later ensures stuck', async () => {
    const sleepGate = createDeferred<void>();
    let sessionOnline = false;
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'offline' })
          .mockResolvedValueOnce({ phase: 'Running' }),
        createOrEnsurePod: vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } }),
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: vi.fn(),
      },
      {
        getAgentOnlineState: vi.fn(() => sessionOnline),
        getAgentSessionOnlineState: vi.fn(() => sessionOnline),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
        sleep: vi.fn(async () => sleepGate.promise),
      },
    );

    const leaderPromise = manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
    });

    await vi.waitFor(() => {
      expect((manager as unknown as { locks: Map<string, Promise<void>> }).locks.size).toBe(1);
    });

    const followerAbort = new AbortController();
    let followerError: unknown;
    void (manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
      signal: followerAbort.signal,
    } as never).catch((error: unknown) => {
      followerError = error;
    }));

    followerAbort.abort('user_cancel_requested');

    await vi.waitFor(() => {
      expect(followerError).toMatchObject({ code: 'AGENT_CANCELLED' });
    });

    sessionOnline = true;
    sleepGate.resolve();
    await leaderPromise;

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: {
        bindingId: 'flib_demo',
        mountPath: '/workspace/task_1',
      },
    })).resolves.toBeUndefined();
  });
});
