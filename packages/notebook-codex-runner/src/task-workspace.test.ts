import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, mkdirMock, fetchMock, readFileMock, spawnMock, writeFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  fetchMock: vi.fn(),
  readFileMock: vi.fn(),
  spawnMock: vi.fn(),
  writeFileMock: vi.fn(),
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
  writeFile: writeFileMock,
  default: {
    mkdir: mkdirMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
  },
}));

import {
  buildTaskWorkspaceMountPath,
  buildTaskWorkspacePaths,
  clearPreparedTaskWorkspaces,
  releasePreparedTaskWorkspace,
  fetchTaskWorkspaceAccess,
  prepareTaskWorkspace,
  resolveRunnerMode,
  resolveTaskCwd,
  shouldRetryTaskWorkspaceMount,
  shouldRetryTaskWorkspaceWriteFailure,
} from './task-workspace.js';
import { classifyMountedWorkspaceOwnerAuthority } from './task-workspace-ownership.js';

type PersistedMountRegistry = {
  version?: number;
  sessions?: Array<Record<string, unknown>>;
};

function parseRegistryWrite(callIndex?: number): PersistedMountRegistry {
  const call = typeof callIndex === 'number'
    ? writeFileMock.mock.calls[callIndex]
    : writeFileMock.mock.calls.at(-1);
  expect(call).toBeDefined();
  return JSON.parse(String(call?.[1] ?? '')) as PersistedMountRegistry;
}

function findRegistrySession(
  registry: PersistedMountRegistry,
  mountPath: string,
): Record<string, unknown> | undefined {
  return registry.sessions?.find((session) => session.mount_path === mountPath);
}

function expectIsoTimestamp(value: unknown): void {
  expect(typeof value).toBe('string');
  expect(Number.isNaN(Date.parse(String(value)))).toBe(false);
}

function buildRunnerProcessCommand(args: {
  pid: number;
  instanceId?: string;
}): string {
  const marker = args.instanceId ? ` runner_instance_id=${args.instanceId}` : '';
  return `${args.pid} node /workspace/packages/notebook-codex-runner/dist/index.js${marker}`;
}

function buildNonRunnerNotebookCommand(pid: number): string {
  return `${pid} vitest packages/notebook-codex-runner/src/index.ts --runInBand`;
}

function buildFindmntSourceOutput(args: {
  source: string;
  fstype?: string;
}): string {
  return `${args.source} ${args.fstype ?? 'fuse.juicefs'}\n`;
}

describe('task-workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPreparedTaskWorkspaces();
    const mountedPaths = new Set<string>();
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
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
    writeFileMock.mockResolvedValue(undefined);
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { exitCode: number | null; unref: () => void };
      child.exitCode = null;
      child.unref = vi.fn();
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    spawnMock.mockImplementation((command: string, args?: string[]) => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void; kill: () => void };
      child.unref = vi.fn();
      child.kill = vi.fn(() => {
        child.emit('exit', 0);
      });
      queueMicrotask(() => {
        if (command === 'juicefs' && Array.isArray(args)) {
          if (args[0] === 'mount') {
            mountedPaths.add(String(args[2] ?? ''));
            child.emit('spawn');
            return;
          }
          if (args[0] === 'umount') {
            mountedPaths.delete(String(args[1] ?? ''));
            child.emit('exit', 0);
            return;
          }
        }
        child.emit('spawn');
      });
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

  it('recognizes canonical node tsx cli launches from the notebook runner package cwd as live foreign owners', () => {
    const authority = classifyMountedWorkspaceOwnerAuthority({
      ownerRecord: {
        ownerProcessPid: 5100,
        runnerInstanceId: null,
      },
      currentRunnerPid: process.pid,
      currentRunnerInstanceId: process.env.MBOS_AGENT_RUNNER_INSTANCE_ID ?? 'runner-current',
      processTableByPid: new Map([
        [
          5100,
          {
            pid: 5100,
            cwd: '/workspace/packages/notebook-codex-runner',
            command: 'node /workspace/node_modules/tsx/dist/cli.mjs src/index.ts',
          },
        ],
      ]),
    });

    expect(authority).toEqual({
      kind: 'live_foreign_runner_legacy',
      reason: 'foreign_runner_alive_without_instance_marker',
    });
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
    expect(paths).toMatchObject({
      mode: 'docker_external',
      mountRoot: '/workspace/task_1',
      taskRoot: '/workspace/task_1',
      homeDir: '/workspace/task_1',
      codexDir: '/workspace/task_1/.codex',
      artifactsDir: '/workspace/task_1/.artifacts',
      mbosDir: '/workspace/task_1/.mbos',
      skillsDir: '/workspace/task_1/.agents/skills',
    });
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
      api_base: 'http://localhost:20000/api/v1/',
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
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
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
        stdio: 'ignore',
      }),
    );
    expect(resolved.cwd).toBe('/workspace/task_1');
    expect(resolved.source).toBe('file_library_mount');
    expect(resolved.paths.homeDir).toBe('/workspace/task_1');
    expect(resolved.paths.codexDir).toBe('/workspace/task_1/.codex');
    expect(resolved.paths.mbosDir).toBe('/workspace/task_1/.mbos');
    expect(typeof resolved.release).toBe('function');
    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/runner-root/task-workspace-mount-sessions.json',
      expect.any(String),
      'utf8',
    );
    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, '/workspace/task_1');
    expect(registry.version).toBe(3);
    expect(session).toMatchObject({
      mount_path: '/workspace/task_1',
      mode: 'docker_external',
      metadata_url: 'postgres://juicefs-meta',
      storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      refs: 1,
      owner_process_pid: process.pid,
      state: 'mounted',
      last_release_outcome: 'not_started',
      lease_revision: 1,
    });
    expect(typeof session?.owner_runner_instance_id).toBe('string');
    expect(String(session?.owner_runner_instance_id)).not.toHaveLength(0);
    expect(typeof session?.lease_id).toBe('string');
    expect(String(session?.lease_id)).not.toHaveLength(0);
    expectIsoTimestamp(session?.created_at);
    expectIsoTimestamp(session?.mounted_at);
    expectIsoTimestamp(session?.updated_at);
    expectIsoTimestamp(session?.last_ref_change_at);
  });

  it('upgrades legacy registry entries while preserving other tracked mounts', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_legacy',
            mode: 'docker_external',
            metadata_url: 'postgres://legacy-meta',
            storage_bucket_url: 'http://localhost:19000/jfs-lib-legacy',
            log_path: '/tmp/legacy.log',
            refs: 2,
          },
        ],
      }),
    );
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

    await prepareTaskWorkspace({
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

    const registry = parseRegistryWrite();
    const legacySession = findRegistrySession(registry, '/workspace/task_legacy');
    const newSession = findRegistrySession(registry, '/workspace/task_1');

    expect(registry.sessions).toHaveLength(2);
    expect(legacySession).toMatchObject({
      mount_path: '/workspace/task_legacy',
      refs: 2,
      owner_process_pid: null,
      owner_runner_instance_id: null,
      state: 'mounted',
      last_release_outcome: 'not_started',
    });
    expect(newSession).toMatchObject({
      mount_path: '/workspace/task_1',
      owner_process_pid: process.pid,
      state: 'mounted',
    });
  });

  it('refuses to steal a ready persisted mount when it belongs to another live runner owner', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_1',
            mode: 'docker_external',
            metadata_url: 'postgres://legacy-meta',
            storage_bucket_url: 'http://localhost:19000/jfs-lib-legacy',
            log_path: '/tmp/legacy.log',
            refs: 1,
            owner_process_pid: process.pid + 1000,
            owner_runner_instance_id: 'runner-legacy',
            lease_id: 'lease-foreign-live',
            lease_revision: 1,
            created_at: '2026-04-10T00:00:00.000Z',
            mounted_at: '2026-04-10T00:00:01.000Z',
            updated_at: '2026-04-10T00:00:02.000Z',
            state: 'mounted',
          },
        ],
      }),
    );
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
    const foreignOwnerPid = process.pid + 1000;

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
          const error = new Error('not a mountpoint') as NodeJS.ErrnoException;
          error.code = 1 as never;
          callback(error);
          return;
        }
        callback(null);
        return;
      }
      if (file === 'ps') {
        callback(null, `${buildRunnerProcessCommand({ pid: foreignOwnerPid, instanceId: 'runner-legacy' })}\n`, '');
        return;
      }
      callback(null);
    });

    await expect(prepareTaskWorkspace({
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
    })).rejects.toThrow('task_workspace_mount_owned_by_live_runner:/workspace/task_1');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('refuses to reuse a ready mount when registry evidence is missing', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
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
    readFileMock.mockResolvedValue('');

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
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

    await expect(prepareTaskWorkspace({
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
    })).rejects.toThrow('task_workspace_mount_untracked_live_mount:/workspace/task_1');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('refuses to blind unmount a ready mount when registry evidence cannot be read', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    const registryReadError = new Error('permission denied') as NodeJS.ErrnoException;
    registryReadError.code = 'EACCES';
    readFileMock.mockRejectedValue(registryReadError);

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
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

    await expect(releasePreparedTaskWorkspace('/workspace/task_1')).rejects.toThrow(
      'task_workspace_release_untracked_live_mount:/workspace/task_1',
    );

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('adopts a ready legacy mount in place when the same host startup can confirm no other runner owns it', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
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
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_1',
            mode: 'docker_external',
            metadata_url: 'postgres://legacy-meta',
            storage_bucket_url: 'http://localhost:19000/jfs-lib-legacy',
            log_path: '/tmp/legacy.log',
            refs: 1,
            owner_process_pid: null,
            owner_runner_instance_id: null,
            lease_id: null,
            lease_revision: 0,
            created_at: '2026-04-10T00:00:00.000Z',
            mounted_at: '2026-04-10T00:00:01.000Z',
            updated_at: '2026-04-10T00:00:02.000Z',
            state: 'mounted',
          },
        ],
      }),
    );

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
          const error = new Error('not a mountpoint') as NodeJS.ErrnoException;
          error.code = 1 as never;
          callback(error);
          return;
        }
        callback(null);
        return;
      }
      if (file === 'ps') {
        callback(null, `${buildRunnerProcessCommand({
          pid: process.pid,
          instanceId: process.env.MBOS_AGENT_RUNNER_INSTANCE_ID,
        })}\n`, '');
        return;
      }
      if (file === 'findmnt') {
        callback(null, buildFindmntSourceOutput({
          source: 'JuiceFS:flib-market-analysis-q1',
        }), '');
        return;
      }
      callback(null);
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

    expect(spawnMock).not.toHaveBeenCalled();
    expect(resolved.cwd).toBe('/workspace/task_1');
    expect(resolved.source).toBe('file_library_mount');

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, '/workspace/task_1');
    expect(session).toMatchObject({
      mount_path: '/workspace/task_1',
      refs: 1,
      owner_process_pid: process.pid,
      state: 'mounted',
      lease_revision: 1,
    });
    expect(typeof session?.owner_runner_instance_id).toBe('string');
    expect(String(session?.owner_runner_instance_id)).not.toHaveLength(0);
    expect(typeof session?.lease_id).toBe('string');
    expect(String(session?.lease_id)).not.toHaveLength(0);
  });

  it('fails closed instead of adopting a ready legacy mount when the live filesystem source mismatches workspace access truth', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
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
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_1',
            mode: 'docker_external',
            metadata_url: 'postgres://legacy-meta',
            storage_bucket_url: 'http://localhost:19000/jfs-lib-legacy',
            log_path: '/tmp/legacy.log',
            refs: 1,
            owner_process_pid: null,
            owner_runner_instance_id: null,
            lease_id: null,
            lease_revision: 0,
            created_at: '2026-04-10T00:00:00.000Z',
            mounted_at: '2026-04-10T00:00:01.000Z',
            updated_at: '2026-04-10T00:00:02.000Z',
            state: 'mounted',
          },
        ],
      }),
    );

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
          const error = new Error('not a mountpoint') as NodeJS.ErrnoException;
          error.code = 1 as never;
          callback(error);
          return;
        }
        callback(null);
        return;
      }
      if (file === 'ps') {
        callback(null, `${buildRunnerProcessCommand({
          pid: process.pid,
          instanceId: process.env.MBOS_AGENT_RUNNER_INSTANCE_ID,
        })}\n`, '');
        return;
      }
      if (file === 'findmnt') {
        callback(null, buildFindmntSourceOutput({
          source: 'JuiceFS:flib-wrong-filesystem',
        }), '');
        return;
      }
      callback(null);
    });

    await expect(prepareTaskWorkspace({
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
    })).rejects.toThrow('task_workspace_mount_truth_mismatch:/workspace/task_1');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('fails closed on a ready legacy mount when another runner is still alive and ownership stays unverified', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
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
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_1',
            mode: 'docker_external',
            metadata_url: 'postgres://legacy-meta',
            storage_bucket_url: 'http://localhost:19000/jfs-lib-legacy',
            log_path: '/tmp/legacy.log',
            refs: 1,
            owner_process_pid: null,
            owner_runner_instance_id: null,
            lease_id: null,
            lease_revision: 0,
            created_at: '2026-04-10T00:00:00.000Z',
            mounted_at: '2026-04-10T00:00:01.000Z',
            updated_at: '2026-04-10T00:00:02.000Z',
            state: 'mounted',
          },
        ],
      }),
    );

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
          const error = new Error('not a mountpoint') as NodeJS.ErrnoException;
          error.code = 1 as never;
          callback(error);
          return;
        }
        callback(null);
        return;
      }
      if (file === 'ps') {
        callback(null, `${buildRunnerProcessCommand({ pid: process.pid + 1000, instanceId: 'runner-foreign' })}\n`, '');
        return;
      }
      callback(null);
    });

    await expect(prepareTaskWorkspace({
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
    })).rejects.toThrow('task_workspace_mount_untracked_live_mount:/workspace/task_1');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('ignores test-style commands that only mention notebook-codex-runner when deciding whether a legacy mount is still owned by another runner', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
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
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_1',
            mode: 'docker_external',
            metadata_url: 'postgres://legacy-meta',
            storage_bucket_url: 'http://localhost:19000/jfs-lib-legacy',
            log_path: '/tmp/legacy.log',
            refs: 1,
            owner_process_pid: null,
            owner_runner_instance_id: null,
            lease_id: null,
            lease_revision: 0,
            created_at: '2026-04-10T00:00:00.000Z',
            mounted_at: '2026-04-10T00:00:01.000Z',
            updated_at: '2026-04-10T00:00:02.000Z',
            state: 'mounted',
          },
        ],
      }),
    );

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
          const error = new Error('not a mountpoint') as NodeJS.ErrnoException;
          error.code = 1 as never;
          callback(error);
          return;
        }
        callback(null);
        return;
      }
      if (file === 'ps') {
        callback(
          null,
          [
            buildRunnerProcessCommand({
              pid: process.pid,
              instanceId: process.env.MBOS_AGENT_RUNNER_INSTANCE_ID,
            }),
            buildNonRunnerNotebookCommand(process.pid + 1000),
          ].join('\n'),
          '',
        );
        return;
      }
      if (file === 'findmnt') {
        callback(null, buildFindmntSourceOutput({
          source: 'JuiceFS:flib-market-analysis-q1',
        }), '');
        return;
      }
      callback(null);
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

    expect(spawnMock).not.toHaveBeenCalled();
    expect(resolved.cwd).toBe('/workspace/task_1');
    expect(resolved.source).toBe('file_library_mount');

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, '/workspace/task_1');
    expect(session).toMatchObject({
      mount_path: '/workspace/task_1',
      refs: 1,
      owner_process_pid: process.pid,
      state: 'mounted',
      lease_revision: 1,
    });
  });

  it('quarantines an incomplete foreign legacy mount before remounting when its recorded owner is gone', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_1',
            mode: 'docker_external',
            metadata_url: 'postgres://legacy-meta',
            storage_bucket_url: 'http://localhost:19000/jfs-lib-legacy',
            log_path: '/tmp/legacy.log',
            refs: 1,
            owner_process_pid: process.pid + 1000,
            owner_runner_instance_id: 'runner-legacy',
            lease_id: null,
            lease_revision: 0,
            created_at: '2026-04-10T00:00:00.000Z',
            mounted_at: '2026-04-10T00:00:01.000Z',
            updated_at: '2026-04-10T00:00:02.000Z',
            state: 'mounted',
          },
        ],
      }),
    );
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

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
          const error = new Error('not a mountpoint') as NodeJS.ErrnoException;
          error.code = 1 as never;
          callback(error);
          return;
        }
        callback(null);
        return;
      }
      if (file === 'ps') {
        callback(null, `${buildRunnerProcessCommand({
          pid: process.pid,
          instanceId: process.env.MBOS_AGENT_RUNNER_INSTANCE_ID,
        })}\n`, '');
        return;
      }
      callback(null);
    });
    spawnMock.mockImplementation((command: string, args?: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        unref: () => void;
        kill: () => void;
      };
      child.exitCode = null;
      child.unref = vi.fn();
      child.kill = vi.fn(() => {
        child.exitCode = 0;
        child.emit('exit', 0);
      });
      queueMicrotask(() => {
        if (command === 'juicefs' && Array.isArray(args)) {
          if (args[0] === 'umount') {
            mountedPaths.delete(String(args[1] ?? ''));
            child.exitCode = 0;
            child.emit('exit', 0);
            return;
          }
          if (args[0] === 'mount') {
            mountedPaths.add(String(args[2] ?? ''));
            child.emit('spawn');
            return;
          }
        }
        child.emit('spawn');
      });
      return child;
    });

    await prepareTaskWorkspace({
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

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'juicefs',
      ['umount', '/workspace/task_1'],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      expect.arrayContaining([
        'mount',
        'postgres://juicefs-meta',
        '/workspace/task_1',
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, '/workspace/task_1');
    expect(session).toMatchObject({
      mount_path: '/workspace/task_1',
      refs: 1,
      owner_process_pid: process.pid,
      state: 'mounted',
      lease_revision: 1,
    });
  });

  it('reclaims a ready persisted mount before reuse when the foreign runner owner is dead', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    const foreignOwnerPid = process.pid + 1000;
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_1',
            mode: 'docker_external',
            metadata_url: 'postgres://legacy-meta',
            storage_bucket_url: 'http://localhost:19000/jfs-lib-legacy',
            log_path: '/tmp/legacy.log',
            refs: 1,
            owner_process_pid: foreignOwnerPid,
            owner_runner_instance_id: 'runner-legacy',
            lease_id: 'lease-foreign-dead',
            lease_revision: 1,
            created_at: '2026-04-10T00:00:00.000Z',
            mounted_at: '2026-04-10T00:00:01.000Z',
            updated_at: '2026-04-10T00:00:02.000Z',
            state: 'mounted',
          },
        ],
      }),
    );
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

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
          const error = new Error('not a mountpoint') as NodeJS.ErrnoException;
          error.code = 1 as never;
          callback(error);
          return;
        }
        callback(null);
        return;
      }
      if (file === 'ps') {
        callback(null, `${buildRunnerProcessCommand({
          pid: process.pid,
          instanceId: process.env.MBOS_AGENT_RUNNER_INSTANCE_ID,
        })}\n`, '');
        return;
      }
      callback(null);
    });
    spawnMock.mockImplementation((command: string, args?: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        unref: () => void;
        kill: () => void;
      };
      child.exitCode = null;
      child.unref = vi.fn();
      child.kill = vi.fn(() => {
        child.exitCode = 0;
        child.emit('exit', 0);
      });
      queueMicrotask(() => {
        if (command === 'juicefs' && Array.isArray(args)) {
          if (args[0] === 'umount') {
            mountedPaths.delete(String(args[1] ?? ''));
            child.exitCode = 0;
            child.emit('exit', 0);
            return;
          }
          if (args[0] === 'mount') {
            mountedPaths.add(String(args[2] ?? ''));
            child.emit('spawn');
            return;
          }
        }
        child.emit('spawn');
      });
      return child;
    });
    await prepareTaskWorkspace({
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

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'juicefs',
      ['umount', '/workspace/task_1'],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      expect.arrayContaining([
        'mount',
        'postgres://juicefs-meta',
        '/workspace/task_1',
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, '/workspace/task_1');
    expect(session).toMatchObject({
      mount_path: '/workspace/task_1',
      refs: 1,
      owner_process_pid: process.pid,
      state: 'mounted',
      last_release_outcome: 'not_started',
    });
    expect(session?.owner_runner_instance_id).not.toBe('runner-legacy');
  });

  it('treats a reused foreign owner pid as stale when the live pid now belongs to an unrelated process', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    const foreignOwnerPid = process.pid + 1000;
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_1',
            mode: 'docker_external',
            metadata_url: 'postgres://legacy-meta',
            storage_bucket_url: 'http://localhost:19000/jfs-lib-legacy',
            log_path: '/tmp/legacy.log',
            refs: 1,
            owner_process_pid: foreignOwnerPid,
            owner_runner_instance_id: 'runner-legacy',
            lease_id: 'lease-foreign-stale',
            lease_revision: 1,
            created_at: '2026-04-10T00:00:00.000Z',
            mounted_at: '2026-04-10T00:00:01.000Z',
            updated_at: '2026-04-10T00:00:02.000Z',
            state: 'mounted',
          },
        ],
      }),
    );
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

    const mountedPaths = new Set<string>(['/workspace/task_1']);
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
          const error = new Error('not a mountpoint') as NodeJS.ErrnoException;
          error.code = 1 as never;
          callback(error);
          return;
        }
        callback(null);
        return;
      }
      if (file === 'ps') {
        callback(
          null,
          [
            buildRunnerProcessCommand({
              pid: process.pid,
              instanceId: process.env.MBOS_AGENT_RUNNER_INSTANCE_ID,
            }),
            `${foreignOwnerPid} node /tmp/unrelated-server.js`,
          ].join('\n'),
          '',
        );
        return;
      }
      callback(null);
    });
    spawnMock.mockImplementation((command: string, args?: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        unref: () => void;
        kill: () => void;
      };
      child.exitCode = null;
      child.unref = vi.fn();
      child.kill = vi.fn(() => {
        child.exitCode = 0;
        child.emit('exit', 0);
      });
      queueMicrotask(() => {
        if (command === 'juicefs' && Array.isArray(args)) {
          if (args[0] === 'umount') {
            mountedPaths.delete(String(args[1] ?? ''));
            child.exitCode = 0;
            child.emit('exit', 0);
            return;
          }
          if (args[0] === 'mount') {
            mountedPaths.add(String(args[2] ?? ''));
            child.emit('spawn');
            return;
          }
        }
        child.emit('spawn');
      });
      return child;
    });

    await prepareTaskWorkspace({
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

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'juicefs',
      ['umount', '/workspace/task_1'],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      expect.arrayContaining([
        'mount',
        'postgres://juicefs-meta',
        '/workspace/task_1',
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
  });

  it('forces a real unmount before remounting when task-root bootstrap hits a retryable write failure', async () => {
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

    const initial = await prepareTaskWorkspace({
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
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(initial.lease).toMatchObject({
      mountPath: '/workspace/task_1',
      revision: 1,
    });

    const mkdirCalls = new Map<string, number>();
    mkdirMock.mockImplementation(async (target: string) => {
      const seen = mkdirCalls.get(target) ?? 0;
      mkdirCalls.set(target, seen + 1);
      if (target === '/workspace/task_1/.mbos' && seen === 0) {
        const error = new Error('stale mount') as NodeJS.ErrnoException;
        error.code = 'EIO';
        throw error;
      }
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

    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      ['umount', '/workspace/task_1'],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      3,
      'juicefs',
      expect.arrayContaining([
        'mount',
        'postgres://juicefs-meta',
        '/workspace/task_1',
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    expect(resolved.cwd).toBe('/workspace/task_1');
    expect(resolved.source).toBe('file_library_mount');
    expect(resolved.lease).toMatchObject({
      mountPath: '/workspace/task_1',
      revision: 2,
    });
    expect(resolved.lease?.leaseId).not.toBe(initial.lease?.leaseId);

    await expect(initial.release()).rejects.toThrow(
      'task_workspace_release_lease_mismatch:/workspace/task_1',
    );
    expect(spawnMock).toHaveBeenCalledTimes(3);

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, '/workspace/task_1');
    expect(session).toMatchObject({
      mount_path: '/workspace/task_1',
      refs: 1,
      state: 'mounted',
      lease_revision: 2,
    });
  });

  it('releases the real mount path when a prepared workspace is released', async () => {
    process.env.MBOS_RUNNER_MODE = 'host_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
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

    await resolved.release();

    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      ['umount', '/home/alice/ags-workspace/task_1'],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    const releasingRegistry = parseRegistryWrite(1);
    const releasingSession = findRegistrySession(
      releasingRegistry,
      '/home/alice/ags-workspace/task_1',
    );
    expect(releasingSession).toMatchObject({
      mount_path: '/home/alice/ags-workspace/task_1',
      state: 'releasing',
      last_release_outcome: 'pending',
      owner_process_pid: process.pid,
    });
    expectIsoTimestamp(releasingSession?.last_release_attempt_at);

    const finalRegistry = parseRegistryWrite();
    expect(findRegistrySession(finalRegistry, '/home/alice/ags-workspace/task_1')).toBeUndefined();
  });

  it('falls back to helper termination and lazy host unmount when a busy mount does not release on normal juicefs umount', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_JUICEFS_MOUNT_RELEASE_TIMEOUT_MS = '1';
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

    const mountedPaths = new Set<string>();
    const events: string[] = [];

    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
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

    spawnMock.mockImplementation((command: string, args?: string[]) => {
      const child = new EventEmitter() as EventEmitter & { exitCode: number | null; unref: () => void; kill: (signal?: string) => void };
      child.exitCode = null;
      child.unref = vi.fn();
      child.kill = vi.fn((signal?: string) => {
        if (command === 'juicefs' && Array.isArray(args) && args[0] === 'mount') {
          events.push(`helper_kill:${signal ?? 'SIGTERM'}`);
          queueMicrotask(() => {
            child.exitCode = 0;
            child.emit('exit', 0);
          });
        }
      });
      child.once('exit', () => {
        if (command === 'juicefs' && Array.isArray(args) && args[0] === 'mount') {
          events.push('helper_exit');
        }
      });
      queueMicrotask(() => {
        if (command === 'juicefs' && Array.isArray(args)) {
          if (args[0] === 'mount') {
            mountedPaths.add(String(args[2] ?? ''));
            child.emit('spawn');
            return;
          }
          if (args[0] === 'umount') {
            events.push(`juicefs_umount:${args.join(' ')}`);
            child.emit('exit', 0);
            return;
          }
        }
        if (command === 'umount' && Array.isArray(args)) {
          events.push(`host_umount:${args.join(' ')}`);
          if (args[0] === '-l' || args[0] === '-lf') {
            mountedPaths.delete('/workspace/task_1');
          }
          child.emit('exit', 0);
          return;
        }
        child.emit('spawn');
      });
      return child;
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

      await resolved.release();

      expect(events).toContain('helper_kill:SIGTERM');
      expect(events).toContain('helper_exit');
      expect(events.findIndex((event) => event === 'helper_exit')).toBeLessThan(events.findIndex((event) => event.startsWith('host_umount:-l ')));
      expect(spawnMock).toHaveBeenCalledWith(
        'umount',
        ['-l', '/workspace/task_1'],
        expect.objectContaining({
          stdio: 'ignore',
        }),
      );
  });

  it('rejects releasing a tracked workspace by mount path without the owning lease', async () => {
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

    await prepareTaskWorkspace({
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

    await expect(releasePreparedTaskWorkspace('/workspace/task_1')).rejects.toThrow(
      'task_workspace_release_requires_lease:/workspace/task_1',
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('can release a tracked workspace by mount path with the owning lease', async () => {
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

    expect(resolved.lease).toMatchObject({
      mountPath: '/workspace/task_1',
      revision: 1,
    });
    await releasePreparedTaskWorkspace('/workspace/task_1', resolved.lease!);

    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      ['umount', '/workspace/task_1'],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
  });

  it('rejects releasing a tracked workspace by mount path with the wrong lease', async () => {
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

    const wrongLease = {
      ...resolved.lease!,
      leaseId: 'lease-wrong',
    };

    await expect(releasePreparedTaskWorkspace('/workspace/task_1', wrongLease)).rejects.toThrow(
      'task_workspace_release_lease_mismatch:/workspace/task_1',
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, '/workspace/task_1');
    expect(session).toMatchObject({
      mount_path: '/workspace/task_1',
      refs: 1,
      state: 'mounted',
      lease_id: resolved.lease?.leaseId,
      lease_revision: resolved.lease?.revision,
    });
  });

  it('keeps release failure evidence in the registry when unmount cannot be completed', async () => {
    process.env.MBOS_RUNNER_MODE = 'docker_external';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    process.env.MBOS_AGENT_JUICEFS_MOUNT_RELEASE_TIMEOUT_MS = '1';
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

    const mountedPaths = new Set<string>();
    execFileMock.mockImplementation((file, args, maybeOptions, maybeCallback) => {
      const callback = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      if (file === 'mountpoint') {
        const mountPath = Array.isArray(args) ? String(args[1] ?? '') : '';
        if (!mountedPaths.has(mountPath)) {
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
    spawnMock.mockImplementation((command: string, args?: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        unref: () => void;
        kill: (signal?: string) => void;
      };
      child.exitCode = null;
      child.unref = vi.fn();
      child.kill = vi.fn(() => {
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit('exit', 0);
        });
      });
      queueMicrotask(() => {
        if (command === 'juicefs' && Array.isArray(args)) {
          if (args[0] === 'mount') {
            mountedPaths.add(String(args[2] ?? ''));
            child.emit('spawn');
            return;
          }
          child.exitCode = 1;
          child.emit('exit', 1);
          return;
        }
        if (command === 'umount') {
          child.exitCode = 1;
          child.emit('exit', 1);
          return;
        }
        child.emit('spawn');
      });
      return child;
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

    await expect(resolved.release()).rejects.toThrow('task_workspace_umount_not_ready:/workspace/task_1');

    const failedRegistry = parseRegistryWrite();
    const failedSession = findRegistrySession(failedRegistry, '/workspace/task_1');
    expect(failedSession).toMatchObject({
      mount_path: '/workspace/task_1',
      owner_process_pid: process.pid,
      state: 'release_failed',
      last_release_outcome: 'failed',
      refs: 1,
    });
    expect(typeof failedSession?.owner_runner_instance_id).toBe('string');
    expectIsoTimestamp(failedSession?.last_release_attempt_at);
    expect(Array.isArray(failedSession?.release_attempts)).toBe(true);
    expect((failedSession?.release_attempts as unknown[])).not.toHaveLength(0);
    expect(String(failedSession?.last_release_error)).toContain('task_workspace_umount_not_ready:/workspace/task_1');
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

  it('recognizes retryable task-root write failures for stale mounts', () => {
    const eio = new Error('input/output error') as NodeJS.ErrnoException;
    eio.code = 'EIO';
    const estale = new Error('stale file handle') as NodeJS.ErrnoException;
    estale.code = 'ESTALE';
    const enotconn = new Error('transport endpoint is not connected') as NodeJS.ErrnoException;
    enotconn.code = 'ENOTCONN';
    const eacces = new Error('permission denied') as NodeJS.ErrnoException;
    eacces.code = 'EACCES';

    expect(shouldRetryTaskWorkspaceWriteFailure(eio)).toBe(true);
    expect(shouldRetryTaskWorkspaceWriteFailure(estale)).toBe(true);
    expect(shouldRetryTaskWorkspaceWriteFailure(enotconn)).toBe(true);
    expect(shouldRetryTaskWorkspaceWriteFailure(eacces)).toBe(false);
  });
});
