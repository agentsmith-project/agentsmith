import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirMock, writeFileMock, prepareTaskWorkspaceMock, prepareNotebookWorkspaceAssetsMock, applyExecutionContextFilesMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
  prepareTaskWorkspaceMock: vi.fn(),
  prepareNotebookWorkspaceAssetsMock: vi.fn(),
  applyExecutionContextFilesMock: vi.fn(),
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

import { prepareTerminalWorkspace } from './terminal-runtime.js';

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
});
