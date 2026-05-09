import { EventEmitter } from 'node:events';
import { relative } from 'node:path';
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
  buildTaskWorkspacePaths,
  clearPreparedTaskWorkspaces,
  releasePreparedTaskWorkspace,
  fetchTaskWorkspaceAccess,
  prepareTaskWorkspace,
  releaseTaskWorkspaceAccess,
  resolveAgentTaskRunnerMode,
  resolveTaskCwd,
  shouldRetryTaskWorkspaceMount,
  shouldRetryTaskWorkspaceWriteFailure,
} from './task-workspace.js';
import { classifyMountedWorkspaceOwnerAuthority } from './task-workspace-ownership.js';

const TASK_HOME = '/home/task_1';
const TASK_WORKSPACE = `${TASK_HOME}/workspace`;
const TASK_ARTIFACTS = `${TASK_WORKSPACE}/.artifacts`;
const LIBRARY_ROOT_PATH = '.';
const TASK_FILE_LIBRARY_ID = 'flib_1';
const TASK_HOME_SEGMENT = 'task_1';
const WORKSPACE_BINDING_MODE = 'file_library';
const HOLDER_ID = 'holder_task_1';
const BINDING_GENERATION = 'binding_gen_1';
const LEASE_EPOCH = 'lease_epoch_1';
const ISSUED_AT = '2026-05-09T00:00:00.000Z';
const EXPIRES_AT = '2026-05-09T00:15:00.000Z';

type PersistedMountRegistry = {
  version?: number;
  sessions?: Array<Record<string, unknown>>;
};

function taskExecutionContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: 'task_1',
    workspace_file_library_id: TASK_FILE_LIBRARY_ID,
    workspace_binding_mode: WORKSPACE_BINDING_MODE,
    runtime_profile: process.env.MBOS_AGENT_TASK_RUNNER_MODE === 'developer' ? 'developer' : 'managed',
    task_home_segment: TASK_HOME_SEGMENT,
    task_home_path: TASK_HOME,
    workspace_path: TASK_WORKSPACE,
    artifacts_path: TASK_ARTIFACTS,
    library_root_path: LIBRARY_ROOT_PATH,
    ...overrides,
  };
}

function taskExecutionContextForHome(
  taskId: string,
  taskHome: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    task_id: taskId,
    workspace_file_library_id: TASK_FILE_LIBRARY_ID,
    workspace_binding_mode: WORKSPACE_BINDING_MODE,
    runtime_profile: process.env.MBOS_AGENT_TASK_RUNNER_MODE === 'developer' ? 'developer' : 'managed',
    task_home_segment: taskId,
    task_home_path: taskHome,
    workspace_path: `${taskHome}/workspace`,
    artifacts_path: `${taskHome}/workspace/.artifacts`,
    library_root_path: LIBRARY_ROOT_PATH,
    ...overrides,
  };
}

function workspaceAccessEcho(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_id: 'task_1',
    file_library_id: TASK_FILE_LIBRARY_ID,
    workspace_binding_mode: WORKSPACE_BINDING_MODE,
    runtime_profile: process.env.MBOS_AGENT_TASK_RUNNER_MODE === 'developer' ? 'developer' : 'managed',
    task_home_segment: TASK_HOME_SEGMENT,
    task_home_path: TASK_HOME,
    workspace_path: TASK_WORKSPACE,
    artifacts_path: TASK_ARTIFACTS,
    library_root_path: LIBRARY_ROOT_PATH,
    holder_id: HOLDER_ID,
    holder_kind: 'runner_workspace',
    binding_generation: BINDING_GENERATION,
    lease_epoch: LEASE_EPOCH,
    issued_at: ISSUED_AT,
    expires_at: EXPIRES_AT,
    ...overrides,
  };
}

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

function expectPathOutside(root: string, target: string): void {
  const rel = relative(root, target);
  expect(rel).not.toBe('');
  expect(rel.startsWith('..')).toBe(true);
}

function buildRunnerProcessCommand(args: {
  pid: number;
  instanceId?: string;
}): string {
  const marker = args.instanceId ? ` runner_instance_id=${args.instanceId}` : '';
  return `${args.pid} node /workspace/packages/agent-task-runner/dist/index.js${marker}`;
}

function buildNonRunnerAgentTaskCommand(pid: number): string {
  return `${pid} vitest packages/agent-task-runner/src/index.ts --runInBand`;
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
    delete process.env.MBOS_AGENT_JUICEFS_MOUNT_OPTIONS;
    delete process.env.MBOS_AGENT_JUICEFS_MOUNT_RETRY_COUNT;
    delete process.env.MBOS_AGENT_JUICEFS_MOUNT_RETRY_DELAY_MS;
    delete process.env.WORKSPACE_PATH;
    process.env.HOME = '/home/alice';
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'developer';
  });

  it('resolves runner mode from explicit env', () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    expect(resolveAgentTaskRunnerMode()).toBe('managed_local');
  });

  it('recognizes canonical node tsx cli launches from the agent task runner package cwd as live foreign owners', () => {
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
            cwd: '/workspace/packages/agent-task-runner',
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

  it('ignores legacy Codex state root env and builds runtime state under task HOME', () => {
    process.env.MBOS_AGENT_CODEX_STATE_ROOT = '/runner-runtime';

    const paths = buildTaskWorkspacePaths({
      mode: 'managed_local',
      taskHomePath: TASK_HOME,
      workspacePath: TASK_WORKSPACE,
      artifactsPath: TASK_ARTIFACTS,
    });
    expect(paths).toMatchObject({
      mode: 'managed_local',
      taskHome: TASK_HOME,
      homeDir: TASK_HOME,
      workspaceDir: TASK_WORKSPACE,
      visibleRoot: TASK_WORKSPACE,
      libraryRoot: LIBRARY_ROOT_PATH,
      mountRoot: TASK_HOME,
      taskRoot: TASK_HOME,
      runtimeRoot: TASK_HOME,
      codexDir: `${TASK_HOME}/.codex`,
      mbosDir: `${TASK_HOME}/.mbos`,
      skillsDir: `${TASK_HOME}/.agents/skills`,
      artifactsDir: TASK_ARTIFACTS,
    });
    expectPathOutside('/runner-runtime', paths.codexDir);
  });

  it('requires explicit canonical path fields for prepared task paths', () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_platform';
    expect(resolveTaskCwd({
      taskId: 'task_1',
      taskHomePath: TASK_HOME,
      workspacePath: TASK_WORKSPACE,
      artifactsPath: TASK_ARTIFACTS,
    })).toEqual(expect.objectContaining({
      cwd: TASK_WORKSPACE,
      source: 'path_fields',
      mode: 'managed_platform',
      paths: expect.objectContaining({
        taskHome: TASK_HOME,
        workspaceDir: TASK_WORKSPACE,
        artifactsDir: TASK_ARTIFACTS,
        libraryRoot: LIBRARY_ROOT_PATH,
      }),
    }));

    expect(() => resolveTaskCwd({
      taskId: 'task_1',
    })).toThrow('task_workspace_paths_missing:task_home_path');
  });

  it('does not translate API execution paths into the developer workspace root', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'developer';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/home/alice/ags-workspace';

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContextForHome('task_api_truth', '/home/task_api_truth', {
        workspace_binding_mode: 'pre_mounted',
      }),
      username: 'alice',
      taskId: 'task_api_truth',
    });

    expect(resolved.cwd).toBe('/home/task_api_truth/workspace');
    expect(resolved.paths.taskHome).toBe('/home/task_api_truth');
    expect(resolved.paths.workspaceDir).toBe('/home/task_api_truth/workspace');
    expect(resolved.paths.taskHome).not.toBe('/home/alice/ags-workspace/task_api_truth');
  });

  it('fetches task-bound workspace access with bearer auth', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
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

  it('releases task-bound workspace access with the holder fence', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    });

    await releaseTaskWorkspaceAccess({
      api_base: 'http://localhost:20000/api/v1/',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      task_id: 'task_1',
      execution_ticket: 'test-token',
    }, {
      mountPath: TASK_HOME,
      leaseId: 'lease_local_1',
      revision: 1,
      holderId: HOLDER_ID,
      taskId: 'task_1',
      fileLibraryId: TASK_FILE_LIBRARY_ID,
      taskHomeSegment: TASK_HOME_SEGMENT,
      bindingGeneration: '1778300000000001',
      leaseEpoch: LEASE_EPOCH,
      holderKind: 'runner_workspace',
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/workspace-access/release',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          holder_id: HOLDER_ID,
          file_library_id: TASK_FILE_LIBRARY_ID,
          binding_generation: '1778300000000001',
          lease_epoch: LEASE_EPOCH,
        }),
      }),
    );
  });

  it('mounts managed file-library workspaces directly at the task directory', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(mkdirMock).toHaveBeenCalledWith(TASK_HOME, { recursive: true });
    expect(spawnMock).toHaveBeenCalledWith(
      'juicefs',
      expect.arrayContaining([
        'mount',
        'postgres://juicefs-meta',
        TASK_HOME,
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    expect(resolved.cwd).toBe(TASK_WORKSPACE);
    expect(resolved.source).toBe('file_library_mount');
    expect(resolved.paths.visibleRoot).toBe(TASK_WORKSPACE);
    expect(resolved.paths.runtimeRoot).toBe(TASK_HOME);
    expect(resolved.paths.homeDir).toBe(TASK_HOME);
    expect(resolved.paths.taskHome).toBe(TASK_HOME);
    expect(resolved.paths.workspaceDir).toBe(TASK_WORKSPACE);
    expect(resolved.paths.codexDir).toBe(`${TASK_HOME}/.codex`);
    expect(resolved.paths.mbosDir).toBe(`${TASK_HOME}/.mbos`);
    expect(resolved.paths.skillsDir).toBe(`${TASK_HOME}/.agents/skills`);
    expect(resolved.paths.artifactsDir).toBe(TASK_ARTIFACTS);
    expect(typeof resolved.release).toBe('function');
    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/runner-root/task-workspace-mount-sessions.json',
      expect.any(String),
      'utf8',
    );
    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, TASK_HOME);
    expect(registry.version).toBe(5);
    expect(session).toMatchObject({
      mount_path: TASK_HOME,
      mode: 'managed_local',
      filesystem_name: 'flib-market-analysis-q1',
      metadata_url: '[redacted]',
      storage_bucket_url: '[redacted]',
      refs: 1,
      owner_process_pid: process.pid,
      state: 'mounted',
      last_release_outcome: 'not_started',
      lease_revision: 1,
      holder_id: HOLDER_ID,
      task_id: 'task_1',
      file_library_id: TASK_FILE_LIBRARY_ID,
      task_home_segment: TASK_HOME_SEGMENT,
      binding_generation: BINDING_GENERATION,
      lease_epoch: LEASE_EPOCH,
      holder_kind: 'runner_workspace',
      issued_at: ISSUED_AT,
      expires_at: EXPIRES_AT,
    });
    expect(JSON.stringify(session)).not.toContain('postgres://juicefs-meta');
    expect(JSON.stringify(session)).not.toContain('jfs-lib-flib_1');
    expect(typeof session?.owner_runner_instance_id).toBe('string');
    expect(String(session?.owner_runner_instance_id)).not.toHaveLength(0);
    expect(typeof session?.lease_id).toBe('string');
    expect(String(session?.lease_id)).not.toHaveLength(0);
    expectIsoTimestamp(session?.created_at);
    expectIsoTimestamp(session?.mounted_at);
    expectIsoTimestamp(session?.updated_at);
    expectIsoTimestamp(session?.last_ref_change_at);
  });

  it('fails typed when workspace-access echo paths disagree with the execution context', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'developer';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
        task_home_path: '/tmp/runner-root/task_1',
        workspace_path: '/tmp/runner-root/task_1/workspace',
        artifacts_path: '/tmp/runner-root/task_1/workspace/.artifacts',
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    await expect(prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow('task_workspace_access_path_mismatch:task_home_path');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('fails typed when workspace-access echo omits a required path field', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'developer';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        runtime_profile: 'developer',
        task_home_segment: TASK_HOME_SEGMENT,
        workspace_path: TASK_WORKSPACE,
        artifacts_path: TASK_ARTIFACTS,
        library_root_path: LIBRARY_ROOT_PATH,
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
      }),
    });

    await expect(prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow('task_workspace_access_path_missing:task_home_path');

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails typed when workspace-access library root is not the file library root', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'developer';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho({ library_root_path: 'agent-tasks/task_1' }),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
      }),
    });

    await expect(prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow('task_workspace_access_library_root_path_invalid');

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails typed when workspace-access identity echo disagrees with execution context', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';

    for (const [field, override] of [
      ['task_id', { task_id: 'task_other' }],
      ['file_library_id', { file_library_id: 'flib_other' }],
      ['workspace_binding_mode', { workspace_binding_mode: 'pre_mounted' }],
      ['runtime_profile', { runtime_profile: 'developer' }],
      ['task_home_segment', { task_home_segment: 'task_other' }],
    ] as const) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...workspaceAccessEcho(override),
          workspace_dir_name: 'ignored-in-v2',
          file_library_name: 'Project Workspace',
          filesystem_name: 'flib-market-analysis-q1',
          metadata_url: 'postgres://juicefs-meta',
        }),
      });

      await expect(prepareTaskWorkspace({
        executionContext: taskExecutionContext({
          api_base: 'http://localhost:20000',
          workspace_id: 'ws_default',
          project_id: 'proj_1',
          execution_ticket: 'test-token',
          workspace_binding_mode: 'file_library',
        }),
        username: 'alice',
        taskId: 'task_1',
      })).rejects.toThrow(`task_workspace_access_identity_mismatch:${field}`);
    }

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails typed when workspace-access holder fence fields are missing', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        const payload = {
          ...workspaceAccessEcho(),
          workspace_dir_name: 'ignored-in-v2',
          file_library_id: 'flib_1',
          file_library_name: 'Project Workspace',
          filesystem_name: 'flib-market-analysis-q1',
          metadata_url: 'postgres://juicefs-meta',
        };
        delete (payload as { binding_generation?: unknown }).binding_generation;
        return payload;
      },
    });

    await expect(prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow('task_workspace_access_holder_field_missing:binding_generation');

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('releases backend workspace access when mount fails before local lease creation', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    process.env.MBOS_AGENT_JUICEFS_MOUNT_RETRY_COUNT = '1';
    const bindingGeneration = '1778300000000001';
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task_1',
          workspace_binding_mode: 'file_library',
          ...workspaceAccessEcho({ binding_generation: bindingGeneration }),
          workspace_dir_name: 'ignored-in-v2',
          file_library_id: 'flib_1',
          file_library_name: 'Project Workspace',
          filesystem_name: 'flib-market-analysis-q1',
          metadata_url: 'postgres://juicefs-meta',
          storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        unref: () => void;
        kill: () => void;
      };
      child.exitCode = null;
      child.unref = vi.fn();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.emit('error', new Error('mount spawn failed'));
      });
      return child;
    });

    await expect(prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000/api/v1/',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow('mount spawn failed');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/workspace-access/release',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          holder_id: HOLDER_ID,
          file_library_id: TASK_FILE_LIBRARY_ID,
          binding_generation: bindingGeneration,
          lease_epoch: LEASE_EPOCH,
        }),
      }),
    );
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('releases backend workspace access when writable check fails after local lease creation', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    process.env.MBOS_AGENT_JUICEFS_MOUNT_RETRY_COUNT = '1';
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          task_id: 'task_1',
          workspace_binding_mode: 'file_library',
          ...workspaceAccessEcho(),
          workspace_dir_name: 'ignored-in-v2',
          file_library_id: 'flib_1',
          file_library_name: 'Project Workspace',
          filesystem_name: 'flib-market-analysis-q1',
          metadata_url: 'postgres://juicefs-meta',
          storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
    mkdirMock.mockImplementation(async (target: string) => {
      if (target === TASK_ARTIFACTS) {
        const error = new Error('stale mount') as NodeJS.ErrnoException;
        error.code = 'EIO';
        throw error;
      }
    });

    await expect(prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000/api/v1/',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow('stale mount');

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'juicefs',
      expect.arrayContaining([
        'mount',
        'postgres://juicefs-meta',
        TASK_HOME,
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      ['umount', TASK_HOME],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/workspace-access/release',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          holder_id: HOLDER_ID,
          file_library_id: TASK_FILE_LIBRARY_ID,
          binding_generation: BINDING_GENERATION,
          lease_epoch: LEASE_EPOCH,
        }),
      }),
    );
  });

  it('upgrades legacy registry entries while preserving other tracked mounts', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: '/workspace/task_legacy',
            mode: 'managed_local',
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
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    const registry = parseRegistryWrite();
    const legacySession = findRegistrySession(registry, '/workspace/task_legacy');
    const newSession = findRegistrySession(registry, TASK_HOME);

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
      mount_path: TASK_HOME,
      owner_process_pid: process.pid,
      state: 'mounted',
    });
  });

  it('refuses to steal a ready persisted mount when it belongs to another live runner owner', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: TASK_HOME,
            mode: 'managed_local',
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
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });
    const foreignOwnerPid = process.pid + 1000;

    const mountedPaths = new Set<string>([TASK_HOME]);
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow(`task_workspace_mount_owned_by_live_runner:${TASK_HOME}`);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('refuses to reuse a ready mount when registry evidence is missing', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });
    readFileMock.mockResolvedValue('');

    const mountedPaths = new Set<string>([TASK_HOME]);
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow(`task_workspace_mount_untracked_live_mount:${TASK_HOME}`);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('refuses to blind unmount a ready mount when registry evidence cannot be read', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    const registryReadError = new Error('permission denied') as NodeJS.ErrnoException;
    registryReadError.code = 'EACCES';
    readFileMock.mockRejectedValue(registryReadError);

    const mountedPaths = new Set<string>([TASK_HOME]);
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

    await expect(releasePreparedTaskWorkspace(TASK_HOME)).rejects.toThrow(
      `task_workspace_release_untracked_live_mount:${TASK_HOME}`,
    );

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('adopts a ready existing mount in place when managed startup can confirm no other runner owns it', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
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
            mount_path: TASK_HOME,
            mode: 'managed_local',
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

    const mountedPaths = new Set<string>([TASK_HOME]);
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(spawnMock).not.toHaveBeenCalled();
    expect(resolved.cwd).toBe(TASK_WORKSPACE);
    expect(resolved.source).toBe('file_library_mount');

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, TASK_HOME);
    expect(session).toMatchObject({
      mount_path: TASK_HOME,
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
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
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
            mount_path: TASK_HOME,
            mode: 'managed_local',
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

    const mountedPaths = new Set<string>([TASK_HOME]);
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow(`task_workspace_mount_truth_mismatch:${TASK_HOME}`);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('fails closed on a ready legacy mount when another runner is still alive and ownership stays unverified', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
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
            mount_path: TASK_HOME,
            mode: 'managed_local',
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

    const mountedPaths = new Set<string>([TASK_HOME]);
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow(`task_workspace_mount_untracked_live_mount:${TASK_HOME}`);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('ignores test-style commands that only mention agent-task-runner when deciding whether a legacy mount is still owned by another runner', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
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
            mount_path: TASK_HOME,
            mode: 'managed_local',
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

    const mountedPaths = new Set<string>([TASK_HOME]);
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
            buildNonRunnerAgentTaskCommand(process.pid + 1000),
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(spawnMock).not.toHaveBeenCalled();
    expect(resolved.cwd).toBe(TASK_WORKSPACE);
    expect(resolved.source).toBe('file_library_mount');

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, TASK_HOME);
    expect(session).toMatchObject({
      mount_path: TASK_HOME,
      refs: 1,
      owner_process_pid: process.pid,
      state: 'mounted',
      lease_revision: 1,
    });
  });

  it('quarantines an incomplete foreign legacy mount before remounting when its recorded owner is gone', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: TASK_HOME,
            mode: 'managed_local',
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
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    const mountedPaths = new Set<string>([TASK_HOME]);
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'juicefs',
      ['umount', TASK_HOME],
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
        TASK_HOME,
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, TASK_HOME);
    expect(session).toMatchObject({
      mount_path: TASK_HOME,
      refs: 1,
      owner_process_pid: process.pid,
      state: 'mounted',
      lease_revision: 1,
    });
  });

  it('reclaims a ready persisted mount before reuse when the foreign runner owner is dead', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    const foreignOwnerPid = process.pid + 1000;
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: TASK_HOME,
            mode: 'managed_local',
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
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    const mountedPaths = new Set<string>([TASK_HOME]);
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'juicefs',
      ['umount', TASK_HOME],
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
        TASK_HOME,
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, TASK_HOME);
    expect(session).toMatchObject({
      mount_path: TASK_HOME,
      refs: 1,
      owner_process_pid: process.pid,
      state: 'mounted',
      last_release_outcome: 'not_started',
    });
    expect(session?.owner_runner_instance_id).not.toBe('runner-legacy');
  });

  it('treats a reused foreign owner pid as stale when the live pid now belongs to an unrelated process', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    const foreignOwnerPid = process.pid + 1000;
    readFileMock.mockResolvedValue(
      JSON.stringify({
        sessions: [
          {
            mount_path: TASK_HOME,
            mode: 'managed_local',
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
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    const mountedPaths = new Set<string>([TASK_HOME]);
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      'juicefs',
      ['umount', TASK_HOME],
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
        TASK_HOME,
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
  });

  it('forces a real unmount before remounting when task-root bootstrap hits a retryable write failure', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    const initial = await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(initial.lease).toMatchObject({
      mountPath: TASK_HOME,
      revision: 1,
    });

    const mkdirCalls = new Map<string, number>();
    mkdirMock.mockImplementation(async (target: string) => {
      const seen = mkdirCalls.get(target) ?? 0;
      mkdirCalls.set(target, seen + 1);
      if (target === TASK_ARTIFACTS && seen === 0) {
        const error = new Error('stale mount') as NodeJS.ErrnoException;
        error.code = 'EIO';
        throw error;
      }
    });

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      ['umount', TASK_HOME],
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
        TASK_HOME,
      ]),
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    expect(resolved.cwd).toBe(TASK_WORKSPACE);
    expect(resolved.source).toBe('file_library_mount');
    expect(resolved.lease).toMatchObject({
      mountPath: TASK_HOME,
      revision: 2,
    });
    expect(resolved.lease?.leaseId).not.toBe(initial.lease?.leaseId);

    await expect(initial.release()).rejects.toThrow(
      `task_workspace_release_lease_mismatch:${TASK_HOME}`,
    );
    expect(spawnMock).toHaveBeenCalledTimes(3);

    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, TASK_HOME);
    expect(session).toMatchObject({
      mount_path: TASK_HOME,
      refs: 1,
      state: 'mounted',
      lease_revision: 2,
    });
  });

  it('releases the real mount path when a prepared workspace is released', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'developer';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    await resolved.release();

    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      ['umount', TASK_HOME],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
    const releasingRegistry = parseRegistryWrite(1);
    const releasingSession = findRegistrySession(
      releasingRegistry,
      TASK_HOME,
    );
    expect(releasingSession).toMatchObject({
      mount_path: TASK_HOME,
      state: 'releasing',
      last_release_outcome: 'pending',
      owner_process_pid: process.pid,
    });
    expectIsoTimestamp(releasingSession?.last_release_attempt_at);

    const finalRegistry = parseRegistryWrite();
    expect(findRegistrySession(finalRegistry, TASK_HOME)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:20000/workspaces/ws_default/projects/proj_1/tasks/task_1/workspace-access/release',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          holder_id: HOLDER_ID,
          file_library_id: TASK_FILE_LIBRARY_ID,
          binding_generation: BINDING_GENERATION,
          lease_epoch: LEASE_EPOCH,
        }),
      }),
    );
  });

  it('falls back to helper termination and lazy workspace unmount when a busy mount does not release on normal juicefs umount', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_JUICEFS_MOUNT_RELEASE_TIMEOUT_MS = '1';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
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
          events.push(`runner_umount:${args.join(' ')}`);
          if (args[0] === '-l' || args[0] === '-lf') {
            mountedPaths.delete(TASK_HOME);
          }
          child.emit('exit', 0);
          return;
        }
        child.emit('spawn');
      });
      return child;
    });

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    await resolved.release();

    expect(events).toContain('helper_kill:SIGTERM');
    expect(events).toContain('helper_exit');
    expect(events.findIndex((event) => event === 'helper_exit')).toBeLessThan(events.findIndex((event) => event.startsWith('runner_umount:-l ')));
    expect(spawnMock).toHaveBeenCalledWith(
      'umount',
      ['-l', TASK_HOME],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
  });

  it('rejects releasing a tracked workspace by mount path without the owning lease', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    await expect(releasePreparedTaskWorkspace(TASK_HOME)).rejects.toThrow(
      `task_workspace_release_requires_lease:${TASK_HOME}`,
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('can release a tracked workspace by mount path with the owning lease', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(resolved.lease).toMatchObject({
      mountPath: TASK_HOME,
      revision: 1,
    });
    await releasePreparedTaskWorkspace(TASK_HOME, resolved.lease!);

    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      'juicefs',
      ['umount', TASK_HOME],
      expect.objectContaining({
        stdio: 'ignore',
      }),
    );
  });

  it('rejects releasing a tracked workspace by mount path with the wrong lease', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    const wrongLease = {
      ...resolved.lease!,
      leaseId: 'lease-wrong',
    };

    await expect(releasePreparedTaskWorkspace(TASK_HOME, wrongLease)).rejects.toThrow(
      `task_workspace_release_lease_mismatch:${TASK_HOME}`,
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, TASK_HOME);
    expect(session).toMatchObject({
      mount_path: TASK_HOME,
      refs: 1,
      state: 'mounted',
      lease_id: resolved.lease?.leaseId,
      lease_revision: resolved.lease?.revision,
    });
  });

  it('treats an old binding generation release as a no-op for the current holder', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
        workspace_dir_name: 'ignored-in-v2',
        file_library_id: 'flib_1',
        file_library_name: 'Project Workspace',
        filesystem_name: 'flib-market-analysis-q1',
        metadata_url: 'postgres://juicefs-meta',
        storage_bucket_url: 'http://localhost:19000/jfs-lib-flib_1',
      }),
    });

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    const staleLease = {
      ...resolved.lease!,
      bindingGeneration: 'binding_gen_old',
      leaseEpoch: 'lease_epoch_old',
    };

    await expect(releasePreparedTaskWorkspace(TASK_HOME, staleLease)).resolves.toBeUndefined();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const registry = parseRegistryWrite();
    const session = findRegistrySession(registry, TASK_HOME);
    expect(session).toMatchObject({
      mount_path: TASK_HOME,
      refs: 1,
      state: 'mounted',
      binding_generation: BINDING_GENERATION,
      lease_epoch: LEASE_EPOCH,
    });
  });

  it('keeps release failure evidence in the registry when unmount cannot be completed', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    process.env.MBOS_AGENT_WORKSPACE_ROOT = '/tmp/runner-root';
    process.env.MBOS_AGENT_JUICEFS_MOUNT_RELEASE_TIMEOUT_MS = '1';
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task_1',
        workspace_binding_mode: 'file_library',
        ...workspaceAccessEcho(),
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
      executionContext: taskExecutionContext({
        api_base: 'http://localhost:20000',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        execution_ticket: 'test-token',
        workspace_binding_mode: 'file_library',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    await expect(resolved.release()).rejects.toThrow(`task_workspace_umount_not_ready:${TASK_HOME}`);

    const failedRegistry = parseRegistryWrite();
    const failedSession = findRegistrySession(failedRegistry, TASK_HOME);
    expect(failedSession).toMatchObject({
      mount_path: TASK_HOME,
      owner_process_pid: process.pid,
      state: 'release_failed',
      last_release_outcome: 'failed',
      refs: 1,
    });
    expect(typeof failedSession?.owner_runner_instance_id).toBe('string');
    expectIsoTimestamp(failedSession?.last_release_attempt_at);
    expect(Array.isArray(failedSession?.release_attempts)).toBe(true);
    expect((failedSession?.release_attempts as unknown[])).not.toHaveLength(0);
    expect(String(failedSession?.last_release_error)).toContain(`task_workspace_umount_not_ready:${TASK_HOME}`);
  });

  it('uses the explicit managed platform task path for pre-mounted workspaces', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_platform';

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContextForHome('task_internal', '/home/task_internal', {
        workspace_binding_mode: 'pre_mounted',
      }),
      username: 'alice',
      taskId: 'task_internal',
    });

    expect(resolved.cwd).toBe('/home/task_internal/workspace');
    expect(resolved.source).toBe('path_fields');
    expect(resolved.paths.visibleRoot).toBe('/home/task_internal/workspace');
    expect(resolved.paths.runtimeRoot).toBe('/home/task_internal');
    expect(resolved.paths.homeDir).toBe('/home/task_internal');
    expect(resolved.paths.taskHome).toBe('/home/task_internal');
    expect(resolved.paths.workspaceDir).toBe('/home/task_internal/workspace');
    expect(resolved.paths.codexDir).toBe('/home/task_internal/.codex');
    expect(resolved.paths.mbosDir).toBe('/home/task_internal/.mbos');
    expect(resolved.paths.skillsDir).toBe('/home/task_internal/.agents/skills');
    expect(resolved.paths.artifactsDir).toBe('/home/task_internal/workspace/.artifacts');
  });

  it('uses task_home_path as the stable runtime root for pre-mounted workspaces', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_platform';

    const first = await prepareTaskWorkspace({
      executionContext: taskExecutionContextForHome('task_a', '/home/task_a', {
        workspace_binding_mode: 'pre_mounted',
      }),
      username: 'alice',
      taskId: 'task_a',
    });
    const second = await prepareTaskWorkspace({
      executionContext: taskExecutionContextForHome('task_b', '/home/task_b', {
        workspace_binding_mode: 'pre_mounted',
      }),
      username: 'alice',
      taskId: 'task_b',
    });
    const stableFirst = await prepareTaskWorkspace({
      executionContext: taskExecutionContextForHome('task_a', '/home/task_a', {
        workspace_binding_mode: 'pre_mounted',
      }),
      username: 'alice',
      taskId: 'task_a',
    });

    expect(first.cwd).toBe('/home/task_a/workspace');
    expect(second.cwd).toBe('/home/task_b/workspace');
    expect(first.paths.runtimeRoot).toBe('/home/task_a');
    expect(second.paths.runtimeRoot).toBe('/home/task_b');
    expect(first.paths.runtimeRoot).not.toBe(second.paths.runtimeRoot);
    expect(first.paths.homeDir).not.toBe(second.paths.homeDir);
    expect(first.paths.codexDir).not.toBe(second.paths.codexDir);
    expect(first.paths.mbosDir).not.toBe(second.paths.mbosDir);
    expect(first.paths.skillsDir).not.toBe(second.paths.skillsDir);
    expect(first.paths.runtimeRoot).toBe(stableFirst.paths.runtimeRoot);
    expect(first.paths.homeDir).toBe(stableFirst.paths.homeDir);
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
