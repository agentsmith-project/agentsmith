import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());
const readlinkSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const mocked = {
    ...actual,
    execFileSync: execFileSyncMock,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const mocked = {
    ...actual,
    readlinkSync: readlinkSyncMock,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

import {
  buildRunnerInstanceMarker,
  classifyMountedWorkspaceJanitorAuthority,
  isAgentTaskRunnerProcessSnapshot,
  type RunnerProcessSnapshot,
} from './task-workspace-ownership.js';

function buildRunnerProcess(pid: number, instanceId?: string, overrides: Partial<RunnerProcessSnapshot> = {}): RunnerProcessSnapshot {
  return {
    pid,
    command: `node /workspace/packages/agent-task-runner/dist/index.js${instanceId ? ` ${buildRunnerInstanceMarker(instanceId)}` : ''}`,
    cwd: null,
    ...overrides,
  };
}

function buildCanonicalTsxRunnerProcess(pid: number, ppid: number): RunnerProcessSnapshot {
  return {
    pid,
    command: 'tsx src/index.ts',
    cwd: '/workspace/packages/agent-task-runner',
    ppid,
  } as RunnerProcessSnapshot & { ppid: number };
}

function expectRelativeTsxRunnerFromPid(pid: number): void {
  expect(isAgentTaskRunnerProcessSnapshot({
    pid,
    command: 'node /repo/node_modules/tsx/dist/cli.mjs src/index.ts',
    cwd: null,
  })).toBe(true);
}

describe('task workspace janitor ownership', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    readlinkSyncMock.mockReset();
  });

  it('prefers proc cwd for a relative tsx runner entrypoint so ps empty cwd markers do not block detection', () => {
    readlinkSyncMock.mockImplementation((target: string) => {
      if (target === '/proc/4103/cwd') {
        return '/repo/packages/agent-task-runner';
      }
      throw new Error(`unexpected readlink target ${target}`);
    });
    execFileSyncMock.mockImplementation((file: string, args: readonly string[]) => {
      if (file === 'ps' && args.join(' ') === '-ww -o cwd= -p 4103') {
        return '-\n';
      }
      throw new Error(`unexpected command ${file} ${args.join(' ')}`);
    });

    expectRelativeTsxRunnerFromPid(4103);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('resolves a relative tsx runner entrypoint from lsof cwd when proc cwd is unavailable', () => {
    readlinkSyncMock.mockImplementation(() => {
      throw new Error('proc cwd unavailable');
    });
    execFileSyncMock.mockImplementation((file: string, args: readonly string[]) => {
      if (file === 'lsof' && args.join(' ') === '-a -p 4104 -d cwd -Fn') {
        return 'p4104\nn/repo/packages/agent-task-runner\n';
      }
      throw new Error(`unexpected command ${file} ${args.join(' ')}`);
    });

    expectRelativeTsxRunnerFromPid(4104);
  });

  it('resolves a relative tsx runner entrypoint from pwdx cwd when proc and lsof are unavailable', () => {
    readlinkSyncMock.mockImplementation(() => {
      throw new Error('proc cwd unavailable');
    });
    execFileSyncMock.mockImplementation((file: string, args: readonly string[]) => {
      if (file === 'lsof' && args.join(' ') === '-a -p 4105 -d cwd -Fn') {
        throw new Error('lsof unavailable');
      }
      if (file === 'pwdx' && args.join(' ') === '4105') {
        return '4105: /repo/packages/agent-task-runner\n';
      }
      throw new Error(`unexpected command ${file} ${args.join(' ')}`);
    });

    expectRelativeTsxRunnerFromPid(4105);
  });

  it('keeps ps cwd as the last non-Linux fallback for relative tsx runner entrypoints', () => {
    readlinkSyncMock.mockImplementation(() => {
      throw new Error('proc cwd unavailable');
    });
    execFileSyncMock.mockImplementation((file: string, args: readonly string[]) => {
      if (file === 'lsof' && args.join(' ') === '-a -p 4106 -d cwd -Fn') {
        throw new Error('lsof unavailable');
      }
      if (file === 'pwdx' && args.join(' ') === '4106') {
        throw new Error('pwdx unavailable');
      }
      if (file === 'ps' && args.join(' ') === '-ww -o cwd= -p 4106') {
        return '/repo/packages/agent-task-runner\n';
      }
      throw new Error(`unexpected command ${file} ${args.join(' ')}`);
    });

    expectRelativeTsxRunnerFromPid(4106);
  });

  it('classifies a live foreign runner as foreign_active', () => {
    const authority = classifyMountedWorkspaceJanitorAuthority({
      ownerRecord: {
        ownerProcessPid: 4100,
        runnerInstanceId: 'runner-foreign',
      },
      currentRunnerPid: 3100,
      currentRunnerInstanceId: 'runner-current',
      processTableByPid: new Map<number, RunnerProcessSnapshot>([
        [4100, buildRunnerProcess(4100, 'runner-foreign')],
      ]),
    });

    expect(authority).toEqual({
      authority: 'foreign_active',
      reason: 'foreign_runner_instance_alive',
    });
  });

  it('classifies a dead owner pid as stale_reclaimable', () => {
    const authority = classifyMountedWorkspaceJanitorAuthority({
      ownerRecord: {
        ownerProcessPid: 4100,
        runnerInstanceId: 'runner-foreign',
      },
      currentRunnerPid: 3100,
      currentRunnerInstanceId: 'runner-current',
      processTableByPid: new Map(),
    });

    expect(authority).toEqual({
      authority: 'stale_reclaimable',
      reason: 'owner_pid_dead',
    });
  });

  it('classifies ownerless mounts with no live runner as ownerless_adoptable', () => {
    const authority = classifyMountedWorkspaceJanitorAuthority({
      ownerRecord: {
        ownerProcessPid: null,
        runnerInstanceId: null,
      },
      currentRunnerPid: 3100,
      currentRunnerInstanceId: 'runner-current',
      processTableByPid: new Map(),
    });

    expect(authority).toEqual({
      authority: 'ownerless_adoptable',
      reason: 'no_other_runner_alive',
    });
  });

  it('classifies ownerless mounts with another live runner as unverified', () => {
    const authority = classifyMountedWorkspaceJanitorAuthority({
      ownerRecord: {
        ownerProcessPid: null,
        runnerInstanceId: null,
      },
      currentRunnerPid: 3100,
      currentRunnerInstanceId: 'runner-current',
      processTableByPid: new Map<number, RunnerProcessSnapshot>([
        [4100, buildRunnerProcess(4100, 'runner-foreign')],
      ]),
    });

    expect(authority).toEqual({
      authority: 'unverified',
      reason: 'other_runner_alive_without_owner_evidence',
    });
  });

  it('treats a live supervisor with a canonical tsx child runner as foreign_active instead of reclaimable', () => {
    const authority = classifyMountedWorkspaceJanitorAuthority({
      ownerRecord: {
        ownerProcessPid: 4100,
        runnerInstanceId: null,
      },
      currentRunnerPid: 3100,
      currentRunnerInstanceId: 'runner-current',
      processTableByPid: new Map<number, RunnerProcessSnapshot>([
        [4100, { pid: 4100, command: 'make agent-task-runner', cwd: '/workspace' }],
        [4101, buildCanonicalTsxRunnerProcess(4101, 4100)],
      ]),
    });

    expect(authority).toEqual({
      authority: 'foreign_active',
      reason: 'foreign_runner_supervisor_alive',
    });
  });
});
