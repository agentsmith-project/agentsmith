import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { accessMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    access: accessMock,
    default: {
      ...actual,
      access: accessMock,
    },
  };
});

import { prepareLaunchCommand, resetChildLauncherForTests } from './child-launcher.js';

describe('child-launcher', () => {
  const previousMode = process.env.MBOS_AGENT_TASK_RUNNER_MODE;
  const previousRequireBwrap = process.env.MBOS_AGENT_TASK_RUNNER_REQUIRE_BWRAP;

  beforeEach(() => {
    vi.clearAllMocks();
    resetChildLauncherForTests();
    accessMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (previousMode === undefined) {
      delete process.env.MBOS_AGENT_TASK_RUNNER_MODE;
    } else {
      process.env.MBOS_AGENT_TASK_RUNNER_MODE = previousMode;
    }
    if (previousRequireBwrap === undefined) {
      delete process.env.MBOS_AGENT_TASK_RUNNER_REQUIRE_BWRAP;
    } else {
      process.env.MBOS_AGENT_TASK_RUNNER_REQUIRE_BWRAP = previousRequireBwrap;
    }
  });

  it('returns direct child commands for managed platform mode', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_platform';
    const result = await prepareLaunchCommand({
      file: 'bash',
      args: ['-i'],
      cwd: '/home/task_1/workspace',
      env: {
        HOME: '/home/task_1',
        TASK_HOME: '/home/task_1',
        WORKSPACE_PATH: '/home/task_1/workspace',
      },
    });
    expect(result).toEqual({
      file: 'bash',
      args: ['-i'],
      env: {
        HOME: '/home/task_1',
        TASK_HOME: '/home/task_1',
        WORKSPACE_PATH: '/home/task_1/workspace',
      },
    });
  });

  it('wraps managed local children with bwrap, preserves env HOME, and binds cwd plus HOME writable', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    const result = await prepareLaunchCommand({
      file: 'codex',
      args: ['exec', 'hello'],
      cwd: '/home/task_1/workspace',
      env: {
        HOME: '/home/task_1',
        TASK_HOME: '/home/task_1',
        WORKSPACE_PATH: '/home/task_1/workspace',
        PATH: '/home/task_1/.local/bin:/home/task_1/.cargo/bin:/usr/bin:/bin',
        PYTHONUSERBASE: '/home/task_1/.local',
        PIP_USER: '1',
        npm_config_prefix: '/home/task_1/.local',
        CARGO_HOME: '/home/task_1/.cargo',
        RUSTUP_HOME: '/home/task_1/.rustup',
      },
    });
    expect(result.file).toBe('/usr/bin/bwrap');
    expect(result.args).toEqual(expect.arrayContaining([
      '--clearenv',
      '--ro-bind', '/', '/',
      '--bind', '/home/task_1/workspace', '/home/task_1/workspace',
      '--bind', '/home/task_1', '/home/task_1',
      '--chdir', '/home/task_1/workspace',
      '--setenv', 'HOME', '/home/task_1',
      '--setenv', 'TASK_HOME', '/home/task_1',
      '--setenv', 'WORKSPACE_PATH', '/home/task_1/workspace',
      '--setenv', 'PYTHONUSERBASE', '/home/task_1/.local',
      '--setenv', 'PIP_USER', '1',
      '--setenv', 'npm_config_prefix', '/home/task_1/.local',
      '--setenv', 'CARGO_HOME', '/home/task_1/.cargo',
      '--setenv', 'RUSTUP_HOME', '/home/task_1/.rustup',
      '--',
      'codex',
      'exec',
      'hello',
    ]));
  });

  it('falls back to direct launch for developer when bwrap is unavailable', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'developer';
    accessMock.mockRejectedValue(new Error('missing'));

    const result = await prepareLaunchCommand({
      file: 'bash',
      args: ['-i'],
      cwd: '/home/task_1/workspace',
      env: { HOME: '/home/task_1', TASK_HOME: '/home/task_1', WORKSPACE_PATH: '/home/task_1/workspace' },
    });

    expect(result).toEqual({
      file: 'bash',
      args: ['-i'],
      env: { HOME: '/home/task_1', TASK_HOME: '/home/task_1', WORKSPACE_PATH: '/home/task_1/workspace' },
    });
  });

  it('still requires bwrap for managed_local', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    accessMock.mockRejectedValue(new Error('missing'));

    await expect(prepareLaunchCommand({
      file: 'bash',
      args: ['-i'],
      cwd: '/home/task_1/workspace',
      env: { HOME: '/home/task_1', TASK_HOME: '/home/task_1', WORKSPACE_PATH: '/home/task_1/workspace' },
    })).rejects.toThrow('bwrap_missing_for_agent_task_runner');
  });

  it('can require bwrap for developer explicitly', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'developer';
    process.env.MBOS_AGENT_TASK_RUNNER_REQUIRE_BWRAP = 'true';
    accessMock.mockRejectedValue(new Error('missing'));

    await expect(prepareLaunchCommand({
      file: 'bash',
      args: ['-i'],
      cwd: '/home/task_1/workspace',
      env: { HOME: '/home/task_1', TASK_HOME: '/home/task_1', WORKSPACE_PATH: '/home/task_1/workspace' },
    })).rejects.toThrow('bwrap_missing_for_agent_task_runner');
  });
});
