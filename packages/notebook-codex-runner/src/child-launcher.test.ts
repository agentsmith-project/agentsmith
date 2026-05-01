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
  const previousMode = process.env.MBOS_RUNNER_MODE;
  const previousRequireBwrap = process.env.MBOS_EXTERNAL_REQUIRE_BWRAP;

  beforeEach(() => {
    vi.clearAllMocks();
    resetChildLauncherForTests();
    accessMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (previousMode === undefined) {
      delete process.env.MBOS_RUNNER_MODE;
    } else {
      process.env.MBOS_RUNNER_MODE = previousMode;
    }
    if (previousRequireBwrap === undefined) {
      delete process.env.MBOS_EXTERNAL_REQUIRE_BWRAP;
    } else {
      process.env.MBOS_EXTERNAL_REQUIRE_BWRAP = previousRequireBwrap;
    }
  });

  it('returns direct child commands for internal mode', async () => {
    process.env.MBOS_RUNNER_MODE = 'k8s_internal';
    const result = await prepareLaunchCommand({
      file: 'bash',
      args: ['-i'],
      cwd: '/workspace/task_1',
      env: { HOME: '/workspace/task_1' },
    });
    expect(result).toEqual({
      file: 'bash',
      args: ['-i'],
      env: { HOME: '/workspace/task_1' },
    });
  });

  it('wraps external children with bwrap, preserves env HOME, and binds cwd plus HOME writable', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    const result = await prepareLaunchCommand({
      file: 'codex',
      args: ['exec', 'hello'],
      cwd: '/workspace/task_1',
      env: {
        HOME: '/runner-runtime/task_1',
        PATH: '/runner-runtime/task_1/.local/bin:/runner-runtime/task_1/.cargo/bin:/usr/bin:/bin',
        PYTHONUSERBASE: '/runner-runtime/task_1/.local',
        PIP_USER: '1',
        npm_config_prefix: '/runner-runtime/task_1/.local',
        CARGO_HOME: '/runner-runtime/task_1/.cargo',
        RUSTUP_HOME: '/runner-runtime/task_1/.rustup',
      },
    });
    expect(result.file).toBe('/usr/bin/bwrap');
    expect(result.args).toEqual(expect.arrayContaining([
      '--clearenv',
      '--ro-bind', '/', '/',
      '--bind', '/workspace/task_1', '/workspace/task_1',
      '--bind', '/runner-runtime/task_1', '/runner-runtime/task_1',
      '--chdir', '/workspace/task_1',
      '--setenv', 'HOME', '/runner-runtime/task_1',
      '--setenv', 'PYTHONUSERBASE', '/runner-runtime/task_1/.local',
      '--setenv', 'PIP_USER', '1',
      '--setenv', 'npm_config_prefix', '/runner-runtime/task_1/.local',
      '--setenv', 'CARGO_HOME', '/runner-runtime/task_1/.cargo',
      '--setenv', 'RUSTUP_HOME', '/runner-runtime/task_1/.rustup',
      '--',
      'codex',
      'exec',
      'hello',
    ]));
  });

  it('falls back to direct launch for host_external when bwrap is unavailable', async () => {
    process.env.MBOS_RUNNER_MODE = 'host_external';
    accessMock.mockRejectedValue(new Error('missing'));

    const result = await prepareLaunchCommand({
      file: 'bash',
      args: ['-i'],
      cwd: '/home/alice/ags-workspace/task_1',
      env: { HOME: '/home/alice/ags-workspace/task_1' },
    });

    expect(result).toEqual({
      file: 'bash',
      args: ['-i'],
      env: { HOME: '/home/alice/ags-workspace/task_1' },
    });
  });

  it('still requires bwrap for docker_external', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    accessMock.mockRejectedValue(new Error('missing'));

    await expect(prepareLaunchCommand({
      file: 'bash',
      args: ['-i'],
      cwd: '/workspace/task_1',
      env: { HOME: '/workspace/task_1' },
    })).rejects.toThrow('bwrap_missing_for_external_runner');
  });

  it('can require bwrap for host_external explicitly', async () => {
    process.env.MBOS_RUNNER_MODE = 'host_external';
    process.env.MBOS_EXTERNAL_REQUIRE_BWRAP = 'true';
    accessMock.mockRejectedValue(new Error('missing'));

    await expect(prepareLaunchCommand({
      file: 'bash',
      args: ['-i'],
      cwd: '/home/alice/ags-workspace/task_1',
      env: { HOME: '/home/alice/ags-workspace/task_1' },
    })).rejects.toThrow('bwrap_missing_for_external_runner');
  });
});
