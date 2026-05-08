import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { accessMock, mkdirMock, writeFileMock, prepareTaskWorkspaceMock, prepareTaskWorkspaceAssetsMock, releaseTaskWorkspaceMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
  prepareTaskWorkspaceMock: vi.fn(),
  prepareTaskWorkspaceAssetsMock: vi.fn(),
  releaseTaskWorkspaceMock: vi.fn(),
}));

const { prepareLaunchCommandMock } = vi.hoisted(() => ({
  prepareLaunchCommandMock: vi.fn(),
}));

const { inspectBuiltinSkillsMock, seedBuiltinSkillsMock } = vi.hoisted(() => ({
  inspectBuiltinSkillsMock: vi.fn(),
  seedBuiltinSkillsMock: vi.fn(),
}));

const {
  nodePtySpawnMock,
  nodePtyWriteMock,
  nodePtyResizeMock,
  nodePtyKillMock,
  nodePtyOnDataMock,
  nodePtyOnExitMock,
} = vi.hoisted(() => ({
  nodePtySpawnMock: vi.fn(),
  nodePtyWriteMock: vi.fn(),
  nodePtyResizeMock: vi.fn(),
  nodePtyKillMock: vi.fn(),
  nodePtyOnDataMock: vi.fn(),
  nodePtyOnExitMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: accessMock,
  mkdir: mkdirMock,
  writeFile: writeFileMock,
  default: {
    access: accessMock,
    mkdir: mkdirMock,
    writeFile: writeFileMock,
  },
}));

vi.mock('./task-workspace.js', () => ({
  prepareTaskWorkspace: prepareTaskWorkspaceMock,
  shouldRetryTaskWorkspaceWriteFailure: vi.fn((error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    return code === 'EIO' || code === 'ESTALE' || code === 'ENOTCONN';
  }),
}));

vi.mock('./task-assets.js', () => ({
  buildTaskHeadlessPreamble: vi.fn(() => 'PREAMBLE'),
  prepareTaskWorkspaceAssets: prepareTaskWorkspaceAssetsMock,
}));

vi.mock('./child-launcher.js', () => ({
  prepareLaunchCommand: prepareLaunchCommandMock,
}));

vi.mock('./builtin-skills.js', () => ({
  resolveBuiltinSkillsConfig: vi.fn(() => ({
    sourceDir: '/seed-skills',
    required: true,
    skills: ['feishu-docs'],
  })),
  inspectBuiltinSkills: inspectBuiltinSkillsMock,
  seedBuiltinSkills: seedBuiltinSkillsMock,
}));

vi.mock('node-pty', () => ({
  spawn: nodePtySpawnMock,
}));

import { prepareTerminalWorkspace, startTerminalProcess } from './terminal-runtime.js';

const TASK_HOME = '/home/task_1';
const TASK_WORKSPACE = `${TASK_HOME}/workspace`;
const TASK_ARTIFACTS = `${TASK_WORKSPACE}/.artifacts`;

function terminalExecutionContext(overrides: Record<string, unknown> = {}) {
  return {
    task_id: 'task_1',
    task_home_path: TASK_HOME,
    workspace_path: TASK_WORKSPACE,
    artifacts_path: TASK_ARTIFACTS,
    ...overrides,
  };
}

describe('terminal-runtime', () => {
  const originalPath = process.env.PATH;
  const originalHistfile = process.env.HISTFILE;
  const originalZdotdir = process.env.ZDOTDIR;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  const originalXdgCacheHome = process.env.XDG_CACHE_HOME;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    accessMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    process.env.PATH = '/usr/bin:/bin';
    prepareTaskWorkspaceMock.mockResolvedValue({
      cwd: TASK_WORKSPACE,
      source: 'file_library_mount',
      paths: {
        mode: 'managed_local',
        taskHome: TASK_HOME,
        visibleRoot: TASK_WORKSPACE,
        mountRoot: TASK_HOME,
        taskRoot: TASK_HOME,
        runtimeRoot: TASK_HOME,
        homeDir: TASK_HOME,
        workspaceDir: TASK_WORKSPACE,
        codexDir: `${TASK_HOME}/.codex`,
        artifactsDir: TASK_ARTIFACTS,
        mbosDir: `${TASK_HOME}/.mbos`,
        skillsDir: `${TASK_HOME}/.agents/skills`,
      },
      release: releaseTaskWorkspaceMock,
    });
    releaseTaskWorkspaceMock.mockResolvedValue(undefined);
    prepareTaskWorkspaceAssetsMock.mockResolvedValue(undefined);
    inspectBuiltinSkillsMock.mockResolvedValue({
      sourceDir: '/seed-skills',
      available: ['feishu-docs'],
      missing: [],
    });
    seedBuiltinSkillsMock.mockResolvedValue({
      targetDir: `${TASK_HOME}/.agents/skills`,
      seeded: ['feishu-docs'],
      manifestPath: `${TASK_HOME}/.mbos/builtin-skills-manifest.json`,
    });
    prepareLaunchCommandMock.mockImplementation(async (input: { file: string; args: string[]; env: NodeJS.ProcessEnv }) => ({
      file: input.file,
      args: input.args,
      env: input.env,
    }));
    nodePtySpawnMock.mockReturnValue({
      write: nodePtyWriteMock,
      resize: nodePtyResizeMock,
      kill: nodePtyKillMock,
      onData: nodePtyOnDataMock,
      onExit: nodePtyOnExitMock,
    });
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalHistfile === undefined) {
      delete process.env.HISTFILE;
    } else {
      process.env.HISTFILE = originalHistfile;
    }
    if (originalZdotdir === undefined) {
      delete process.env.ZDOTDIR;
    } else {
      process.env.ZDOTDIR = originalZdotdir;
    }
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    if (originalXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    }
    if (originalXdgCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = originalXdgCacheHome;
    }
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
  });

  it('creates a minimal zshrc in task home for interactive zsh shells', async () => {
    await prepareTerminalWorkspace({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
      shell: '/usr/bin/zsh',
    });

    expect(writeFileMock).toHaveBeenCalledWith(
      `${TASK_HOME}/.zshrc`,
      '# AgentSmith Terminal Session\n',
      { flag: 'a' },
    );
    expect(mkdirMock.mock.calls.map((call) => call[0])).toContain(`${TASK_HOME}/.agents`);
  });

  it('retries terminal workspace bootstrap after a retryable task-root write failure', async () => {
    const mkdirCalls = new Map<string, number>();
    mkdirMock.mockImplementation(async (target: string) => {
      const seen = mkdirCalls.get(target) ?? 0;
      mkdirCalls.set(target, seen + 1);
      if (target === `${TASK_HOME}/.agents/skills` && seen === 0) {
        const error = new Error('stale mount write') as NodeJS.ErrnoException;
        error.code = 'EIO';
        throw error;
      }
    });

    await prepareTerminalWorkspace({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
      shell: '/usr/bin/bash',
    });

    expect(prepareTaskWorkspaceMock).toHaveBeenCalledTimes(2);
    expect(releaseTaskWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(seedBuiltinSkillsMock).toHaveBeenCalledTimes(1);
    expect(prepareLaunchCommandMock).toHaveBeenCalledTimes(1);
  });

  it('releases the acquired task workspace when terminal bootstrap fails after workspace acquisition', async () => {
    prepareLaunchCommandMock.mockRejectedValueOnce(new Error('launch command failed'));

    await expect(prepareTerminalWorkspace({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
      shell: '/usr/bin/bash',
    })).rejects.toThrowError('launch command failed');

    expect(prepareTaskWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(releaseTaskWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(prepareTaskWorkspaceAssetsMock).toHaveBeenCalledTimes(1);
    expect(prepareLaunchCommandMock).toHaveBeenCalledTimes(1);
  });

  it('releases the acquired task workspace when terminal spawn fails', async () => {
    nodePtySpawnMock.mockImplementationOnce(() => {
      throw new Error('pty_spawn_failed');
    });

    await expect(startTerminalProcess({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
      shell: '/usr/bin/bash',
    })).rejects.toThrowError('pty_spawn_failed');

    expect(releaseTaskWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid shell overrides before terminal workspace bootstrap starts', async () => {
    accessMock.mockRejectedValueOnce(Object.assign(new Error('missing shell'), {
      code: 'ENOENT',
    }));

    await expect(startTerminalProcess({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
      shell: '/definitely/not/a/real/shell',
    })).rejects.toThrowError('invalid_shell');

    expect(prepareTaskWorkspaceMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(inspectBuiltinSkillsMock).not.toHaveBeenCalled();
    expect(seedBuiltinSkillsMock).not.toHaveBeenCalled();
    expect(prepareTaskWorkspaceAssetsMock).not.toHaveBeenCalled();
    expect(prepareLaunchCommandMock).not.toHaveBeenCalled();
    expect(nodePtySpawnMock).not.toHaveBeenCalled();
    expect(releaseTaskWorkspaceMock).not.toHaveBeenCalled();
  });

  it('starts a node-pty shell with provided cols and rows', async () => {
    const started = await startTerminalProcess({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
        api_base: 'http://localhost:20000',
        execution_ticket: 'ticket_123',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
      }),
      shell: '/usr/bin/bash',
      cols: 140,
      rows: 40,
    });

    expect(nodePtySpawnMock).toHaveBeenCalledWith(
      '/usr/bin/bash',
      ['-i'],
      expect.objectContaining({
        cwd: TASK_WORKSPACE,
        cols: 140,
        rows: 40,
        name: expect.any(String),
        env: expect.objectContaining({
          HOME: TASK_HOME,
          TASK_HOME,
          WORKSPACE_PATH: TASK_WORKSPACE,
          PYTHONUSERBASE: `${TASK_HOME}/.local`,
          PIP_USER: '1',
          npm_config_prefix: `${TASK_HOME}/.local`,
          CARGO_HOME: `${TASK_HOME}/.cargo`,
          RUSTUP_HOME: `${TASK_HOME}/.rustup`,
          MBOS_AGENT_API_BASE: 'http://localhost:20000',
          MBOS_AGENT_EXECUTION_TICKET: 'ticket_123',
          MBOS_AGENT_WORKSPACE_ID: 'ws_default',
          MBOS_AGENT_PROJECT_ID: 'proj_1',
          MBOS_AGENT_TASK_ID: 'task_1',
        }),
      }),
    );
    expect(prepareLaunchCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: TASK_WORKSPACE,
      env: expect.objectContaining({
        HOME: TASK_HOME,
        TASK_HOME,
        WORKSPACE_PATH: TASK_WORKSPACE,
      }),
    }));
    started.child.write('echo hi\n');
    started.child.resize(120, 30);
    started.child.kill('SIGTERM');
    expect(nodePtyWriteMock).toHaveBeenCalledWith('echo hi\n');
    expect(nodePtyResizeMock).toHaveBeenCalledWith(120, 30);
    expect(nodePtyKillMock).toHaveBeenCalledWith('SIGTERM');
  });

  it('re-homes leaked shell history and xdg paths before starting interactive terminals', async () => {
    process.env.HISTFILE = '/home/percy/.zsh_history';
    process.env.ZDOTDIR = '/home/percy/.config/zsh';
    process.env.XDG_CONFIG_HOME = '/home/percy/.config';
    process.env.XDG_STATE_HOME = '/home/percy/.local/state';
    process.env.XDG_CACHE_HOME = '/home/percy/.cache';
    process.env.XDG_DATA_HOME = '/home/percy/.local/share';

    await startTerminalProcess({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
      shell: '/usr/bin/zsh',
    });

    expect(nodePtySpawnMock).toHaveBeenCalledWith(
      '/usr/bin/zsh',
      ['-i'],
      expect.objectContaining({
        env: expect.objectContaining({
          HOME: TASK_HOME,
          TASK_HOME,
          WORKSPACE_PATH: TASK_WORKSPACE,
          HISTFILE: `${TASK_HOME}/.zsh_history`,
          ZDOTDIR: TASK_HOME,
          XDG_CONFIG_HOME: `${TASK_HOME}/.config`,
          XDG_STATE_HOME: `${TASK_HOME}/.local/state`,
          XDG_CACHE_HOME: `${TASK_HOME}/.cache`,
          XDG_DATA_HOME: `${TASK_HOME}/.local/share`,
        }),
      }),
    );
  });

  it('rejects terminal execution context when task_id is missing', async () => {
    await expect(startTerminalProcess({
      executionContext: {
        api_base: 'http://localhost:20000',
        execution_ticket: 'ticket_missing_task',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
      } as unknown as Parameters<typeof startTerminalProcess>[0]['executionContext'],
      shell: '/usr/bin/bash',
    })).rejects.toThrowError('task_terminal_execution_context_invalid');
    expect(nodePtySpawnMock).not.toHaveBeenCalled();
  });

  it('rejects legacy execution discriminants for task terminals', async () => {
    const legacyDiscriminantKey = ['interaction', 'kind'].join('_');
    const legacySessionKey = ['session', 'id'].join('_');
    await expect(startTerminalProcess({
      executionContext: terminalExecutionContext({
        [legacyDiscriminantKey]: 'legacy',
        [legacySessionKey]: 'sess_legacy',
        api_base: 'http://localhost:20000',
        execution_ticket: 'ticket_legacy_context',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
      }) as unknown as Parameters<typeof startTerminalProcess>[0]['executionContext'],
      shell: '/usr/bin/bash',
    })).rejects.toThrowError('task_terminal_execution_context_invalid');
    expect(nodePtySpawnMock).not.toHaveBeenCalled();
  });

  it('tracks exit code from node-pty exit events', async () => {
    let onExitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    nodePtyOnExitMock.mockImplementation((handler: (event: { exitCode: number; signal?: number }) => void) => {
      onExitHandler = handler;
    });

    const started = await startTerminalProcess({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
    });

    expect(started.child.exitCode).toBeNull();
    onExitHandler?.({ exitCode: 7, signal: 15 });
    expect(started.child.exitCode).toBe(7);
    expect(releaseTaskWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it('injects task preamble for task terminals', async () => {
    await prepareTerminalWorkspace({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
        api_base: 'http://localhost:20000',
        execution_ticket: 'ticket_123',
      }),
      shell: '/usr/bin/bash',
    });

    expect(prepareLaunchCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        MBOS_AGENT_API_BASE: 'http://localhost:20000',
        MBOS_AGENT_EXECUTION_TICKET: 'ticket_123',
        MBOS_AGENT_TASK_PREAMBLE: 'PREAMBLE',
      }),
    }));

    await prepareTerminalWorkspace({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
      shell: '/usr/bin/bash',
    });

    expect(prepareLaunchCommandMock).toHaveBeenLastCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        MBOS_AGENT_TASK_PREAMBLE: 'PREAMBLE',
      }),
    }));
  });

  it('exposes canonical terminal runner id through the runtime environment', async () => {
    await prepareTerminalWorkspace({
      executionContext: terminalExecutionContext({
        runner_id: 'runner_terminal_1',
        runner_session_scope: 'task_execution',
      }),
      shell: '/usr/bin/bash',
    });

    expect(prepareLaunchCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        MBOS_AGENT_TASK_ID: 'task_1',
        MBOS_AGENT_RUNNER_ID: 'runner_terminal_1',
      }),
    }));
  });
});
