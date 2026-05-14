import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { handleProjectFileLibraryRoutes } from './project-file-library-routes.js';
import {
  JsonDocFileLibraryRestorePreviewRepo,
  JsonDocFileLibrarySavePointMappingRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectTaskFileTemplateRepo,
} from './file-library-persistence.js';
import { notebookTasksCollection } from './notebook-task/task-store.js';
import {
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from './project-member-governance-persistence.js';
import {
  FileLibraryStorageOperationPendingError,
  type FileLibraryStoragePort,
} from './file-library-afscp-storage.js';
import {
  JsonDocTaskFileLibraryBindingRepo,
  JsonDocTaskWorkspaceHolderRepo,
} from './notebook-task/task-file-library-bindings.js';
import type { ProjectStoragePreflightResult } from './project-storage-bootstrap-service.js';
import type { InternalAgentWorkspaceBinding } from './internal-agent-workspace-provisioner.js';

const OWNER_USER = { id: 'user_1', email: 'user@example.com', name: 'User One' } as never;
const OTHER_PROJECT_USER = { id: 'user_2', email: 'other@example.com', name: 'Other User' } as never;

function readyProjectStorage(): ProjectStoragePreflightResult {
  return {
    status: 'ready',
    namespaceId: 'ns_project_1',
    stage: 'ready',
    generation: 1,
    nextAction: 'none',
    retryable: false,
    lastErrorCode: null,
  };
}

function createStorageAdapter(overrides: Partial<FileLibraryStoragePort> = {}): FileLibraryStoragePort {
  let createdSavePointCount = 1;
  const adapter: FileLibraryStoragePort = {
    enabled: true,
    createRepoForLibrary: vi.fn(async (input) => ({
      namespaceId: input.namespaceId,
      repoId: `repo_${input.libraryId}`,
      operationId: `op_${input.libraryId}`,
      operationStatus: 'succeeded',
      projectStorageGeneration: input.projectStorageGeneration,
    })),
    getOperationProjection: vi.fn(async (input) => ({
      operation_id: input.operationId,
      operation_state: 'succeeded',
      operation_type: 'repo_create',
      resource: { type: 'repo' },
      error: null,
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:01.000Z',
    })),
    deleteRepoForLibrary: vi.fn(async () => undefined),
    assertEmpty: vi.fn(async () => undefined),
    listEntries: vi.fn(async (input) => ({
      path: input.path,
      items: [
        {
          kind: 'file',
          path: 'docs/readme.txt',
          name: 'readme.txt',
          size_bytes: 11,
          content_type: 'text/plain',
          modified_at: '2026-04-20T00:00:00.000Z',
        },
      ],
      nextContinuationToken: null,
    })),
    createFolder: vi.fn(async () => undefined),
    deletePaths: vi.fn(async (input) => input.paths.map((path) => ({ path, status: 'deleted' as const }))),
    moveEntry: vi.fn(async () => undefined),
    uploadObject: vi.fn(async (input) => ({
      kind: 'file',
      path: input.objectPath,
      name: input.objectPath.split('/').at(-1) ?? input.objectPath,
      size_bytes: 11,
      content_type: input.contentType ?? 'application/octet-stream',
      modified_at: '2026-04-20T00:00:00.000Z',
    })),
    downloadObject: vi.fn(async (input) => ({
      meta: {
        key: input.objectPath,
        size_bytes: 11,
        content_type: 'text/plain',
        last_modified: '2026-04-20T00:00:00.000Z',
        user_metadata: {},
      },
      download: {
        stream: Readable.from(['hello world']),
        cancel: vi.fn(async () => undefined),
      },
    })),
    getObjectMeta: vi.fn(async (input) => ({
      key: input.objectPath,
      size_bytes: 11,
      content_type: 'text/plain',
      last_modified: '2026-04-20T00:00:00.000Z',
      user_metadata: {},
    })),
    listSavePoints: vi.fn(async () => [
      {
        savePointId: 'sp_user_001',
        repoId: 'repo_flib_123',
        message: 'Before restore',
        createdAt: '2026-05-09T00:00:00.000Z',
      },
    ]),
    createSavePoint: vi.fn(async () => {
      createdSavePointCount += 1;
      const savePointSuffix = String(createdSavePointCount).padStart(3, '0');
      return {
        operationId: `op_save_point_${savePointSuffix}`,
        operationStatus: 'succeeded',
        savePointId: `sp_user_${savePointSuffix}`,
        createdAt: '2026-05-09T00:01:00.000Z',
      };
    }),
    createRestorePreview: vi.fn(async () => ({
      operationId: 'op_preview01',
      operationStatus: 'succeeded',
      restorePlanId: 'plan_001',
      sourceSavePointId: 'sp_user_001',
      summary: {
        added: { count: 1, samples: ['src/new.ts'] },
        changed: { count: 2, samples: ['docs/readme.md'] },
        removed: { count: 1, samples: ['tmp/cache.txt'] },
        destructive: true,
      },
      blockers: [],
      stale: false,
    })),
    reconcileRestorePreview: vi.fn(async () => ({
      operationId: 'op_preview01',
      operationStatus: 'succeeded',
      restorePlanId: 'plan_001',
      sourceSavePointId: 'sp_user_001',
      summary: {
        added: { count: 1, samples: ['src/new.ts'] },
        changed: { count: 2, samples: ['docs/readme.md'] },
        removed: { count: 1, samples: ['tmp/cache.txt'] },
        destructive: true,
      },
      blockers: [],
      stale: false,
    })),
    runRestorePreview: vi.fn(async () => ({
      operationId: 'op_restore_run',
      operationStatus: 'succeeded',
      restorePlanId: 'plan_001',
      sourceSavePointId: 'sp_user_001',
    })),
    discardRestorePreview: vi.fn(async () => ({
      operationId: 'op_restore_discard',
      operationStatus: 'succeeded',
      restorePlanId: 'plan_001',
      sourceSavePointId: 'sp_user_001',
    })),
    createTemplateFromLibrary: vi.fn(async () => ({
      templateId: 'tmpl_task_file_template_1',
      operationId: 'op_template_create',
      operationStatus: 'succeeded',
      sourceSavePointId: 'sp_template_source_001',
    })),
    cloneTemplateToLibrary: vi.fn(async (input) => ({
      namespaceId: input.namespaceId,
      repoId: `repo_${input.libraryId}`,
      operationId: 'op_template_clone',
      operationStatus: 'succeeded',
      projectStorageGeneration: input.projectStorageGeneration,
    })),
    reconcileLibraryProvisioning: vi.fn(async (input) => ({
      namespaceId: 'ns_project_1',
      repoId: `repo_${input.libraryId}`,
      operationId: `op_${input.libraryId}_template_clone`,
      operationStatus: 'succeeded',
      projectStorageGeneration: 1,
      lastErrorCode: null,
    })),
    ...overrides,
  };
  return adapter;
}

function createDeps(args: {
  storageAdapter?: FileLibraryStoragePort;
  projectStorage?: ProjectStoragePreflightResult;
} = {}) {
  return {
    docStore: new InMemoryJsonDocStore(),
    cache: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      del: vi.fn(async () => undefined),
      incr: vi.fn(async () => 1),
    },
    notebookTerminalService: {
      hasLiveSessionsForTask: vi.fn(async () => false),
      listSessionsForTask: vi.fn(async () => []),
    },
    internalAgentWorkspaceBindingManager: {
      ensureWorkspaceBinding: vi.fn(),
      deleteWorkspaceBinding: vi.fn(async () => undefined),
      findWorkspaceBinding: vi.fn(async () => null),
    },
    fileLibraryStorageAdapter: args.storageAdapter ?? createStorageAdapter(),
    projectStorageBootstrapService: {
      enabled: true,
      bootstrapProjectStorage: vi.fn(async () => undefined),
      reconcileProjectStorage: vi.fn(async () => undefined),
      ensureProjectStorageReady: vi.fn(async () => args.projectStorage ?? readyProjectStorage()),
    },
    getProjectUseCase: {
      execute: vi.fn(async (input: { workspaceId: string; projectId: string }) => ({
        id: input.projectId,
        workspace_id: input.workspaceId,
        name: input.projectId,
        owner_id: OWNER_USER.id,
        governance_json: null,
      })),
    },
  } as never;
}

function createMockResponse(): http.ServerResponse & {
  headers: Record<string, string>;
  end: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const res = new PassThrough() as PassThrough & http.ServerResponse & {
    headers: Record<string, string>;
    end: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = vi.fn((name: string, value: string | number | readonly string[]) => {
    res.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
    return res;
  }) as never;
  res.end = vi.fn(() => {
    res.emit('finish');
    return res;
  }) as never;
  return res;
}

async function createReadyLibrary(deps: ReturnType<typeof createDeps>, json = vi.fn()): Promise<Record<string, unknown>> {
  await expect(handleProjectFileLibraryRoutes({
    routeKind: 'fileLibraries',
    method: 'POST',
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    req: {} as never,
    res: createMockResponse(),
    deps,
    user: OWNER_USER,
    json,
    readBody: vi.fn().mockResolvedValue({
      name: 'Shared Docs',
      description: 'Project scoped docs',
    }),
  })).resolves.toBe(true);
  return json.mock.calls.at(-1)?.[2] as Record<string, unknown>;
}

async function seedLibrary(deps: ReturnType<typeof createDeps>, status: 'creating' | 'ready' | 'failed' = 'ready') {
  const now = new Date().toISOString();
  await new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).save({
    id: `flib_${status}`,
    workspace_id: 'ws_default',
    project_id: 'proj_1',
    name: `${status} Library`,
    status,
    version: 1,
    file_library_home_segment: `flibhome_${status}`,
    source: 'agent_task_files',
    created_by_user_id: 'user_1',
    created_at: now,
    updated_at: now,
  });
}

async function grantProjectPermissions(
  deps: ReturnType<typeof createDeps>,
  userId: string,
  permissions: string[],
): Promise<void> {
  await upsertProjectMembershipRecord(deps.docStore, 'ws_default', 'proj_1', {
    project_id: 'proj_1',
    user_id: userId,
    user_email: `${userId}@example.com`,
    user_name: userId,
    status: 'active',
    joined_at: new Date().toISOString(),
  });
  await upsertProjectMemberPermissionState(deps.docStore, 'ws_default', 'proj_1', userId, {
    mode: 'custom',
    template: null,
    permissions,
  });
}

async function seedTaskFileTemplate(input: {
  deps: ReturnType<typeof createDeps>;
  id: string;
  name: string;
  status: 'published' | 'unpublished';
  sourceLibraryId?: string;
}): Promise<void> {
  const repo = new JsonDocProjectTaskFileTemplateRepo(input.deps.docStore);
  await repo.create({
    id: input.id,
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    name: input.name,
    sourceLibraryId: input.sourceLibraryId ?? `flib_source_${input.id}`,
    createdByUserId: OWNER_USER.id,
    afscpTemplateId: `tmpl_${input.id}`,
  });
  if (input.status !== 'unpublished') {
    await repo.updateStatus({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: input.id,
      status: input.status,
    });
  }
}

async function seedBoundTask(input: {
  deps: ReturnType<typeof createDeps>;
  libraryId: string;
  taskId?: string;
  title?: string;
  ownerUserId?: string;
  status?: 'active' | 'archived';
}): Promise<{
  taskId: string;
  bindingGeneration: number;
}> {
  const now = new Date().toISOString();
  const taskId = input.taskId ?? `task_${input.libraryId}`;
  const ownerUserId = input.ownerUserId ?? OWNER_USER.id;
  const title = input.title ?? 'Restore blocker task';
  const status = input.status ?? 'active';
  const taskRecord = {
    id: taskId,
    workspace_id: 'ws_default',
    project_id: 'proj_1',
    owner_user_id: ownerUserId,
    title,
    task_home_segment: taskId,
    workspace_file_library_id: input.libraryId,
    workspace_file_library_name: 'Shared Docs',
    status,
    attached_inputs: [],
    created_at: now,
    updated_at: now,
    last_activity_at: now,
  };
  await input.deps.docStore.upsert(notebookTasksCollection('ws_default'), taskId, taskRecord);
  const acquired = await new JsonDocTaskFileLibraryBindingRepo(input.deps.docStore).acquire({
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    fileLibraryId: input.libraryId,
    taskId,
    taskTitle: title,
    taskStatus: status,
    ownerUserId,
    runtimeWritableAffordance: 'task_internal_home',
    correlationId: `req_bind_${taskId}`,
    now,
  });
  if (!acquired.ok) throw new Error('expected test binding acquire to succeed');
  await input.deps.docStore.upsert(notebookTasksCollection('ws_default'), taskId, {
    ...taskRecord,
    file_library_binding_generation: acquired.binding.bindingGeneration,
    runtime_writable_affordance: 'task_internal_home',
  });
  return {
    taskId,
    bindingGeneration: acquired.binding.bindingGeneration,
  };
}

async function seedReadyRestorePreview(input: {
  deps: ReturnType<typeof createDeps>;
  libraryId: string;
  blockers?: Array<{ code: 'active_writer_sessions' }>;
}) {
  return new JsonDocFileLibraryRestorePreviewRepo(input.deps.docStore).create({
    id: `flrp_${input.libraryId}`,
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    libraryId: input.libraryId,
    afscpPreviewOperationId: 'op_preview_hidden',
    sourceSavePointId: 'flsp_before_restore',
    sourceAfscpSavePointId: 'sp_user_hidden',
    status: 'ready',
    restorePlanId: 'plan_hidden',
    blockers: input.blockers ?? [],
  });
}

function activeRuntimeBinding(libraryId: string): InternalAgentWorkspaceBinding {
  return {
    file_library_id: libraryId,
    workspace_id: 'ws_default',
    project_id: 'proj_1',
    provider: 'afscp',
    task_home_binding_id: 'wmb_hidden_runtime',
    afscp_mount_binding_id: 'wmb_hidden_runtime',
    afscp_namespace_id: 'ns_hidden_runtime',
    afscp_repo_id: 'repo_hidden_runtime',
    afscp_volume_id: 'vol_hidden_runtime',
    mount_binding_generation: 1,
    project_storage_generation: 1,
    status: 'ready',
    mount_binding_status: 'issued',
    lease_expires_at: '2999-05-09T00:00:00.000Z',
    task_home_path: '/home/task_release_runtime_access',
    workspace_path: '/home/task_release_runtime_access/workspace',
    artifacts_path: '/home/task_release_runtime_access/workspace/.artifacts',
    library_root_path: '.',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
  };
}

function multipartUploadRequest(filename = 'hello.txt'): http.IncomingMessage {
  const boundary = '----agentsmith-upload-boundary';
  const req = new PassThrough() as PassThrough & http.IncomingMessage;
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  };
  req.end([
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: text/plain',
    '',
    'hello world',
    `--${boundary}--`,
    '',
  ].join('\r\n'));
  return req;
}

describe('project-file-library-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates project-scoped AFSCP-backed libraries and never exposes raw storage fields', async () => {
    const deps = createDeps();
    const json = vi.fn();

    const created = await createReadyLibrary(deps, json);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      201,
      expect.objectContaining({
        id: expect.stringMatching(/^flib_/),
        name: 'Shared Docs',
        status: 'ready',
        source: 'agent_task_files',
        file_library_home_segment: expect.stringMatching(/^flibhome_/),
        created_by_user_id: 'user_1',
      }),
    );
    expect(created).not.toHaveProperty('filesystem_name');
    expect(JSON.stringify(created)).not.toContain('metadata_url');
    expect(JSON.stringify(created)).not.toContain('storage_bucket_url');
    expect(JSON.stringify(created)).not.toContain('bucket');
    expect(deps.projectStorageBootstrapService.ensureProjectStorageReady).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'user_1',
      signal: expect.any(AbortSignal),
    }));
    expect(deps.fileLibraryStorageAdapter.createRepoForLibrary).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: created.id,
      namespaceId: 'ns_project_1',
      projectStorageGeneration: 1,
      actorUserId: 'user_1',
    }));
  });

  it('waits for project storage readiness while creating a project file library', async () => {
    vi.useFakeTimers();
    try {
      const ensureProjectStorageReady = vi.fn()
        .mockResolvedValueOnce({
          status: 'pending',
          stage: 'namespace_upsert',
          generation: 1,
          nextAction: 'wait',
          retryable: false,
          lastErrorCode: null,
        })
        .mockResolvedValueOnce({
          status: 'ready',
          namespaceId: 'ns_waited_files',
          stage: 'ready',
          generation: 2,
          nextAction: 'none',
          retryable: false,
          lastErrorCode: null,
        });
      const createRepoForLibrary = vi.fn<FileLibraryStoragePort['createRepoForLibrary']>(async (input) => ({
        namespaceId: input.namespaceId,
        repoId: `repo_${input.libraryId}`,
        operationId: `op_${input.libraryId}`,
        operationStatus: 'succeeded' as const,
        projectStorageGeneration: input.projectStorageGeneration,
      }));
      const storageAdapter = createStorageAdapter({ createRepoForLibrary });
      const deps = createDeps({ storageAdapter });
      deps.projectStorageBootstrapService.ensureProjectStorageReady = ensureProjectStorageReady;

      const json = vi.fn();
      const createPromise = handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraries',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        req: { headers: { 'x-request-id': 'req_file_library_wait' } } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json,
        readBody: vi.fn().mockResolvedValue({ name: 'Waited storage files' }),
      });

      await vi.runAllTimersAsync();
      await expect(createPromise).resolves.toBe(true);

      expect(json.mock.calls[0]?.[1]).toBe(201);
      expect(json.mock.calls[0]?.[2]).toMatchObject({
        name: 'Waited storage files',
        status: 'ready',
      });
      expect(ensureProjectStorageReady).toHaveBeenCalledTimes(2);
      expect(ensureProjectStorageReady).toHaveBeenNthCalledWith(1, expect.objectContaining({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        actorUserId: 'user_1',
        requestId: 'req_file_library_wait',
        signal: expect.any(AbortSignal),
      }));
      expect(createRepoForLibrary).toHaveBeenCalledWith(expect.objectContaining({
        namespaceId: 'ns_waited_files',
        projectStorageGeneration: 2,
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves file-library operation projections through the storage adapter without raw AFSCP details', async () => {
    const storageAdapter = createStorageAdapter({
      getOperationProjection: vi.fn(async () => ({
        operation_id: 'op_repo_create',
        operation_state: 'succeeded',
        operation_type: 'repo_create',
        resource: { type: 'repo' },
        error: null,
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:01.000Z',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const json = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_repo_create',
      req: { headers: { 'x-request-id': 'req_operation_projection' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(storageAdapter.getOperationProjection).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_repo_create',
      requestId: 'req_operation_projection',
    });
    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        operation_id: 'op_repo_create',
        operation_state: 'succeeded',
        operation_type: 'repo_create',
        resource: { type: 'repo' },
      }),
    );
    const serialized = JSON.stringify(json.mock.calls[0]?.[2]);
    expect(serialized).not.toContain('ns_project_1');
    expect(serialized).not.toContain('repo_flib_123');
    expect(serialized).not.toContain('metadata_url');
    expect(serialized).not.toContain('one-time-webdav-secret');
  });

  it('maps invisible file-library operation projections to not_found', async () => {
    const storageAdapter = createStorageAdapter({
      getOperationProjection: vi.fn(async () => {
        throw new Error('file_library_operation_not_found');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const json = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_hidden_elsewhere',
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      404,
      {
        error_code: 'RESOURCE_NOT_FOUND',
        message: 'not_found',
      },
    );
  });

  it('lists and reads libraries by project scope instead of creator ownership', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const res = createMockResponse();

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res,
      deps,
      user: OTHER_PROJECT_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(listJson.mock.calls[0]?.[2]).toMatchObject({
      items: [
        expect.objectContaining({
          id: created.id,
          created_by_user_id: 'user_1',
        }),
      ],
    });
    expect(JSON.stringify(listJson.mock.calls[0]?.[2])).not.toContain('filesystem_name');

    const detailJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: String(created.id),
      req: {} as never,
      res,
      deps,
      user: OTHER_PROJECT_USER,
      json: detailJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(detailJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        id: created.id,
        created_by_user_id: 'user_1',
      }),
    );
    expect(JSON.stringify(detailJson.mock.calls[0]?.[2])).not.toContain('filesystem_name');
    expect(detailJson.mock.calls[0]?.[2]).toMatchObject({
      source: 'agent_task_files',
    });
  });

  it('reconciles pending template clone provisioning on file-library list and detail without leaking AFSCP ids', async () => {
    const reconcileLibraryProvisioning = vi.fn(async (input) => ({
      namespaceId: 'ns_project_1',
      repoId: `repo_${input.libraryId}`,
      operationId: 'op_template_clone_hidden',
      operationStatus: 'succeeded' as const,
      projectStorageGeneration: 1,
      lastErrorCode: null,
    }));
    const deps = createDeps({
      storageAdapter: createStorageAdapter({ reconcileLibraryProvisioning }),
    });
    const repo = new JsonDocProjectFileLibraryCatalogRepo(deps.docStore);
    await repo.save({
      id: 'flib_pending_template_clone',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Pending clone',
      status: 'creating',
      version: 1,
      file_library_home_segment: 'flibhome_pending_template_clone',
      source: 'agent_task_files',
      created_by_user_id: OWNER_USER.id,
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:00.000Z',
    });
    await repo.markTemplateCloneProvisioning({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_pending_template_clone',
      operationId: 'op_template_clone_hidden',
      templateId: 'tftpl_public_template',
      requestId: 'req_clone_retry',
    });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: { headers: { 'x-request-id': 'req_clone_list_reconcile' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(listJson.mock.calls[0]?.[2]).toMatchObject({
      items: [
        expect.objectContaining({
          id: 'flib_pending_template_clone',
          status: 'ready',
        }),
      ],
    });

    const detailJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_pending_template_clone',
      req: { headers: { 'x-request-id': 'req_clone_detail_reconcile' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: detailJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(detailJson.mock.calls[0]?.[2]).toMatchObject({
      id: 'flib_pending_template_clone',
      status: 'ready',
    });
    expect(reconcileLibraryProvisioning).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_pending_template_clone',
      requestId: 'req_clone_list_reconcile',
    }));
    expect(JSON.stringify([listJson.mock.calls, detailJson.mock.calls])).not.toMatch(/op_template_clone_hidden|repo_|tmpl_|credential|control_root/);
  });

  it('maps pending project storage timeout to a typed response without creating a half-provisioned library', async () => {
    vi.useFakeTimers();
    try {
      const deps = createDeps({
        projectStorage: {
          status: 'pending',
          stage: 'namespace_requested',
          generation: 1,
          nextAction: 'wait',
          retryable: true,
          lastErrorCode: null,
        },
      });
      const json = vi.fn();

      const createPromise = handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraries',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        req: {} as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json,
        readBody: vi.fn().mockResolvedValue({ name: 'Storage Pending' }),
      });

      await vi.runAllTimersAsync();
      await expect(createPromise).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(
        expect.anything(),
        409,
        {
          error_code: 'PROJECT_STORAGE_PENDING',
          message: 'project_storage_pending',
        },
      );
      expect(deps.fileLibraryStorageAdapter.createRepoForLibrary).not.toHaveBeenCalled();
      await expect(deps.docStore.list('project_file_libraries')).resolves.toEqual([]);
      expect(JSON.stringify(await deps.docStore.list('project_file_libraries'))).not.toContain('metadata_url');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps blocked project storage as a typed error without creating a half-provisioned library', async () => {
    const deps = createDeps({
      projectStorage: {
        status: 'blocked',
        stage: 'volume_binding',
        generation: 1,
        nextAction: 'admin_repair',
        retryable: false,
        lastErrorCode: 'storage_admin_action_required',
      },
    });
    const json = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({ name: 'Storage Blocked' }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(expect.anything(), 503, {
      error_code: 'PROJECT_STORAGE_BLOCKED',
      message: 'project_storage_blocked',
    });
    expect(deps.fileLibraryStorageAdapter.createRepoForLibrary).not.toHaveBeenCalled();
    await expect(deps.docStore.list('project_file_libraries')).resolves.toEqual([]);
  });

  it('redacts AFSCP repo provisioning failures and does not delete the sanitized failed library', async () => {
    const storageAdapter = createStorageAdapter({
      createRepoForLibrary: vi.fn(async () => {
        throw new Error('repo create failed metadata_url=postgres://user:secret@db/juicefs MINIO_SECRET_KEY=minio-secret');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const json = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({ name: 'Provision Failure' }),
    })).resolves.toBe(true);

    const payload = json.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(json.mock.calls[0]?.[1]).toBe(502);
    expect(payload).toMatchObject({
      error_code: 'FILE_LIBRARY_PROVISIONING_FAILED',
      message: 'file_library_operation_failed',
    });
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(JSON.stringify(payload)).not.toContain('metadata_url');
    await expect(deps.docStore.list('project_file_libraries')).resolves.toEqual([
      expect.objectContaining({
        name: 'Provision Failure',
        status: 'failed',
      }),
    ]);
  });

  it('routes list, folder, delete, move, upload, download, and meta operations through the storage adapter', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const entriesJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryEntries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { url: '/file-libraries/entries?path=docs&page_size=20&continuation_token=docs%2Fold.txt' } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: entriesJson,
      readBody: vi.fn(),
    });
    expect(storageAdapter.listEntries).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      path: 'docs/',
      pageSize: 20,
      continuationToken: 'docs/old.txt',
    }));

    const folderRes = createMockResponse();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryFolders',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: new EventEmitter() as never,
      res: folderRes,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn().mockResolvedValue({ path: 'docs/new' }),
    });
    expect(storageAdapter.createFolder).toHaveBeenCalledWith(expect.objectContaining({
      folderPath: 'docs/new/',
      actorUserId: 'user_1',
    }));
    expect(folderRes.statusCode).toBe(204);

    const deleteJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryDelete',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: deleteJson,
      readBody: vi.fn().mockResolvedValue({ paths: ['docs/readme.txt'] }),
    });
    expect(storageAdapter.deletePaths).toHaveBeenCalledWith(expect.objectContaining({
      paths: ['docs/readme.txt'],
      actorUserId: 'user_1',
    }));
    expect(deleteJson.mock.calls[0]?.[2]).toEqual({
      results: [{ path: 'docs/readme.txt', status: 'deleted' }],
    });

    const moveRes = createMockResponse();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryMove',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: new EventEmitter() as never,
      res: moveRes,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn().mockResolvedValue({
        from_path: 'docs/readme.txt',
        to_path: 'docs/renamed.txt',
        overwrite: true,
      }),
    });
    expect(storageAdapter.moveEntry).toHaveBeenCalledWith(expect.objectContaining({
      fromPath: 'docs/readme.txt',
      toPath: 'docs/renamed.txt',
      overwrite: true,
    }));
    expect(moveRes.statusCode).toBe(204);

    const uploadJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryUpload',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: multipartUploadRequest(),
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: uploadJson,
      readBody: vi.fn(),
    });
    expect(storageAdapter.uploadObject).toHaveBeenCalledWith(expect.objectContaining({
      objectPath: 'hello.txt',
      contentType: 'text/plain',
      overwrite: false,
    }));
    const uploadBody = vi.mocked(storageAdapter.uploadObject).mock.calls[0]?.[0].body;
    expect(typeof (uploadBody as WebReadableStream<Uint8Array>).getReader).toBe('function');
    expect(uploadJson.mock.calls[0]?.[1]).toBe(201);

    const downloadReq = new EventEmitter() as EventEmitter & http.IncomingMessage;
    downloadReq.url = '/file-libraries/download?path=docs%2Freadme.txt';
    downloadReq.headers = {};
    const downloadRes = createMockResponse();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryDownload',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: downloadReq,
      res: downloadRes,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn(),
    });
    expect(storageAdapter.downloadObject).toHaveBeenCalledWith(expect.objectContaining({
      objectPath: 'docs/readme.txt',
    }));
    expect(downloadRes.headers['content-disposition']).toContain('filename="readme.txt"');

    const metaJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryMeta',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { url: '/file-libraries/meta?path=docs%2Freadme.txt', headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: metaJson,
      readBody: vi.fn(),
    });
    expect(storageAdapter.getObjectMeta).toHaveBeenCalledWith(expect.objectContaining({
      objectPath: 'docs/readme.txt',
    }));
    expect(metaJson.mock.calls[0]?.[2]).toMatchObject({
      key: 'docs/readme.txt',
      content_type: 'text/plain',
    });
  });

  it('deletes ready libraries through the storage adapter and rolls back when content remains', async () => {
    const nonEmptyAdapter = createStorageAdapter({
      assertEmpty: vi.fn(async () => {
        throw new Error('file_library_not_empty');
      }),
    });
    const nonEmptyDeps = createDeps({ storageAdapter: nonEmptyAdapter });
    const nonEmptyCreated = await createReadyLibrary(nonEmptyDeps);
    const nonEmptyJson = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: String(nonEmptyCreated.id),
      req: { headers: { 'x-request-id': 'req_delete_non_empty' } } as never,
      res: createMockResponse(),
      deps: nonEmptyDeps,
      user: OWNER_USER,
      json: nonEmptyJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(nonEmptyJson).toHaveBeenCalledWith(
      expect.anything(),
      409,
      expect.objectContaining({
        error_code: 'FILE_LIBRARY_NOT_EMPTY',
        message: 'file_library_not_empty',
        file_library_id: nonEmptyCreated.id,
      }),
    );
    await expect(nonEmptyDeps.docStore.get('project_file_libraries', String(nonEmptyCreated.id))).resolves.toMatchObject({
      status: 'ready',
      delete_correlation_id: 'req_delete_non_empty',
    });

    const emptyAdapter = createStorageAdapter();
    const emptyDeps = createDeps({ storageAdapter: emptyAdapter });
    const emptyCreated = await createReadyLibrary(emptyDeps);
    const res = createMockResponse();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: String(emptyCreated.id),
      req: { headers: { 'x-request-id': 'req_delete_empty' } } as never,
      res,
      deps: emptyDeps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(emptyAdapter.assertEmpty).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: emptyCreated.id,
    }));
    expect(emptyAdapter.deleteRepoForLibrary).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: emptyCreated.id,
      actorUserId: 'user_1',
      reason: 'file_library_delete',
    }));
    expect(res.statusCode).toBe(204);
    await expect(emptyDeps.docStore.get('project_file_libraries', String(emptyCreated.id))).resolves.toBeNull();
  });

  it('blocks deleting a task-bound file library with safe bound-task fields and keeps the library ready', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const acquired = await new JsonDocTaskFileLibraryBindingRepo(deps.docStore).acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: String(created.id),
      taskId: 'task_bound_delete_blocker',
      taskTitle: 'Bound delete blocker task',
      taskStatus: 'active',
      ownerUserId: OWNER_USER.id,
      runtimeWritableAffordance: 'task_internal_home',
      correlationId: 'req_bind_before_delete',
    });
    expect(acquired.ok).toBe(true);
    const json = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: String(created.id),
      req: { headers: { 'x-request-id': 'req_delete_bound_library' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      expect.objectContaining({
        error_code: 'FILE_LIBRARY_TASK_IN_USE',
        message: 'file_library_task_in_use',
        file_library_id: created.id,
        bound_task_visible: true,
        bound_task_id: 'task_bound_delete_blocker',
        bound_task_title: 'Bound delete blocker task',
        bound_task_status: 'active',
      }),
    );
    expect(deps.fileLibraryStorageAdapter.assertEmpty).not.toHaveBeenCalled();
    expect(deps.fileLibraryStorageAdapter.deleteRepoForLibrary).not.toHaveBeenCalled();
    await expect(deps.docStore.get('project_file_libraries', String(created.id))).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('returns accepted and keeps deleting status while AFSCP repo delete remains pending', async () => {
    const storageAdapter = createStorageAdapter({
      deleteRepoForLibrary: vi.fn(async () => {
        throw new FileLibraryStorageOperationPendingError({
          message: 'file_library_repo_delete_pending',
          operationId: 'op_repo_delete_pending',
        });
      }),
    });
    const deps = createDeps({ storageAdapter });
    await seedLibrary(deps, 'ready');
    const json = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_ready',
      req: { headers: { 'x-request-id': 'req_delete_pending' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(storageAdapter.deleteRepoForLibrary).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'flib_ready',
      actorUserId: 'user_1',
      reason: 'file_library_delete',
    }));
    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      202,
      expect.objectContaining({
        file_library_id: 'flib_ready',
        file_library_status: 'deleting',
        operation_id: 'op_repo_delete_pending',
        operation_status: 'pending',
      }),
    );
    await expect(deps.docStore.get('project_file_libraries', 'flib_ready')).resolves.toMatchObject({
      status: 'deleting',
      delete_correlation_id: 'req_delete_pending',
    });
  });

  it('retries deleting libraries until AFSCP repo cleanup reaches terminal success', async () => {
    const deleteRepoForLibrary = vi.fn()
      .mockRejectedValueOnce(new FileLibraryStorageOperationPendingError({
        message: 'file_library_repo_delete_pending',
        operationId: 'op_repo_delete_pending',
      }))
      .mockResolvedValueOnce(undefined);
    const storageAdapter = createStorageAdapter({ deleteRepoForLibrary });
    const deps = createDeps({ storageAdapter });
    await seedLibrary(deps, 'ready');
    const firstJson = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_ready',
      req: { headers: { 'x-request-id': 'req_delete_pending' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: firstJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const secondRes = createMockResponse();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_ready',
      req: { headers: { 'x-request-id': 'req_delete_reconcile' } } as never,
      res: secondRes,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(deleteRepoForLibrary).toHaveBeenCalledTimes(2);
    expect(secondRes.statusCode).toBe(204);
    await expect(deps.docStore.get('project_file_libraries', 'flib_ready')).resolves.toBeNull();
  });

  it('does not fast-delete failed libraries before AFSCP repo cleanup reaches terminal success', async () => {
    const storageAdapter = createStorageAdapter({
      deleteRepoForLibrary: vi.fn(async () => {
        throw new FileLibraryStorageOperationPendingError({
          message: 'file_library_repo_delete_pending',
          operationId: 'op_repo_delete_failed_pending',
        });
      }),
    });
    const deps = createDeps({ storageAdapter });
    await seedLibrary(deps, 'failed');
    const json = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_failed',
      req: { headers: { 'x-request-id': 'req_delete_failed_pending' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(storageAdapter.deleteRepoForLibrary).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'flib_failed',
      actorUserId: 'user_1',
      reason: 'file_library_delete',
    }));
    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      202,
      expect.objectContaining({
        file_library_id: 'flib_failed',
        file_library_status: 'deleting',
        operation_id: 'op_repo_delete_failed_pending',
        operation_status: 'pending',
      }),
    );
    await expect(deps.docStore.get('project_file_libraries', 'flib_failed')).resolves.toMatchObject({
      status: 'deleting',
    });
  });

  it('fails closed when AFSCP repo delete reports pending without an operation id', async () => {
    const storageAdapter = createStorageAdapter({
      deleteRepoForLibrary: vi.fn(async () => {
        throw new FileLibraryStorageOperationPendingError({
          message: 'file_library_repo_delete_pending',
          operationId: null as unknown as string,
        });
      }),
    });
    const deps = createDeps({ storageAdapter });
    await seedLibrary(deps, 'ready');
    const json = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_ready',
      req: { headers: { 'x-request-id': 'req_delete_pending_without_operation_id' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      502,
      expect.objectContaining({
        error_code: 'FILE_LIBRARY_DELETE_FAILED',
        message: 'file_library_operation_failed',
      }),
    );
    await expect(deps.docStore.get('project_file_libraries', 'flib_ready')).resolves.toMatchObject({
      status: 'degraded',
      delete_correlation_id: 'req_delete_pending_without_operation_id',
    });
  });

  it('redacts file operation errors returned by upload, download, meta, and bulk delete routes', async () => {
    const storageAdapter = createStorageAdapter({
      uploadObject: vi.fn(async () => {
        throw new Error('upload exploded password=super-secret metadata_url=postgres://db');
      }),
      downloadObject: vi.fn(async () => {
        throw new Error('download exploded password=super-secret metadata_url=postgres://db');
      }),
      getObjectMeta: vi.fn(async () => {
        throw new Error('meta exploded password=super-secret metadata_url=postgres://db');
      }),
      deletePaths: vi.fn(async () => {
        throw new Error('delete exploded password=super-secret metadata_url=postgres://db');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const uploadJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryUpload',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: multipartUploadRequest(),
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: uploadJson,
      readBody: vi.fn(),
    });
    expect(uploadJson).toHaveBeenCalledWith(
      expect.anything(),
      400,
      {
        error_code: 'FILE_LIBRARY_UPLOAD_FAILED',
        message: 'file_library_upload_failed',
      },
    );

    const downloadJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryDownload',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { url: '/file-libraries/download?path=docs%2Freadme.txt', headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: downloadJson,
      readBody: vi.fn(),
    });
    expect(downloadJson).toHaveBeenCalledWith(
      expect.anything(),
      404,
      {
        error_code: 'RESOURCE_NOT_FOUND',
        message: 'file_library_download_not_found',
      },
    );

    const metaJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryMeta',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { url: '/file-libraries/meta?path=docs%2Freadme.txt', headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: metaJson,
      readBody: vi.fn(),
    });
    expect(metaJson).toHaveBeenCalledWith(
      expect.anything(),
      404,
      {
        error_code: 'RESOURCE_NOT_FOUND',
        message: 'file_library_meta_not_found',
      },
    );

    const deleteJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryDelete',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: deleteJson,
      readBody: vi.fn().mockResolvedValue({ paths: ['docs/readme.txt'] }),
    });
    expect(deleteJson).toHaveBeenCalledWith(
      expect.anything(),
      502,
      {
        error_code: 'FILE_LIBRARY_DELETE_FAILED',
        message: 'file_library_delete_failed',
      },
    );

    const serializedResponses = JSON.stringify([
      uploadJson.mock.calls,
      downloadJson.mock.calls,
      metaJson.mock.calls,
      deleteJson.mock.calls,
    ]);
    expect(serializedResponses).not.toContain('super-secret');
    expect(serializedResponses).not.toContain('metadata_url');
    expect(serializedResponses).not.toContain('postgres://db');
  });

  it('rejects write routes while a library is not ready', async () => {
    const deps = createDeps();
    await seedLibrary(deps, 'creating');
    const cases: Array<Parameters<typeof handleProjectFileLibraryRoutes>[0]['routeKind']> = [
      'fileLibraryFolders',
      'fileLibraryDelete',
      'fileLibraryMove',
      'fileLibraryUpload',
      'fileLibrarySavePoints',
      'fileLibraryRestorePreview',
      'fileLibraryRestoreRun',
      'fileLibraryRestoreCancel',
    ];

    for (const routeKind of cases) {
      const json = vi.fn();
      await expect(handleProjectFileLibraryRoutes({
        routeKind,
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: 'flib_creating',
        req: routeKind === 'fileLibraryUpload' ? multipartUploadRequest() : {} as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json,
        readBody: vi.fn().mockResolvedValue(routeKind === 'fileLibraryDelete'
            ? { paths: ['docs/readme.txt'] }
            : routeKind === 'fileLibraryMove'
              ? { from_path: 'docs/readme.txt', to_path: 'docs/new.txt' }
              : routeKind === 'fileLibraryRestorePreview'
                ? { save_point_id: 'flsp_before_restore' }
                : routeKind === 'fileLibraryRestoreRun' || routeKind === 'fileLibraryRestoreCancel'
                  ? { restore_preview_id: 'flrp_before_restore' }
              : { path: 'docs' }),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(
        expect.anything(),
        409,
        {
          error_code: 'FILE_LIBRARY_NOT_READY',
          message: 'file_library_not_ready',
          file_library_id: 'flib_creating',
          file_library_status: 'creating',
        },
      );
    }
    expect(deps.fileLibraryStorageAdapter.createFolder).not.toHaveBeenCalled();
    expect(deps.fileLibraryStorageAdapter.uploadObject).not.toHaveBeenCalled();
    expect(deps.fileLibraryStorageAdapter.createSavePoint).not.toHaveBeenCalled();
    expect(deps.fileLibraryStorageAdapter.createRestorePreview).not.toHaveBeenCalled();
    expect(deps.fileLibraryStorageAdapter.runRestorePreview).not.toHaveBeenCalled();
    expect(deps.fileLibraryStorageAdapter.discardRestorePreview).not.toHaveBeenCalled();
  });

  it('lists and creates product-safe save points and filters template-source save points', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const createJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_save_point_create' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    })).resolves.toBe(true);

    expect(storageAdapter.createSavePoint).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
      message: 'Before restore',
      actorUserId: 'user_1',
      requestId: 'req_save_point_create',
    }));
    const createdBody = createJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(createdBody).toMatchObject({
      id: expect.stringMatching(/^flsp_/),
      file_library_id: libraryId,
      message: 'Before restore',
    });
    expect(JSON.stringify(createdBody)).not.toMatch(/repo_|sp_user_|tmpl_|credential|control_root/);

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const listBody = listJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(listBody).toMatchObject({
      items: [
        expect.objectContaining({
          id: expect.stringMatching(/^flsp_/),
          file_library_id: libraryId,
          message: 'Before restore',
        }),
      ],
    });
    expect(JSON.stringify(listBody)).not.toMatch(/repo_flib|sp_user|tmpl_|storage_credential|control_root/);
  });

  it('returns stable save point create blockers without exposing storage internals', async () => {
    for (const [message, errorCode] of [
      ['file_library_save_point_create_pending', 'FILE_LIBRARY_OPERATION_PENDING'],
      ['file_library_active_writer_blocked', 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED'],
    ] as const) {
      const storageAdapter = createStorageAdapter({
        createSavePoint: vi.fn(async () => {
          throw new Error(`${message} repo_hidden_elsewhere ns_hidden metadata_url=postgres://db`);
        }),
      });
      const deps = createDeps({ storageAdapter });
      const created = await createReadyLibrary(deps);
      const libraryId = String(created.id);

      const createJson = vi.fn();
      await expect(handleProjectFileLibraryRoutes({
        routeKind: 'fileLibrarySavePoints',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: { headers: { 'x-request-id': 'req_save_point_blocker' } } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: createJson,
        readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
      })).resolves.toBe(true);

      expect(createJson).toHaveBeenCalledWith(expect.anything(), 409, {
        error_code: errorCode,
        message,
        ...(message.endsWith('_pending') ? {
          operation_status: 'pending',
          retry_after_ms: 2000,
        } : {}),
      });
      expect(JSON.stringify(createJson.mock.calls)).not.toMatch(/repo_hidden_elsewhere|ns_hidden|metadata_url|postgres|repo_flib|sp_user|credential|control_root/);
    }
  });

  it('runs restore preview, restore run, and restore cancel using public preview ids', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const savePointJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: savePointJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    });
    const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;

    const previewJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preview' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: previewJson,
      readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
    })).resolves.toBe(true);
    const preview = previewJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(preview).toMatchObject({
      id: expect.stringMatching(/^flrp_/),
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'ready',
      summary: {
        added: { count: 1, samples: ['src/new.ts'] },
        changed: { count: 2, samples: ['docs/readme.md'] },
        removed: { count: 1, samples: ['tmp/cache.txt'] },
        destructive: true,
      },
      blockers: [],
      stale: false,
    });

    const runJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreRun',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_run' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: runJson,
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    })).resolves.toBe(true);
    expect(storageAdapter.runRestorePreview).toHaveBeenCalledWith(expect.objectContaining({
      previewOperationId: 'op_preview01',
    }));
    expect(runJson.mock.calls[0]?.[2]).toMatchObject({
      restore_preview_id: preview.id,
      status: 'succeeded',
    });

    const cancelJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreCancel',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_cancel' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: cancelJson,
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    })).resolves.toBe(true);
    expect(storageAdapter.discardRestorePreview).toHaveBeenCalledWith(expect.objectContaining({
      previewOperationId: 'op_preview01',
    }));
    expect(JSON.stringify([previewJson.mock.calls, runJson.mock.calls, cancelJson.mock.calls])).not.toMatch(/repo_|sp_user_|plan_|credential|control_root/);
  });

  it('creates a hidden current-state fence before restore preview instead of requiring a user mutation save point', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const savePointJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_user_save_point' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: savePointJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before delete' }),
    });
    const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;

    const previewJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preview' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: previewJson,
      readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
    });

    expect(storageAdapter.createSavePoint).toHaveBeenCalledTimes(2);
    expect(storageAdapter.createSavePoint).toHaveBeenLastCalledWith(expect.objectContaining({
      libraryId,
      message: 'Restore preview current state',
      actorUserId: 'user_1',
      requestId: 'req_restore_preview',
    }));
    expect(vi.mocked(storageAdapter.createSavePoint).mock.invocationCallOrder[1])
      .toBeLessThan(vi.mocked(storageAdapter.createRestorePreview).mock.invocationCallOrder[0] ?? 0);

    vi.mocked(storageAdapter.listSavePoints).mockResolvedValueOnce([
      {
        savePointId: 'sp_user_002',
        repoId: `repo_${libraryId}`,
        message: 'Before delete',
        createdAt: '2026-05-09T00:01:00.000Z',
      },
      {
        savePointId: 'sp_user_003',
        repoId: `repo_${libraryId}`,
        message: 'Restore preview current state',
        createdAt: '2026-05-09T00:01:00.000Z',
      },
    ]);
    const listJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    });
    expect(listJson.mock.calls[0]?.[2]).toMatchObject({
      items: [
        expect.objectContaining({ message: 'Before delete' }),
      ],
    });
    expect(JSON.stringify(listJson.mock.calls[0]?.[2])).not.toContain('Restore preview current state');
  });

  it('hides restore preview current-state save points synced later from AFSCP history', async () => {
    const storageAdapter = createStorageAdapter({
      listSavePoints: vi.fn(async () => [
        {
          savePointId: 'sp_history_user_001',
          repoId: 'repo_hidden_history',
          message: 'Before restore',
          createdAt: '2026-05-09T00:00:00.000Z',
        },
        {
          savePointId: 'sp_history_restore_preview_fence',
          repoId: 'repo_hidden_history',
          message: 'Restore preview current state',
          createdAt: '2026-05-09T00:01:00.000Z',
        },
      ]),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_save_points_history_sync' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(listJson).toHaveBeenCalledWith(expect.anything(), 200, {
      items: [
        expect.objectContaining({
          file_library_id: libraryId,
          message: 'Before restore',
        }),
      ],
    });
    const fenceMapping = await new JsonDocFileLibrarySavePointMappingRepo(deps.docStore).getByAfscpId({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpSavePointId: 'sp_history_restore_preview_fence',
    });
    expect(fenceMapping).toMatchObject({
      purpose: 'restore_preview_fence',
      message: 'Restore preview current state',
    });
    expect(JSON.stringify(listJson.mock.calls)).not.toMatch(/Restore preview current state|sp_history|repo_hidden_history|credential|control_root/);
  });

  it('corrects cached restore preview fence save points that were previously exposed as user save points', async () => {
    const storageAdapter = createStorageAdapter({
      listSavePoints: vi.fn(async () => [
        {
          savePointId: 'sp_history_user_after_fence',
          repoId: 'repo_hidden_history',
          message: 'Before restore',
          createdAt: '2026-05-09T00:00:00.000Z',
        },
        {
          savePointId: 'sp_history_fence_previously_user',
          repoId: 'repo_hidden_history',
          message: 'Restore preview current state',
          createdAt: '2026-05-09T00:01:00.000Z',
        },
      ]),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(deps.docStore);
    await savePointRepo.upsertFromAfscp({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpSavePointId: 'sp_history_fence_previously_user',
      message: 'Restore preview current state',
      createdAt: '2026-05-09T00:01:00.000Z',
      purpose: 'user',
    });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_save_points_history_resync' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(listJson).toHaveBeenCalledWith(expect.anything(), 200, {
      items: [
        expect.objectContaining({
          file_library_id: libraryId,
          message: 'Before restore',
        }),
      ],
    });
    const correctedFence = await savePointRepo.getByAfscpId({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpSavePointId: 'sp_history_fence_previously_user',
    });
    expect(correctedFence).toMatchObject({
      purpose: 'restore_preview_fence',
      message: 'Restore preview current state',
    });
    expect(JSON.stringify(listJson.mock.calls)).not.toMatch(/Restore preview current state|sp_history|repo_hidden_history|credential|control_root/);
  });

  it('returns restore-preview preparation pending when the hidden fence save point is still pending', async () => {
    for (const pendingFence of [
      {
        name: 'pending_result',
        createFenceSavePoint: async () => ({
          operationId: 'op_fence_pending_hidden',
          operationStatus: 'pending' as const,
          savePointId: null,
        }),
      },
      {
        name: 'pending_error',
        createFenceSavePoint: async () => {
          throw new Error('file_library_save_point_create_pending op_fence_pending_hidden repo_hidden_history');
        },
      },
    ] as const) {
      const createSavePoint = vi.fn()
        .mockResolvedValueOnce({
          operationId: 'op_user_save_point',
          operationStatus: 'succeeded' as const,
          savePointId: 'sp_user_before_restore',
          createdAt: '2026-05-09T00:00:00.000Z',
        })
        .mockImplementationOnce(pendingFence.createFenceSavePoint);
      const storageAdapter = createStorageAdapter({ createSavePoint });
      const deps = createDeps({ storageAdapter });
      const created = await createReadyLibrary(deps);
      const libraryId = String(created.id);

      const savePointJson = vi.fn();
      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibrarySavePoints',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: { headers: { 'x-request-id': `req_user_save_point_${pendingFence.name}` } } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: savePointJson,
        readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
      });
      const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;

      const previewJson = vi.fn();
      await expect(handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryRestorePreview',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: { headers: { 'x-request-id': `req_restore_preview_${pendingFence.name}` } } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: previewJson,
        readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
      })).resolves.toBe(true);

      expect(previewJson).toHaveBeenCalledWith(expect.anything(), 409, {
        error_code: 'FILE_LIBRARY_OPERATION_PENDING',
        message: 'file_library_restore_preview_pending',
        restore_preview_status: 'preparing',
        operation_status: 'pending',
        retry_after_ms: 2000,
      });
      expect(storageAdapter.createRestorePreview).not.toHaveBeenCalled();
      await expect(new JsonDocFileLibraryRestorePreviewRepo(deps.docStore).findLatestByLibrary(
        'ws_default',
        'proj_1',
        libraryId,
      )).resolves.toBeNull();
      expect(JSON.stringify(previewJson.mock.calls)).not.toMatch(/op_fence_pending_hidden|repo_hidden_history|sp_user_before_restore|credential|control_root/);
    }
  });

  it('returns a previewing restore preview instead of a conflict when AFSCP preview is still running', async () => {
    const storageAdapter = createStorageAdapter({
      createRestorePreview: vi.fn(async () => ({
        operationId: 'op_preview_long',
        operationStatus: 'pending',
        restorePlanId: null,
        sourceSavePointId: 'sp_user_001',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const savePointJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: savePointJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    });
    const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;

    const previewJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preview_pending' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: previewJson,
      readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
    })).resolves.toBe(true);

    expect(previewJson).toHaveBeenCalledWith(expect.anything(), 201, expect.objectContaining({
      id: expect.stringMatching(/^flrp_/),
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'previewing',
    }));
    expect(JSON.stringify(previewJson.mock.calls)).not.toMatch(/repo_|sp_user_|plan_|credential|control_root/);
  });

  it('reconciles an active restore preview through a backend projection without exposing AFSCP ids', async () => {
    const reconcileRestorePreview = vi.fn(async () => ({
      operationId: 'op_preview_long',
      operationStatus: 'succeeded' as const,
      restorePlanId: 'plan_afscp_hidden',
      sourceSavePointId: '1778481131647-4d2e0211',
      summary: {
        added: { count: 0, samples: [] },
        changed: { count: 1, samples: ['docs/guide.txt'] },
        removed: { count: 0, samples: [] },
        destructive: false,
      },
      blockers: [],
      stale: false,
    }));
    const storageAdapter = createStorageAdapter({
      createRestorePreview: vi.fn(async () => ({
        operationId: 'op_preview_long',
        operationStatus: 'pending',
        restorePlanId: null,
        sourceSavePointId: '1778481131647-4d2e0211',
      })),
      reconcileRestorePreview,
    } as Partial<FileLibraryStoragePort> & { reconcileRestorePreview: typeof reconcileRestorePreview });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const savePointJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: savePointJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    });
    const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;

    const previewJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preview_pending' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: previewJson,
      readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
    })).resolves.toBe(true);
    const preview = previewJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(preview).toMatchObject({ status: 'previewing' });

    const getJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preview_poll' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: getJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(reconcileRestorePreview).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      operationId: 'op_preview_long',
      requestId: 'req_restore_preview_poll',
    }));
    expect(getJson).toHaveBeenCalledWith(expect.anything(), 200, {
      restore_preview: expect.objectContaining({
        id: preview.id,
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'ready',
        summary: {
          added: { count: 0, samples: [] },
          changed: { count: 1, samples: ['docs/guide.txt'] },
          removed: { count: 0, samples: [] },
          destructive: false,
        },
        blockers: [],
        stale: false,
      }),
    });
    expect(JSON.stringify(getJson.mock.calls)).not.toMatch(/op_preview_long|repo_|plan_|1778481131647-4d2e0211|sp_user_|credential|control_root/);
  });

  it('returns failed restore preview projections after async AFSCP failure without blocking retry or templates', async () => {
    const createRestorePreview = vi.fn()
      .mockResolvedValueOnce({
        operationId: 'op_preview_failed_hidden',
        operationStatus: 'pending' as const,
        restorePlanId: null,
        sourceSavePointId: 'sp_user_001',
      })
      .mockResolvedValueOnce({
        operationId: 'op_preview_retry_hidden',
        operationStatus: 'succeeded' as const,
        restorePlanId: 'plan_retry_hidden',
        sourceSavePointId: 'sp_user_001',
        summary: {
          added: { count: 0, samples: [] },
          changed: { count: 0, samples: [] },
          removed: { count: 1, samples: ['tmp/deleted.txt'] },
          destructive: true,
        },
        blockers: [],
        stale: false,
      });
    const reconcileRestorePreview = vi.fn(async () => ({
      operationId: 'op_preview_failed_hidden',
      operationStatus: 'failed' as const,
      restorePlanId: null,
      sourceSavePointId: 'sp_user_001',
    }));
    const storageAdapter = createStorageAdapter({
      createRestorePreview,
      reconcileRestorePreview,
    } as Partial<FileLibraryStoragePort> & {
      createRestorePreview: typeof createRestorePreview;
      reconcileRestorePreview: typeof reconcileRestorePreview;
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const savePointJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: savePointJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    });
    const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;

    const previewJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preview_async_failure' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: previewJson,
      readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
    })).resolves.toBe(true);
    const preview = previewJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(preview).toMatchObject({ status: 'previewing' });

    const getJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preview_failed_poll' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: getJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(getJson).toHaveBeenCalledWith(expect.anything(), 200, {
      restore_preview: expect.objectContaining({
        id: preview.id,
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'failed',
      }),
    });

    const templateJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: { headers: { 'x-request-id': 'req_template_after_failed_preview' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: templateJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Template after failed preview',
        source_library_id: libraryId,
      }),
    })).resolves.toBe(true);
    expect(templateJson.mock.calls[0]?.[1]).toBe(201);
    expect(storageAdapter.createTemplateFromLibrary).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
    }));

    const retryJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preview_retry' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: retryJson,
      readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
    })).resolves.toBe(true);
    expect(retryJson.mock.calls[0]?.[1]).toBe(201);
    expect(retryJson.mock.calls[0]?.[2]).toMatchObject({
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'ready',
    });
    expect(JSON.stringify([getJson.mock.calls, retryJson.mock.calls, templateJson.mock.calls]))
      .not.toMatch(/op_preview_failed_hidden|op_preview_retry_hidden|repo_|plan_|sp_user_|credential|control_root/);
  });

  it('serves cached save points instead of list-failed while a restore preview projection is active', async () => {
    const storageAdapter = createStorageAdapter({
      listSavePoints: vi.fn(async () => {
        throw new Error('file_library_save_point_list_failed repo_hidden_elsewhere metadata_url=postgres://db');
      }),
      reconcileRestorePreview: vi.fn(async () => ({
        operationId: 'op_preview_long_hidden',
        operationStatus: 'pending' as const,
        restorePlanId: null,
        sourceSavePointId: 'sp_cached_001',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(deps.docStore);
    const cachedSavePoint = await savePointRepo.upsertFromAfscp({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpSavePointId: 'sp_cached_001',
      message: 'Cached before restore',
      createdAt: '2026-05-09T00:00:00.000Z',
      purpose: 'user',
    });
    await new JsonDocFileLibraryRestorePreviewRepo(deps.docStore).create({
      id: 'flrp_active_cached_list',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpPreviewOperationId: 'op_preview_long_hidden',
      activeAfscpOperationId: 'op_preview_long_hidden',
      sourceSavePointId: cachedSavePoint.id,
      sourceAfscpSavePointId: 'sp_cached_001',
      status: 'previewing',
    });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_save_points_list_during_preview' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(listJson).toHaveBeenCalledWith(expect.anything(), 200, {
      items: [
        expect.objectContaining({
          id: cachedSavePoint.id,
          file_library_id: libraryId,
          message: 'Cached before restore',
        }),
      ],
    });
    expect(JSON.stringify(listJson.mock.calls)).not.toMatch(/FILE_LIBRARY_SAVE_POINT_LIST_FAILED|repo_hidden_elsewhere|metadata_url|postgres|op_preview_long_hidden|sp_cached_001|credential|control_root/);
  });

  it('serves cached user save points when AFSCP reports save point listing is pending', async () => {
    const storageAdapter = createStorageAdapter({
      listSavePoints: vi.fn(async () => {
        throw new Error('file_library_save_point_list_pending repo_hidden_elsewhere metadata_url=postgres://db');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePointRepo = new JsonDocFileLibrarySavePointMappingRepo(deps.docStore);
    const cachedSavePoint = await savePointRepo.upsertFromAfscp({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpSavePointId: 'sp_cached_busy_001',
      message: 'Cached before busy mutation',
      createdAt: '2026-05-09T00:00:00.000Z',
      purpose: 'user',
    });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_save_points_list_busy' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(listJson).toHaveBeenCalledWith(expect.anything(), 200, {
      items: [
        expect.objectContaining({
          id: cachedSavePoint.id,
          file_library_id: libraryId,
          message: 'Cached before busy mutation',
        }),
      ],
    });
    expect(JSON.stringify(listJson.mock.calls)).not.toMatch(/FILE_LIBRARY_SAVE_POINT_LIST_FAILED|FILE_LIBRARY_OPERATION_PENDING|file_library_save_point_list_pending|repo_hidden_elsewhere|metadata_url|postgres|sp_cached_busy_001|credential|control_root/);
  });

  it('returns a retryable pending state instead of a terminal list failure when save point listing is pending without cache', async () => {
    const storageAdapter = createStorageAdapter({
      listSavePoints: vi.fn(async () => {
        throw new Error('file_library_save_point_list_pending repo_hidden_elsewhere metadata_url=postgres://db');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_save_points_list_busy_no_cache' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(listJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_save_point_list_pending',
      operation_status: 'pending',
      retry_after_ms: 2000,
    });
    expect(JSON.stringify(listJson.mock.calls))
      .not.toMatch(/FILE_LIBRARY_SAVE_POINT_LIST_FAILED|repo_hidden_elsewhere|metadata_url|postgres|credential|control_root/);
  });

  it('does not return terminal restore previews as active blockers after reconcile', async () => {
    const reconcileRestorePreview = vi.fn(async () => ({
      operationId: 'op_restore_run_long',
      operationStatus: 'succeeded' as const,
      restorePlanId: 'plan_hidden_restored',
      sourceSavePointId: 'sp_user_restored',
    }));
    const storageAdapter = createStorageAdapter({ reconcileRestorePreview });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const restoreRepo = new JsonDocFileLibraryRestorePreviewRepo(deps.docStore);
    await restoreRepo.create({
      id: 'flrp_restoring',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpPreviewOperationId: 'op_preview_hidden',
      activeAfscpOperationId: 'op_restore_run_long',
      sourceSavePointId: 'flsp_public',
      sourceAfscpSavePointId: 'sp_user_restored',
      status: 'restoring',
      restorePlanId: 'plan_hidden_initial',
    });

    const getJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_terminal_poll' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: getJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(getJson).toHaveBeenCalledWith(expect.anything(), 200, {
      restore_preview: null,
    });

    await seedTaskFileTemplate({
      deps,
      id: 'tftpl_after_restore',
      name: 'After restore',
      status: 'unpublished',
      sourceLibraryId: libraryId,
    });
    const publishJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplatePublish',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: 'tftpl_after_restore',
      req: { headers: { 'x-request-id': 'req_publish_after_restore' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: publishJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(publishJson.mock.calls[0]?.[1]).toBe(200);
    expect(publishJson.mock.calls[0]?.[2]).toMatchObject({
      id: 'tftpl_after_restore',
      status: 'published',
    });
    expect(JSON.stringify([getJson.mock.calls, publishJson.mock.calls])).not.toMatch(/op_restore_run_long|op_preview_hidden|repo_|plan_|sp_user_|credential|control_root/);
  });

  it('keeps a pending restore run as an active restoring projection until terminal reconcile clears it', async () => {
    const reconcileRestorePreview = vi.fn()
      .mockResolvedValueOnce({
        operationId: 'op_restore_run_long',
        operationStatus: 'pending' as const,
        restorePlanId: 'plan_hidden_pending',
        sourceSavePointId: 'sp_user_hidden',
      })
      .mockResolvedValueOnce({
        operationId: 'op_restore_run_long',
        operationStatus: 'succeeded' as const,
        restorePlanId: 'plan_hidden_restored',
        sourceSavePointId: 'sp_user_hidden',
      });
    const storageAdapter = createStorageAdapter({
      runRestorePreview: vi.fn(async () => ({
        operationId: 'op_restore_run_long',
        operationStatus: 'pending',
        restorePlanId: 'plan_hidden_pending',
        sourceSavePointId: 'sp_user_hidden',
      })),
      reconcileRestorePreview,
    } as Partial<FileLibraryStoragePort> & { reconcileRestorePreview: typeof reconcileRestorePreview });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const savePointJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: savePointJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    });
    const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;

    const previewJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: previewJson,
      readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
    });
    const preview = previewJson.mock.calls[0]?.[2] as Record<string, unknown>;

    const runJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreRun',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_run_pending' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: runJson,
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    })).resolves.toBe(true);

    expect(runJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      restore_preview_id: preview.id,
      status: 'pending',
    }));

    const pendingGetJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_run_pending_poll' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: pendingGetJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(pendingGetJson).toHaveBeenCalledWith(expect.anything(), 200, {
      restore_preview: expect.objectContaining({
        id: preview.id,
        status: 'restoring',
      }),
    });

    const terminalGetJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_run_terminal_poll' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: terminalGetJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(terminalGetJson).toHaveBeenCalledWith(expect.anything(), 200, {
      restore_preview: null,
    });
    expect(JSON.stringify([runJson.mock.calls, pendingGetJson.mock.calls, terminalGetJson.mock.calls]))
      .not.toMatch(/op_restore_run_long|repo_|plan_|sp_user_|credential|control_root/);
  });

  it('returns stable restore conflict responses without exposing AFSCP ids', async () => {
    for (const [message, errorCode] of [
      ['file_library_restore_run_pending', 'FILE_LIBRARY_OPERATION_PENDING'],
      ['file_library_restore_preview_stale', 'FILE_LIBRARY_RESTORE_PREVIEW_STALE'],
      ['file_library_active_writer_blocked', 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED'],
      ['file_library_project_storage_not_ready', 'FILE_LIBRARY_STORAGE_NOT_READY'],
    ] as const) {
      const storageAdapter = createStorageAdapter({
        runRestorePreview: vi.fn(async () => {
          throw new Error(`${message} repo_hidden_elsewhere ns_hidden export_hidden`);
        }),
      });
      const deps = createDeps({ storageAdapter });
      const created = await createReadyLibrary(deps);
      const libraryId = String(created.id);

      const savePointJson = vi.fn();
      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibrarySavePoints',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: { headers: {} } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: savePointJson,
        readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
      });
      const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;

      const previewJson = vi.fn();
      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryRestorePreview',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: { headers: {} } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: previewJson,
        readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
      });
      const preview = previewJson.mock.calls[0]?.[2] as Record<string, unknown>;

      const runJson = vi.fn();
      await expect(handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryRestoreRun',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: { headers: { 'x-request-id': 'req_restore_conflict' } } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: runJson,
        readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
      })).resolves.toBe(true);

      if (message === 'file_library_active_writer_blocked') {
        expect(runJson).toHaveBeenCalledWith(expect.anything(), 409, {
          error_code: errorCode,
          message,
          file_library_id: libraryId,
          restore_preview_id: preview.id,
          blockers: [{ code: 'active_writer_sessions' }],
          bound_task_visible: false,
        });
      } else {
        expect(runJson).toHaveBeenCalledWith(expect.anything(), 409, {
          error_code: errorCode,
          message,
        });
      }
      expect(JSON.stringify(runJson.mock.calls)).not.toMatch(/repo_hidden_elsewhere|ns_hidden|export_hidden|repo_|sp_user_|plan_|credential|control_root/);
    }
  });

  it('does not treat the durable task file-library binding as a restore active writer after runtime access is gone', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const preview = await seedReadyRestorePreview({ deps, libraryId });
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_durable_binding_only',
      title: 'Durable binding only task',
    });

    const runJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreRun',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_durable_binding_only' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: runJson,
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    })).resolves.toBe(true);

    expect(storageAdapter.runRestorePreview).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
      previewOperationId: 'op_preview_hidden',
    }));
    expect(runJson.mock.calls[0]?.[1]).toBe(200);
    expect(JSON.stringify(runJson.mock.calls)).not.toMatch(/wmb_|ns_|repo_hidden|credential|control_root/);
  });

  it('preflights restore run against active runtime workspace access and projects a typed blocker', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const preview = await seedReadyRestorePreview({ deps, libraryId });
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_active_writer',
      title: 'Restore active writer task',
    });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => activeRuntimeBinding(libraryId));

    const runJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreRun',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preflight_blocked' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: runJson,
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    })).resolves.toBe(true);

    expect(storageAdapter.runRestorePreview).not.toHaveBeenCalled();
    expect(runJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: libraryId,
      restore_preview_id: preview.id,
      blockers: [{ code: 'active_writer_sessions' }],
      bound_task_visible: true,
      bound_task_id: 'task_restore_active_writer',
      bound_task_title: 'Restore active writer task',
      bound_task_status: 'active',
    });

    const getJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preflight_refresh' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: getJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(getJson).toHaveBeenCalledWith(expect.anything(), 200, {
      restore_preview: expect.objectContaining({
        id: preview.id,
        status: 'ready',
        blockers: [{ code: 'active_writer_sessions' }],
      }),
    });
    expect(JSON.stringify([runJson.mock.calls, getJson.mock.calls]))
      .not.toMatch(/op_preview_hidden|sp_user_hidden|plan_hidden|repo_|ns_|wmb_|mount|credential|control_root/);
  });

  it('returns typed restore active-writer schema and persists the preview blocker when storage rejects restore run', async () => {
    const storageAdapter = createStorageAdapter({
      runRestorePreview: vi.fn(async () => {
        throw new Error('file_library_active_writer_blocked repo_hidden_elsewhere ns_hidden export_hidden');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const preview = await seedReadyRestorePreview({ deps, libraryId });
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_storage_writer',
      title: 'Storage writer task',
    });

    const runJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreRun',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_storage_active_writer' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: runJson,
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    })).resolves.toBe(true);

    expect(storageAdapter.runRestorePreview).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
      previewOperationId: 'op_preview_hidden',
    }));
    expect(runJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: libraryId,
      restore_preview_id: preview.id,
      blockers: [{ code: 'active_writer_sessions' }],
      bound_task_visible: true,
      bound_task_id: seededTask.taskId,
      bound_task_title: 'Storage writer task',
      bound_task_status: 'active',
    });
    await expect(new JsonDocFileLibraryRestorePreviewRepo(deps.docStore).getById(
      'ws_default',
      'proj_1',
      libraryId,
      preview.id,
    )).resolves.toMatchObject({
      id: preview.id,
      status: 'ready',
      blockers: [{ code: 'active_writer_sessions' }],
    });
    expect(JSON.stringify(runJson.mock.calls)).not.toMatch(/repo_hidden_elsewhere|ns_hidden|export_hidden|op_preview_hidden|sp_user_hidden|plan_hidden|repo_|ns_|wmb_|mount|credential|control_root/);
  });

  it('redacts invisible bound task fields in restore active-writer preflight responses', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const preview = await seedReadyRestorePreview({ deps, libraryId });
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_invisible_writer',
      title: 'Invisible restore writer task',
      ownerUserId: OTHER_PROJECT_USER.id,
    });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => activeRuntimeBinding(libraryId));

    const runJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreRun',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preflight_redacted' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: runJson,
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    })).resolves.toBe(true);

    expect(storageAdapter.runRestorePreview).not.toHaveBeenCalled();
    const body = runJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body).toMatchObject({
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: libraryId,
      restore_preview_id: preview.id,
      blockers: [{ code: 'active_writer_sessions' }],
      bound_task_visible: false,
    });
    expect(body).not.toHaveProperty('bound_task_id');
    expect(body).not.toHaveProperty('bound_task_title');
    expect(body).not.toHaveProperty('bound_task_status');
    expect(JSON.stringify(body)).not.toMatch(/task_restore_invisible_writer|Invisible restore writer task|op_preview_hidden|sp_user_hidden|plan_hidden|repo_|ns_|wmb_|mount|credential|control_root/);
  });

  it('releases file-library runtime access through the workspace binding manager and clears stale preview blockers', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const preview = await seedReadyRestorePreview({
      deps,
      libraryId,
      blockers: [{ code: 'active_writer_sessions' }],
    });
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_runtime_access',
      title: 'Release runtime access task',
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_runtime_access_release' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      fileLibraryId: libraryId,
    });
    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: true,
      runtime_access_status: 'released',
    });
    expect(JSON.stringify(releaseJson.mock.calls)).not.toMatch(/wmb_|ns_|repo_|mount|credential|control_root/);
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      fileLibraryId: libraryId,
      bindingGeneration: seededTask.bindingGeneration,
      runtimeWritableAffordance: 'task_internal_home',
    });
    await expect(deps.docStore.get(notebookTasksCollection('ws_default'), seededTask.taskId)).resolves.toMatchObject({
      workspace_file_library_id: libraryId,
      workspace_file_library_name: 'Shared Docs',
      file_library_binding_generation: seededTask.bindingGeneration,
      runtime_writable_affordance: 'task_internal_home',
    });

    const detailJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_runtime_access_release_detail' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: detailJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(detailJson.mock.calls[0]?.[2]).toMatchObject({
      id: libraryId,
      task_home_binding_status: 'bound',
      bound_task_visible: true,
      bound_task_id: seededTask.taskId,
    });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: { headers: { 'x-request-id': 'req_runtime_access_release_list' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(listJson.mock.calls[0]?.[2]).toMatchObject({
      items: [
        expect.objectContaining({
          id: libraryId,
          task_home_binding_status: 'bound',
          bound_task_visible: true,
          bound_task_id: seededTask.taskId,
        }),
      ],
    });

    const getJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_runtime_access_release_refresh' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: getJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(getJson.mock.calls[0]?.[2]).toMatchObject({
      restore_preview: {
        id: preview.id,
        blockers: [],
      },
    });

    const runJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreRun',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_runtime_access_release_restore_run' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: runJson,
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    })).resolves.toBe(true);
    expect(storageAdapter.runRestorePreview).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
      previewOperationId: 'op_preview_hidden',
    }));
  });

  it('reports pending runtime access release truth without dropping the durable task binding', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const preview = await seedReadyRestorePreview({
      deps,
      libraryId,
      blockers: [{ code: 'active_writer_sessions' }],
    });
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_runtime_access_pending',
      title: 'Release pending task',
    });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => ({
      ...activeRuntimeBinding(libraryId),
      status: 'releasing',
      mount_binding_status: 'releasing',
      release_operation_id: 'op_hidden_release_pending',
      release_requested_at: '2026-05-09T00:00:00.000Z',
      drain_started_at: '2026-05-09T00:00:00.000Z',
    }));

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_runtime_access_release_pending' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: false,
      runtime_access_status: 'release_pending',
    });
    expect(JSON.stringify(releaseJson.mock.calls)).not.toMatch(/op_hidden|wmb_|ns_|repo_|mount|credential|control_root/);
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
    });
    await expect(deps.docStore.get(notebookTasksCollection('ws_default'), seededTask.taskId)).resolves.toMatchObject({
      workspace_file_library_id: libraryId,
      file_library_binding_generation: seededTask.bindingGeneration,
      runtime_writable_affordance: 'task_internal_home',
    });

    const runJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreRun',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_runtime_access_release_pending_restore_run' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: runJson,
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    })).resolves.toBe(true);

    expect(storageAdapter.runRestorePreview).not.toHaveBeenCalled();
    expect(runJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: libraryId,
      restore_preview_id: preview.id,
      blockers: [{ code: 'active_writer_sessions' }],
      bound_task_visible: true,
      bound_task_id: seededTask.taskId,
      bound_task_title: 'Release pending task',
      bound_task_status: 'active',
    });
    expect(JSON.stringify(runJson.mock.calls)).not.toMatch(/op_preview_hidden|sp_user_hidden|plan_hidden|op_hidden|wmb_|ns_|repo_|mount|credential|control_root/);
  });

  it.each([
    ['active_run', async (deps: ReturnType<typeof createDeps>, taskId: string) => {
      deps.cache.get = vi.fn(async () => JSON.stringify({
        task_id: taskId,
        run_id: 'run_release_blocked',
        owner_instance_id: 'api-test',
        phase: 'running',
        started_at: '2026-05-09T00:00:00.000Z',
        heartbeat_at: '2026-05-09T00:00:00.000Z',
      }));
    }],
    ['active_terminal', async (deps: ReturnType<typeof createDeps>) => {
      deps.notebookTerminalService.hasLiveSessionsForTask = vi.fn(async () => true);
    }],
    ['workspace_holder', async (deps: ReturnType<typeof createDeps>, taskId: string, libraryId: string, bindingGeneration: number) => {
      await new JsonDocTaskWorkspaceHolderRepo(deps.docStore).acquire({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId,
        fileLibraryId: libraryId,
        taskHomeSegment: taskId,
        bindingGeneration,
        holderId: 'holder_release_blocked',
        holderKind: 'runner_workspace',
        leaseEpoch: 'lease_release_blocked',
        issuedAt: '2026-05-09T00:00:00.000Z',
        expiresAt: '2999-05-09T00:00:00.000Z',
      });
    }],
  ] as const)('refuses runtime access release while %s is live', async (blockerCode, setupBlocker) => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: `task_release_blocked_${blockerCode}`,
      title: `Release blocked by ${blockerCode}`,
    });
    await setupBlocker(deps, seededTask.taskId, libraryId, seededTask.bindingGeneration);

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': `req_release_blocked_${blockerCode}` } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_BLOCKED',
      message: 'file_library_runtime_access_release_blocked',
      file_library_id: libraryId,
      blockers: [{ code: blockerCode }],
      bound_task_visible: true,
      bound_task_id: seededTask.taskId,
    }));
    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).not.toHaveBeenCalled();
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
    });
    await expect(deps.docStore.get(notebookTasksCollection('ws_default'), seededTask.taskId)).resolves.toMatchObject({
      workspace_file_library_id: libraryId,
      file_library_binding_generation: seededTask.bindingGeneration,
      runtime_writable_affordance: 'task_internal_home',
    });
  });

  it('lists only published task file templates for task-use users without leaking drafts', async () => {
    const deps = createDeps();
    await grantProjectPermissions(deps, OTHER_PROJECT_USER.id, ['project:agent_task:use']);
    await seedTaskFileTemplate({
      deps,
      id: 'tftpl_published',
      name: 'Published template',
      status: 'published',
    });
    await seedTaskFileTemplate({
      deps,
      id: 'tftpl_draft',
      name: 'Draft template',
      status: 'unpublished',
    });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OTHER_PROJECT_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(listJson.mock.calls[0]?.[1]).toBe(200);
    expect(listJson.mock.calls[0]?.[2]).toMatchObject({
      items: [
        expect.objectContaining({
          id: 'tftpl_published',
          status: 'published',
        }),
      ],
    });
    expect(JSON.stringify(listJson.mock.calls[0]?.[2])).not.toMatch(/tftpl_draft|Draft template|unpublished|tmpl_/);
  });

  it('lists unpublished task file templates only for files-update template managers', async () => {
    const deps = createDeps();
    await grantProjectPermissions(deps, OTHER_PROJECT_USER.id, ['project:files:update']);
    await seedTaskFileTemplate({
      deps,
      id: 'tftpl_published',
      name: 'Published template',
      status: 'published',
    });
    await seedTaskFileTemplate({
      deps,
      id: 'tftpl_draft',
      name: 'Draft template',
      status: 'unpublished',
    });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OTHER_PROJECT_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(listJson.mock.calls[0]?.[1]).toBe(200);
    expect(listJson.mock.calls[0]?.[2]).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'tftpl_published',
          status: 'published',
        }),
        expect.objectContaining({
          id: 'tftpl_draft',
          status: 'unpublished',
        }),
      ]),
    });
    expect(JSON.stringify(listJson.mock.calls[0]?.[2])).not.toMatch(/tmpl_/);
  });

  it('refuses task file template listing without task-use or files-update permissions without leaking template metadata', async () => {
    const deps = createDeps();
    await seedTaskFileTemplate({
      deps,
      id: 'tftpl_published',
      name: 'Published template',
      status: 'published',
    });
    await seedTaskFileTemplate({
      deps,
      id: 'tftpl_draft',
      name: 'Draft template',
      status: 'unpublished',
    });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OTHER_PROJECT_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(listJson).toHaveBeenCalledWith(expect.anything(), 403, {
      error_code: 'FORBIDDEN',
      message: 'forbidden',
      missing_permissions: ['project:agent_task:use', 'project:files:update'],
    });
    expect(JSON.stringify(listJson.mock.calls)).not.toMatch(/tftpl_draft|Draft template|tftpl_published|Published template|unpublished|published|tmpl_/);
  });

  it('keeps AFSCP capability denials as typed file-library errors instead of treating template publish as successful', async () => {
    const storageAdapter = createStorageAdapter({
      createTemplateFromLibrary: vi.fn(async () => {
        throw new Error('file_library_capability_denied repo_template disabled by local profile');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const createJson = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: { headers: { 'x-request-id': 'req_template_capability_denied' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Denied template',
        source_library_id: String(created.id),
      }),
    })).resolves.toBe(true);

    expect(createJson).toHaveBeenCalledWith(expect.anything(), 403, {
      error_code: 'FILE_LIBRARY_CAPABILITY_DENIED',
      message: 'file_library_capability_denied',
    });
    expect(JSON.stringify(createJson.mock.calls)).not.toMatch(/repo_template disabled|req_template_capability_denied|repo_|tmpl_|credential|control_root/);
  });

  it('blocks template create and publish while a backend restore preview is active', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const savePointJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: savePointJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    });
    const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;

    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_preview_ready' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
    });

    const createTemplateJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: { headers: { 'x-request-id': 'req_template_blocked' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createTemplateJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Blocked template',
        source_library_id: libraryId,
      }),
    })).resolves.toBe(true);

    expect(createTemplateJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_RESTORE_PREVIEW_ACTIVE',
      message: 'file_library_restore_preview_active',
      file_library_id: libraryId,
      restore_preview_status: 'ready',
    }));
    expect(storageAdapter.createTemplateFromLibrary).not.toHaveBeenCalled();

    await seedTaskFileTemplate({
      deps,
      id: 'tftpl_blocked_publish',
      name: 'Blocked publish template',
      status: 'unpublished',
      sourceLibraryId: libraryId,
    });
    const publishJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplatePublish',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: 'tftpl_blocked_publish',
      req: { headers: { 'x-request-id': 'req_template_publish_blocked' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: publishJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(publishJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_RESTORE_PREVIEW_ACTIVE',
      message: 'file_library_restore_preview_active',
      file_library_id: libraryId,
      restore_preview_status: 'ready',
    }));
    expect(JSON.stringify([createTemplateJson.mock.calls, publishJson.mock.calls])).not.toMatch(/op_preview|repo_|plan_|sp_user_|tmpl_|credential|control_root/);
  });

  it('allows template create after a canceling preview reconciles to canceled', async () => {
    const reconcileRestorePreview = vi.fn(async () => ({
      operationId: 'op_restore_discard_long',
      operationStatus: 'succeeded' as const,
      restorePlanId: 'plan_afscp_hidden',
      sourceSavePointId: 'sp_user_001',
    }));
    const storageAdapter = createStorageAdapter({
      discardRestorePreview: vi.fn(async () => ({
        operationId: 'op_restore_discard_long',
        operationStatus: 'pending',
        restorePlanId: 'plan_001',
        sourceSavePointId: 'sp_user_001',
      })),
      reconcileRestorePreview,
    } as Partial<FileLibraryStoragePort> & { reconcileRestorePreview: typeof reconcileRestorePreview });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const savePointJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: savePointJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    });
    const savePoint = savePointJson.mock.calls[0]?.[2] as Record<string, unknown>;
    const previewJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestorePreview',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: previewJson,
      readBody: vi.fn().mockResolvedValue({ save_point_id: savePoint.id }),
    });
    const preview = previewJson.mock.calls[0]?.[2] as Record<string, unknown>;
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestoreCancel',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_cancel_pending' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn().mockResolvedValue({ restore_preview_id: preview.id }),
    });

    const createTemplateJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: { headers: { 'x-request-id': 'req_template_after_cancel' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createTemplateJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Template after cancel',
        source_library_id: libraryId,
      }),
    })).resolves.toBe(true);

    expect(reconcileRestorePreview).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'op_restore_discard_long',
    }));
    expect(createTemplateJson.mock.calls[0]?.[1]).toBe(201);
    expect(storageAdapter.createTemplateFromLibrary).toHaveBeenCalled();

    const restoreRepo = new JsonDocFileLibraryRestorePreviewRepo(deps.docStore);
    await expect(restoreRepo.getById(
      'ws_default',
      'proj_1',
      libraryId,
      String(preview.id),
    )).resolves.toMatchObject({
      status: 'canceled',
    });
  });

  it('re-snapshots an unpublished task file template at publish time and updates public source mapping', async () => {
    let templateCreateCount = 0;
    const createTemplateFromLibrary = vi.fn(async (input: Parameters<FileLibraryStoragePort['createTemplateFromLibrary']>[0]) => {
      templateCreateCount += 1;
      return {
        templateId: input.templateId,
        operationId: `op_template_create_${templateCreateCount}`,
        operationStatus: 'succeeded' as const,
        sourceSavePointId: `sp_template_source_${templateCreateCount}`,
      };
    });
    const storageAdapter = createStorageAdapter({ createTemplateFromLibrary });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const createJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: { headers: { 'x-request-id': 'req_template_create_draft' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Publish-time template',
        source_library_id: libraryId,
      }),
    })).resolves.toBe(true);
    const template = createJson.mock.calls[0]?.[2] as Record<string, unknown>;
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const initialInternal = await templateRepo.getById('ws_default', 'proj_1', String(template.id));
    expect(initialInternal).toMatchObject({
      status: 'unpublished',
      source_afscp_save_point_id: 'sp_template_source_1',
    });

    const publishJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplatePublish',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: String(template.id),
      req: { headers: { 'x-request-id': 'req_template_publish_current_state' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: publishJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(createTemplateFromLibrary).toHaveBeenCalledTimes(2);
    expect(createTemplateFromLibrary).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      actorUserId: OWNER_USER.id,
      requestId: 'req_template_publish_current_state',
      templateId: expect.stringMatching(/^tmpl_/),
    }));
    const updatedInternal = await templateRepo.getById('ws_default', 'proj_1', String(template.id));
    expect(updatedInternal).toMatchObject({
      status: 'published',
      source_afscp_save_point_id: 'sp_template_source_2',
      afscp_create_operation_id: 'op_template_create_2',
    });
    expect(updatedInternal?.source_save_point_id).toEqual(expect.stringMatching(/^flsp_/));
    expect(updatedInternal?.source_save_point_id).not.toBe(initialInternal?.source_save_point_id);
    expect(updatedInternal?.afscp_template_id).not.toBe(initialInternal?.afscp_template_id);

    expect(publishJson.mock.calls[0]?.[2]).toMatchObject({
      id: template.id,
      status: 'published',
      source_save_point_id: updatedInternal?.source_save_point_id,
    });
    expect(JSON.stringify(publishJson.mock.calls)).not.toMatch(/tmpl_|sp_template_source|repo_|credential|control_root/);

    vi.mocked(storageAdapter.listSavePoints).mockResolvedValueOnce([
      {
        savePointId: 'sp_template_source_2',
        repoId: `repo_${libraryId}`,
        message: 'Template source: Publish-time template',
        createdAt: '2026-05-09T00:02:00.000Z',
      },
    ]);
    const listJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: {} } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    });
    expect(listJson.mock.calls[0]?.[2]).toEqual({ items: [] });
  });

  it('manages project-scoped task file templates without exposing raw AFSCP ids', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const createJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: { headers: { 'x-request-id': 'req_template_create' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Release template',
        source_library_id: libraryId,
      }),
    })).resolves.toBe(true);
    const template = createJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(template).toMatchObject({
      id: expect.stringMatching(/^tftpl_/),
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      status: 'unpublished',
      source_library_id: libraryId,
      source_save_point_id: expect.stringMatching(/^flsp_/),
    });
    expect(JSON.stringify(template)).not.toMatch(/tmpl_|repo_|sp_template|credential|control_root/);

    const publishJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplatePublish',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: String(template.id),
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: publishJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(publishJson.mock.calls[0]?.[2]).toMatchObject({
      id: template.id,
      status: 'published',
    });

    await grantProjectPermissions(deps, OTHER_PROJECT_USER.id, ['project:agent_task:use']);
    const listJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OTHER_PROJECT_USER,
      json: listJson,
      readBody: vi.fn(),
    });
    expect(listJson.mock.calls[0]?.[2]).toMatchObject({
      items: [
        expect.objectContaining({
          id: template.id,
          status: 'published',
        }),
      ],
    });

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplateUnpublish',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: String(template.id),
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const deleteRes = createMockResponse();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplateItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: String(template.id),
      req: {} as never,
      res: deleteRes,
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(deleteRes.statusCode).toBe(204);
  });
});
