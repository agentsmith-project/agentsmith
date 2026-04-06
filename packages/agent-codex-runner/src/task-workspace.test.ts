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
  buildTaskWorkspaceMountPath,
  buildTaskWorkspacePaths,
  clearPreparedTaskWorkspaces,
  fetchTaskWorkspaceAccess,
  prepareTaskWorkspace,
  resolveRunnerMode,
  resolveTaskCwd,
  shouldRetryTaskWorkspaceMount,
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
    delete process.env.MBOS_AGENT_CODEX_STATE_ROOT;
    delete process.env.MBOS_AGENT_JUICEFS_MOUNT_OPTIONS;
    delete process.env.WORKSPACE_PATH;
    process.env.HOME = '/home/alice';
    process.env.MBOS_RUNNER_MODE = 'host_external';
  });

  it('resolves runner mode from explicit env', () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    expect(resolveRunnerMode()).toBe('docker_external');
  });

  it('builds host external task mount paths under ~/ags-workspace/<task_id>', () => {
    expect(buildTaskWorkspaceMountPath({
      mode: 'host_external',
      taskId: 'task_1',
    })).toBe('/home/alice/ags-workspace/task_1');
  });

  it('builds docker and internal task mount paths under /workspace/<task_id>', () => {
    expect(buildTaskWorkspaceMountPath({
      mode: 'docker_external',
      taskId: 'task_1',
    })).toBe('/workspace/task_1');
    expect(buildTaskWorkspaceMountPath({
      mode: 'k8s_internal',
      taskId: 'task_1',
    })).toBe('/workspace/task_1');
  });

  it('builds task-root-scoped runtime paths under the task directory', () => {
    const paths = buildTaskWorkspacePaths('/workspace/task_1', 'docker_external');
    expect(paths).toEqual({
      mode: 'docker_external',
      mountRoot: '/workspace/task_1',
      taskRoot: '/workspace/task_1',
      homeDir: '/workspace/task_1',
      codexDir: '/workspace/task_1/.codex',
      artifactsDir: '/workspace/task_1/.artifacts',
      mbosDir: '/workspace/task_1/.mbos',
      credentialDir: expect.stringContaining('/agentsmith-runner-state/docker_external/_workspace_task_1/credentials'),
      skillsDir: '/workspace/task_1/.agents/skills',
    });
    expect(paths.credentialDir.startsWith(paths.taskRoot)).toBe(false);
  });

  it('prefers an explicit workspace path for pre-mounted internal runs', () => {
    process.env.MBOS_RUNNER_MODE = 'k8s_internal';
    expect(resolveTaskCwd({
      workspacePath: '/workspace/task_internal',
      taskId: 'task_internal',
    })).toEqual({
      cwd: '/workspace/task_internal',
      source: 'workspace_path',
      mode: 'k8s_internal',
    });
  });

  it('falls back to the mode task mount path when workspace path is missing', () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    expect(resolveTaskCwd({
      taskId: 'task_1',
    })).toEqual({
      cwd: '/workspace/task_1',
      source: 'mode_mount_path',
      mode: 'docker_external',
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
      execution_ticket: 'test-token',
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

  it('mounts external file-library workspaces directly at the task directory', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        workspace_dir_name: 'ignored-in-v2',
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
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      },
      username: 'alice',
      taskId: 'task_1',
    });

    expect(mkdirMock).toHaveBeenCalledWith('/workspace/task_1', { recursive: true });
    expect(spawnMock).toHaveBeenCalledWith(
      'juicefs',
      expect.arrayContaining([
        'mount',
        'postgres://juicefs-meta',
        '/workspace/task_1',
      ]),
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    );
    expect(resolved.cwd).toBe('/workspace/task_1');
    expect(resolved.source).toBe('file_library_mount');
    expect(resolved.paths.homeDir).toBe('/workspace/task_1');
    expect(resolved.paths.codexDir).toBe('/workspace/task_1/.codex');
    expect(resolved.paths.mbosDir).toBe('/workspace/task_1/.mbos');
    expect(resolved.paths.credentialDir).toContain('/agentsmith-runner-state/docker_external/_workspace_task_1/credentials');
  });

  it('uses the explicit internal task path for pre-mounted workspaces', async () => {
    process.env.MBOS_RUNNER_MODE = 'k8s_internal';

    const resolved = await prepareTaskWorkspace({
      executionContext: {
        workspace_binding_mode: 'pre_mounted',
        workspace_path: '/workspace/task_internal',
      },
      username: 'alice',
      taskId: 'task_internal',
    });

    expect(resolved.cwd).toBe('/workspace/task_internal');
    expect(resolved.source).toBe('workspace_path');
    expect(resolved.paths.codexDir).toBe('/workspace/task_internal/.codex');
    expect(resolved.paths.mbosDir).toBe('/workspace/task_internal/.mbos');
    expect(resolved.paths.skillsDir).toBe('/workspace/task_internal/.agents/skills');
  });

  it('recognizes retryable mount failures', () => {
    expect(shouldRetryTaskWorkspaceMount(new Error('task_workspace_mount_not_ready'))).toBe(true);
    expect(shouldRetryTaskWorkspaceMount(new Error('boom'))).toBe(false);
  });
});
