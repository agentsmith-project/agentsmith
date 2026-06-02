import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InternalAgentPodManagerImpl, sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import type { InternalAgentWorkspaceMount } from './internal-agent-workspace-provisioner.js';
import type { AgentRecord } from './resource-models.js';
import {
  INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS,
} from '@mbos/contracts';

const RUNNER_DIGEST_A = `sha256:${'a'.repeat(64)}`;
const RUNNER_DIGEST_B = `sha256:${'b'.repeat(64)}`;
const MANAGED_RUNNER_IMAGE_A = `kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_A}`;
const LIVE_RUNNER_IMAGE_ID_A = `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_A}`;
const LIVE_RUNNER_IMAGE_ID_B = `docker-pullable://kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_B}`;

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

function buildRunningPodStatus(): { phase: 'Running'; image_id: string } {
  return {
    phase: 'Running',
    image_id: LIVE_RUNNER_IMAGE_ID_A,
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

async function runHealthCommandWithProcessTable(input: {
  command: string[];
  processTable: string;
  timeoutSeconds: number;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}> {
  const executable = input.command[0];
  if (!executable) {
    throw new Error('health_command_executable_missing');
  }
  const tempDir = await mkdtemp(join(tmpdir(), 'agentsmith-runner-health-'));
  const startedAt = Date.now();
  try {
    const fakePgrepPath = join(tempDir, 'pgrep');
    const fakePsPath = join(tempDir, 'ps');
    await writeFile(fakePgrepPath, [
      '#!/bin/sh',
      'pattern=""',
      'for arg in "$@"; do',
      '  pattern="$arg"',
      'done',
      'printf "%s\\n" "$FAKE_PROCESS_TABLE" | grep -E "$pattern"',
      '',
    ].join('\n'));
    await writeFile(fakePsPath, [
      '#!/bin/sh',
      'printf "%s\\n" "$FAKE_PROCESS_TABLE"',
      '',
    ].join('\n'));
    await chmod(fakePgrepPath, 0o755);
    await chmod(fakePsPath, 0o755);

    return await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    }>((resolve, reject) => {
      const child = spawn(executable, input.command.slice(1), {
        env: {
          ...process.env,
          PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          FAKE_PROCESS_TABLE: input.processTable,
          MBOS_AGENT_RUNNER_INSTANCE_ID: 'ag_1:task_1:task_1',
        },
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
      }, Math.max(1, input.timeoutSeconds) * 1_000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({
          exitCode: code ?? 124,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildProcessTableRunnerHealthExec(processTable: string) {
  return vi.fn(async (
    _workspaceId: string,
    _projectId: string,
    _workloadId: string,
    command: string[],
    timeoutSeconds = 5,
  ) => {
    const result = await runHealthCommandWithProcessTable({
      command,
      processTable,
      timeoutSeconds,
    });
    return {
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration_ms: result.durationMs,
    };
  });
}

describe('internal-agent-pod-manager', () => {
  it('sanitizes workload id for k8s naming constraints', () => {
    expect(sanitizeWorkloadId('TASK_ABC.123###')).toBe('task-abc-123');
    expect(sanitizeWorkloadId('---')).toBe('workload');
  });

  it('retries public sandbox readyz check on ASBCP readiness not_ready', async () => {
    const readinessError = Object.assign(new Error('raw pvc pending detail must stay server-side'), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'readyz',
      asbcpCode: 'not_ready',
      retryable: true,
      requestId: 'asbcp_req_readyz_public_retry',
      retryAfterMs: 1_000,
    });
    const checkReady = vi.fn()
      .mockRejectedValueOnce(readinessError)
      .mockResolvedValueOnce(undefined);
    const readinessSleep = vi.fn(async () => undefined);
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady,
        getPodStatus: vi.fn(),
        createOrEnsurePod: vi.fn(),
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: buildRunnerHealthFoundExec(),
      },
      { getAgentOnlineState: vi.fn().mockReturnValue(false) },
      'ws://api:20000',
      { sleep: readinessSleep },
    );

    await expect(manager.checkReady()).resolves.toBeUndefined();

    expect(checkReady).toHaveBeenCalledTimes(2);
    expect(readinessSleep).toHaveBeenCalledTimes(1);
    expect(readinessSleep).toHaveBeenCalledWith(1_000);
  });

  it('creates pod with image command enabled and waits for online', async () => {
    const getPodStatus = vi.fn()
      .mockResolvedValueOnce({ phase: 'offline' })
      .mockResolvedValueOnce(buildRunningPodStatus());
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
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
        image: MANAGED_RUNNER_IMAGE_A,
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
          MBOS_AGENT_BUILTIN_SKILLS: 'mbos-context',
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

  it('rejects a just-ensured running pod when live image identity stays unavailable', async () => {
    let sessionOnline = false;
    const getPodStatus = vi.fn()
      .mockResolvedValueOnce({ phase: 'offline' })
      .mockResolvedValueOnce({ phase: 'Running' });
    const createOrEnsurePod = vi.fn().mockImplementation(async () => {
      sessionOnline = true;
      return { httpStatus: 201, pod: { phase: 'Running' } };
    });
    const exec = buildRunnerHealthFoundExec();
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
        getAgentOnlineState: vi.fn(() => sessionOnline),
        getAgentSessionOnlineState: vi.fn(() => sessionOnline),
      },
      'ws://api:20000',
    );

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: MANAGED_RUNNER_IMAGE_A,
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    })).rejects.toMatchObject({
      code: 'AGENT_RUNNER_IMAGE_MISMATCH',
      message: 'agent_runner_image_identity_unavailable',
      expectedImage: MANAGED_RUNNER_IMAGE_A,
      expectedDigest: RUNNER_DIGEST_A,
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(getPodStatus).toHaveBeenCalledTimes(2);
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects a just-ensured running pod when ASBCP only returns a bare CRI status image', async () => {
    let sessionOnline = false;
    let pollCount = 0;
    const getPodStatus = vi.fn(async () => {
      pollCount += 1;
      if (pollCount === 1) {
        return { phase: 'offline' };
      }
      sessionOnline = true;
      return {
        phase: 'Running',
        image: RUNNER_DIGEST_B,
      };
    });
    const createOrEnsurePod = vi.fn().mockResolvedValue({
      httpStatus: 202,
      workloadId: 'task_1',
      status: 'accepted',
    });
    const exec = buildRunnerHealthFoundExec();
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
        getAgentOnlineState: vi.fn(() => sessionOnline),
        getAgentSessionOnlineState: vi.fn(() => sessionOnline),
      },
      'ws://api:20000',
    );

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: MANAGED_RUNNER_IMAGE_A,
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    })).rejects.toMatchObject({
      code: 'AGENT_RUNNER_IMAGE_MISMATCH',
      message: 'agent_runner_image_identity_unavailable',
      expectedImage: MANAGED_RUNNER_IMAGE_A,
      expectedDigest: RUNNER_DIGEST_A,
      actualImageRef: RUNNER_DIGEST_B,
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(getPodStatus).toHaveBeenCalledTimes(3);
    expect(exec).not.toHaveBeenCalled();
  });

  it('polls GET after an async PUT ensure response instead of requiring PUT to return Running', async () => {
    const getPodStatus = vi.fn()
      .mockResolvedValueOnce({ phase: 'offline' })
      .mockResolvedValueOnce({ phase: 'Pending' })
      .mockResolvedValueOnce(buildRunningPodStatus());
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
        image: MANAGED_RUNNER_IMAGE_A,
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(getPodStatus).toHaveBeenCalledTimes(3);
  });

  it('retries createOrEnsurePod on ASBCP readiness not_ready and reaches Running', async () => {
    const getPodStatus = vi.fn().mockResolvedValueOnce({ phase: 'offline' });
    const readinessError = Object.assign(new Error('raw pvc pending detail must stay server-side'), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'create_or_ensure_pod',
      asbcpCode: 'not_ready',
      retryable: true,
      requestId: 'asbcp_req_workload_retry',
      retryAfterMs: 1_000,
    });
    const createOrEnsurePod = vi.fn()
      .mockRejectedValueOnce(readinessError)
      .mockResolvedValueOnce({ httpStatus: 201, pod: buildRunningPodStatus() });
    const readinessSleep = vi.fn(async () => undefined);
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
        getAgentSessionOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
        sleep: readinessSleep,
      },
    );

    await manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: MANAGED_RUNNER_IMAGE_A,
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(2);
    expect(readinessSleep).toHaveBeenCalledTimes(1);
    expect(readinessSleep).toHaveBeenCalledWith(1_000);
    expect(getPodStatus).toHaveBeenCalledTimes(1);
  });

  it.each([502, 503])('retries createOrEnsurePod on generic ASBCP %s unavailable and reaches Running', async (status) => {
    const getPodStatus = vi.fn().mockResolvedValueOnce({ phase: 'offline' });
    const transientError = Object.assign(new Error(`asbcp_error: create_or_ensure_pod ${status}`), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status,
      operation: 'create_or_ensure_pod',
      retryable: true,
    });
    const createOrEnsurePod = vi.fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({ httpStatus: 201, pod: buildRunningPodStatus() });
    const readinessSleep = vi.fn(async () => undefined);
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
        getAgentSessionOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
        sleep: readinessSleep,
      },
    );

    await manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: MANAGED_RUNNER_IMAGE_A,
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(2);
    expect(readinessSleep).toHaveBeenCalledTimes(1);
    expect(readinessSleep).toHaveBeenCalledWith(1_000);
    expect(getPodStatus).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 403, code: 'AGENT_SANDBOX_FORBIDDEN' },
    { status: 409, code: 'AGENT_SANDBOX_CONFLICT' },
  ])('does not retry non-readiness createOrEnsurePod status $status', async ({ status, code }) => {
    const getPodStatus = vi.fn().mockResolvedValueOnce({ phase: 'offline' });
    const createOrEnsurePod = vi.fn().mockRejectedValue(Object.assign(
      new Error('asbcp_non_retryable_error'),
      {
        code,
        status,
        operation: 'create_or_ensure_pod',
        retryable: false,
      },
    ));
    const readinessSleep = vi.fn(async () => undefined);
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
        getAgentSessionOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
        sleep: readinessSleep,
      },
    );

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: MANAGED_RUNNER_IMAGE_A,
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    })).rejects.toMatchObject({
      code,
      status,
      operation: 'create_or_ensure_pod',
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(readinessSleep).not.toHaveBeenCalled();
    expect(getPodStatus).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-retryable ASBCP internal_error during createOrEnsurePod', async () => {
    const getPodStatus = vi.fn().mockResolvedValueOnce({ phase: 'offline' });
    const internalError = Object.assign(new Error('asbcp_internal_error'), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'create_or_ensure_pod',
      asbcpCode: 'internal_error',
      retryable: false,
      asbcpRetryable: false,
    });
    const createOrEnsurePod = vi.fn().mockRejectedValue(internalError);
    const readinessSleep = vi.fn(async () => undefined);
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
        getAgentSessionOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
        sleep: readinessSleep,
      },
    );

    await expect(manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: MANAGED_RUNNER_IMAGE_A,
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    })).rejects.toBe(internalError);

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(readinessSleep).not.toHaveBeenCalled();
    expect(getPodStatus).toHaveBeenCalledTimes(1);
  });

  it('continues with GET polling after PUT ensure times out when workload id is already known', async () => {
    const getPodStatus = vi.fn()
      .mockResolvedValueOnce({ phase: 'offline' })
      .mockResolvedValueOnce({ phase: 'Pending' })
      .mockResolvedValueOnce(buildRunningPodStatus());
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
        image: MANAGED_RUNNER_IMAGE_A,
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
      .mockResolvedValueOnce(buildRunningPodStatus());
    const createOrEnsurePod = vi.fn().mockRejectedValue(Object.assign(
      new Error('asbcp_error: create_or_ensure_pod 504'),
      {
        code: 'AGENT_SANDBOX_UNAVAILABLE',
        operation: 'create_or_ensure_pod',
        status: 504,
      },
    ));
    const readinessSleep = vi.fn(async () => undefined);
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
        sleep: readinessSleep,
      },
    );

    await manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({
        image: MANAGED_RUNNER_IMAGE_A,
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    });

    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
    expect(readinessSleep).not.toHaveBeenCalled();
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        agent: buildAgent({ image: MANAGED_RUNNER_IMAGE_A, _internal_raw_key: 'ask_test' }),
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
        agent: buildAgent({ image: MANAGED_RUNNER_IMAGE_A, _internal_raw_key: 'ask_test' }),
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
        agent: buildAgent({ image: MANAGED_RUNNER_IMAGE_A, _internal_raw_key: 'ask_test' }),
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
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'offline' })
          .mockResolvedValueOnce(buildRunningPodStatus()),
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
        image: MANAGED_RUNNER_IMAGE_A,
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
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'offline' })
          .mockResolvedValueOnce(buildRunningPodStatus()),
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        agent: buildAgent({ image: MANAGED_RUNNER_IMAGE_A }),
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

  it.each([
    ['legacy image', `kind-registry:5000/mbos/agentsmith-agent-task-runner@${RUNNER_DIGEST_A}`, 'managed_runner_image_legacy_ref_rejected'],
    ['tag-only image', 'kind-registry:5000/mbos/agentsmith-managed-runner:v1', 'managed_runner_image_digest_required'],
    ['latest image', 'kind-registry:5000/mbos/agentsmith-managed-runner:latest', 'managed_runner_image_latest_rejected'],
  ])('rejects %s before creating an internal managed runner pod', async (_label, image, reason) => {
    const createOrEnsurePod = vi.fn();
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn().mockResolvedValue({ phase: 'offline' }),
        createOrEnsurePod,
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
        agent: buildAgent({ image, _internal_raw_key: 'ask_test' }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_RUNNER_IMAGE_INVALID',
      message: expect.stringContaining(reason),
    });
    expect(createOrEnsurePod).not.toHaveBeenCalled();
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
        agent: buildAgent({ image: MANAGED_RUNNER_IMAGE_A, _internal_raw_key: 'ask_test' }),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_NOT_CONFIGURED',
      message: 'workspace_binding_id_required',
    });
  });

  it('retries sandbox readyz preflight on ASBCP readiness not_ready and reaches Running', async () => {
    const readinessError = Object.assign(new Error('raw pvc pending detail must stay server-side'), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'readyz',
      asbcpCode: 'not_ready',
      retryable: true,
      requestId: 'asbcp_req_readyz_retry',
      retryAfterMs: 1_000,
    });
    const checkReady = vi.fn()
      .mockRejectedValueOnce(readinessError)
      .mockResolvedValueOnce(undefined);
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
    const readinessSleep = vi.fn(async () => undefined);
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady,
        getPodStatus: vi.fn().mockResolvedValueOnce({ phase: 'offline' }),
        createOrEnsurePod,
        deletePod: vi.fn().mockResolvedValue(undefined),
        keepalive: vi.fn().mockResolvedValue(null),
        exec: buildRunnerHealthFoundExec(),
      },
      {
        getAgentOnlineState: vi.fn().mockReturnValue(false),
        getAgentSessionOnlineState: vi.fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      },
      'ws://api:20000',
      {
        phasePollIntervalMs: 1,
        onlinePollIntervalMs: 1,
        sleep: readinessSleep,
      },
    );

    await manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({ image: MANAGED_RUNNER_IMAGE_A, _internal_raw_key: 'ask_test' }),
      workspaceMount: buildWorkspaceMount(),
    });

    expect(checkReady).toHaveBeenCalledTimes(2);
    expect(readinessSleep).toHaveBeenCalledTimes(1);
    expect(readinessSleep).toHaveBeenCalledWith(1_000);
    expect(createOrEnsurePod).toHaveBeenCalledTimes(1);
  });

  it('aborts sandbox readyz preflight readiness retry without continuing to pod ensure', async () => {
    const readinessError = Object.assign(new Error('raw pvc pending detail must stay server-side'), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'readyz',
      asbcpCode: 'not_ready',
      retryable: true,
      requestId: 'asbcp_req_readyz_abort',
      retryAfterMs: 1_000,
    });
    const sleepDeferred = createDeferred<void>();
    const checkReady = vi.fn().mockRejectedValue(readinessError);
    const getPodStatus = vi.fn();
    const createOrEnsurePod = vi.fn();
    const readinessSleep = vi.fn(() => sleepDeferred.promise);
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady,
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
        sleep: readinessSleep,
      },
    );
    const controller = new AbortController();
    const result = manager.ensureAgentReady({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      workloadId: 'task_1',
      sessionId: 'task_1',
      agent: buildAgent({ image: MANAGED_RUNNER_IMAGE_A, _internal_raw_key: 'ask_test' }),
      workspaceMount: buildWorkspaceMount(),
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(readinessSleep).toHaveBeenCalledTimes(1);
    });
    controller.abort('user_cancel_requested');

    await expect(result).rejects.toMatchObject({
      code: 'AGENT_CANCELLED',
      message: 'user_cancel_requested',
    });
    expect(checkReady).toHaveBeenCalledTimes(1);
    expect(getPodStatus).not.toHaveBeenCalled();
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('fails with AGENT_SANDBOX_UNAVAILABLE when sandbox readyz preflight fails', async () => {
    const checkReady = vi.fn().mockRejectedValue(Object.assign(
      new Error('asbcp_readyz_internal_error'),
      {
        code: 'AGENT_SANDBOX_UNAVAILABLE',
        status: 500,
        operation: 'readyz',
        asbcpCode: 'internal_error',
        retryable: false,
      },
    ));
    const getPodStatus = vi.fn();
    const createOrEnsurePod = vi.fn();
    const readinessSleep = vi.fn(async () => undefined);
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady,
        getPodStatus,
        createOrEnsurePod,
        deletePod: vi.fn(),
        keepalive: vi.fn(),
        exec: buildRunnerHealthFoundExec(),
      },
      { getAgentOnlineState: vi.fn().mockReturnValue(false) },
      'ws://api:20000',
      {
        sleep: readinessSleep,
      },
    );

    await expect(
      manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({ image: MANAGED_RUNNER_IMAGE_A, _internal_raw_key: 'ask_test' }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      message: 'sandbox_not_ready',
    });
    expect(checkReady).toHaveBeenCalledTimes(1);
    expect(readinessSleep).not.toHaveBeenCalled();
    expect(getPodStatus).not.toHaveBeenCalled();
    expect(createOrEnsurePod).not.toHaveBeenCalled();
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
      const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValueOnce({ phase: 'offline' })
            .mockResolvedValueOnce(buildRunningPodStatus()),
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
          image: MANAGED_RUNNER_IMAGE_A,
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
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'offline' })
          .mockResolvedValueOnce(buildRunningPodStatus()),
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
        image: MANAGED_RUNNER_IMAGE_A,
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
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'Completed' })
          .mockResolvedValueOnce({ phase: 'offline' })
          .mockResolvedValueOnce(buildRunningPodStatus()),
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
        image: MANAGED_RUNNER_IMAGE_A,
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
      const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValueOnce({ phase: 'Completed' })
            .mockResolvedValueOnce(buildRunningPodStatus()),
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
          image: MANAGED_RUNNER_IMAGE_A,
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
      const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValueOnce({ phase: 'Completed' })
            .mockResolvedValueOnce(buildRunningPodStatus()),
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
            image: MANAGED_RUNNER_IMAGE_A,
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
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'Completed' })
          .mockResolvedValueOnce(buildRunningPodStatus()),
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
          image: MANAGED_RUNNER_IMAGE_A,
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
      const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn()
            .mockResolvedValueOnce({ phase: 'Completed' })
            .mockResolvedValueOnce(buildRunningPodStatus()),
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
            image: MANAGED_RUNNER_IMAGE_A,
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

  it('uses the startup timeout as the default session readiness budget', async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const deletePod = vi.fn().mockResolvedValue(undefined);
    const exec = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: '123 agentsmith-runner --runner-instance-id runner_instance_id=ag_1:task_1:task_1\n',
      stderr: '',
      duration_ms: 8,
    });
    const options: ConstructorParameters<typeof InternalAgentPodManagerImpl>[3] = {
      startupTimeoutMs: 100_000,
      phasePollIntervalMs: 1,
      onlinePollIntervalMs: 5_000,
      sleep: vi.fn(async (delayMs: number) => {
        now += delayMs;
      }),
    };

    try {
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus: vi.fn().mockResolvedValue(buildRunningPodStatus()),
          createOrEnsurePod: vi.fn(),
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
          image: MANAGED_RUNNER_IMAGE_A,
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      })).rejects.toMatchObject({
        code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
        message: 'sandbox_startup_timeout',
        sandboxOperation: 'wait_for_agent_session_online',
        runnerHealth: expect.objectContaining({
          status: 'runner_process_found',
        }),
      });

      expect(now).toBe(100_000);
      expect(exec).toHaveBeenCalledTimes(1);
      expect(deletePod).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('preserves a running workload pod when the agentsmith-runner process exists but session dispatch readiness never arrives', async () => {
    let now = 0;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const deletePod = vi.fn().mockResolvedValue(undefined);
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
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
            .mockResolvedValue(buildRunningPodStatus()),
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
          image: MANAGED_RUNNER_IMAGE_A,
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
      expect(String(exec.mock.calls[0]?.[3]?.[2])).toContain('[a]gentsmith-agent-task-runner');
      expect(String(exec.mock.calls[0]?.[3]?.[2])).toContain('runner_instance_id=');
      const healthCommand = String(exec.mock.calls[0]?.[3]?.[2]);
      expect(healthCommand).toContain('runner_health_probe=agentsmith_runner');
      expect(healthCommand).toContain("runner_patterns='([a]gentsmith-runner|[a]gentsmith-agent-task-runner)'");
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
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
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
            .mockResolvedValue(buildRunningPodStatus()),
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
          image: MANAGED_RUNNER_IMAGE_A,
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
    const createOrEnsurePod = vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() });
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
            .mockResolvedValue(buildRunningPodStatus()),
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
          image: MANAGED_RUNNER_IMAGE_A,
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
          image: MANAGED_RUNNER_IMAGE_A,
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
          image: MANAGED_RUNNER_IMAGE_A,
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).resolves.toBeUndefined();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('rejects a ready session when the live pod image digest differs from the expected runner image digest', async () => {
    const rawKey = 'ask_do_not_leak_in_image_mismatch';
    const createOrEnsurePod = vi.fn();
    const getPodStatus = vi.fn().mockResolvedValue({
      phase: 'Running',
      image_id: LIVE_RUNNER_IMAGE_ID_B,
    });
    const exec = buildRunnerHealthFoundExec();
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

    let caught: unknown;
    try {
      await manager.ensureAgentReady({
        workspaceId: 'ws_1',
        projectId: 'proj_1',
        workloadId: 'task_1',
        sessionId: 'task_1',
        agent: buildAgent({
          image: MANAGED_RUNNER_IMAGE_A,
          _internal_raw_key: rawKey,
          env: {
            MBOS_AGENT_KEY: 'env_key_should_not_leak',
          },
        }),
        workspaceMount: buildWorkspaceMount(),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'AGENT_RUNNER_IMAGE_MISMATCH',
      message: 'agent_runner_image_mismatch',
      expectedImage: MANAGED_RUNNER_IMAGE_A,
      expectedDigest: RUNNER_DIGEST_A,
      actualImageId: LIVE_RUNNER_IMAGE_ID_B,
      actualDigest: RUNNER_DIGEST_B,
    });
    const diagnosticText = JSON.stringify(caught);
    expect(diagnosticText).not.toContain(rawKey);
    expect(diagnosticText).not.toContain('env_key_should_not_leak');
    expect(diagnosticText).not.toContain('MBOS_AGENT_KEY');
    expect(getPodStatus).toHaveBeenCalledTimes(1);
    expect(exec).not.toHaveBeenCalled();
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('accepts a ready session when the live pod image digest matches the expected runner image digest', async () => {
    const createOrEnsurePod = vi.fn();
    const getPodStatus = vi.fn().mockResolvedValue({
      phase: 'Running',
      image_id: LIVE_RUNNER_IMAGE_ID_A,
    });
    const exec = buildRunnerHealthFoundExec();
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
          image: MANAGED_RUNNER_IMAGE_A,
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).resolves.toBeUndefined();
    expect(getPodStatus).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('rejects a ready session when live imageID mismatches even if desired image ref matches', async () => {
    const createOrEnsurePod = vi.fn();
    const getPodStatus = vi.fn().mockResolvedValue({
      phase: 'Running',
      image_ref: MANAGED_RUNNER_IMAGE_A,
      image_id: LIVE_RUNNER_IMAGE_ID_B,
    });
    const exec = buildRunnerHealthFoundExec();
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
          image: MANAGED_RUNNER_IMAGE_A,
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_RUNNER_IMAGE_MISMATCH',
      message: 'agent_runner_image_mismatch',
      expectedImage: MANAGED_RUNNER_IMAGE_A,
      expectedDigest: RUNNER_DIGEST_A,
      actualImageRef: MANAGED_RUNNER_IMAGE_A,
      actualImageId: LIVE_RUNNER_IMAGE_ID_B,
      actualDigest: RUNNER_DIGEST_B,
    });
    expect(getPodStatus).toHaveBeenCalledTimes(1);
    expect(exec).not.toHaveBeenCalled();
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('accepts a ready session when live imageID matches even if desired image ref differs', async () => {
    const createOrEnsurePod = vi.fn();
    const getPodStatus = vi.fn().mockResolvedValue({
      phase: 'Running',
      image_ref: `kind-registry:5000/mbos/agentsmith-managed-runner@${RUNNER_DIGEST_B}`,
      image_id: LIVE_RUNNER_IMAGE_ID_A,
    });
    const exec = buildRunnerHealthFoundExec();
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
          image: MANAGED_RUNNER_IMAGE_A,
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).resolves.toBeUndefined();
    expect(getPodStatus).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('rejects a bare image_id digest that does not match the expected runner image digest', async () => {
    const createOrEnsurePod = vi.fn();
    const getPodStatus = vi.fn().mockResolvedValue({
      phase: 'Running',
      image_ref: RUNNER_DIGEST_B,
      image_id: RUNNER_DIGEST_B,
    });
    const exec = buildRunnerHealthFoundExec();
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
          image: MANAGED_RUNNER_IMAGE_A,
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_RUNNER_IMAGE_MISMATCH',
      message: 'agent_runner_image_mismatch',
      expectedImage: MANAGED_RUNNER_IMAGE_A,
      expectedDigest: RUNNER_DIGEST_A,
      actualImageRef: RUNNER_DIGEST_B,
      actualImageId: RUNNER_DIGEST_B,
      actualDigest: RUNNER_DIGEST_B,
    });
    expect(exec).not.toHaveBeenCalled();
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('accepts ready-session health when the current agentsmith-agent-task-runner process exists', async () => {
    const createOrEnsurePod = vi.fn();
    const getPodStatus = vi.fn().mockResolvedValue(buildRunningPodStatus());
    const exec = buildProcessTableRunnerHealthExec([
      '1 0 S tini /usr/bin/tini -- agent-task-runner',
      '14 1 S agentsmith-agent-task-runner agentsmith-agent-task-runner runner_instance_ag_1_task_1',
    ].join('\n'));
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
          image: MANAGED_RUNNER_IMAGE_A,
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).resolves.toBeUndefined();

    expect(exec).toHaveBeenCalledTimes(1);
    const healthCommand = String(exec.mock.calls[0]?.[3]?.[2]);
    expect(healthCommand).toContain('[a]gentsmith-agent-task-runner');
    expect(getPodStatus).toHaveBeenCalledTimes(1);
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('rejects ready-session health when only the tini agent-task-runner wrapper exists', async () => {
    const createOrEnsurePod = vi.fn();
    const getPodStatus = vi.fn().mockResolvedValue(buildRunningPodStatus());
    const exec = buildProcessTableRunnerHealthExec('1 0 S tini /usr/bin/tini -- agent-task-runner');
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
          image: MANAGED_RUNNER_IMAGE_A,
          _internal_raw_key: 'ask_xxx',
        }),
        workspaceMount: buildWorkspaceMount(),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
      message: 'sandbox_runner_bootstrap_unhealthy',
      sandboxOperation: 'verify_ready_session_runner_health',
      runnerHealth: expect.objectContaining({
        status: 'runner_process_missing',
        exitCode: 1,
        stdout: expect.stringContaining('/usr/bin/tini -- agent-task-runner'),
      }),
    });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('rejects an already ready session when health exec cannot find the managed runner process', async () => {
    const createOrEnsurePod = vi.fn();
    const getPodStatus = vi.fn().mockResolvedValue(buildRunningPodStatus());
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
          image: MANAGED_RUNNER_IMAGE_A,
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
    expect(getPodStatus).toHaveBeenCalledTimes(1);
    expect(createOrEnsurePod).not.toHaveBeenCalled();
  });

  it('redacts ready-session runner health command and output diagnostics', async () => {
    const previousHealthCommand = process.env.INTERNAL_AGENT_RUNNER_HEALTH_COMMAND;
    const fakeSkToken = 'sk-runnerhealthfake000000000000';
    const commandSecret = 'command-secret-value';
    process.env.INTERNAL_AGENT_RUNNER_HEALTH_COMMAND = `echo ${fakeSkToken} && echo api_key=${commandSecret}`;

    try {
      const createOrEnsurePod = vi.fn();
      const getPodStatus = vi.fn().mockResolvedValue(buildRunningPodStatus());
      const longOutput = 'x'.repeat(9_000);
      const exec = vi.fn().mockResolvedValue({
        exit_code: 1,
        stdout: `stdout token=stdout-secret-value ${fakeSkToken} ${longOutput}`,
        stderr: `stderr password=stderr-secret-value ${fakeSkToken} ${longOutput}`,
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

      let caught: unknown;
      try {
        await manager.ensureAgentReady({
          workspaceId: 'ws_1',
          projectId: 'proj_1',
          workloadId: 'task_1',
          sessionId: 'task_1',
          agent: buildAgent({
            image: MANAGED_RUNNER_IMAGE_A,
            _internal_raw_key: 'ask_xxx',
          }),
          workspaceMount: buildWorkspaceMount(),
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
        message: 'sandbox_runner_bootstrap_unhealthy',
        sandboxOperation: 'verify_ready_session_runner_health',
        runnerHealth: expect.objectContaining({
          status: 'runner_process_missing',
          command: expect.arrayContaining(['sh', '-lc', expect.stringContaining('[redacted]')]),
          stdout: expect.stringContaining('[redacted]'),
          stderr: expect.stringContaining('[redacted]'),
        }),
      });
      const runnerHealth = (caught as {
        runnerHealth?: { command?: string[]; stdout?: string; stderr?: string };
      }).runnerHealth;
      expect(runnerHealth?.command?.[2]).not.toContain(fakeSkToken);
      expect(runnerHealth?.command?.[2]).not.toContain(commandSecret);
      expect(runnerHealth?.stdout).not.toContain(fakeSkToken);
      expect(runnerHealth?.stdout).not.toContain('stdout-secret-value');
      expect(runnerHealth?.stderr).not.toContain(fakeSkToken);
      expect(runnerHealth?.stderr).not.toContain('stderr-secret-value');
      expect(runnerHealth?.stdout?.length ?? 0).toBeLessThanOrEqual(8_020);
      expect(runnerHealth?.stderr?.length ?? 0).toBeLessThanOrEqual(8_020);
      expect(runnerHealth?.stdout).toContain('[truncated]');
      expect(runnerHealth?.stderr).toContain('[truncated]');
      expect(String(exec.mock.calls[0]?.[3]?.[2])).toContain(fakeSkToken);
      expect(String(exec.mock.calls[0]?.[3]?.[2])).toContain(commandSecret);
      expect(getPodStatus).toHaveBeenCalledTimes(1);
      expect(createOrEnsurePod).not.toHaveBeenCalled();
    } finally {
      if (previousHealthCommand === undefined) {
        delete process.env.INTERNAL_AGENT_RUNNER_HEALTH_COMMAND;
      } else {
        process.env.INTERNAL_AGENT_RUNNER_HEALTH_COMMAND = previousHealthCommand;
      }
    }
  });

  it('reports ready-session health exec failures as startup timeout without deleting or recreating the pod', async () => {
    const previousHealthCommand = process.env.INTERNAL_AGENT_RUNNER_HEALTH_COMMAND;
    const fakeSkToken = 'sk-runnerhealtherrorfake000000000';
    process.env.INTERNAL_AGENT_RUNNER_HEALTH_COMMAND = `echo ${fakeSkToken}`;

    try {
      const createOrEnsurePod = vi.fn();
      const getPodStatus = vi.fn().mockResolvedValue(buildRunningPodStatus());
      const deletePod = vi.fn().mockResolvedValue(undefined);
      const longErrorMessage = 'x'.repeat(9_000);
      const exec = vi.fn().mockRejectedValue(Object.assign(
        new Error(`exec failed token=transport-secret-value ${fakeSkToken} ${longErrorMessage}`),
        { code: 'AGENT_SANDBOX_UNAVAILABLE' },
      ));
      const manager = new InternalAgentPodManagerImpl(
        {
          checkReady: vi.fn().mockResolvedValue(undefined),
          getPodStatus,
          createOrEnsurePod,
          deletePod,
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

      let caught: unknown;
      try {
        await manager.ensureAgentReady({
          workspaceId: 'ws_1',
          projectId: 'proj_1',
          workloadId: 'task_1',
          sessionId: 'task_1',
          agent: buildAgent({
            image: MANAGED_RUNNER_IMAGE_A,
            _internal_raw_key: 'ask_xxx',
          }),
          workspaceMount: buildWorkspaceMount(),
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        code: 'AGENT_SANDBOX_STARTUP_TIMEOUT',
        message: 'sandbox_startup_timeout',
        workloadId: 'task_1',
        sessionId: 'task_1',
        sandboxOperation: 'verify_ready_session_runner_health',
        runnerHealth: expect.objectContaining({
          status: 'exec_failed',
          command: expect.arrayContaining(['sh', '-lc', expect.stringContaining('[redacted]')]),
          error: expect.objectContaining({
            code: 'AGENT_SANDBOX_UNAVAILABLE',
            message: expect.stringContaining('[redacted]'),
          }),
        }),
      });
      expect(caught).not.toMatchObject({ message: 'sandbox_runner_bootstrap_unhealthy' });
      const runnerHealth = (caught as {
        runnerHealth?: { command?: string[]; error?: { message?: string } };
      }).runnerHealth;
      expect(runnerHealth?.command?.[2]).not.toContain(fakeSkToken);
      expect(runnerHealth?.error?.message).not.toContain(fakeSkToken);
      expect(runnerHealth?.error?.message).not.toContain('transport-secret-value');
      expect(runnerHealth?.error?.message?.length ?? 0).toBeLessThanOrEqual(8_020);
      expect(runnerHealth?.error?.message).toContain('[truncated]');
      expect(String(exec.mock.calls[0]?.[3]?.[2])).toContain(fakeSkToken);
      expect(deletePod).not.toHaveBeenCalled();
      expect(getPodStatus).toHaveBeenCalledTimes(1);
      expect(createOrEnsurePod).not.toHaveBeenCalled();
    } finally {
      if (previousHealthCommand === undefined) {
        delete process.env.INTERNAL_AGENT_RUNNER_HEALTH_COMMAND;
      } else {
        process.env.INTERNAL_AGENT_RUNNER_HEALTH_COMMAND = previousHealthCommand;
      }
    }
  });

  it('aborts a session-online wait quickly and releases the workload lock for a later ensure', async () => {
    const sleepGate = new Promise<void>(() => {});
    let sessionOnline = false;
    const manager = new InternalAgentPodManagerImpl(
      {
        checkReady: vi.fn().mockResolvedValue(undefined),
        getPodStatus: vi.fn()
          .mockResolvedValueOnce({ phase: 'offline' })
          .mockResolvedValueOnce(buildRunningPodStatus()),
        createOrEnsurePod: vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() }),
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        getPodStatus: vi.fn(async () => (phase === 'Running' ? buildRunningPodStatus() : { phase })),
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        image: MANAGED_RUNNER_IMAGE_A,
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
          return buildRunningPodStatus();
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        getPodStatus: vi.fn(async () => (phase === 'Running' ? buildRunningPodStatus() : { phase })),
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        image: MANAGED_RUNNER_IMAGE_A,
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
          .mockResolvedValueOnce(buildRunningPodStatus())
          .mockResolvedValue(buildRunningPodStatus()),
        createOrEnsurePod: vi.fn().mockResolvedValue({ httpStatus: 201, pod: buildRunningPodStatus() }),
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        image: MANAGED_RUNNER_IMAGE_A,
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
        image: MANAGED_RUNNER_IMAGE_A,
        _internal_raw_key: 'ask_xxx',
      }),
      workspaceMount: buildWorkspaceMount(),
    })).resolves.toBeUndefined();
  });
});
