import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, mkdirMock, fetchMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  default: {
    execFile: execFileMock,
  },
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  default: {
    mkdir: mkdirMock,
  },
}));

import {
  buildTaskWorkspaceMountPath,
  clearPreparedTaskWorkspaces,
  fetchTaskWorkspaceAccess,
  prepareTaskWorkspace,
  resolveTaskCwd,
} from './task-workspace.js';

describe('task-workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPreparedTaskWorkspaces();
    execFileMock.mockImplementation((_file, _args, callback: (error: Error | null) => void) => {
      callback(null);
    });
    mkdirMock.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    delete process.env.MBOS_AGENT_WORKSPACE_ROOT;
    delete process.env.WORKSPACE_PATH;
  });

  it('prefers WORKSPACE_PATH when provided', () => {
    const resolved = resolveTaskCwd({
      workspacePath: ' /workspace ',
      username: 'alice',
      taskId: 'task_1',
    });
    expect(resolved).toEqual({
      cwd: '/workspace',
      source: 'workspace_path',
    });
  });

  it('falls back to /tmp/{username}/{taskId} when WORKSPACE_PATH is empty', () => {
    const resolved = resolveTaskCwd({
      workspacePath: '   ',
      username: 'alice',
      taskId: 'task_1',
    });
    expect(resolved).toEqual({
      cwd: '/tmp/alice/task_1',
      source: 'tmp_fallback',
    });
  });

  it('builds mount path from configured workspace root and workspace dir name', () => {
    const mountPath = buildTaskWorkspaceMountPath({
      username: 'alice',
      workspaceRoot: '/srv/ags-workspaces',
      workspaceDirName: 'market-analysis-q1',
      taskId: 'task_1',
    });
    expect(mountPath).toBe('/srv/ags-workspaces/market-analysis-q1');
  });

  it('fetches task-bound workspace access with bearer auth', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        workspace_dir_name: 'market-analysis-q1',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
      }),
    });

    const response = await fetchTaskWorkspaceAccess({
      api_base: 'http://localhost:20000/',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      task_id: 'task_1',
      user_bearer_token: 'test-token',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/workspace-access',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
    expect(response.file_library_id).toBe('flib_1');
  });

  it('prepares and mounts file library workspace for notebook task bindings', async () => {
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/srv/ags-workspaces';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        workspace_dir_name: 'market-analysis-q1',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
      }),
    });

    const resolved = await prepareTaskWorkspace({
      executionContext: {
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        task_id: 'task_1',
        user_bearer_token: 'test-token',
        workspace_binding_mode: 'file_library',
      },
      username: 'alice',
      taskId: 'task_1',
    });

    expect(mkdirMock).toHaveBeenCalledWith('/srv/ags-workspaces/market-analysis-q1', { recursive: true });
    expect(execFileMock).toHaveBeenCalledWith(
      'juicefs',
      ['mount', 'postgres://juicefs-meta', '/srv/ags-workspaces/market-analysis-q1', '-d'],
      expect.any(Function),
    );
    expect(resolved).toEqual({
      cwd: '/srv/ags-workspaces/market-analysis-q1',
      source: 'file_library_mount',
    });
  });

  it('reuses prepared file library workspace for subsequent task runs', async () => {
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/srv/ags-workspaces';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        workspace_dir_name: 'market-analysis-q1',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
      }),
    });

    await prepareTaskWorkspace({
      executionContext: {
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        task_id: 'task_1',
        user_bearer_token: 'test-token',
        workspace_binding_mode: 'file_library',
      },
      username: 'alice',
      taskId: 'task_1',
    });
    execFileMock.mockClear();
    mkdirMock.mockClear();

    const resolved = await prepareTaskWorkspace({
      executionContext: {
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        task_id: 'task_1',
        user_bearer_token: 'test-token',
        workspace_binding_mode: 'file_library',
      },
      username: 'alice',
      taskId: 'task_1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(resolved).toEqual({
      cwd: '/srv/ags-workspaces/market-analysis-q1',
      source: 'file_library_mount',
    });
  });

  it('uses pre-mounted workspace path for internal task bindings', async () => {
    const resolved = await prepareTaskWorkspace({
      executionContext: {
        workspace_binding_mode: 'pre_mounted',
        workspace_path: '/workspace',
      },
      username: 'alice',
      taskId: 'task_internal',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(resolved).toEqual({
      cwd: '/workspace',
      source: 'workspace_path',
    });
  });
});
