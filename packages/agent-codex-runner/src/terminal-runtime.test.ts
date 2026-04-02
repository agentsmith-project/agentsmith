import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirMock, writeFileMock, prepareTaskWorkspaceMock, prepareNotebookWorkspaceAssetsMock, applyExecutionContextFilesMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
  prepareTaskWorkspaceMock: vi.fn(),
  prepareNotebookWorkspaceAssetsMock: vi.fn(),
  applyExecutionContextFilesMock: vi.fn(),
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

vi.mock('./execution-context-files.js', () => ({
  applyExecutionContextFiles: applyExecutionContextFilesMock,
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
        codexRootDir: '/codex/tasks',
        codexHomeDir: '/codex/tasks/task_1',
        homeDir: '/codex/tasks/task_1/home',
        artifactsDir: '/workspace/.artifacts',
        credentialDir: '/codex/credentials/task_1',
      },
    });
    prepareNotebookWorkspaceAssetsMock.mockResolvedValue(undefined);
    applyExecutionContextFilesMock.mockResolvedValue({ writtenFiles: [] });
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
        notebook_mode: true,
      },
      shell: '/usr/bin/zsh',
    });

    expect(writeFileMock).toHaveBeenCalledWith(
      '/codex/tasks/task_1/home/.zshrc',
      '# AgentSmith Terminal Session\n',
      { flag: 'a' },
    );
  });

  it('starts a node-pty shell with provided cols and rows', async () => {
    const started = await startTerminalProcess({
      executionContext: {
        task_id: 'task_1',
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
          HOME: '/codex/tasks/task_1/home',
          MBOS_TASK_CREDENTIAL_DIR: '/codex/credentials/task_1',
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

  it('tracks exit code from node-pty exit events', async () => {
    let onExitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    nodePtyOnExitMock.mockImplementation((handler: (event: { exitCode: number; signal?: number }) => void) => {
      onExitHandler = handler;
    });

    const started = await startTerminalProcess({
      executionContext: {
        task_id: 'task_1',
      },
    });

    expect(started.child.exitCode).toBeNull();
    onExitHandler?.({ exitCode: 7, signal: 15 });
    expect(started.child.exitCode).toBe(7);
  });
});
