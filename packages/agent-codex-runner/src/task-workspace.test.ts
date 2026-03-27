import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, mkdirMock, fetchMock, readFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  fetchMock: vi.fn(),
  readFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
  default: {
    execFile: execFileMock,
    spawn: spawnMock,
  },
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
  default: {
    mkdir: mkdirMock,
    readFile: readFileMock,
  },
}));

import {
  buildTaskWorkspacePaths,
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
    const mountpointChecks = new Map<string, number>();
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        const seen = mountpointChecks.get(mountPath) ?? 0;
        mountpointChecks.set(mountPath, seen + 1);
        if (seen === 0) {
          const error = new Error('not a mountpoint') as NodeJS.ErrnoException;
          error.code = 1 as never;
          callback(error);
          return;
        }
        callback(null);
        return;
      }
      callback(null);
    });
    mkdirMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue('');
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    delete process.env.MBOS_AGENT_WORKSPACE_ROOT;
    delete process.env.MBOS_AGENT_JUICEFS_MOUNT_OPTIONS;
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

  it('builds stable workspace paths within a persistent file library root', () => {
    expect(buildTaskWorkspacePaths('/srv/ags-workspaces/market-analysis-q1', 'task_1')).toEqual({
      rootCwd: '/srv/ags-workspaces/market-analysis-q1',
      sharedSkillsDir: '/srv/ags-workspaces/market-analysis-q1/.codex/skills',
      codexDir: '/srv/ags-workspaces/market-analysis-q1/.codex',
      homeDir: '/srv/ags-workspaces/market-analysis-q1',
      artifactsDir: '/srv/ags-workspaces/market-analysis-q1/.artifacts',
    });
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
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
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
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
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
      'mountpoint',
      ['-q', '/srv/ags-workspaces/market-analysis-q1'],
      expect.any(Function),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      'juicefs',
      expect.arrayContaining([
        'mount',
        'postgres://juicefs-meta',
        '/srv/ags-workspaces/market-analysis-q1',
        '--log',
        expect.stringContaining('.juicefs/log/agentsmith'),
        '--check-storage',
        '--bucket',
        'http://localhost:19000/jfs-lib-flib_1',
        '--cache-dir',
        expect.stringContaining('.juicefs/cache/agentsmith'),
      ]),
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        env: expect.not.objectContaining({
          HTTP_PROXY: expect.any(String),
          HTTPS_PROXY: expect.any(String),
          ALL_PROXY: expect.any(String),
          http_proxy: expect.any(String),
          https_proxy: expect.any(String),
          all_proxy: expect.any(String),
        }),
      }),
    );
    expect(spawnMock.mock.calls[0]?.[1]).not.toContain('-o');
    expect(resolved.cwd).toBe('/srv/ags-workspaces/market-analysis-q1');
    expect(resolved.source).toBe('file_library_mount');
    expect(resolved.paths.artifactsDir).toBe('/srv/ags-workspaces/market-analysis-q1/.artifacts');
  });

  it('passes explicit JuiceFS mount options when configured', async () => {
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/srv/ags-workspaces';
    process.env.MBOS_AGENT_JUICEFS_MOUNT_OPTIONS = 'writeback_cache,cache-size=204800';
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

    expect(spawnMock).toHaveBeenCalledWith(
      'juicefs',
      expect.arrayContaining([
        'mount',
        'postgres://juicefs-meta',
        '/srv/ags-workspaces/market-analysis-q1',
        '-o',
        'writeback_cache',
        '--cache-size',
        '204800',
      ]),
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        env: expect.not.objectContaining({
          HTTP_PROXY: expect.any(String),
          HTTPS_PROXY: expect.any(String),
          ALL_PROXY: expect.any(String),
          http_proxy: expect.any(String),
          https_proxy: expect.any(String),
          all_proxy: expect.any(String),
        }),
      }),
    );
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
    spawnMock.mockClear();
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
    expect(spawnMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(resolved.cwd).toBe('/srv/ags-workspaces/market-analysis-q1');
    expect(resolved.source).toBe('file_library_mount');
  });

  it('reuses an already-mounted workspace path after runner restart', async () => {
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/srv/ags-workspaces';
    execFileMock.mockImplementation((file, _args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        callback(null);
        return;
      }
      callback(null);
    });
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

    expect(spawnMock).not.toHaveBeenCalled();
    expect(resolved.cwd).toBe('/srv/ags-workspaces/market-analysis-q1');
    expect(resolved.source).toBe('file_library_mount');
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
    expect(resolved.cwd).toBe('/workspace');
    expect(resolved.source).toBe('workspace_path');
    expect(resolved.paths.artifactsDir).toBe('/workspace/.artifacts');
  });
});
