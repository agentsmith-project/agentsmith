import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirMock, writeFileMock, prepareTaskWorkspaceMock, prepareNotebookWorkspaceAssetsMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
  prepareTaskWorkspaceMock: vi.fn(),
  prepareNotebookWorkspaceAssetsMock: vi.fn(),
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
  mkdir: mkdirMock,
  writeFile: writeFileMock,
  default: {
    mkdir: mkdirMock,
    writeFile: writeFileMock,
  },
}));

vi.mock('./task-workspace.js', () => ({
  prepareTaskWorkspace: prepareTaskWorkspaceMock,
}));

vi.mock('./notebook-assets.js', () => ({
  buildNotebookHeadlessPreamble: vi.fn(() => 'PREAMBLE'),
  prepareNotebookWorkspaceAssets: prepareNotebookWorkspaceAssetsMock,
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

describe('terminal-runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    prepareTaskWorkspaceMock.mockResolvedValue({
      cwd: '/workspace',
      source: 'file_library_mount',
      paths: {
        rootCwd: '/workspace',
        mode: 'docker_external',
        mountRoot: '/workspace',
        taskRoot: '/workspace',
        homeDir: '/workspace',
        codexDir: '/workspace/.codex',
        artifactsDir: '/workspace/.artifacts',
        mbosDir: '/workspace/.mbos',
        skillsDir: '/workspace/.agents/skills',
      },
    });
    prepareNotebookWorkspaceAssetsMock.mockResolvedValue(undefined);
    inspectBuiltinSkillsMock.mockResolvedValue({
      sourceDir: '/seed-skills',
      available: ['feishu-docs'],
      missing: [],
    });
    seedBuiltinSkillsMock.mockResolvedValue({
      targetDir: '/workspace/.agents/skills',
      seeded: ['feishu-docs'],
      manifestPath: '/workspace/.mbos/builtin-skills-manifest.json',
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

  it('creates a minimal zshrc in task home for interactive zsh shells', async () => {
    await prepareTerminalWorkspace({
      executionContext: {
        task_id: 'task_1',
        interaction_kind: 'notebook',
      },
      shell: '/usr/bin/zsh',
    });

    expect(writeFileMock).toHaveBeenCalledWith(
      '/workspace/.zshrc',
      '# AgentSmith Terminal Session\n',
      { flag: 'a' },
    );
  });

  it('starts a node-pty shell with provided cols and rows', async () => {
    const started = await startTerminalProcess({
      executionContext: {
        task_id: 'task_1',
        interaction_kind: 'notebook',
        api_base: 'http://localhost:20000',
        execution_ticket: 'ticket_123',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
      },
      shell: '/usr/bin/bash',
      cols: 140,
      rows: 40,
    });

    expect(nodePtySpawnMock).toHaveBeenCalledWith(
      '/usr/bin/bash',
      ['-i'],
      expect.objectContaining({
        cwd: '/workspace',
        cols: 140,
        rows: 40,
        name: expect.any(String),
        env: expect.objectContaining({
          HOME: '/workspace',
          PYTHONUSERBASE: '/workspace/.local',
          PIP_USER: '1',
          npm_config_prefix: '/workspace/.local',
          CARGO_HOME: '/workspace/.cargo',
          RUSTUP_HOME: '/workspace/.rustup',
          MBOS_AGENT_API_BASE: 'http://localhost:20000',
          MBOS_AGENT_EXECUTION_TICKET: 'ticket_123',
          MBOS_AGENT_WORKSPACE_ID: 'ws_default',
          MBOS_AGENT_PROJECT_ID: 'proj_1',
          MBOS_AGENT_TASK_ID: 'task_1',
        }),
      }),
    );
    started.child.write('echo hi\n');
    started.child.resize(120, 30);
    started.child.kill('SIGTERM');
    expect(nodePtyWriteMock).toHaveBeenCalledWith('echo hi\n');
    expect(nodePtyResizeMock).toHaveBeenCalledWith(120, 30);
    expect(nodePtyKillMock).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects terminal execution context when task_id is missing', async () => {
    await expect(startTerminalProcess({
      executionContext: {
        interaction_kind: 'notebook',
        api_base: 'http://localhost:20000',
        execution_ticket: 'ticket_chat',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
      },
      shell: '/usr/bin/bash',
    })).rejects.toThrowError('notebook_terminal_execution_context_invalid');
    expect(nodePtySpawnMock).not.toHaveBeenCalled();
  });

  it('rejects chat execution context for notebook terminals', async () => {
    await expect(startTerminalProcess({
      executionContext: {
        interaction_kind: 'chat',
        // @ts-expect-error intentional invalid runtime input
        session_id: 'sess_chat',
        api_base: 'http://localhost:20000',
        execution_ticket: 'ticket_chat',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
      },
      shell: '/usr/bin/bash',
    })).rejects.toThrowError('notebook_terminal_execution_context_invalid');
    expect(nodePtySpawnMock).not.toHaveBeenCalled();
  });

  it('tracks exit code from node-pty exit events', async () => {
    let onExitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    nodePtyOnExitMock.mockImplementation((handler: (event: { exitCode: number; signal?: number }) => void) => {
      onExitHandler = handler;
    });

    const started = await startTerminalProcess({
      executionContext: {
        task_id: 'task_1',
        interaction_kind: 'notebook',
      },
    });

    expect(started.child.exitCode).toBeNull();
    onExitHandler?.({ exitCode: 7, signal: 15 });
    expect(started.child.exitCode).toBe(7);
  });

  it('injects notebook-specific preamble for notebook terminals', async () => {
    await prepareTerminalWorkspace({
      executionContext: {
        task_id: 'task_1',
        interaction_kind: 'notebook',
        api_base: 'http://localhost:20000',
        execution_ticket: 'ticket_123',
      },
      shell: '/usr/bin/bash',
    });

    expect(prepareLaunchCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        MBOS_AGENT_API_BASE: 'http://localhost:20000',
        MBOS_AGENT_EXECUTION_TICKET: 'ticket_123',
        MBOS_NOTEBOOK_PREAMBLE: 'PREAMBLE',
      }),
    }));

    await prepareTerminalWorkspace({
      executionContext: {
        task_id: 'task_1',
        interaction_kind: 'notebook',
      },
      shell: '/usr/bin/bash',
    });

    expect(prepareLaunchCommandMock).toHaveBeenLastCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        MBOS_NOTEBOOK_PREAMBLE: 'PREAMBLE',
      }),
    }));
  });
});
