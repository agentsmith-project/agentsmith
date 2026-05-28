import { describe, expect, it, vi } from 'vitest';
import { InternalAgentPodManagerImpl, sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import type { InternalAgentWorkspaceMount } from './internal-agent-workspace-provisioner.js';
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

function buildWorkspaceMount(): InternalAgentWorkspaceMount {
  return {
    bindingId: 'flib_demo',
    mountPath: '/home/task_1',
    taskHomePath: '/home/task_1',
    workspacePath: '/home/task_1/workspace',
    artifactsPath: '/home/task_1/workspace/.artifacts',
    libraryRootPath: '.',
  };
}

function buildRunnerHealthFoundExec() {
  return vi.fn().mockResolvedValue({
    exit_code: 0,
    stdout: '123 agentsmith-runner --runner-instance-id runner_instance_id=ag_1:task_1:task_1\n',
    stderr: '',
    duration_ms: 4,
  });
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
        exec: buildRunnerHealthFoundExec(),
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
      workspaceMount: buildWorkspaceMount(),
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(createOrEnsurePod).toHaveBeenCalledWith(
      'ws_1',
      'proj_1',
      'task_1',
      expect.objectContaining({
        workspace_binding_id: 'flib_demo',
        env: expect.objectContaining({
          TASK_HOME: '/home/task_1',
          HOME: '/home/task_1',
          WORKSPACE_PATH: '/home/task_1/workspace',
          ARTIFACTS_PATH: '/home/task_1/workspace/.artifacts',
          MBOS_AGENT_BUILTIN_SKILLS_DIR: '/etc/codex/skills',
          MBOS_AGENT_BUILTIN_SKILLS: 'mbos-context,feishu-docs,jira-ops',
          MBOS_AGENT_BUILTIN_SKILLS_REQUIRED: '1',
          MBOS_AGENT_RUNNER_INSTANCE_ID: 'ag_1:task_1:task_1',
        }),
      }),
      undefined,
    );
    expect(createOrEnsurePod.mock.calls[0]?.[3]).not.toHaveProperty('mount_path');
    expect(createOrEnsurePod.mock.calls[0]?.[3]).not.toHaveProperty('sub_path');
    expect(createOrEnsurePod.mock.calls[0]?.[3]).not.toHaveProperty('working_dir');
    expect(onlineStateStore.getAgentSessionOnlineState).toHaveBeenCalledWith('ag_1', 'task_1');
  });

  it('polls GET after an async PUT ensure response instead of requiring PUT to return Running', async () => {
    const getPodStatus = vi.fn()
      .mockResolvedValueOnce({ phase: 'offline' })
      .mockResolvedValueOnce({ phase: 'Pending' })
      .mockResolvedValueOnce({ phase: 'Running' });
    const createOrEnsurePod = vi.fn().mockResolvedValue({
      httpStatus: 202,
      workloadId: 'task_1',
      status: 'accepted',
      operationId: 'op_task_1',
      correlationId: 'corr_task_1',
    });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus,
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: buildRunnerHealthFoundExec(),
      },
      {
        getAgentOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
        getAgentSessionOnlineState: vi.fn()
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
      workspaceMount: buildWorkspaceMount(),
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(getPodStatus).toHaveBeenCalledTimes(3);
  });

  it('continues with GET polling after PUT ensure times out when workload id is already known', async () => {
    const getPodStatus = vi.fn()
      .mockResolvedValueOnce({ phase: 'offline' })
      .mockResolvedValueOnce({ phase: 'Pending' })
      .mockResolvedValueOnce({ phase: 'Running' });
    const createOrEnsurePod = vi.fn().mockRejectedValue(Object.assign(
      new Error('asbcp_network_error: create_or_ensure_pod request timeout'),
      { code: 'AGENT_SANDBOX_UNAVAILABLE' },
    ));
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus,
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: buildRunnerHealthFoundExec(),
      },
      {
        getAgentOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
        getAgentSessionOnlineState: vi.fn()
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
      workspaceMount: buildWorkspaceMount(),
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(getPodStatus).toHaveBeenCalledTimes(3);
  });

  it('continues with GET polling after PUT ensure returns HTTP 504 with an empty body', async () => {
    const getPodStatus = vi.fn()
      .mockResolvedValueOnce({ phase: 'offline' })
      .mockResolvedValueOnce({ phase: 'Pending' })
      .mockResolvedValueOnce({ phase: 'Running' });
    const createOrEnsurePod = vi.fn().mockRejectedValue(Object.assign(
      new Error('asbcp_error: create_or_ensure_pod 504'),
      {
        code: 'AGENT_SANDBOX_UNAVAILABLE',
        operation: 'create_or_ensure_pod',
        status: 504,
      },
    ));
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus,
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: buildRunnerHealthFoundExec(),
      },
      {
        getAgentOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
        getAgentSessionOnlineState: vi.fn()
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
      workspaceMount: buildWorkspaceMount(),
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(getPodStatus).toHaveBeenCalledTimes(3);
  });

  it('fails from GET poll evidence after PUT ensure times out and the workload is failed', async () => {
    const getPodStatus = vi.fn()
      .mockResolvedValueOnce({ phase: 'offline' })
      .mockResolvedValueOnce({ phase: 'Failed' });
    const createOrEnsurePod = vi.fn().mockRejectedValue(Object.assign(
      new Error('asbcp_network_error: create_or_ensure_pod TimeoutError'),
      { code: 'AGENT_SANDBOX_UNAVAILABLE' },
    ));
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus,
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: buildRunnerHealthFoundExec(),
      },
      {
        getAgentOnlineState: vi.fn().mockReturnValue(false),
        getAgentSessionOnlineState: vi.fn().mockReturnValue(false),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
      },
    );

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: 'runner:v1',
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    })).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_POD_FAILED',
      message: 'sandbox_pod_failed',
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(getPodStatus).toHaveBeenCalledTimes(2);
  });

  it('fails fast when the workspace mount library root is not the file library root', async () => {
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: buildRunnerHealthFoundExec(),
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
          ...buildWorkspaceMount(),
          libraryRootPath: 'agent-tasks/task_1' as never,
        },
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
      message: 'workspace_library_root_path_invalid',
    });
  });

  it('fails fast when workspace paths are outside the task HOME contract', async () => {
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: buildRunnerHealthFoundExec(),
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
          ...buildWorkspaceMount(),
          workspacePath: '/home/other/workspace',
        },
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
      message: 'workspace_path_invalid',
    });
  });

  it('fails fast when workspace mount paths are relative or contain traversal', async () => {
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: buildRunnerHealthFoundExec(),
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
          ...buildWorkspaceMount(),
          taskHomePath: '../task_1',
        },
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
      message: 'workspace_task_home_path_invalid',
    });
  });

  it('pins k8s managed runner pods to the canonical managed_platform runner mode env', async () => {
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
        exec: buildRunnerHealthFoundExec(),
      },
      {
        getAgentOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
        getAgentSessionOnlineState: vi.fn()
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
        env: {
          MBOS_AGENT_TASK_RUNNER_MODE: 'developer',
          MBOS_RUNNER_MODE: 'k8s_internal',
        },
      }),
      workspaceMount: buildWorkspaceMount(),
    });

    const podBody = createOrEnsurePod.mock.calls[0]?.[3];
    expect(podBody).toEqual(expect.objectContaining({
      env: expect.objectContaining({
        MBOS_AGENT_TASK_RUNNER_MODE: 'managed_platform',
      }),
    }));
  });

  it('normalizes internal websocket base before appending the agent execution endpoint path', async () => {
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
        exec: buildRunnerHealthFoundExec(),
      },
      {
        getAgentOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
        getAgentSessionOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      },
      'ws://172.19.0.1:41000/api/v1',
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
      workspaceMount: buildWorkspaceMount(),
    });

    expect(createOrEnsurePod).toHaveBeenCalledWith(
      'ws_1',
      'proj_1',
      'task_1',
      expect.objectContaining({
        env: expect.objectContaining({
          MBOS_AGENT_WS_URL:
            'ws://172.19.0.1:41000/api/v1/agent-execution/ws?agent_runner_id=ag_1&runner_session_id=task_1',
        }),
      }),
      undefined,
    );
  });

  it('fails fast when internal key is missing', async () => {
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: buildRunnerHealthFoundExec(),
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
        workspaceMount: buildWorkspaceMount(),
      }),
    ).rejects.toMatchObject({ code: 'AGENT_SANDBOX_NOT_CONFIGURED' });
  });

  it('classifies missing managed runner image as image configuration infra failure', async () => {
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: buildRunnerHealthFoundExec(),
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
        agent: buildAgent({ _internal_raw_key: 'ask_test' }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_RUNNER_IMAGE_UNCONFIGURED',
      message: 'agent_runner_image_unconfigured',
    });
  });

  it('fails fast when workspace binding is missing', async () => {
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: buildRunnerHealthFoundExec(),
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
        exec: buildRunnerHealthFoundExec(),
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
        workspaceMount: buildWorkspaceMount(),
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
          exec: buildRunnerHealthFoundExec(),
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
        workspaceMount: buildWorkspaceMount(),
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
        exec: buildRunnerHealthFoundExec(),
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
      workspaceMount: buildWorkspaceMount(),
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
        exec: buildRunnerHealthFoundExec(),
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
      workspaceMount: buildWorkspaceMount(),
    });

    expect(deletePod).toHaveBeenCalledWith('ws_1', 'proj_1', 'task_1', undefined);
    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['workload_release_incomplete', undefined],
    ['AGENT_SANDBOX_RELEASE_INCOMPLETE', 'workload_release_incomplete'],
  ] as const)(
    'fails terminal workload cleanup as retryable release incomplete only for stable release code %s',
    async (code, asbcpCode) => {
      const deletePod = vi.fn().mockRejectedValue(Object.assign(
        new Error(`asbcp_error: delete_pod 409 release terminal truth missing`),
        {
          code,
          ...(asbcpCode ? { asbcpCode } : {}),
          status: 409,
          operation: 'delete_pod',
          retryable: true,
          requestId: `asbcp_req_delete_${code}`,
        },
      ));
      const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValueOnce({ phase: 'Completed' })
            .mockResolvedValueOnce({ phase: 'Running' }),
          createOrEnsurePod,
          deletePod,
          keepalive: vi.fn().mockResolvedValue(null),
          exec: buildRunnerHealthFoundExec(),
        },
        {
          getAgentOnlineState: vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValue(true),
          getAgentSessionOnlineState: vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValue(true),
        },
        'ws://api:20000',
        {
          phasePollIntervalMs: 1,
          onlinePollIntervalMs: 1,
        },
      );

      await expect(manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({
          image: 'runner:v1',
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      })).rejects.toMatchObject({
        code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
        status: 409,
        operation: 'delete_terminal_workload',
        retryable: true,
        releaseDiagnostic: expect.objectContaining({
          status: 409,
          code,
          ...(asbcpCode ? { asbcpCode } : {}),
          operation: 'delete_pod',
          requestId: `asbcp_req_delete_${code}`,
        }),
      });

      expect(deletePod).toHaveBeenCalledWith('ws_1', 'proj_1', 'task_1', undefined);
      expect(createOrEnsurePod).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['workspace_binding_release_incomplete', undefined],
    ['AGENT_SANDBOX_RELEASE_INCOMPLETE', 'workspace_binding_release_incomplete'],
  ] as const)(
    'does not classify workspace binding release code %s as terminal workload release incomplete',
    async (code, asbcpCode) => {
      const deleteError = Object.assign(
        new Error('asbcp_error: delete_pod 409 workspace binding release incomplete'),
        {
          code,
          ...(asbcpCode ? { asbcpCode } : {}),
          status: 409,
          operation: 'delete_pod',
          retryable: true,
          requestId: `asbcp_req_delete_${code}`,
        },
      );
      const deletePod = vi.fn().mockRejectedValue(deleteError);
      const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValueOnce({ phase: 'Completed' })
            .mockResolvedValueOnce({ phase: 'Running' }),
          createOrEnsurePod,
          deletePod,
          keepalive: vi.fn().mockResolvedValue(null),
          exec: buildRunnerHealthFoundExec(),
        },
        {
          getAgentOnlineState: vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValue(true),
          getAgentSessionOnlineState: vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValue(true),
        },
        'ws://api:20000',
        {
          phasePollIntervalMs: 1,
          onlinePollIntervalMs: 1,
        },
      );

      let caught: unknown;
      try {
        await manager.ensureAgentReady({
          workspaceId: 'ws_1',
          projectId: 'proj_1',
          workloadId: 'task_1',
          sessionId: 'task_1',
          agent: buildAgent({
            image: 'runner:v1',
            _internal_raw_key: 'ask_xxx',
          }),
          workspaceMount: buildWorkspaceMount(),
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code,
        ...(asbcpCode ? { asbcpCode } : {}),
        status: 409,
        operation: 'delete_pod',
        retryable: true,
        requestId: `asbcp_req_delete_${code}`,
      });
      expect(caught).not.toMatchObject({
        operation: 'delete_terminal_workload',
        code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
      });
      expect(deletePod).toHaveBeenCalledTimes(1);
      expect(createOrEnsurePod).not.toHaveBeenCalled();
    },
  );

  it('does not classify a normalized release code without a stable ASBCP code', async () => {
    const deletePod = vi.fn().mockRejectedValue(Object.assign(
      new Error('asbcp_error: delete_pod 409 normalized code without stable upstream code'),
      {
        code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
        status: 409,
        operation: 'delete_pod',
        retryable: true,
        requestId: 'asbcp_req_delete_normalized_without_stable_code',
      },
    ));
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'Completed' })
          .mockResolvedValueOnce({ phase: 'Running' }),
        createOrEnsurePod,
        deletePod,
        keepalive: vi.fn().mockResolvedValue(null),
        exec: buildRunnerHealthFoundExec(),
      },
      {
        getAgentOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValue(true),
        getAgentSessionOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValue(true),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
      },
    );

    let caught: unknown;
    try {
      await manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({
          image: 'runner:v1',
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
      status: 409,
      operation: 'delete_pod',
      retryable: true,
      requestId: 'asbcp_req_delete_normalized_without_stable_code',
    });
    expect(caught).not.toMatchObject({
      operation: 'delete_terminal_workload',
    });
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'AGENT_SANDBOX_NOT_FOUND'],
    [409, 'AGENT_SANDBOX_CONFLICT'],
  ] as const)(
    'does not classify ordinary delete %i as terminal workload release incomplete',
    async (status, code) => {
      const deleteError = Object.assign(
        new Error(`asbcp_error: delete_pod ${status} ordinary cleanup failure`),
        {
          code,
          status,
          operation: 'delete_pod',
          retryable: false,
          requestId: `asbcp_req_delete_plain_${status}`,
        },
      );
      const deletePod = vi.fn().mockRejectedValue(deleteError);
      const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValueOnce({ phase: 'Completed' })
            .mockResolvedValueOnce({ phase: 'Running' }),
          createOrEnsurePod,
          deletePod,
          keepalive: vi.fn().mockResolvedValue(null),
          exec: buildRunnerHealthFoundExec(),
        },
        {
          getAgentOnlineState: vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValue(true),
          getAgentSessionOnlineState: vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValue(true),
        },
        'ws://api:20000',
        {
          phasePollIntervalMs: 1,
          onlinePollIntervalMs: 1,
        },
      );

      let caught: unknown;
      try {
        await manager.ensureAgentReady({
          workspaceId: 'ws_1',
          projectId: 'proj_1',
          workloadId: 'task_1',
          sessionId: 'task_1',
          agent: buildAgent({
            image: 'runner:v1',
            _internal_raw_key: 'ask_xxx',
          }),
          workspaceMount: buildWorkspaceMount(),
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code,
        status,
        operation: 'delete_pod',
        retryable: false,
        requestId: `asbcp_req_delete_plain_${status}`,
      });
      expect(caught).not.toMatchObject({
        operation: 'delete_terminal_workload',
        code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
      });
      expect(deletePod).toHaveBeenCalledTimes(1);
      expect(createOrEnsurePod).not.toHaveBeenCalled();
    },
  );

  it('preserves a running workload pod when the agentsmith-runner process exists but session dispatch readiness never arrives', async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const deletePod = vi.fn().mockResolvedValue(undefined);
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
    const exec = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: '123 agentsmith-runner --runner-instance-id runner_instance_id=ag_1:task_1:task_1\n',
      stderr: '',
      duration_ms: 8,
    });
    const options: ConstructorParameters<typeof InternalAgentPodManagerImpl>[3] & {
      sessionReadinessTimeoutMs: number;
    } = {
      startupTimeoutMs: 50,
      phasePollIntervalMs: 1,
      onlinePollIntervalMs: 1,
      sessionReadinessTimeoutMs: 5,
      sleep: vi.fn(async (delayMs: number) => {
        now += delayMs;
      }),
    };

    try {
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValue({ phase: 'Running' }),
          createOrEnsurePod,
          deletePod,
          keepalive: vi.fn().mockResolvedValue(null),
          exec,
        },
        {
          getAgentOnlineState: vi.fn().mockReturnValue(false),
          getAgentSessionOnlineState: vi.fn().mockReturnValue(false),
          getAgentSessionDispatchAuthority: vi.fn().mockResolvedValue('offline'),
        },
        'ws://api:20000',
        options,
      );

      await expect(manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({
          image: 'runner:v1',
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      })).rejects.toMatchObject({
        code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
        message: 'sandbox_startup_timeout',
        workloadId: 'task_1',
        sessionId: 'task_1',
        sandboxOperation: 'wait_for_agent_session_online',
        podPhase: 'Running',
        runnerHealth: expect.objectContaining({
          status: 'runner_process_found',
          exitCode: 0,
          stdout: '123 agentsmith-runner --runner-instance-id runner_instance_id=ag_1:task_1:task_1\n',
          stderr: '',
          durationMs: 8,
        }),
      });

      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledWith(
        'ws_1',
        'proj_1',
        'task_1',
        expect.arrayContaining(['sh', '-lc']),
        expect.any(Number),
        undefined,
      );
      expect(String(exec.mock.calls[0]?.[3]?.[2])).toContain('ps');
      expect(String(exec.mock.calls[0]?.[3]?.[2])).toContain('[a]gentsmith-runner');
      expect(String(exec.mock.calls[0]?.[3]?.[2])).toContain('runner_instance_id=');
      const healthCommand = String(exec.mock.calls[0]?.[3]?.[2]);
      expect(healthCommand).toContain('runner_health_probe=agentsmith_runner');
      expect(healthCommand).toContain("runner_patterns='[a]gentsmith-runner'");
      expect(healthCommand).toContain('pgrep -af "$runner_patterns"');
      expect(healthCommand).toContain('grep -E "$runner_patterns"');
      expect(healthCommand).toContain('--- ps snapshot ---');
      expect(healthCommand).toContain('--- task workspace snapshot ---');
      expect(healthCommand).toContain('--- mount snapshot ---');
      expect(healthCommand).not.toContain('runner_health_error=');
      expect(healthCommand.match(/_patterns=/g) ?? []).toHaveLength(1);
      expect(healthCommand.match(/grep -E/g) ?? []).toHaveLength(1);
      expect(healthCommand).not.toContain('transition-only');
      const healthCommandLines = healthCommand.split('\n');
      const canonicalPgrepCheckLine = healthCommandLines.findIndex((line) => line.includes('pgrep_output='));
      const canonicalPsCheckLine = healthCommandLines.findIndex((line) =>
        line.includes('grep -E "$runner_patterns"'),
      );
      expect(canonicalPgrepCheckLine).toBeGreaterThan(-1);
      expect(canonicalPsCheckLine).toBeGreaterThan(-1);
      expect(canonicalPgrepCheckLine).toBeLessThan(canonicalPsCheckLine);
      expect(deletePod).not.toHaveBeenCalled();
      expect(createOrEnsurePod).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('deletes a stale running workload pod when session readiness times out and runner process is missing', async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const deletePod = vi.fn().mockResolvedValue(undefined);
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
    const exec = vi.fn().mockResolvedValue({
      exit_code: 1,
      stdout: 'runner_health_probe=process_scan\n--- ps snapshot ---\n1 tini\n',
      stderr: 'runner process not found\n',
      duration_ms: 12,
    });
    const options: ConstructorParameters<typeof InternalAgentPodManagerImpl>[3] & {
      sessionReadinessTimeoutMs: number;
    } = {
      startupTimeoutMs: 50,
      phasePollIntervalMs: 1,
      onlinePollIntervalMs: 1,
      sessionReadinessTimeoutMs: 5,
      sleep: vi.fn(async (delayMs: number) => {
        now += delayMs;
      }),
    };

    try {
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValue({ phase: 'Running' }),
          createOrEnsurePod,
          deletePod,
          keepalive: vi.fn().mockResolvedValue(null),
          exec,
        },
        {
          getAgentOnlineState: vi.fn().mockReturnValue(false),
          getAgentSessionOnlineState: vi.fn().mockReturnValue(false),
          getAgentSessionDispatchAuthority: vi.fn().mockResolvedValue('offline'),
        },
        'ws://api:20000',
        options,
      );

      await expect(manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({
          image: 'runner:v1',
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      })).rejects.toMatchObject({
        code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
        message: 'sandbox_runner_bootstrap_unhealthy',
        workloadId: 'task_1',
        sessionId: 'task_1',
        sandboxOperation: 'wait_for_agent_session_online',
        podPhase: 'Running',
        stalePodDeleted: true,
        runnerHealth: expect.objectContaining({
          status: 'runner_process_missing',
          exitCode: 1,
          stdout: 'runner_health_probe=process_scan\n--- ps snapshot ---\n1 tini\n',
          stderr: 'runner process not found\n',
          durationMs: 12,
        }),
      });

      expect(exec).toHaveBeenCalledTimes(1);
      expect(deletePod).toHaveBeenCalledTimes(1);
      expect(deletePod).toHaveBeenCalledWith('ws_1', 'proj_1', 'task_1', undefined);
      expect(createOrEnsurePod).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('includes runner health exec failures in the timeout error without treating them as process-missing proof', async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const deletePod = vi.fn().mockResolvedValue(undefined);
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: { phase: 'Running' } });
    const exec = vi.fn().mockRejectedValue(Object.assign(new Error('exec transport unavailable'), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
    }));
    const options: ConstructorParameters<typeof InternalAgentPodManagerImpl>[3] & {
      sessionReadinessTimeoutMs: number;
    } = {
      startupTimeoutMs: 50,
      phasePollIntervalMs: 1,
      onlinePollIntervalMs: 1,
      sessionReadinessTimeoutMs: 5,
      sleep: vi.fn(async (delayMs: number) => {
        now += delayMs;
      }),
    };

    try {
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValue({ phase: 'Running' }),
          createOrEnsurePod,
          deletePod,
          keepalive: vi.fn().mockResolvedValue(null),
          exec,
        },
        {
          getAgentOnlineState: vi.fn().mockReturnValue(false),
          getAgentSessionOnlineState: vi.fn().mockReturnValue(false),
          getAgentSessionDispatchAuthority: vi.fn().mockResolvedValue('offline'),
        },
        'ws://api:20000',
        options,
      );

      await expect(manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({
          image: 'runner:v1',
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      })).rejects.toMatchObject({
        code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
        message: 'sandbox_startup_timeout',
        workloadId: 'task_1',
        sessionId: 'task_1',
        sandboxOperation: 'wait_for_agent_session_online',
        podPhase: 'Running',
        runnerHealth: expect.objectContaining({
          status: 'exec_failed',
          error: expect.objectContaining({
            code: 'AGENT_SANDBOX_UNAVAILABLE',
            message: 'exec transport unavailable',
          }),
        }),
      });

      expect(exec).toHaveBeenCalledTimes(1);
      expect(deletePod).not.toHaveBeenCalled();
      expect(createOrEnsurePod).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
    }
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
        exec: buildRunnerHealthFoundExec(),
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
        workspaceMount: buildWorkspaceMount(),
      }),
    ).rejects.toMatchObject({ code: 'AGENT_SANDBOX_REMOTE_OWNED' });
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('treats local dispatch authority as ready even if the weaker local session-online boolean has not caught up yet', async () => {
    const createOrEnsurePod = vi.fn();
    const exec = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: '123 agentsmith-runner --runner-instance-id runner_instance_id=ag_1:task_1:task_1\n',
      stderr: '',
      duration_ms: 4,
    });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec,
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
        workspaceMount: buildWorkspaceMount(),
      }),
    ).resolves.toBeUndefined();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('rejects an already ready session when health exec cannot find the canonical agentsmith-runner process', async () => {
    const createOrEnsurePod = vi.fn();
    const getPodStatus = vi.fn();
    const exec = vi.fn().mockResolvedValue({
      exit_code: 1,
      stdout: [
        'runner_health_probe=agentsmith_runner',
        'runner_instance_id=ag_1:task_1:task_1',
        '--- ps snapshot ---',
        '1 tini',
        '--- mount snapshot ---',
        'tmpfs /tmp tmpfs rw 0 0',
      ].join('\n'),
      stderr: '',
      duration_ms: 6,
    });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus,
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec,
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
        workspaceMount: buildWorkspaceMount(),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
      message: 'sandbox_runner_bootstrap_unhealthy',
      workloadId: 'task_1',
      sessionId: 'task_1',
      sandboxOperation: 'verify_ready_session_runner_health',
      runnerHealth: expect.objectContaining({
        status: 'runner_process_missing',
        exitCode: 1,
        stdout: expect.stringContaining('--- ps snapshot ---'),
        durationMs: 6,
      }),
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(
      'ws_1',
      'proj_1',
      'task_1',
      expect.arrayContaining(['sh', '-lc']),
      expect.any(Number),
      undefined,
    );
    expect(String(exec.mock.calls[0]?.[3]?.[2])).not.toContain('runner_health_error=');
    expect(getPodStatus).not.toHaveBeenCalled();
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
        exec: buildRunnerHealthFoundExec(),
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
      workspaceMount: buildWorkspaceMount(),
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
      workspaceMount: buildWorkspaceMount(),
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
        exec: buildRunnerHealthFoundExec(),
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
      workspaceMount: buildWorkspaceMount(),
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
      workspaceMount: buildWorkspaceMount(),
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
        exec: buildRunnerHealthFoundExec(),
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
      workspaceMount: buildWorkspaceMount(),
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
      workspaceMount: buildWorkspaceMount(),
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
        exec: buildRunnerHealthFoundExec(),
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
      workspaceMount: buildWorkspaceMount(),
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
      workspaceMount: buildWorkspaceMount(),
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
        exec: buildRunnerHealthFoundExec(),
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
      workspaceMount: buildWorkspaceMount(),
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
      workspaceMount: buildWorkspaceMount(),
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
      workspaceMount: buildWorkspaceMount(),
    })).resolves.toBeUndefined();
  });
});
