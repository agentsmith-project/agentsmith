import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirMock, fetchMock, spawnMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  fetchMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: spawnMock,
  default: {
    execFile: vi.fn(),
    spawn: spawnMock,
  },
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  default: {
    mkdir: mkdirMock,
  },
}));

import {
  buildTaskWorkspacePaths,
  clearPreparedTaskWorkspaces,
  fetchTaskWorkspaceAccess,
  prepareTaskWorkspace,
  releaseTaskWorkspaceAccess,
  resolveAgentTaskRunnerMode,
  resolveTaskCwd,
  shouldRetryTaskWorkspaceWriteFailure,
} from './task-workspace.js';

const TASK_HOME = '/home/task_1';
const TASK_WORKSPACE = `${TASK_HOME}/workspace`;
const TASK_ARTIFACTS = `${TASK_WORKSPACE}/.artifacts`;
const TASK_FILE_LIBRARY_ID = 'flib_1';
const TASK_HOME_SEGMENT = 'task_1';
const HOLDER_ID = 'holder_task_1';
const BINDING_GENERATION = '1';
const LEASE_EPOCH = 'lease_epoch_1';
const ISSUED_AT = '2026-05-09T00:00:00.000Z';
const EXPIRES_AT = '2026-05-09T00:15:00.000Z';

function taskExecutionContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workspace_id: 'ws_default',
    project_id: 'proj_1',
    task_id: 'task_1',
    workspace_file_library_id: TASK_FILE_LIBRARY_ID,
    workspace_binding_mode: 'file_library',
    runtime_profile: process.env.MBOS_AGENT_TASK_RUNNER_MODE === 'developer' ? 'developer' : 'managed',
    task_home_segment: TASK_HOME_SEGMENT,
    task_home_path: TASK_HOME,
    workspace_path: TASK_WORKSPACE,
    artifacts_path: TASK_ARTIFACTS,
    library_root_path: '.',
    api_base: 'http://localhost:20000/api/v1',
    execution_ticket: 'test-token',
    ...overrides,
  };
}

function taskHomeBinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    binding_id: 'thb_task_1',
    provider: 'afscp',
    mode: 'pre_mounted',
    task_id: 'task_1',
    file_library_id: TASK_FILE_LIBRARY_ID,
    task_home_segment: TASK_HOME_SEGMENT,
    generation: BINDING_GENERATION,
    holder: {
      holder_id: HOLDER_ID,
      holder_kind: 'runner_workspace',
      binding_generation: BINDING_GENERATION,
      lease_epoch: LEASE_EPOCH,
      issued_at: ISSUED_AT,
      expires_at: EXPIRES_AT,
    },
    paths: {
      task_home_path: TASK_HOME,
      workspace_path: TASK_WORKSPACE,
      artifacts_path: TASK_ARTIFACTS,
      library_root_path: '.',
    },
    ...overrides,
  };
}

function workspaceAccessPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_home_binding: taskHomeBinding(),
    ...overrides,
  };
}

describe('task-workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPreparedTaskWorkspaces();
    mkdirMock.mockResolvedValue(undefined);
    spawnMock.mockImplementation(() => {
      throw new Error('juicefs_spawn_must_not_be_called');
    });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    delete process.env.MBOS_AGENT_TASK_RUNNER_MODE;
    process.env.HOME = '/home/alice';
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'developer';
  });

  it('resolves runner mode from explicit env', () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_local';
    expect(resolveAgentTaskRunnerMode()).toBe('managed_local');
  });

  it('builds task HOME paths from explicit path truth', () => {
    const paths = buildTaskWorkspacePaths({
      mode: 'managed_platform',
      runtimeProfile: 'managed',
      taskHomeSegment: TASK_HOME_SEGMENT,
      taskHomePath: TASK_HOME,
      workspacePath: TASK_WORKSPACE,
      artifactsPath: TASK_ARTIFACTS,
      libraryRootPath: '.',
    });

    expect(paths.homeDir).toBe(TASK_HOME);
    expect(paths.workspaceDir).toBe(TASK_WORKSPACE);
    expect(paths.artifactsDir).toBe(TASK_ARTIFACTS);
    expect(paths.visibleRoot).toBe(TASK_WORKSPACE);
    expect(paths.libraryRoot).toBe('.');
    expect(paths.codexDir).toBe(`${TASK_HOME}/.codex`);
    expect(paths.mbosDir).toBe(`${TASK_HOME}/.mbos`);
    expect(paths.skillsDir).toBe(`${TASK_HOME}/.agents/skills`);
  });

  it('resolves cwd from pre-mounted path fields without backend workspace access', () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_platform';

    expect(resolveTaskCwd({
      taskId: 'task_1',
      runtimeProfile: 'managed',
      taskHomeSegment: TASK_HOME_SEGMENT,
      taskHomePath: TASK_HOME,
      workspacePath: TASK_WORKSPACE,
      artifactsPath: TASK_ARTIFACTS,
      libraryRootPath: '.',
    })).toMatchObject({
      cwd: TASK_WORKSPACE,
      source: 'path_fields',
    });
  });

  it('fetches only the opaque task HOME binding contract', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(workspaceAccessPayload()), { status: 200 }));

    const payload = await fetchTaskWorkspaceAccess(taskExecutionContext());

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/workspace-access',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
    expect(payload.task_home_binding).toMatchObject({
      provider: 'afscp',
      mode: 'pre_mounted',
      paths: {
        task_home_path: TASK_HOME,
        workspace_path: TASK_WORKSPACE,
        artifacts_path: TASK_ARTIFACTS,
        library_root_path: '.',
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(/metadata_url|storage_bucket_url|filesystem_name|recommended_mount|juicefs/i);
  });

  it('releases workspace access with the holder fence only', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ released: true }), { status: 200 }));

    await releaseTaskWorkspaceAccess(taskExecutionContext(), {
      holderId: HOLDER_ID,
      fileLibraryId: TASK_FILE_LIBRARY_ID,
      bindingGeneration: BINDING_GENERATION,
      leaseEpoch: LEASE_EPOCH,
    });

    expect(fetchMock).toHaveBeenCalledWith(
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

  it('consumes pre-mounted task HOME binding without spawning juicefs', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(workspaceAccessPayload()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ released: true }), { status: 200 }));

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContext(),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(resolved.cwd).toBe(TASK_WORKSPACE);
    expect(resolved.source).toBe('path_fields');
    expect(resolved.lease).toMatchObject({
      mountPath: TASK_HOME,
      holderId: HOLDER_ID,
      fileLibraryId: TASK_FILE_LIBRARY_ID,
      bindingGeneration: BINDING_GENERATION,
      leaseEpoch: LEASE_EPOCH,
    });
    expect(mkdirMock).toHaveBeenCalledWith(TASK_WORKSPACE, { recursive: true });
    expect(mkdirMock).toHaveBeenCalledWith(TASK_ARTIFACTS, { recursive: true });
    expect(spawnMock).not.toHaveBeenCalled();

    await resolved.release();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['developer_connector_unavailable', 'developer_connector'])(
    'rejects unsupported task HOME binding mode %s',
    async (mode) => {
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify(workspaceAccessPayload({
          task_home_binding: taskHomeBinding({ mode }),
        })), { status: 200 }));

      await expect(prepareTaskWorkspace({
        executionContext: taskExecutionContext(),
        username: 'alice',
        taskId: 'task_1',
      })).rejects.toThrow('task_workspace_access_binding_mode_invalid');

      expect(spawnMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects workspace-access payloads that still include raw storage material', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...workspaceAccessPayload(),
        metadata_url: 'postgres://juicefs-meta',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ released: true }), { status: 200 }));

    await expect(prepareTaskWorkspace({
      executionContext: taskExecutionContext(),
      username: 'alice',
      taskId: 'task_1',
    })).rejects.toThrow('task_workspace_access_raw_storage_field:metadata_url');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses path fields directly for pre-mounted execution contexts', async () => {
    process.env.MBOS_AGENT_TASK_RUNNER_MODE = 'managed_platform';

    const resolved = await prepareTaskWorkspace({
      executionContext: taskExecutionContext({
        workspace_binding_mode: 'pre_mounted',
        runtime_profile: 'managed',
      }),
      username: 'alice',
      taskId: 'task_1',
    });

    expect(resolved.cwd).toBe(TASK_WORKSPACE);
    expect(resolved.source).toBe('path_fields');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('recognizes retryable task-root write failures', () => {
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
