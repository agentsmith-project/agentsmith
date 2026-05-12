import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  accessMock,
  mkdirMock,
  readFileMock,
  readdirMock,
  writeFileMock,
  prepareTaskWorkspaceMock,
  prepareTaskWorkspaceAssetsMock,
  releaseTaskWorkspaceMock,
} = vi.hoisted(() => ({
  accessMock: vi.fn(),
  mkdirMock: vi.fn(),
  readFileMock: vi.fn(),
  readdirMock: vi.fn(),
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
  readFile: readFileMock,
  readdir: readdirMock,
  writeFile: writeFileMock,
  default: {
    access: accessMock,
    mkdir: mkdirMock,
    readFile: readFileMock,
    readdir: readdirMock,
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

import {
  prepareTerminalWorkspace,
  startTerminalProcess,
  terminateTerminalProcessTree,
  type TerminalExecutionContext,
  type TerminalPidMetadata,
  type TerminalProcess,
} from './terminal-runtime.js';

const TASK_HOME = '/home/task_1';
const TASK_WORKSPACE = `${TASK_HOME}/workspace`;
const TASK_ARTIFACTS = `${TASK_WORKSPACE}/.artifacts`;
const LIBRARY_ROOT_PATH = '.' as const;

function terminalExecutionContext(
  overrides: Partial<TerminalExecutionContext> & Record<string, unknown> = {},
): TerminalExecutionContext {
  return {
    ...overrides,
    task_id: 'task_1',
    workspace_file_library_id: 'flib_1',
    workspace_binding_mode: 'file_library',
    runtime_profile: 'managed',
    task_home_segment: 'task_1',
    task_home_path: TASK_HOME,
    workspace_path: TASK_WORKSPACE,
    artifacts_path: TASK_ARTIFACTS,
    library_root_path: LIBRARY_ROOT_PATH,
  };
}

function linuxStat(pid: number, ppid: number, pgrp: number, sid: number, comm = 'bash'): string {
  return `${pid} (${comm}) S ${ppid} ${pgrp} ${sid} 34816 0 0 0 0 0 0 0 0 20 0 1 0 1 0 0\n`;
}

function createFakeTerminalProcess(
  pidMetadata: TerminalPidMetadata,
): {
  child: TerminalProcess;
  emitExit: (exitCode: number | null, signal?: NodeJS.Signals | null) => void;
  setExitCode: (exitCode: number | null) => void;
  killMock: ReturnType<typeof vi.fn>;
} {
  let exitCode: number | null = null;
  const exitListeners: Array<(event: { exitCode: number | null; signal?: string | number | null }) => void> = [];
  const killMock = vi.fn();
  const child: TerminalProcess = {
    get exitCode() {
      return exitCode;
    },
    get pidMetadata() {
      return pidMetadata;
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: killMock,
    onData: vi.fn(),
    onExit: vi.fn((listener: (event: { exitCode: number | null; signal?: string | number | null }) => void) => {
      exitListeners.push(listener);
    }),
    waitForWorkspaceRelease: vi.fn(async () => undefined),
  };
  return {
    child,
    emitExit(exitCodeValue: number | null, signal: NodeJS.Signals | null = null) {
      exitCode = exitCodeValue;
      for (const listener of exitListeners) {
        listener({ exitCode: exitCodeValue, signal });
      }
    },
    setExitCode(exitCodeValue: number | null) {
      exitCode = exitCodeValue;
    },
    killMock,
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
    readFileMock.mockRejectedValue(Object.assign(new Error('proc stat missing'), {
      code: 'ENOENT',
    }));
    readdirMock.mockResolvedValue([]);
    writeFileMock.mockResolvedValue(undefined);
    process.env.PATH = '/usr/bin:/bin';
    prepareTaskWorkspaceMock.mockResolvedValue({
      cwd: TASK_WORKSPACE,
      source: 'file_library_mount',
      paths: {
        mode: 'managed_local',
        taskHome: TASK_HOME,
        visibleRoot: TASK_WORKSPACE,
        libraryRoot: LIBRARY_ROOT_PATH,
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
    vi.useRealTimers();
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
          ARTIFACTS_PATH: TASK_ARTIFACTS,
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
        ARTIFACTS_PATH: TASK_ARTIFACTS,
      }),
    }));
    started.child.write('echo hi\n');
    started.child.resize(120, 30);
    started.child.kill('SIGTERM');
    expect(nodePtyWriteMock).toHaveBeenCalledWith('echo hi\n');
    expect(nodePtyResizeMock).toHaveBeenCalledWith(120, 30);
    expect(nodePtyKillMock).toHaveBeenCalledWith('SIGTERM');
  });

  it('exposes terminal pid metadata from the spawned pty process', async () => {
    nodePtySpawnMock.mockReturnValueOnce({
      pid: 4242,
      write: nodePtyWriteMock,
      resize: nodePtyResizeMock,
      kill: nodePtyKillMock,
      onData: nodePtyOnDataMock,
      onExit: nodePtyOnExitMock,
    });
    readFileMock.mockImplementation(async (pathLike: string) => {
      if (pathLike === '/proc/4242/stat') {
        return linuxStat(4242, 1, 4242, 4242, 'bash');
      }
      throw Object.assign(new Error('missing proc stat'), { code: 'ENOENT' });
    });

    const started = await startTerminalProcess({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
      shell: '/usr/bin/bash',
    });

    expect(started.child.pidMetadata).toEqual({
      ptyPid: 4242,
      rootPid: 4242,
      pgid: 4242,
      sid: 4242,
      platform: process.platform,
      diagnostics: [],
    });
  });

  it('hard-kills a terminal process tree only after graceful close grace expires', async () => {
    vi.useFakeTimers();
    const alivePids = new Set([1001, 1002]);
    const fake = createFakeTerminalProcess({
      ptyPid: 1001,
      rootPid: 1001,
      pgid: 1001,
      sid: 1001,
      platform: 'linux',
      diagnostics: [],
    });
    fake.killMock.mockImplementation((signal?: NodeJS.Signals) => {
      if (signal !== 'SIGKILL') return;
      alivePids.clear();
      fake.emitExit(137, 'SIGKILL');
    });
    readFileMock.mockImplementation(async (pathLike: string) => {
      if (pathLike === `/proc/${process.pid}/stat`) return linuxStat(process.pid, 1, 9000, 9000, 'node');
      if (pathLike === '/proc/1001/stat' && alivePids.has(1001)) return linuxStat(1001, 1, 1001, 1001, 'bash');
      if (pathLike === '/proc/1002/stat' && alivePids.has(1002)) return linuxStat(1002, 1001, 1001, 1001, 'sleep');
      throw Object.assign(new Error('missing proc stat'), { code: 'ENOENT' });
    });
    readdirMock.mockImplementation(async (pathLike: string) => {
      if (pathLike !== '/proc') return [];
      return [String(process.pid), ...Array.from(alivePids).map(String)];
    });
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
      if (signal === 0) {
        return true;
      }
      if (signal === 'SIGKILL' && (pid === -1001 || pid === 1001 || pid === 1002)) {
        alivePids.clear();
        fake.emitExit(137, 'SIGKILL');
      }
      return true;
    }) as typeof process.kill);
    try {
      let resolved = false;
      const resultPromise = terminateTerminalProcessTree(fake.child, {
        graceMs: 1_000,
        hardKillGraceMs: 1_000,
        pollIntervalMs: 10,
      }).then((result) => {
        resolved = true;
        return result;
      });

      for (let index = 0; index < 10 && !fake.killMock.mock.calls.some(([signal]) => signal === 'SIGTERM'); index += 1) {
        await Promise.resolve();
      }
      expect(fake.killMock).toHaveBeenCalledWith('SIGTERM');
      expect(fake.killMock).not.toHaveBeenCalledWith('SIGKILL');
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(999);
      expect(fake.killMock).not.toHaveBeenCalledWith('SIGKILL');
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const result = await resultPromise;

      expect(result.outcome).toBe('terminated');
      expect(result.remainingPids).toEqual([]);
      expect(result.terminatedPids).toContain(1002);
      expect(result.signalSequence).toEqual(expect.arrayContaining([
        'pty:SIGTERM',
        'pty:SIGKILL',
      ]));
      expect(processKillSpy).not.toHaveBeenCalledWith(-9000, expect.anything());
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it('returns remaining pid diagnostic evidence when terminal descendants survive hard kill', async () => {
    vi.useFakeTimers();
    const fake = createFakeTerminalProcess({
      ptyPid: 1101,
      rootPid: 1101,
      pgid: 1101,
      sid: 1101,
      platform: 'linux',
      diagnostics: [],
    });
    readFileMock.mockImplementation(async (pathLike: string) => {
      if (pathLike === `/proc/${process.pid}/stat`) return linuxStat(process.pid, 1, 9100, 9100, 'node');
      if (pathLike === '/proc/1101/stat') return linuxStat(1101, 1, 1101, 1101, 'bash');
      if (pathLike === '/proc/1102/stat') return linuxStat(1102, 1101, 1101, 1101, 'sleep');
      throw Object.assign(new Error('missing proc stat'), { code: 'ENOENT' });
    });
    readdirMock.mockImplementation(async (pathLike: string) => (
      pathLike === '/proc' ? [String(process.pid), '1101', '1102'] : []
    ));
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);
    try {
      const resultPromise = terminateTerminalProcessTree(fake.child, {
        graceMs: 10,
        hardKillGraceMs: 10,
        pollIntervalMs: 1,
      });
      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(result.outcome).toBe('failed');
      expect(result.diagnosticCode).toBe('terminal_process_tree_remaining');
      expect(result.remainingPids).toEqual([1101, 1102]);
      expect(result.signalSequence).toEqual(expect.arrayContaining([
        'pty:SIGTERM',
        'pty:SIGKILL',
      ]));
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it('returns not_found when the fenced terminal root pid is already gone', async () => {
    const fake = createFakeTerminalProcess({
      ptyPid: 1201,
      rootPid: 1201,
      pgid: 1201,
      sid: 1201,
      platform: 'linux',
      diagnostics: [],
    });
    readFileMock.mockImplementation(async () => {
      throw Object.assign(new Error('missing proc stat'), { code: 'ENOENT' });
    });

    const result = await terminateTerminalProcessTree(fake.child, {
      graceMs: 10,
      hardKillGraceMs: 10,
      pollIntervalMs: 1,
    });

    expect(result.outcome).toBe('not_found');
    expect(result.diagnosticCode).toBe('terminal_root_pid_not_found');
    expect(result.remainingPids).toEqual([]);
    expect(result.signalSequence).toEqual([]);
    expect(fake.killMock).not.toHaveBeenCalled();
  });

  it('returns unsupported_platform as an error on non-linux developer runners', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    });
    try {
      const fake = createFakeTerminalProcess({
        ptyPid: 1301,
        rootPid: 1301,
        pgid: 1301,
        sid: 1301,
        platform: 'darwin',
        diagnostics: [],
      });

      const result = await terminateTerminalProcessTree(fake.child, {
        graceMs: 10,
        hardKillGraceMs: 10,
        pollIntervalMs: 1,
      });

      expect(result.outcome).toBe('failed');
      expect(result.diagnosticCode).toBe('unsupported_platform');
      expect(result.remainingPids).toEqual([1301]);
      expect(result.signalSequence).toEqual([]);
      expect(fake.killMock).not.toHaveBeenCalled();
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    }
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

  it('exposes a terminal workspace release drain promise for close acknowledgements', async () => {
    let onExitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    let resolveRelease: (() => void) | undefined;
    let releaseResolved = false;
    releaseTaskWorkspaceMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRelease = () => {
        releaseResolved = true;
        resolve();
      };
    }));
    nodePtyOnExitMock.mockImplementation((handler: (event: { exitCode: number; signal?: number }) => void) => {
      onExitHandler = handler;
    });

    const started = await startTerminalProcess({
      executionContext: terminalExecutionContext({
        run_id: 'run_1',
      }),
    });

    onExitHandler?.({ exitCode: 0, signal: 15 });
    const drainPromise = started.child.waitForWorkspaceRelease();
    await Promise.resolve();
    expect(releaseResolved).toBe(false);
    resolveRelease?.();
    await drainPromise;
    expect(releaseResolved).toBe(true);
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
