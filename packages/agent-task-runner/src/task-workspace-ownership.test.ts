import { describe, expect, it } from 'vitest';
import {
  buildRunnerInstanceMarker,
  classifyMountedWorkspaceJanitorAuthority,
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

describe('task workspace janitor ownership', () => {
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
