import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import type http from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { handleProjectFileLibraryRoutes } from './project-file-library-routes.js';
import {
  buildFileLibraryRestoreOperationPublicId,
  JsonDocFileLibraryRestoreOperationRepo,
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
  buildRuntimeAccessReleaseBeginCorrelationId,
  buildRuntimeAccessReleaseCompleteCorrelationId,
  buildRuntimeAccessRestoreStartedCorrelationId,
  JsonDocTaskFileLibraryBindingRepo,
  JsonDocTaskWorkspaceHolderRepo,
} from './notebook-task/task-file-library-bindings.js';
import type { ProjectStoragePreflightResult } from './project-storage-bootstrap-service.js';
import type { InternalAgentWorkspaceBinding } from './internal-agent-workspace-provisioner.js';
import { auditEventsCollection } from './audit-usage/utils.js';

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

type LegacyRestoreAdmissionSpies = {
  admitRestoreFileLibrary: ReturnType<typeof vi.fn>;
  preflightRestoreFileLibrary: ReturnType<typeof vi.fn>;
};

function createStorageAdapter(
  overrides: Partial<FileLibraryStoragePort & LegacyRestoreAdmissionSpies> = {},
): FileLibraryStoragePort & LegacyRestoreAdmissionSpies {
  let createdSavePointCount = 1;
  const legacyRestoreAdmission = {
    admitRestoreFileLibrary: vi.fn(async () => undefined),
    preflightRestoreFileLibrary: vi.fn(async () => undefined),
  };
  const adapter = {
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
    invalidateListReadExport: vi.fn(async () => undefined),
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
    ...legacyRestoreAdmission,
    restoreFileLibrary: vi.fn(async () => ({
      operationId: 'op_restore_direct',
      operationStatus: 'pending',
      sourceSavePointId: 'sp_user_001',
    })),
    reconcileRestoreOperation: vi.fn(async () => ({
      operationId: 'op_restore_direct',
      operationStatus: 'pending',
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
  } as FileLibraryStoragePort & LegacyRestoreAdmissionSpies;
  return adapter;
}

function createDeps(args: {
  storageAdapter?: FileLibraryStoragePort;
  projectStorage?: ProjectStoragePreflightResult;
  docStore?: InMemoryJsonDocStore;
} = {}) {
  return {
    docStore: args.docStore ?? new InMemoryJsonDocStore(),
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
    internalAgentPodManager: {
      releasePod: vi.fn(async () => undefined),
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

function createCountGate(count: number): () => Promise<void> {
  const deferred = createDeferred<void>();
  let arrivals = 0;
  return async () => {
    arrivals += 1;
    if (arrivals >= count) {
      deferred.resolve();
    }
    await deferred.promise;
  };
}

class RestoreOperationRaceDocStore extends InMemoryJsonDocStore {
  private readonly idempotencyListGate = createCountGate(2);
  private readonly pendingCreateUpsertGate = createCountGate(2);

  override async list<T>(collection: string, filter: Record<string, string> = {}): Promise<T[]> {
    if (
      collection === 'project_file_library_restore_operations'
      && filter.workspace_id === 'ws_default'
      && filter.project_id === 'proj_1'
      && filter.library_id
      && filter.idempotency_key
    ) {
      await this.idempotencyListGate();
    }
    return super.list<T>(collection, filter);
  }

  override async upsert<T>(collection: string, id: string, doc: T): Promise<void> {
    if (
      collection === 'project_file_library_restore_operations'
      && typeof doc === 'object'
      && doc !== null
      && (doc as Record<string, unknown>).idempotency_key === 'restore-key-concurrent'
      && (doc as Record<string, unknown>).status === 'pending'
      && (doc as Record<string, unknown>).afscp_operation_id === null
    ) {
      await this.pendingCreateUpsertGate();
    }
    await super.upsert(collection, id, doc);
  }
}

class RestoreOperationDifferentKeyRaceDocStore extends InMemoryJsonDocStore {
  private readonly idempotencyListGate = createCountGate(2);
  private readonly activeListGate = createCountGate(2);
  private raceEnabled = false;

  enableRestoreRace(): void {
    this.raceEnabled = true;
  }

  override async list<T>(collection: string, filter: Record<string, string> = {}): Promise<T[]> {
    if (!this.raceEnabled) {
      return super.list<T>(collection, filter);
    }
    if (
      collection === 'project_file_library_restore_operations'
      && filter.workspace_id === 'ws_default'
      && filter.project_id === 'proj_1'
      && filter.library_id
      && filter.idempotency_key
    ) {
      await this.idempotencyListGate();
    }
    if (
      collection === 'project_file_library_restore_operations'
      && filter.workspace_id === 'ws_default'
      && filter.project_id === 'proj_1'
      && filter.library_id
      && !filter.idempotency_key
    ) {
      await this.activeListGate();
    }
    return super.list<T>(collection, filter);
  }
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

async function createSavePointForRestore(input: {
  deps: ReturnType<typeof createDeps>;
  libraryId: string;
  message?: string;
}): Promise<Record<string, unknown>> {
  const savePointJson = vi.fn();
  await handleProjectFileLibraryRoutes({
    routeKind: 'fileLibrarySavePoints',
    method: 'POST',
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    libraryId: input.libraryId,
    req: {
      headers: {
        'x-request-id': 'req_save_point_for_restore',
        'idempotency-key': `save-point-for-restore-${input.libraryId}-${input.message ?? 'default'}`,
      },
    } as never,
    res: createMockResponse(),
    deps: input.deps,
    user: OWNER_USER,
    json: savePointJson,
    readBody: vi.fn().mockResolvedValue({ message: input.message ?? 'Before restore' }),
  });
  const targetMessage = input.message ?? 'Before restore';
  const mappedSavePoints = await input.deps.docStore.list<Record<string, unknown>>(
    'project_file_library_save_point_mappings',
    {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      library_id: input.libraryId,
    },
  );
  const mapped = mappedSavePoints.find((item) => item.message === targetMessage);
  if (mapped) {
    return mapped;
  }
  const listJson = vi.fn();
  await handleProjectFileLibraryRoutes({
    routeKind: 'fileLibrarySavePoints',
    method: 'GET',
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    libraryId: input.libraryId,
    req: { headers: { 'x-request-id': 'req_save_point_for_restore_list' } } as never,
    res: createMockResponse(),
    deps: input.deps,
    user: OWNER_USER,
    json: listJson,
    readBody: vi.fn(),
  });
  const listBody = listJson.mock.calls[0]?.[2] as { items?: Record<string, unknown>[] };
  return listBody.items?.find((item) => item.message === targetMessage) ?? listBody.items?.[0] ?? {};
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork(turns = 3): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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
        created_by_user_id: 'user_1',
      }),
    );
    expect(created).not.toHaveProperty('file_library_home_segment');
    expect(created).not.toHaveProperty('version');
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

  it.each([
    {
      label: 'failed',
      projection: {
        operation_id: 'op_save_point_terminal_failed',
        operation_state: 'failed',
        operation_type: 'save_point_create',
        resource: { type: 'repo' },
        error: { code: 'afscp_save_point_failed' },
        created_at: '2026-05-09T00:01:00.000Z',
        updated_at: '2026-05-09T00:01:02.000Z',
      },
      expectedStatus: 'failed',
      expectedFailureReason: 'file_library_save_point_create_failed',
    },
    {
      label: 'recovery_required',
      projection: {
        operation_id: 'op_save_point_terminal_recovery',
        operation_state: 'operator_intervention_required',
        operation_type: 'save_point_create',
        resource: { type: 'repo' },
        error: { code: 'afscp_operator_recovery_required' },
        created_at: '2026-05-09T00:01:00.000Z',
        updated_at: '2026-05-09T00:01:02.000Z',
      },
      expectedStatus: 'recovery_required',
      expectedFailureReason: 'file_library_storage_admin_action_required',
    },
  ])('serves local save-point terminal $label projections through public operation lookup', async ({
    projection,
    expectedStatus,
    expectedFailureReason,
  }) => {
    const storageAdapter = createStorageAdapter({
      createSavePoint: vi.fn(async () => ({
        operationId: projection.operation_id,
        operationStatus: 'pending',
        savePointId: null,
      })),
      getOperationProjection: vi.fn(async (input) => {
        if (input.operationId !== projection.operation_id) {
          throw new Error('file_library_operation_not_found');
        }
        return projection;
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
      req: {
        headers: {
          'x-request-id': `req_save_point_lookup_${expectedStatus}`,
          'idempotency-key': `save-point-lookup-${expectedStatus}`,
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({ message: `Before ${expectedStatus}` }),
    })).resolves.toBe(true);
    const publicOperationId = (createJson.mock.calls[0]?.[2] as { id?: string }).id;
    expect(publicOperationId).toMatch(/^flop_/);

    const lookupJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: publicOperationId,
      req: { headers: { 'x-request-id': `req_save_point_lookup_${expectedStatus}_get` } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: lookupJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(storageAdapter.getOperationProjection).toHaveBeenCalledWith(expect.objectContaining({
      operationId: projection.operation_id,
      requestId: `req_save_point_lookup_${expectedStatus}_get`,
    }));
    expect(lookupJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      id: publicOperationId,
      kind: 'save_point_create',
      file_library_id: libraryId,
      status: expectedStatus,
      failure_reason: expectedFailureReason,
    }));
    expect(JSON.stringify(lookupJson.mock.calls[0]?.[2]))
      .not.toMatch(new RegExp(`${projection.operation_id}|${projection.error.code}`));
  });

  it('maps save point terminal operation lookup result to a public save point id', async () => {
    const storageAdapter = createStorageAdapter({
      createSavePoint: vi.fn(async () => ({
        operationId: 'op_save_point_terminal_result',
        operationStatus: 'pending',
        savePointId: null,
      })),
      getOperationProjection: vi.fn(async () => ({
        operation_id: 'op_save_point_terminal_result',
        operation_state: 'succeeded',
        operation_type: 'save_point_create',
        resource: { type: 'repo' },
        error: null,
        created_at: '2026-05-09T00:01:00.000Z',
        updated_at: '2026-05-09T00:01:02.000Z',
        resultSavePointId: 'sp_raw_terminal_result',
      })),
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
      req: {
        headers: {
          'x-request-id': 'req_save_point_terminal_result',
          'idempotency-key': 'save-point-terminal-result-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before terminal result' }),
    })).resolves.toBe(true);
    const operationId = (createJson.mock.calls[0]?.[2] as { id?: string }).id;

    const lookupJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId,
      req: { headers: { 'x-request-id': 'req_save_point_terminal_result_lookup' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: lookupJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const lookupBody = lookupJson.mock.calls[0]?.[2] as { result_save_point_id?: string };
    expect(lookupBody).toMatchObject({
      result_save_point_id: expect.stringMatching(/^flsp_/),
    });
    expect(JSON.stringify(lookupBody)).not.toMatch(/sp_raw_terminal_result|op_save_point_terminal_result|repo_/);
    await expect(deps.docStore.list<Record<string, unknown>>(
      'project_file_library_save_point_mappings',
      {
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        library_id: libraryId,
      },
    )).resolves.toEqual([
      expect.objectContaining({
        id: lookupBody.result_save_point_id,
        afscp_save_point_id: 'sp_raw_terminal_result',
        message: 'Before terminal result',
        purpose: 'user',
      }),
    ]);
  });

  it('serves local restore failed projections through public operation lookup', async () => {
    const storageAdapter = createStorageAdapter({
      reconcileRestoreOperation: vi.fn(async (input) => {
        if (input.operationId !== 'op_restore_lookup_failed') {
          throw new Error('file_library_operation_not_found');
        }
        return {
          operationId: 'op_restore_lookup_failed',
          operationStatus: 'failed',
          sourceSavePointId: 'sp_user_001',
        };
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const restoreOperation = await new JsonDocFileLibraryRestoreOperationRepo(deps.docStore).create({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: 'op_restore_lookup_failed',
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_001',
      status: 'restoring',
      idempotencyKey: 'restore-lookup-failed',
      createdByUserId: 'user_1',
    });

    const lookupJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: restoreOperation.id,
      req: { headers: { 'x-request-id': 'req_restore_lookup_failed' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: lookupJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(storageAdapter.reconcileRestoreOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'op_restore_lookup_failed',
      requestId: 'req_restore_lookup_failed',
    }));
    expect(lookupJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      id: restoreOperation.id,
      kind: 'restore',
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'failed',
      failure_reason: 'file_library_restore_failed',
    }));
    expect(JSON.stringify(lookupJson.mock.calls[0]?.[2]))
      .not.toMatch(/restore_op_|op_restore_lookup_failed/);
  });

  it('serves local restore recovery-required projections through public operation lookup', async () => {
    const storageAdapter = createStorageAdapter({
      reconcileRestoreOperation: vi.fn(async (input) => {
        if (input.operationId !== 'op_restore_lookup_recovery') {
          throw new Error('file_library_operation_not_found');
        }
        return {
          operationId: 'op_restore_lookup_recovery',
          operationStatus: 'recovery_required',
          sourceSavePointId: 'sp_user_001',
        };
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const restoreOperation = await new JsonDocFileLibraryRestoreOperationRepo(deps.docStore).create({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: 'op_restore_lookup_recovery',
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_001',
      status: 'restoring',
      idempotencyKey: 'restore-lookup-recovery',
      createdByUserId: 'user_1',
    });

    const lookupJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: restoreOperation.id,
      req: { headers: { 'x-request-id': 'req_restore_lookup_recovery' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: lookupJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(lookupJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      id: restoreOperation.id,
      kind: 'restore',
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'recovery_required',
      failure_reason: 'file_library_storage_admin_action_required',
    }));
    expect(JSON.stringify(lookupJson.mock.calls[0]?.[2]))
      .not.toMatch(/restore_op_|op_restore_lookup_recovery|operator|JVS|control_root/);
  });

  it('requires restore public ids for public operation and active-operation responses', async () => {
    const storageAdapter = createStorageAdapter({
      getOperationProjection: vi.fn(async () => {
        throw new Error('file_library_operation_not_found');
      }),
      reconcileRestoreOperation: vi.fn(async (input) => {
        if (input.operationId !== 'op_restore_public_route') {
          throw new Error('file_library_operation_not_found');
        }
        return {
          operationId: 'op_restore_public_route',
          operationStatus: 'pending',
          sourceSavePointId: 'sp_user_001',
        };
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const restoreOperation = await new JsonDocFileLibraryRestoreOperationRepo(deps.docStore).create({
      id: 'restore_op_public_route_raw',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: 'op_restore_public_route',
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_001',
      status: 'restoring',
      idempotencyKey: 'restore-public-route',
      createdByUserId: 'user_1',
    });
    const publicOperationId = buildFileLibraryRestoreOperationPublicId(restoreOperation);
    expect(publicOperationId).toMatch(/^flro_[0-9a-f]{24}$/);
    expect(publicOperationId).not.toBe(restoreOperation.id);

    const rawLookupJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: restoreOperation.id,
      req: { headers: { 'x-request-id': 'req_restore_raw_public_lookup' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: rawLookupJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(rawLookupJson).toHaveBeenCalledWith(expect.anything(), 404, {
      error_code: 'RESOURCE_NOT_FOUND',
      message: 'not_found',
    });
    expect(storageAdapter.reconcileRestoreOperation).not.toHaveBeenCalled();
    expect(storageAdapter.getOperationProjection).not.toHaveBeenCalled();

    const rawAfscpLookupJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_restore_public_route',
      req: { headers: { 'x-request-id': 'req_restore_raw_afscp_public_lookup' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: rawAfscpLookupJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(rawAfscpLookupJson).toHaveBeenCalledWith(expect.anything(), 404, {
      error_code: 'RESOURCE_NOT_FOUND',
      message: 'not_found',
    });
    expect(storageAdapter.getOperationProjection).not.toHaveBeenCalled();
    expect(JSON.stringify(rawAfscpLookupJson.mock.calls[0]?.[2]))
      .not.toMatch(/op_restore_public_route/);

    const malformedPublicLookupJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'flro_public_route',
      req: { headers: { 'x-request-id': 'req_restore_malformed_public_lookup' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: malformedPublicLookupJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(malformedPublicLookupJson).toHaveBeenCalledWith(expect.anything(), 404, {
      error_code: 'RESOURCE_NOT_FOUND',
      message: 'not_found',
    });
    expect(storageAdapter.getOperationProjection).not.toHaveBeenCalled();

    const publicLookupJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: publicOperationId,
      req: { headers: { 'x-request-id': 'req_restore_public_lookup' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: publicLookupJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(publicLookupJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      id: publicOperationId,
      kind: 'restore',
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'running',
    }));
    expect(JSON.stringify(publicLookupJson.mock.calls[0]?.[2]))
      .not.toMatch(/restore_op_public_route_raw|op_restore_public_route/);

    const activeJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_public_active' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(activeJson).toHaveBeenCalledWith(expect.anything(), 200, {
      operation: expect.objectContaining({
        id: publicOperationId,
        kind: 'restore',
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'running',
      }),
    });
    expect(JSON.stringify(activeJson.mock.calls[0]?.[2]))
      .not.toMatch(/restore_op_public_route_raw|op_restore_public_route/);
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

  it.each([
    {
      storageMessage: 'file_library_project_storage_not_ready',
      expectedStatus: 409,
      expectedErrorCode: 'FILE_LIBRARY_STORAGE_NOT_READY',
    },
    {
      storageMessage: 'file_library_afscp_mapping_not_ready',
      expectedStatus: 409,
      expectedErrorCode: 'FILE_LIBRARY_STORAGE_NOT_READY',
    },
    {
      storageMessage: 'file_library_list_pending',
      expectedStatus: 409,
      expectedErrorCode: 'FILE_LIBRARY_OPERATION_PENDING',
    },
    {
      storageMessage: 'file_library_storage_admin_action_required',
      expectedStatus: 503,
      expectedErrorCode: 'FILE_LIBRARY_STORAGE_ADMIN_ACTION_REQUIRED',
    },
  ])(
    'maps entries $storageMessage without collapsing it to an untyped list 502',
    async ({ storageMessage, expectedStatus, expectedErrorCode }) => {
      const storageAdapter = createStorageAdapter({
        listEntries: vi.fn(async () => {
          throw new Error(storageMessage);
        }),
      });
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
        req: {
          url: '/file-libraries/entries?path=workspace%2F.artifacts',
          headers: { 'x-request-id': 'req_entries_readiness' },
        } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: entriesJson,
        readBody: vi.fn(),
      });

      expect(storageAdapter.listEntries).toHaveBeenCalledWith(expect.objectContaining({
        path: 'workspace/.artifacts/',
        requestId: 'req_entries_readiness',
      }));
      expect(entriesJson).toHaveBeenCalledWith(expect.anything(), expectedStatus, {
        error_code: expectedErrorCode,
        message: storageMessage,
      });
    },
  );

  it('releases idle task runtime access before a successful entries list so the export is fresh', async () => {
    const storageAdapter = createStorageAdapter({
      listEntries: vi.fn(async () => ({
        path: 'workspace/.artifacts/',
        items: [
          {
            kind: 'file',
            path: 'workspace/.artifacts/restored.svg',
            name: 'restored.svg',
            size_bytes: 42,
            content_type: 'image/svg+xml',
            modified_at: '2026-05-09T00:00:00.000Z',
          },
        ],
        nextContinuationToken: null,
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_entries_pre_list_release',
      title: 'Entries pre-list release task',
    });
    let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      runtimeBinding = null;
    });

    const entriesJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryEntries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        url: '/file-libraries/entries?path=workspace%2F.artifacts',
        headers: { 'x-request-id': 'req_entries_pre_list_release' },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: entriesJson,
      readBody: vi.fn(),
    });

    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      fileLibraryId: libraryId,
    });
    expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      createdBeforeOrAtMs: expect.any(Number),
      requestId: 'req_entries_pre_list_release',
    }));
    const releaseCallOrder = vi
      .mocked(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding)
      .mock.invocationCallOrder[0] ?? 0;
    const listCallOrder = vi
      .mocked(storageAdapter.listEntries)
      .mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
    expect(releaseCallOrder).toBeLessThan(listCallOrder);
    expect(entriesJson).toHaveBeenCalledWith(expect.anything(), 200, {
      path: 'workspace/.artifacts/',
      items: [
        expect.objectContaining({
          kind: 'file',
          path: 'workspace/.artifacts/restored.svg',
          name: 'restored.svg',
        }),
      ],
      next_continuation_token: null,
    });
  });

  it('returns entries pending without creating a stale export while pre-list runtime release is pending', async () => {
    const storageAdapter = createStorageAdapter({
      listEntries: vi.fn(async () => ({
        path: 'workspace/.artifacts/',
        items: [],
        nextContinuationToken: null,
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_entries_pre_list_release_pending',
      title: 'Entries pre-list release pending task',
    });
    let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      runtimeBinding = {
        ...activeRuntimeBinding(libraryId),
        status: 'releasing',
        mount_binding_status: 'releasing',
      };
    });

    const entriesJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryEntries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        url: '/file-libraries/entries?path=workspace%2F.artifacts',
        headers: { 'x-request-id': 'req_entries_pre_list_release_pending' },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: entriesJson,
      readBody: vi.fn(),
    });

    expect(storageAdapter.listEntries).not.toHaveBeenCalled();
    expect(entriesJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_list_pending',
    });
  });

  it('keeps entries pending without creating a stale export when pre-list runtime release is retryable infrastructure', async () => {
    const storageAdapter = createStorageAdapter({
      listEntries: vi.fn(async () => ({
        path: 'workspace/.artifacts/',
        items: [],
        nextContinuationToken: null,
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_entries_pre_list_release_retryable',
      title: 'Entries pre-list retryable release task',
    });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => activeRuntimeBinding(libraryId));
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      throw Object.assign(new Error('sandbox release unavailable raw-secret-token'), {
        code: 'AGENT_SANDBOX_UNAVAILABLE',
        status: 502,
        operation: 'delete_workspace_binding',
        requestId: 'asbcp_req_entries_release_retryable',
        retryable: true,
      });
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const entriesJson = vi.fn();
      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryEntries',
        method: 'GET',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: {
          url: '/file-libraries/entries?path=workspace%2F.artifacts',
          headers: { 'x-request-id': 'req_entries_pre_list_release_retryable' },
        } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: entriesJson,
        readBody: vi.fn(),
      });

      expect(storageAdapter.listEntries).not.toHaveBeenCalled();
      expect(entriesJson).toHaveBeenCalledWith(expect.anything(), 409, {
        error_code: 'FILE_LIBRARY_OPERATION_PENDING',
        message: 'file_library_list_pending',
      });
      expect(JSON.stringify(entriesJson.mock.calls)).not.toMatch(/raw-secret-token|delete_workspace_binding/);
      expect(warnSpy).toHaveBeenCalledWith(
        '[files] runtime_pending_readiness_failure %s',
        expect.stringContaining('"scope":"file_library_runtime_access_release"'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[files] runtime_pending_readiness_failure %s',
        expect.stringContaining('"request_id":"release:begin:req_entries_pre_list_release_retryable"'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('releases idle task runtime access and lets the next entries poll use a refreshed export', async () => {
    const storageAdapter = createStorageAdapter({
      listEntries: vi.fn()
        .mockRejectedValueOnce(new Error('file_library_list_pending'))
        .mockResolvedValueOnce({
          path: 'workspace/.artifacts/',
          items: [
            {
              kind: 'file',
              path: 'workspace/.artifacts/restored.svg',
              name: 'restored.svg',
              size_bytes: 42,
              content_type: 'image/svg+xml',
              modified_at: '2026-05-09T00:00:00.000Z',
            },
          ],
          nextContinuationToken: null,
        }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_entries_pending_release',
      title: 'Entries pending release task',
    });
    let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      runtimeBinding = null;
    });

    const firstEntriesJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryEntries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        url: '/file-libraries/entries?path=workspace%2F.artifacts',
        headers: { 'x-request-id': 'req_entries_pending_release_first' },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: firstEntriesJson,
      readBody: vi.fn(),
    });

    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      fileLibraryId: libraryId,
    });
    expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      createdBeforeOrAtMs: expect.any(Number),
      requestId: 'req_entries_pending_release_first',
    }));
    expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledTimes(2);
    expect(storageAdapter.invalidateListReadExport).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      createdBeforeOrAtMs: expect.any(Number),
      requestId: 'req_entries_pending_release_first',
    }));
    expect(storageAdapter.listEntries).toHaveBeenCalledTimes(1);
    expect(firstEntriesJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_list_pending',
    });

    const secondEntriesJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryEntries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        url: '/file-libraries/entries?path=workspace%2F.artifacts',
        headers: { 'x-request-id': 'req_entries_pending_release_second' },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: secondEntriesJson,
      readBody: vi.fn(),
    });

    expect(storageAdapter.listEntries).toHaveBeenCalledTimes(2);
    expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledTimes(2);
    expect(secondEntriesJson).toHaveBeenCalledWith(expect.anything(), 200, {
      path: 'workspace/.artifacts/',
      items: [
        expect.objectContaining({
          kind: 'file',
          path: 'workspace/.artifacts/restored.svg',
          name: 'restored.svg',
        }),
      ],
      next_continuation_token: null,
    });
  });

  it('keeps a post-release pending read export warm after the release-transition invalidation', async () => {
    const storageAdapter = createStorageAdapter({
      listEntries: vi.fn(async () => {
        throw new Error('file_library_list_pending');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_entries_post_release_pending',
      title: 'Entries post release pending task',
    });
    let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      runtimeBinding = null;
    });

    const firstEntriesJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryEntries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        url: '/file-libraries/entries?path=workspace%2F.artifacts',
        headers: { 'x-request-id': 'req_entries_post_release_pending_first' },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: firstEntriesJson,
      readBody: vi.fn(),
    });

    expect(storageAdapter.listEntries).toHaveBeenCalledTimes(1);
    expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledTimes(2);
    expect(storageAdapter.invalidateListReadExport).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      createdBeforeOrAtMs: expect.any(Number),
      requestId: 'req_entries_post_release_pending_first',
    }));
    expect(firstEntriesJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_list_pending',
    });

    const secondEntriesJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryEntries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        url: '/file-libraries/entries?path=workspace%2F.artifacts',
        headers: { 'x-request-id': 'req_entries_post_release_pending_second' },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: secondEntriesJson,
      readBody: vi.fn(),
    });

    expect(storageAdapter.listEntries).toHaveBeenCalledTimes(2);
    expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledTimes(3);
    expect(storageAdapter.invalidateListReadExport).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      createdBeforeOrAtMs: expect.any(Number),
      requestId: 'req_entries_post_release_pending_second',
    }));
    expect(secondEntriesJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_list_pending',
    });
  });

  it('keeps the current pending read export warm when post-release entries list is still pending', async () => {
    vi.useFakeTimers();
    const listStartMs = Date.parse('2026-06-07T08:00:00.000Z');
    vi.setSystemTime(new Date(listStartMs));
    try {
      const storageAdapter = createStorageAdapter({
        listEntries: vi.fn(async () => {
          vi.setSystemTime(new Date(listStartMs + 30_000));
          throw new Error('file_library_list_pending');
        }),
      });
      const deps = createDeps({ storageAdapter });
      const created = await createReadyLibrary(deps);
      const libraryId = String(created.id);
      await seedBoundTask({
        deps,
        libraryId,
        taskId: 'task_entries_pending_keeps_current_export',
        title: 'Entries pending keeps current export task',
      });
      let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
      deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
      deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
        runtimeBinding = null;
      });

      const entriesJson = vi.fn();
      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryEntries',
        method: 'GET',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: {
          url: '/file-libraries/entries?path=workspace%2F.artifacts',
          headers: { 'x-request-id': 'req_entries_pending_keep_current_export' },
        } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: entriesJson,
        readBody: vi.fn(),
      });

      expect(storageAdapter.listEntries).toHaveBeenCalledTimes(1);
      expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledTimes(2);
      expect(storageAdapter.invalidateListReadExport).toHaveBeenLastCalledWith(expect.objectContaining({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        createdBeforeOrAtMs: listStartMs,
        requestId: 'req_entries_pending_keep_current_export',
      }));
      expect(entriesJson).toHaveBeenCalledWith(expect.anything(), 409, {
        error_code: 'FILE_LIBRARY_OPERATION_PENDING',
        message: 'file_library_list_pending',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps entries pending without creating a stale export while slow idle runtime release continues in the background', async () => {
    const storageAdapter = createStorageAdapter({
      listEntries: vi.fn(async () => {
        throw new Error('file_library_list_pending');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_entries_pending_slow_release',
      title: 'Entries pending slow release task',
    });
    const releaseGate = createDeferred<void>();
    let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      await releaseGate.promise;
      runtimeBinding = null;
    });

    const entriesJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryEntries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        url: '/file-libraries/entries?path=workspace%2F.artifacts',
        headers: { 'x-request-id': 'req_entries_pending_slow_release' },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: entriesJson,
      readBody: vi.fn(),
    });

    expect(storageAdapter.listEntries).not.toHaveBeenCalled();
    expect(entriesJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_list_pending',
    });
    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      fileLibraryId: libraryId,
    });
    expect(storageAdapter.invalidateListReadExport).not.toHaveBeenCalled();

    releaseGate.resolve();
    await flushAsyncWork(10);
    expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      createdBeforeOrAtMs: expect.any(Number),
      requestId: 'req_entries_pending_slow_release',
    }));
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      bindingState: 'releasing',
      correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({
        beginCorrelationId: buildRuntimeAccessReleaseBeginCorrelationId({
          requestId: 'req_entries_pending_slow_release',
        }),
      }),
    });
  });

  it('continues release-pending entries runtime access in the background before invalidating read export', async () => {
    vi.useFakeTimers();
    try {
      const storageAdapter = createStorageAdapter({
        listEntries: vi.fn(async () => {
          throw new Error('file_library_list_pending');
        }),
      });
      const deps = createDeps({ storageAdapter });
      const created = await createReadyLibrary(deps);
      const libraryId = String(created.id);
      await seedBoundTask({
        deps,
        libraryId,
        taskId: 'task_entries_release_pending_background',
        title: 'Entries release pending background task',
      });
      let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
      deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
      deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
        runtimeBinding = {
          ...activeRuntimeBinding(libraryId),
          status: 'releasing',
          mount_binding_status: 'releasing',
        };
      });

      const entriesJson = vi.fn();
      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryEntries',
        method: 'GET',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: {
          url: '/file-libraries/entries?path=workspace%2F.artifacts',
          headers: { 'x-request-id': 'req_entries_release_pending_background' },
        } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: entriesJson,
        readBody: vi.fn(),
      });

      expect(entriesJson).toHaveBeenCalledWith(expect.anything(), 409, {
        error_code: 'FILE_LIBRARY_OPERATION_PENDING',
        message: 'file_library_list_pending',
      });
      expect(storageAdapter.invalidateListReadExport).not.toHaveBeenCalled();
      await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId: libraryId,
      })).resolves.toMatchObject({
        bindingState: 'releasing',
        correlationId: buildRuntimeAccessReleaseBeginCorrelationId({
          requestId: 'req_entries_release_pending_background',
        }),
      });

      for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
      }
      runtimeBinding = null;
      await vi.advanceTimersByTimeAsync(1_000);
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }

      expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledTimes(1);
      expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        createdBeforeOrAtMs: expect.any(Number),
        requestId: 'req_entries_release_pending_background',
      }));
      await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId: libraryId,
      })).resolves.toMatchObject({
        bindingState: 'releasing',
        correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({
          beginCorrelationId: buildRuntimeAccessReleaseBeginCorrelationId({
            requestId: 'req_entries_release_pending_background',
          }),
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues sandbox-unavailable entries runtime access in the background before invalidating read export', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const storageAdapter = createStorageAdapter({
        listEntries: vi.fn(async () => {
          throw new Error('file_library_list_pending');
        }),
      });
      const deps = createDeps({ storageAdapter });
      const created = await createReadyLibrary(deps);
      const libraryId = String(created.id);
      await seedBoundTask({
        deps,
        libraryId,
        taskId: 'task_entries_sandbox_release_pending_background',
        title: 'Entries sandbox release pending background task',
      });
      let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
      deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
      deps.internalAgentPodManager.releasePod = vi.fn()
        .mockRejectedValueOnce(Object.assign(
          new Error('asbcp_error: delete_pod 502 secret=raw-secret-token dependency failure'),
          {
            code: 'AGENT_SANDBOX_UNAVAILABLE',
            status: 502,
            operation: 'delete_pod',
            retryable: true,
            requestId: 'asbcp_req_entries_sandbox_release_pending',
          },
        ))
        .mockResolvedValue(undefined);
      deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
        runtimeBinding = null;
      });

      const entriesJson = vi.fn();
      await handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryEntries',
        method: 'GET',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: {
          url: '/file-libraries/entries?path=workspace%2F.artifacts',
          headers: { 'x-request-id': 'req_entries_sandbox_release_pending_background' },
        } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: entriesJson,
        readBody: vi.fn(),
      });

      expect(entriesJson).toHaveBeenCalledWith(expect.anything(), 409, {
        error_code: 'FILE_LIBRARY_OPERATION_PENDING',
        message: 'file_library_list_pending',
      });
      expect(storageAdapter.invalidateListReadExport).not.toHaveBeenCalled();
      expect(deps.internalAgentPodManager.releasePod).toHaveBeenCalledTimes(1);
      expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).not.toHaveBeenCalled();
      await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId: libraryId,
      })).resolves.toMatchObject({
        bindingState: 'releasing',
        correlationId: buildRuntimeAccessReleaseBeginCorrelationId({
          requestId: 'req_entries_sandbox_release_pending_background',
        }),
      });

      await vi.advanceTimersByTimeAsync(1_000);
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }

      expect(deps.internalAgentPodManager.releasePod).toHaveBeenCalledTimes(2);
      expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledTimes(1);
      expect(storageAdapter.invalidateListReadExport).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        createdBeforeOrAtMs: expect.any(Number),
        requestId: 'req_entries_sandbox_release_pending_background',
      }));
      await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId: libraryId,
      })).resolves.toMatchObject({
        bindingState: 'releasing',
        correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({
          beginCorrelationId: buildRuntimeAccessReleaseBeginCorrelationId({
            requestId: 'req_entries_sandbox_release_pending_background',
          }),
        }),
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toMatch(/raw-secret-token|secret=/);
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
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

  it('does not delete repo storage when workspace binding delete returns release-incomplete 409', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      throw Object.assign(
        new Error('asbcp_error: delete_workspace_binding 409 token=raw-binding-release-token release terminal fact missing'),
        {
          code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
          status: 409,
          operation: 'delete_workspace_binding',
          retryable: true,
          requestId: 'asbcp_req_binding_release_409',
        },
      );
    });
    const json = vi.fn();

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_delete_binding_release_409' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      fileLibraryId: libraryId,
    });
    expect(storageAdapter.deleteRepoForLibrary).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_RETRYABLE_INFRASTRUCTURE_CONFLICT',
      message: 'file_library_retryable_infrastructure_conflict',
      retryable: true,
      retry_after_ms: 2000,
    }));
    expect(JSON.stringify(json.mock.calls)).not.toContain('raw-binding-release-token');
    await expect(deps.docStore.get('project_file_libraries', libraryId)).resolves.toMatchObject({
      status: 'deleting',
      delete_correlation_id: 'req_delete_binding_release_409',
    });
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
      'fileLibraryRestore',
    ];

    for (const routeKind of cases) {
      const json = vi.fn();
      await expect(handleProjectFileLibraryRoutes({
        routeKind,
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId: 'flib_creating',
        req: routeKind === 'fileLibraryUpload'
          ? multipartUploadRequest()
          : { headers: { 'idempotency-key': `not-ready-${routeKind}` } } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json,
        readBody: vi.fn().mockResolvedValue(routeKind === 'fileLibraryDelete'
            ? { paths: ['docs/readme.txt'] }
            : routeKind === 'fileLibraryMove'
              ? { from_path: 'docs/readme.txt', to_path: 'docs/new.txt' }
              : routeKind === 'fileLibraryRestore'
                ? { save_point_id: 'flsp_before_restore' }
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
    expect(deps.fileLibraryStorageAdapter.restoreFileLibrary).not.toHaveBeenCalled();
  });

  it('admits product-safe save point creation as a version operation and filters template-source save points', async () => {
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
      req: {
        headers: {
          'x-request-id': 'req_save_point_create',
          'idempotency-key': 'save-point-create-key-1',
        },
      } as never,
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
      idempotencyKey: 'save-point-create-key-1',
      requestId: 'req_save_point_create',
    }));
    const createdBody = createJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(createdBody).toMatchObject({
      id: expect.stringMatching(/^flop_/),
      kind: 'save_point_create',
      file_library_id: libraryId,
      status: expect.stringMatching(/^(accepted|running|succeeded)$/),
      message: 'Before restore',
      created_at: expect.any(String),
      updated_at: expect.any(String),
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

  it('returns the public result_save_point_id when save point creation succeeds immediately', async () => {
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
      req: {
        headers: {
          'x-request-id': 'req_save_point_immediate_result',
          'idempotency-key': 'save-point-immediate-result-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before immediate result' }),
    })).resolves.toBe(true);

    const createdBody = createJson.mock.calls[0]?.[2] as { id?: string; result_save_point_id?: string };
    expect(createdBody).toMatchObject({
      id: expect.stringMatching(/^flop_/),
      result_save_point_id: expect.stringMatching(/^flsp_/),
    });
    expect(JSON.stringify(createdBody)).not.toMatch(/sp_user_|op_save_point_|repo_/);

    const lookupJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: createdBody.id,
      req: { headers: { 'x-request-id': 'req_save_point_immediate_result_lookup' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: lookupJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(lookupJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      id: createdBody.id,
      status: 'succeeded',
      result_save_point_id: createdBody.result_save_point_id,
    }));
  });

  it('rejects save point creation without Idempotency-Key before storage admission', async () => {
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
      req: { headers: { 'x-request-id': 'req_save_point_missing_idempotency' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    })).resolves.toBe(true);

    expect(createJson).toHaveBeenCalledWith(expect.anything(), 422, {
      error_code: 'VALIDATION_ERROR',
      message: 'idempotency_key_required',
    });
    expect(storageAdapter.createSavePoint).not.toHaveBeenCalled();
  });

  it('reuses the local save-point version operation for the same Idempotency-Key and matching message', async () => {
    const storageAdapter = createStorageAdapter({
      createSavePoint: vi.fn(async () => ({
        operationId: 'op_save_point_idempotent',
        operationStatus: 'pending',
        savePointId: null,
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const firstJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_save_point_idempotent_first',
          'idempotency-key': 'save-point-idempotent-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: firstJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    })).resolves.toBe(true);
    const secondJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_save_point_idempotent_second',
          'idempotency-key': 'save-point-idempotent-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: secondJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    })).resolves.toBe(true);

    const firstBody = firstJson.mock.calls[0]?.[2] as Record<string, unknown>;
    const secondBody = secondJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(secondBody).toEqual(firstBody);
    expect(secondBody).not.toHaveProperty('idempotency_key');
    expect(storageAdapter.createSavePoint).toHaveBeenCalledTimes(1);
    await expect(deps.docStore.list<Record<string, unknown>>(
      'project_file_library_version_operations',
      {
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        library_id: libraryId,
      },
    )).resolves.toEqual([
      expect.objectContaining({
        id: firstBody.id,
        idempotency_key: 'save-point-idempotent-key',
        afscp_operation_id: 'op_save_point_idempotent',
      }),
    ]);
  });

  it('rejects save point creation when the same Idempotency-Key is reused with a different message', async () => {
    const storageAdapter = createStorageAdapter({
      createSavePoint: vi.fn(async () => ({
        operationId: 'op_save_point_idempotent_conflict',
        operationStatus: 'pending',
        savePointId: null,
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const firstJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_save_point_idempotent_conflict_first',
          'idempotency-key': 'save-point-idempotent-conflict-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: firstJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before restore' }),
    })).resolves.toBe(true);

    const secondJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_save_point_idempotent_conflict_second',
          'idempotency-key': 'save-point-idempotent-conflict-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: secondJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Changed retry body' }),
    })).resolves.toBe(true);

    expect(secondJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_IDEMPOTENCY_CONFLICT',
      message: 'file_library_idempotency_conflict',
    });
    expect(storageAdapter.createSavePoint).toHaveBeenCalledTimes(1);
  });

  it('projects active save-point creation operations through the library active operation endpoint', async () => {
    const storageAdapter = createStorageAdapter({
      createSavePoint: vi.fn(async () => ({
        operationId: 'op_save_point_active',
        operationStatus: 'pending',
        savePointId: null,
      })),
      getOperationProjection: vi.fn(async () => ({
        operation_id: 'op_save_point_active',
        operation_state: 'running',
        operation_type: 'save_point_create',
        resource: { type: 'repo' },
        error: null,
        created_at: '2026-05-09T00:01:00.000Z',
        updated_at: '2026-05-09T00:01:02.000Z',
      })),
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
      req: {
        headers: {
          'x-request-id': 'req_save_point_active',
          'idempotency-key': 'save-point-active-key-1',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Before active projection' }),
    })).resolves.toBe(true);

    expect(createJson).toHaveBeenCalledWith(expect.anything(), 202, expect.objectContaining({
      id: expect.stringMatching(/^flop_/),
      kind: 'save_point_create',
      file_library_id: libraryId,
      status: 'accepted',
      message: 'Before active projection',
    }));
    const operationId = (createJson.mock.calls[0]?.[2] as { id?: string }).id;

    const activeJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_save_point_active_projection' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(storageAdapter.getOperationProjection).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      operationId: 'op_save_point_active',
      requestId: 'req_save_point_active_projection',
    }));
    expect(activeJson).toHaveBeenCalledWith(expect.anything(), 200, {
      operation: expect.objectContaining({
        id: operationId,
        kind: 'save_point_create',
        file_library_id: libraryId,
        status: 'running',
        message: 'Before active projection',
      }),
    });
    expect(JSON.stringify(activeJson.mock.calls[0]?.[2])).not.toMatch(/op_save_point_active|repo_/);
  });

  it('does not project completed save-point creation operations as permanently active', async () => {
    const storageAdapter = createStorageAdapter({
      createSavePoint: vi.fn(async () => ({
        operationId: 'op_save_point_terminal',
        operationStatus: 'pending',
        savePointId: null,
      })),
      getOperationProjection: vi.fn(async () => ({
        operation_id: 'op_save_point_terminal',
        operation_state: 'succeeded',
        operation_type: 'save_point_create',
        resource: { type: 'repo' },
        error: null,
        created_at: '2026-05-09T00:01:00.000Z',
        updated_at: '2026-05-09T00:01:02.000Z',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_save_point_terminal',
          'idempotency-key': 'save-point-terminal-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn().mockResolvedValue({ message: 'Before terminal projection' }),
    })).resolves.toBe(true);

    const activeJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_save_point_terminal_projection' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(activeJson).toHaveBeenCalledWith(expect.anything(), 200, { operation: null });
  });

  it('returns stable save point create blockers without exposing storage internals', async () => {
    for (const [message, errorCode] of [
      ['file_library_save_point_create_pending', 'FILE_LIBRARY_SAVE_POINT_OPERATION_PENDING'],
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
        req: {
          headers: {
            'x-request-id': 'req_save_point_blocker',
            'idempotency-key': `save-point-blocker-${message}`,
          },
        } as never,
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

  it('directly restores a save point with a required idempotency key and reuses the durable operation', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const secondSavePoint = await createSavePointForRestore({
      deps,
      libraryId,
      message: 'Before different restore',
    });

    const restoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_direct',
          'idempotency-key': 'restore-key-1',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    const restoreBody = restoreJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(restoreBody).toMatchObject({
      id: expect.stringMatching(/^flro_/),
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    });
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
      savePointId: expect.stringMatching(/^sp_user_/),
      idempotencyKey: 'restore-key-1',
      actorUserId: 'user_1',
      requestId: 'req_restore_direct',
    }));

    const repeatJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_direct_repeat',
          'idempotency-key': 'restore-key-1',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: repeatJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);
    expect(repeatJson.mock.calls[0]?.[2]).toMatchObject({
      id: restoreBody.id,
      status: 'restoring',
    });

    const conflictJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_direct_repeat_different_save_point',
          'idempotency-key': 'restore-key-1',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: conflictJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: secondSavePoint.id,
      }),
    })).resolves.toBe(true);
    expect(conflictJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_IDEMPOTENCY_CONFLICT',
      message: 'file_library_idempotency_conflict',
    });
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);

    const invisibleConflictJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_direct_repeat_invisible_save_point',
          'idempotency-key': 'restore-key-1',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: invisibleConflictJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: 'flsp_deleted_or_not_visible',
      }),
    })).resolves.toBe(true);
    expect(invisibleConflictJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_IDEMPOTENCY_CONFLICT',
      message: 'file_library_idempotency_conflict',
    });
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);

    const activeJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_get_active' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(activeJson.mock.calls[0]?.[2]).toMatchObject({
      operation: {
        id: restoreBody.id,
        kind: 'restore',
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'running',
      },
    });

    expect(JSON.stringify([restoreJson.mock.calls, repeatJson.mock.calls, activeJson.mock.calls]))
      .not.toMatch(/repo_|sp_user_|restore_op_|op_restore|ns_|plan_|credential|control_root/);
  });

  it('reuses one durable direct restore operation for concurrent matching idempotency keys', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({
      storageAdapter,
      docStore: new RestoreOperationRaceDocStore(),
    });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const makeRequest = (requestId: string, json: ReturnType<typeof vi.fn>) => handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': requestId,
          'idempotency-key': 'restore-key-concurrent',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    });
    const firstJson = vi.fn();
    const secondJson = vi.fn();

    await expect(Promise.all([
      makeRequest('req_restore_concurrent_1', firstJson),
      makeRequest('req_restore_concurrent_2', secondJson),
    ])).resolves.toEqual([true, true]);

    const firstBody = firstJson.mock.calls[0]?.[2] as Record<string, unknown>;
    const secondBody = secondJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(firstBody.id).toBe(secondBody.id);
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);
    await expect(deps.docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      { workspace_id: 'ws_default', project_id: 'proj_1', library_id: libraryId },
    )).resolves.toEqual([
      expect.objectContaining({
        id: firstBody.id,
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        idempotency_key: 'restore-key-concurrent',
      }),
    ]);
  });

  it('atomically rejects concurrent direct restores with different idempotency keys for the same library', async () => {
    const storageAdapter = createStorageAdapter();
    const docStore = new RestoreOperationDifferentKeyRaceDocStore();
    const deps = createDeps({
      storageAdapter,
      docStore,
    });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const makeRequest = (
      requestId: string,
      idempotencyKey: string,
      json: ReturnType<typeof vi.fn>,
    ) => handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': requestId,
          'idempotency-key': idempotencyKey,
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    });
    const firstJson = vi.fn();
    const secondJson = vi.fn();
    docStore.enableRestoreRace();

    await expect(Promise.all([
      makeRequest('req_restore_concurrent_key_a', 'restore-key-concurrent-a', firstJson),
      makeRequest('req_restore_concurrent_key_b', 'restore-key-concurrent-b', secondJson),
    ])).resolves.toEqual([true, true]);

    const responses = [firstJson, secondJson].map((json) => ({
      status: json.mock.calls[0]?.[1] as number,
      body: json.mock.calls[0]?.[2] as Record<string, unknown>,
    }));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const accepted = responses.find((response) => response.status === 200);
    const blocked = responses.find((response) => response.status === 409);
    expect(accepted?.body).toMatchObject({
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    });
    expect(blocked?.body).toMatchObject({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      operation_status: 'pending',
      retry_after_ms: 2000,
    });
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);
    await expect(deps.docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      { workspace_id: 'ws_default', project_id: 'proj_1', library_id: libraryId },
    )).resolves.toEqual([
      expect.objectContaining({
        id: accepted?.body.id,
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
      }),
    ]);
  });

  it('returns direct restore admission before storage restore reaches a terminal state', async () => {
    const storageResult = createDeferred<Awaited<ReturnType<FileLibraryStoragePort['restoreFileLibrary']>>>();
    const storageStarted = createDeferred<void>();
    let activeOperationSeenByStorage:
      | Awaited<ReturnType<JsonDocFileLibraryRestoreOperationRepo['findActiveByLibrary']>>
      | undefined;

    const restoreFileLibrary = vi.fn<FileLibraryStoragePort['restoreFileLibrary']>(async () => {
      activeOperationSeenByStorage = await new JsonDocFileLibraryRestoreOperationRepo(deps.docStore)
        .findActiveByLibrary('ws_default', 'proj_1', libraryId);
      storageStarted.resolve();
      return storageResult.promise;
    });
    const storageAdapter = createStorageAdapter({ restoreFileLibrary });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });

    const restoreJson = vi.fn();
    const restorePromise = handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_durable_timing',
          'idempotency-key': 'restore-key-durable-timing',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    });

    await storageStarted.promise;
    expect(activeOperationSeenByStorage).toMatchObject({
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
      idempotency_key: 'restore-key-durable-timing',
      created_by_user_id: 'user_1',
    });
    expect(activeOperationSeenByStorage?.afscp_operation_id).toBeNull();
    await expect(Promise.race([
      restorePromise.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
    ])).resolves.toBe('resolved');
    expect(restoreJson.mock.calls[0]?.[2]).toMatchObject({
      id: activeOperationSeenByStorage?.id,
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    });

    const activeJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_durable_refresh' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(activeJson.mock.calls[0]?.[2]).toMatchObject({
      operation: {
        id: activeOperationSeenByStorage?.id,
        kind: 'restore',
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'accepted',
      },
    });

    storageResult.resolve({
      operationId: 'op_restore_direct',
      operationStatus: 'succeeded',
      sourceSavePointId: 'sp_user_001',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(new JsonDocFileLibraryRestoreOperationRepo(deps.docStore).getById(
      'ws_default',
      'proj_1',
      libraryId,
      String(activeOperationSeenByStorage?.id),
    )).resolves.toMatchObject({
      id: activeOperationSeenByStorage?.id,
      status: 'succeeded',
    });

    const auditEvents = await deps.docStore.list<Record<string, unknown>>(
      auditEventsCollection('ws_default'),
      { workspace_id: 'ws_default', project_id: 'proj_1' },
    );
    expect(auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor_type: 'user',
        actor_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        action: 'project.file_library.restore.start',
        result: 'ok',
        resource_type: 'project_file_library',
        resource_id: libraryId,
        request_id: 'req_restore_durable_timing',
        metadata_json: {
          file_library_id: libraryId,
          source_save_point_id: savePoint.id,
          restore_operation_id: activeOperationSeenByStorage?.id,
          restore_operation_status: 'pending',
          final_result: 'started',
        },
      }),
      expect.objectContaining({
        actor_type: 'user',
        actor_id: 'user_1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        action: 'project.file_library.restore.succeeded',
        result: 'ok',
        resource_type: 'project_file_library',
        resource_id: libraryId,
        request_id: 'req_restore_durable_timing',
        metadata_json: {
          file_library_id: libraryId,
          source_save_point_id: savePoint.id,
          restore_operation_id: activeOperationSeenByStorage?.id,
          restore_operation_status: 'succeeded',
          final_result: 'succeeded',
        },
      }),
    ]));
    expect(JSON.stringify(auditEvents)).not.toMatch(/restore_op_|op_restore|repo_|sp_user_|ns_|plan_|credential|control_root/);
  });

  it('continues a pre-start direct restore idempotency replay when the local operation has no storage operation id', async () => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => ({
        operationId: 'op_restore_replayed_pending_start',
        operationStatus: 'pending',
        sourceSavePointId: 'sp_user_002',
      })),
      reconcileRestoreOperation: vi.fn(async () => ({
        operationId: 'op_restore_replayed_pending_start',
        operationStatus: 'succeeded',
        sourceSavePointId: 'sp_user_002',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_pre_start_replay',
      title: 'Restore pre-start replay task',
    });

    const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const beginCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
      requestId: 'req_release_before_restore_pre_start_replay',
    });
    await expect(bindingRepo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      correlationId: beginCorrelationId,
    })).resolves.toMatchObject({ ok: true });

    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    const pendingOperationResult = await restoreRepo.createOrReuseActiveByLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: null,
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_002',
      status: 'pending',
      idempotencyKey: 'restore-key-pre-start-replay',
      createdByUserId: OWNER_USER.id,
    });
    const pendingOperation = pendingOperationResult.operation;
    const restoreCorrelationId = buildRuntimeAccessRestoreStartedCorrelationId({
      operationId: pendingOperation.id,
    });
    await expect(bindingRepo.claimRuntimeAccessReleaseForRestore({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      releaseCorrelationId: beginCorrelationId,
      restoreCorrelationId,
    })).resolves.toMatchObject({ ok: true });
    await expect(restoreRepo.updateRuntimeAccessReleaseAssociation({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      operationId: pendingOperation.id,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      fenceCorrelationId: beginCorrelationId,
      restoreCorrelationId,
    })).resolves.toMatchObject({
      id: pendingOperation.id,
      afscp_operation_id: null,
      status: 'pending',
    });

    const replayJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_pre_start_replay',
          'idempotency-key': 'restore-key-pre-start-replay',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: replayJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(replayJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      id: pendingOperation.id,
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    }));
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      savePointId: 'sp_user_002',
      idempotencyKey: 'restore-key-pre-start-replay',
      actorUserId: OWNER_USER.id,
      requestId: 'req_restore_pre_start_replay',
    }));
    await expect(restoreRepo.getById(
      'ws_default',
      'proj_1',
      libraryId,
      pendingOperation.id,
    )).resolves.toMatchObject({
      id: pendingOperation.id,
      afscp_operation_id: 'op_restore_replayed_pending_start',
      status: 'restoring',
      runtime_access_release_restore_correlation_id: restoreCorrelationId,
    });

    const activeJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_pre_start_replay_get' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(storageAdapter.reconcileRestoreOperation).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
      operationId: 'op_restore_replayed_pending_start',
      requestId: 'req_restore_pre_start_replay_get',
    }));
    expect(activeJson).toHaveBeenCalledWith(expect.anything(), 200, {
      operation: expect.objectContaining({
        id: pendingOperation.id,
        kind: 'restore',
        status: 'succeeded',
      }),
    });
    await expect(bindingRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'bound',
      correlationId: expect.stringMatching(/^restore:.*:terminal:req_restore_pre_start_replay_get$/),
    });
  });

  it('continues a pre-start direct restore from the active operation projection when the local operation has no storage operation id', async () => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => ({
        operationId: 'op_restore_pre_start_get',
        operationStatus: 'succeeded',
        sourceSavePointId: 'sp_user_002',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    const pendingOperationResult = await restoreRepo.createOrReuseActiveByLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: null,
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_002',
      status: 'pending',
      idempotencyKey: 'restore-key-pre-start-get',
      createdByUserId: OWNER_USER.id,
    });
    const pendingOperation = pendingOperationResult.operation;

    const activeJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_pre_start_get' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(activeJson).toHaveBeenCalledWith(expect.anything(), 200, {
      operation: expect.objectContaining({
        id: pendingOperation.id,
        kind: 'restore',
        status: 'accepted',
      }),
    });
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      savePointId: 'sp_user_002',
      idempotencyKey: 'restore-key-pre-start-get',
      actorUserId: OWNER_USER.id,
      requestId: 'req_restore_pre_start_get',
    }));
    await expect(restoreRepo.getById(
      'ws_default',
      'proj_1',
      libraryId,
      pendingOperation.id,
    )).resolves.toMatchObject({
      id: pendingOperation.id,
      afscp_operation_id: 'op_restore_pre_start_get',
      status: 'succeeded',
    });
  });

  it('blocks pre-start restore idempotency replay when runtime access is reacquired before storage start', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    const pendingOperationResult = await restoreRepo.createOrReuseActiveByLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: null,
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_002',
      status: 'pending',
      idempotencyKey: 'restore-key-pre-start-active-writer',
      createdByUserId: OWNER_USER.id,
    });
    const pendingOperation = pendingOperationResult.operation;
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_reacquired_runtime_access',
      title: 'Restore reacquired runtime access task',
    });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => activeRuntimeBinding(libraryId));

    const replayJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_pre_start_active_writer_replay',
          'idempotency-key': 'restore-key-pre-start-active-writer',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: replayJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.restoreFileLibrary).not.toHaveBeenCalled();
    expect(replayJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: libraryId,
      blockers: [{ code: 'active_writer_sessions' }],
      bound_task_id: seededTask.taskId,
    }));
    await expect(restoreRepo.getById(
      'ws_default',
      'proj_1',
      libraryId,
      pendingOperation.id,
    )).resolves.toMatchObject({
      id: pendingOperation.id,
      afscp_operation_id: null,
      status: 'pending',
    });
  });

  it('lets runtime access release unblock a pre-start restore that is waiting on an active writer', async () => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => ({
        operationId: 'op_restore_after_release_pre_start_active_writer',
        operationStatus: 'pending',
        sourceSavePointId: 'sp_user_002',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    const pendingOperationResult = await restoreRepo.createOrReuseActiveByLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: null,
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_002',
      status: 'pending',
      idempotencyKey: 'restore-key-pre-start-release-active-writer',
      createdByUserId: OWNER_USER.id,
    });
    const pendingOperation = pendingOperationResult.operation;
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_release_active_writer',
      title: 'Restore release active writer task',
    });
    let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      runtimeBinding = null;
    });

    const blockedReplayJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_pre_start_release_active_writer_blocked',
          'idempotency-key': 'restore-key-pre-start-release-active-writer',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: blockedReplayJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);
    expect(blockedReplayJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      file_library_id: libraryId,
      bound_task_id: seededTask.taskId,
    }));
    expect(storageAdapter.restoreFileLibrary).not.toHaveBeenCalled();

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_for_pre_start_restore_active_writer' } } as never,
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

    const resumedReplayJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_pre_start_release_active_writer_resumed',
          'idempotency-key': 'restore-key-pre-start-release-active-writer',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: resumedReplayJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(resumedReplayJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      id: pendingOperation.id,
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    }));
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      savePointId: 'sp_user_002',
      idempotencyKey: 'restore-key-pre-start-release-active-writer',
      actorUserId: OWNER_USER.id,
      requestId: 'req_restore_pre_start_release_active_writer_resumed',
    }));
    await expect(restoreRepo.getById(
      'ws_default',
      'proj_1',
      libraryId,
      pendingOperation.id,
    )).resolves.toMatchObject({
      id: pendingOperation.id,
      afscp_operation_id: 'op_restore_after_release_pre_start_active_writer',
      runtime_access_release_task_id: seededTask.taskId,
      runtime_access_release_binding_generation: seededTask.bindingGeneration,
    });
  });

  it('keeps runtime access release fenced by a pre-start restore when no runtime writer needs release', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    await restoreRepo.createOrReuseActiveByLibrary({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: null,
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_002',
      status: 'pending',
      idempotencyKey: 'restore-key-pre-start-release-no-writer',
      createdByUserId: OWNER_USER.id,
    });
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_release_no_writer',
      title: 'Restore release no writer task',
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_for_pre_start_restore_no_writer' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
    }));
    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).not.toHaveBeenCalled();
  });

  it('fails direct restore validation without idempotency key or save point id', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const operationRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);

    const missingKeyJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_missing_key' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: missingKeyJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);
    expect(missingKeyJson).toHaveBeenCalledWith(expect.anything(), 422, {
      error_code: 'VALIDATION_ERROR',
      message: 'idempotency_key_required',
    });

    const missingSavePointJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_missing_save_point',
          'idempotency-key': 'restore-key-missing-save-point',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: missingSavePointJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);
    expect(missingSavePointJson).toHaveBeenCalledWith(expect.anything(), 400, {
      error_code: 'BAD_REQUEST',
      message: 'bad_request',
    });

    expect(storageAdapter.restoreFileLibrary).not.toHaveBeenCalled();
    await expect(operationRepo.findActiveByLibrary('ws_default', 'proj_1', libraryId)).resolves.toBeNull();
    await expect(deps.docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      { workspace_id: 'ws_default', project_id: 'proj_1', library_id: libraryId },
    )).resolves.toEqual([]);
  });

  it('projects a recent terminal direct restore when background restore succeeds before the next active poll', async () => {
    const reconcileRestoreOperation = vi.fn(async () => ({
      operationId: 'op_restore_direct',
      operationStatus: 'succeeded' as const,
      sourceSavePointId: 'sp_user_001',
    }));
    const storageAdapter = createStorageAdapter({ reconcileRestoreOperation });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });

    const restoreJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_terminal_post',
          'idempotency-key': 'restore-key-terminal',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    });
    await flushAsyncWork();

    const activeJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_terminal_get' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(reconcileRestoreOperation).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
      operationId: 'op_restore_direct',
      requestId: 'req_restore_terminal_get',
    }));
    expect(activeJson).toHaveBeenCalledWith(expect.anything(), 200, {
      operation: expect.objectContaining({
        kind: 'restore',
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'succeeded',
      }),
    });

    const activeVersionJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_terminal_active_version' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeVersionJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(activeVersionJson).toHaveBeenCalledWith(expect.anything(), 200, {
      operation: expect.objectContaining({
        kind: 'restore',
        status: 'succeeded',
      }),
    });
    await expect(new JsonDocFileLibraryRestoreOperationRepo(deps.docStore).findActiveByLibrary(
      'ws_default',
      'proj_1',
      libraryId,
    )).resolves.toBeNull();
  });

  it('writes last_restore into file library list and detail after restore terminal success', async () => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => ({
        operationId: 'op_restore_last_restore_success',
        operationStatus: 'succeeded',
        sourceSavePointId: 'sp_user_002',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({
      deps,
      libraryId,
      message: 'Before last restore',
    });

    const restoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_last_restore_success',
          'idempotency-key': 'restore-key-last-restore-success',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);
    await flushAsyncWork();

    const expectedLastRestore = {
      source_save_point_id: savePoint.id,
      source_save_point_label: 'Before last restore',
      source_save_point_created_at: savePoint.created_at,
      restored_at: expect.any(String),
      restore_operation_id: expect.stringMatching(/^flro_/),
    };

    const detailJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: detailJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(detailJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      id: libraryId,
      last_restore: expectedLastRestore,
    }));

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraries',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(listJson).toHaveBeenCalledWith(expect.anything(), 200, {
      items: [
        expect.objectContaining({
          id: libraryId,
          last_restore: expectedLastRestore,
        }),
      ],
    });

    const stored = await deps.docStore.get<Record<string, unknown>>('project_file_libraries', libraryId);
    expect(stored).toMatchObject({
      last_restored_save_point_id: savePoint.id,
      last_restored_save_point_label: 'Before last restore',
      last_restored_save_point_created_at: savePoint.created_at,
      last_restore_operation_id: expect.stringMatching(/^flro_/),
    });
    expect(stored).not.toHaveProperty('last_restore');
  });

  it.each([
    ['failed', 'failed'],
    ['recovery_required', 'recovery_required'],
    ['pending', 'pending'],
  ] as const)('does not overwrite last_restore when restore remains %s', async (_label, operationStatus) => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => ({
        operationId: `op_restore_last_restore_${operationStatus}`,
        operationStatus,
        sourceSavePointId: 'sp_user_002',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    await new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).recordSuccessfulRestore({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      sourceSavePointId: 'flsp_existing',
      sourceSavePointLabel: 'Existing restore',
      sourceSavePointCreatedAt: '2026-05-09T00:00:00.000Z',
      restoredAt: '2026-05-09T00:05:00.000Z',
      restoreOperationId: 'flro_444444444444444444444444',
    });

    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': `req_restore_last_restore_${operationStatus}`,
          'idempotency-key': `restore-key-last-restore-${operationStatus}`,
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: vi.fn(),
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);
    await flushAsyncWork();

    await expect(new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).getById(
      'ws_default',
      'proj_1',
      libraryId,
    )).resolves.toMatchObject({
      last_restore: {
        source_save_point_id: 'flsp_existing',
        source_save_point_label: 'Existing restore',
        source_save_point_created_at: '2026-05-09T00:00:00.000Z',
        restored_at: '2026-05-09T00:05:00.000Z',
        restore_operation_id: 'flro_444444444444444444444444',
      },
    });
  });

  it('does not project stale terminal direct restore operations as active history', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(
      deps.docStore,
      () => '2026-05-09T00:00:00.000Z',
    );
    await restoreRepo.create({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: 'op_restore_stale_terminal',
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_002',
      status: 'succeeded',
      idempotencyKey: 'restore-key-stale-terminal',
      createdByUserId: OWNER_USER.id,
    });

    const activeJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryActiveOperation',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_stale_terminal_active' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: activeJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(activeJson).toHaveBeenCalledWith(expect.anything(), 200, {
      operation: null,
    });
  });

  it('maps durable restore blockers without calling legacy preflight/admit restore', async () => {
    for (const restoreBlocker of [
      {
        name: 'storage_not_ready',
        errorMessage: 'file_library_project_storage_not_ready repo_hidden ns_hidden',
        statusCode: 409,
        errorCode: 'FILE_LIBRARY_STORAGE_NOT_READY',
        publicMessage: 'file_library_project_storage_not_ready',
      },
      {
        name: 'namespace_mismatch',
        errorMessage: 'file_library_namespace_project_mismatch repo_hidden ns_hidden',
        statusCode: 409,
        errorCode: 'FILE_LIBRARY_NAMESPACE_PROJECT_MISMATCH',
        publicMessage: 'file_library_namespace_project_mismatch',
      },
      {
        name: 'unsupported_capability',
        errorMessage: 'file_library_capability_denied repo_hidden ns_hidden',
        statusCode: 403,
        errorCode: 'FILE_LIBRARY_CAPABILITY_DENIED',
        publicMessage: 'file_library_capability_denied',
      },
    ] as const) {
      const storageAdapter = createStorageAdapter({
        restoreFileLibrary: vi.fn(async () => {
          throw new Error(restoreBlocker.errorMessage);
        }),
      });
      const deps = createDeps({ storageAdapter });
      const created = await createReadyLibrary(deps);
      const libraryId = String(created.id);
      const savePoint = await createSavePointForRestore({ deps, libraryId });

      const restoreJson = vi.fn();
      await expect(handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryRestore',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: {
          headers: {
            'x-request-id': `req_restore_${restoreBlocker.name}`,
            'idempotency-key': `restore-key-${restoreBlocker.name}`,
          },
        } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: restoreJson,
        readBody: vi.fn().mockResolvedValue({
          save_point_id: savePoint.id,
        }),
      })).resolves.toBe(true);

      expect(storageAdapter.preflightRestoreFileLibrary).not.toHaveBeenCalled();
      expect(storageAdapter.admitRestoreFileLibrary).not.toHaveBeenCalled();
      expect(restoreJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'pending',
      }));
      await flushAsyncWork();
      expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);
      expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledWith(expect.objectContaining({
        libraryId,
        savePointId: expect.stringMatching(/^sp_user_/),
        actorUserId: 'user_1',
        requestId: `req_restore_${restoreBlocker.name}`,
      }));
      const restoreRecords = await deps.docStore.list<Record<string, unknown>>(
        'project_file_library_restore_operations',
        { workspace_id: 'ws_default', project_id: 'proj_1', library_id: libraryId },
      );
      expect(restoreRecords).toEqual([
        expect.objectContaining({
          file_library_id: libraryId,
          source_save_point_id: savePoint.id,
          status: 'failed',
          idempotency_key: `restore-key-${restoreBlocker.name}`,
          created_by_user_id: 'user_1',
          failure_reason: restoreBlocker.publicMessage,
        }),
      ]);
      const auditEvents = await deps.docStore.list<Record<string, unknown>>(
        auditEventsCollection('ws_default'),
        { workspace_id: 'ws_default', project_id: 'proj_1' },
      );
      expect(auditEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: 'project.file_library.restore.start',
          result: 'ok',
        }),
        expect.objectContaining({
          action: 'project.file_library.restore.failed',
          result: 'error',
          error_code: restoreBlocker.errorCode,
          error_message: restoreBlocker.publicMessage,
        }),
      ]));
      expect(JSON.stringify(restoreJson.mock.calls)).not.toMatch(/repo_hidden|ns_hidden|credential|control_root/);
      expect(JSON.stringify([restoreRecords, auditEvents])).not.toMatch(/repo_hidden|ns_hidden|credential|control_root/);
    }
  });

  it('maps durable restore capability denial after save-point listing without legacy admit', async () => {
    const storageAdapter = createStorageAdapter({
      listSavePoints: vi.fn(async () => [
        {
          savePointId: 'sp_user_002',
          repoId: 'repo_flib_123',
          message: 'Before restore',
          createdAt: '2026-05-09T00:00:00.000Z',
        },
      ]),
      restoreFileLibrary: vi.fn(async () => {
        throw new Error('file_library_capability_denied repo_hidden ns_hidden direct restore disabled');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });

    const listJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_restore_list_success' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(listJson).toHaveBeenCalledWith(expect.anything(), 200, {
      items: [
        expect.objectContaining({
          id: savePoint.id,
          file_library_id: libraryId,
          message: 'Before restore',
        }),
      ],
    });

    const restoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_admit_capability_denied',
          'idempotency-key': 'restore-key-admit-capability-denied',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.preflightRestoreFileLibrary).not.toHaveBeenCalled();
    expect(storageAdapter.admitRestoreFileLibrary).not.toHaveBeenCalled();
    expect(restoreJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    }));
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
      savePointId: expect.stringMatching(/^sp_user_/),
      idempotencyKey: 'restore-key-admit-capability-denied',
      actorUserId: 'user_1',
      requestId: 'req_restore_admit_capability_denied',
    }));
    const restoreRecords = await deps.docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      { workspace_id: 'ws_default', project_id: 'proj_1', library_id: libraryId },
    );
    expect(restoreRecords).toEqual([
      expect.objectContaining({
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'failed',
        idempotency_key: 'restore-key-admit-capability-denied',
        created_by_user_id: 'user_1',
        failure_reason: 'file_library_capability_denied',
      }),
    ]);
    const auditEvents = await deps.docStore.list<Record<string, unknown>>(
      auditEventsCollection('ws_default'),
      { workspace_id: 'ws_default', project_id: 'proj_1' },
    );
    expect(auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'project.file_library.restore.start', result: 'ok' }),
      expect.objectContaining({
        action: 'project.file_library.restore.failed',
        result: 'error',
        error_code: 'FILE_LIBRARY_CAPABILITY_DENIED',
        error_message: 'file_library_capability_denied',
      }),
    ]));
    expect(JSON.stringify([restoreJson.mock.calls, restoreRecords, auditEvents]))
      .not.toMatch(/repo_hidden|ns_hidden|credential|control_root/);
  });

  it('marks post-start direct restore storage operation failures failed with sanitized audit records', async () => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => {
        throw new Error('file_library_restore_failed repo_hidden ns_hidden metadata_url=postgres://db');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });

    const restoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_storage_failure',
          'idempotency-key': 'restore-key-storage-failure',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.preflightRestoreFileLibrary).not.toHaveBeenCalled();
    expect(storageAdapter.admitRestoreFileLibrary).not.toHaveBeenCalled();
    expect(restoreJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    }));
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);
    const restoreRecords = await deps.docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      { workspace_id: 'ws_default', project_id: 'proj_1', library_id: libraryId },
    );
    expect(restoreRecords).toEqual([
      expect.objectContaining({
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'failed',
        idempotency_key: 'restore-key-storage-failure',
        created_by_user_id: 'user_1',
        failure_reason: 'file_library_restore_failed',
      }),
    ]);
    const failedOperation = restoreRecords[0];
    const auditEvents = await deps.docStore.list<Record<string, unknown>>(
      auditEventsCollection('ws_default'),
      { workspace_id: 'ws_default', project_id: 'proj_1' },
    );
    expect(auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor_type: 'user',
        actor_id: 'user_1',
        action: 'project.file_library.restore.start',
        result: 'ok',
        resource_type: 'project_file_library',
        resource_id: libraryId,
        request_id: 'req_restore_storage_failure',
        metadata_json: expect.objectContaining({
          file_library_id: libraryId,
          source_save_point_id: savePoint.id,
          restore_operation_id: failedOperation?.id,
          restore_operation_status: 'pending',
          final_result: 'started',
        }),
      }),
      expect.objectContaining({
        actor_type: 'user',
        actor_id: 'user_1',
        action: 'project.file_library.restore.failed',
        result: 'error',
        resource_type: 'project_file_library',
        resource_id: libraryId,
        request_id: 'req_restore_storage_failure',
        error_code: 'FILE_LIBRARY_RESTORE_FAILED',
        error_message: 'file_library_restore_failed',
        metadata_json: expect.objectContaining({
          file_library_id: libraryId,
          source_save_point_id: savePoint.id,
          restore_operation_id: failedOperation?.id,
          restore_operation_status: 'failed',
          final_result: 'failed',
          failure_category: 'file_library_restore_failed',
        }),
      }),
    ]));
    expect(JSON.stringify(restoreJson.mock.calls))
      .not.toMatch(/restore_op_|repo_hidden|ns_hidden|metadata_url|postgres|credential|control_root/);
    expect(JSON.stringify([restoreRecords, auditEvents]))
      .not.toMatch(/restore_op_|repo_hidden|ns_hidden|metadata_url|postgres|credential|control_root/);
  });

  it('rejects direct restore for a missing save point before storage or durable operation', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const notFoundJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_save_point_missing',
          'idempotency-key': 'restore-key-save-point-missing',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: notFoundJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: 'flsp_missing',
      }),
    })).resolves.toBe(true);
    expect(notFoundJson).toHaveBeenCalledWith(expect.anything(), 404, {
      error_code: 'FILE_LIBRARY_SAVE_POINT_NOT_FOUND',
      message: 'file_library_save_point_not_found',
    });
    expect(deps.fileLibraryStorageAdapter.restoreFileLibrary).not.toHaveBeenCalled();
    await expect(new JsonDocFileLibraryRestoreOperationRepo(deps.docStore).findActiveByLibrary(
      'ws_default',
      'proj_1',
      libraryId,
    )).resolves.toBeNull();
    await expect(deps.docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      { workspace_id: 'ws_default', project_id: 'proj_1', library_id: libraryId },
    )).resolves.toEqual([]);
  });

  it('blocks direct restore against active writers and redacts storage/runtime internals', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_active_writer',
      title: 'Restore active writer task',
    });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => activeRuntimeBinding(libraryId));

    const restoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_writer_blocked',
          'idempotency-key': 'restore-key-active-writer',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.restoreFileLibrary).not.toHaveBeenCalled();
    expect(restoreJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: libraryId,
      blockers: [{ code: 'active_writer_sessions' }],
      bound_task_visible: true,
      bound_task_id: 'task_restore_active_writer',
      bound_task_title: 'Restore active writer task',
      bound_task_status: 'active',
    });
    await expect(new JsonDocFileLibraryRestoreOperationRepo(deps.docStore).findActiveByLibrary(
      'ws_default',
      'proj_1',
      libraryId,
    )).resolves.toBeNull();
    await expect(deps.docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      { workspace_id: 'ws_default', project_id: 'proj_1', library_id: libraryId },
    )).resolves.toEqual([]);
    expect(JSON.stringify(restoreJson.mock.calls)).not.toMatch(
      new RegExp([`restore_${'preview'}_id`, 'repo_', 'ns_', 'wmb_', 'mount', 'credential', 'control_root'].join('|')),
    );
  });

  it.each([
    ['releasing', 'releasing'],
    ['release_pending', 'releasing'],
  ] as const)('blocks direct restore while local runtime binding is %s', async (runtimeStatus, mountStatus) => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: `task_restore_${runtimeStatus}`,
      title: `Restore ${runtimeStatus} task`,
    });
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      correlationId: `req_restore_${runtimeStatus}_begin`,
    })).resolves.toMatchObject({ ok: true });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => ({
      ...activeRuntimeBinding(libraryId),
      status: runtimeStatus,
      mount_binding_status: mountStatus,
      release_operation_id: `op_restore_${runtimeStatus}`,
    }));

    const restoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': `req_restore_${runtimeStatus}_blocked`,
          'idempotency-key': `restore-key-${runtimeStatus}`,
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.preflightRestoreFileLibrary).not.toHaveBeenCalled();
    expect(storageAdapter.restoreFileLibrary).not.toHaveBeenCalled();
    expect(restoreJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_ACTIVE_WRITER_BLOCKED',
      message: 'file_library_active_writer_blocked',
      file_library_id: libraryId,
      blockers: [{ code: 'active_writer_sessions' }],
      bound_task_visible: true,
      bound_task_id: seededTask.taskId,
      bound_task_status: 'active',
    }));
    await expect(new JsonDocFileLibraryRestoreOperationRepo(deps.docStore).findActiveByLibrary(
      'ws_default',
      'proj_1',
      libraryId,
    )).resolves.toBeNull();
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingState: 'releasing',
    });
    expect(JSON.stringify(restoreJson.mock.calls)).not.toMatch(/wmb_|ns_|repo_|mount|credential|control_root/);
  });

  it.each([
    ['releasing', 'released'],
    ['release_pending', 'released'],
  ] as const)('allows direct restore when local runtime binding is %s but mount status is %s', async (runtimeStatus, mountStatus) => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: `task_restore_${runtimeStatus}_terminal_mount`,
      title: `Restore ${runtimeStatus} terminal mount task`,
    });
    const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    await expect(bindingRepo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      correlationId: `req_restore_${runtimeStatus}_terminal_mount_begin`,
    })).resolves.toMatchObject({ ok: true });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => ({
      ...activeRuntimeBinding(libraryId),
      status: runtimeStatus,
      mount_binding_status: mountStatus,
      release_operation_id: `op_restore_${runtimeStatus}_terminal_mount`,
      drain_completed_at: '2026-05-09T12:00:00.000Z',
    }));

    const restoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': `req_restore_${runtimeStatus}_terminal_mount`,
          'idempotency-key': `restore-key-${runtimeStatus}-terminal-mount`,
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.preflightRestoreFileLibrary).not.toHaveBeenCalled();
    expect(storageAdapter.admitRestoreFileLibrary).not.toHaveBeenCalled();
    expect(restoreJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    }));
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledWith(expect.objectContaining({
      libraryId,
      savePointId: expect.stringMatching(/^sp_user_/),
      idempotencyKey: `restore-key-${runtimeStatus}-terminal-mount`,
      requestId: `req_restore_${runtimeStatus}_terminal_mount`,
    }));
    await expect(bindingRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: expect.stringMatching(/^restore:.*:started$/),
    });
    expect(JSON.stringify(restoreJson.mock.calls)).not.toMatch(/wmb_|ns_|repo_|mount|credential|control_root/);
  });

  it('blocks concurrent file-library mutations and template snapshots while direct restore is active', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const firstSavePoint = await createSavePointForRestore({ deps, libraryId, message: 'Before restore one' });
    const secondSavePoint = await createSavePointForRestore({ deps, libraryId, message: 'Before restore two' });

    const restoreJson = vi.fn();
    await handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_concurrent_active',
          'idempotency-key': 'restore-key-concurrent-active',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: firstSavePoint.id,
      }),
    });
    const savePointCreateCallsAfterSetup = vi.mocked(storageAdapter.createSavePoint).mock.calls.length;

    const sameSavePointJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_same_save_point_active',
          'idempotency-key': 'restore-key-concurrent-same-save-point',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: sameSavePointJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: firstSavePoint.id,
      }),
    })).resolves.toBe(true);
    expect(sameSavePointJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
      operation_status: 'pending',
      retry_after_ms: 2000,
    }));

    const differentSavePointJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_different_save_point_active',
          'idempotency-key': 'restore-key-concurrent-different-save-point',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: differentSavePointJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: secondSavePoint.id,
      }),
    })).resolves.toBe(true);
    expect(differentSavePointJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
      operation_status: 'pending',
      retry_after_ms: 2000,
    }));

    const createTemplateJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {
        headers: {
          'x-request-id': 'req_template_restore_active',
          'idempotency-key': 'template-key-restore-active',
        },
      } as never,
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
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
    }));
    expect(storageAdapter.createTemplateFromLibrary).not.toHaveBeenCalled();

    const savePointJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibrarySavePoints',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_save_point_restore_active',
          'idempotency-key': 'save-point-restore-active-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: savePointJson,
      readBody: vi.fn().mockResolvedValue({ message: 'Blocked save point' }),
    })).resolves.toBe(true);
    expect(savePointJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
    }));
    expect(storageAdapter.createSavePoint).toHaveBeenCalledTimes(savePointCreateCallsAfterSetup);

    const folderJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryFolders',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_folder_restore_active' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: folderJson,
      readBody: vi.fn().mockResolvedValue({ path: 'docs/blocked' }),
    })).resolves.toBe(true);
    expect(folderJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
    }));
    expect(storageAdapter.createFolder).not.toHaveBeenCalled();

    const fileObjectDeleteJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryDelete',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_file_object_delete_restore_active' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: fileObjectDeleteJson,
      readBody: vi.fn().mockResolvedValue({ paths: ['docs/readme.txt'] }),
    })).resolves.toBe(true);
    expect(fileObjectDeleteJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
    }));
    expect(storageAdapter.deletePaths).not.toHaveBeenCalled();

    const moveJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryMove',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_move_restore_active' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: moveJson,
      readBody: vi.fn().mockResolvedValue({
        from_path: 'docs/readme.txt',
        to_path: 'docs/renamed.txt',
      }),
    })).resolves.toBe(true);
    expect(moveJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
    }));
    expect(storageAdapter.moveEntry).not.toHaveBeenCalled();

    const uploadJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryUpload',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: multipartUploadRequest('blocked-upload.txt'),
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: uploadJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(uploadJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
    }));
    expect(storageAdapter.uploadObject).not.toHaveBeenCalled();

    const deleteJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'DELETE',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_delete_restore_active' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: deleteJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(deleteJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
    }));
    expect(storageAdapter.assertEmpty).not.toHaveBeenCalled();
    expect(storageAdapter.deleteRepoForLibrary).not.toHaveBeenCalled();

    const runtimeAccessReleaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_restore_active' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: runtimeAccessReleaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);
    expect(runtimeAccessReleaseJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_OPERATION_PENDING',
      message: 'file_library_restore_operation_active',
      file_library_id: libraryId,
    }));
    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).not.toHaveBeenCalled();

    expect(JSON.stringify([
      differentSavePointJson.mock.calls,
      createTemplateJson.mock.calls,
      savePointJson.mock.calls,
      folderJson.mock.calls,
      fileObjectDeleteJson.mock.calls,
      moveJson.mock.calls,
      uploadJson.mock.calls,
      deleteJson.mock.calls,
      runtimeAccessReleaseJson.mock.calls,
    ]))
      .not.toMatch(/restore_op_|op_restore|repo_|sp_user_|ns_|credential|control_root/);
  });

  it('does not call legacy restore preview/run/fence helpers on the direct restore route', () => {
    const routeSourcePath = [
      'packages/api-entry-node/src/project-file-library-routes.ts',
      'src/project-file-library-routes.ts',
    ].find((candidate) => existsSync(candidate));
    expect(routeSourcePath).toBeDefined();
    const source = readFileSync(routeSourcePath as string, 'utf8');
    const start = source.indexOf("routeKind === 'fileLibraryRestore'");
    const end = source.indexOf("routeKind === 'fileLibraryEntries'", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const directRestoreSlice = source.slice(start, end);
    expect(directRestoreSlice).not.toMatch(/createRestorePreview|runRestorePreview|discardRestorePreview|createRestorePreviewCurrentStateFence/);
  });

  it('releases file-library runtime access through the workspace binding manager', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
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
    expect(deps.internalAgentPodManager.releasePod).toHaveBeenCalledWith(
      'ws_default',
      'proj_1',
      'task-release-runtime-access',
    );
    expect(
      deps.internalAgentPodManager.releasePod.mock.invocationCallOrder[0],
    ).toBeLessThan(
      deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding.mock.invocationCallOrder[0],
    );
    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: true,
      runtime_access_status: 'released',
    });
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
    });
    const itemJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryItem',
      method: 'GET',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {} as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: itemJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
    });
    const releasedTask = await deps.docStore.get<Record<string, unknown>>(
      notebookTasksCollection('ws_default'),
      seededTask.taskId,
    );
    expect(releasedTask).toMatchObject({ id: seededTask.taskId });
    expect(JSON.stringify(releaseJson.mock.calls)).not.toMatch(/wmb_|ns_|repo_|mount|credential|control_root/);
  });

  it('maps ASBCP runtime workload release 409 to a retryable infrastructure conflict', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_runtime_asbcp_409',
      title: 'Release runtime ASBCP 409 task',
    });
    deps.internalAgentPodManager.releasePod = vi.fn(async () => {
      throw Object.assign(new Error('asbcp_error: delete_pod 409 secret=raw-secret-token release terminal truth missing'), {
        code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
        status: 409,
        operation: 'delete_pod',
        retryable: true,
        requestId: 'asbcp_req_file_runtime_release_409',
      });
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_file_runtime_release_409' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_RETRYABLE_INFRASTRUCTURE_CONFLICT',
      message: 'file_library_retryable_infrastructure_conflict',
      file_library_id: libraryId,
    }));
    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).not.toHaveBeenCalled();
    expect(JSON.stringify(releaseJson.mock.calls)).not.toMatch(
      /raw-secret-token|secret=|wmb_|ns_|repo_|mount|credential|control_root/,
    );
  });

  it('keeps the release fence pending when sandbox workload release is unavailable', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_runtime_sandbox_unavailable',
      title: 'Release runtime sandbox unavailable task',
    });
    deps.internalAgentPodManager.releasePod = vi.fn(async () => {
      throw Object.assign(new Error('asbcp_error: delete_pod 502 secret=raw-secret-token dependency failure'), {
        code: 'AGENT_SANDBOX_UNAVAILABLE',
        status: 502,
        operation: 'delete_pod',
        retryable: true,
        requestId: 'asbcp_req_file_runtime_release_502',
      });
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const releaseJson = vi.fn();
      await expect(handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryRuntimeAccessRelease',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: { headers: { 'x-request-id': 'req_file_runtime_release_502' } } as never,
        res: createMockResponse(),
        deps,
        user: OWNER_USER,
        json: releaseJson,
        readBody: vi.fn().mockResolvedValue({}),
      })).resolves.toBe(true);

      expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).not.toHaveBeenCalled();
      expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
        file_library_id: libraryId,
        released: false,
        runtime_access_status: 'release_pending',
      });
      await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId: libraryId,
      })).resolves.toMatchObject({
        taskId: seededTask.taskId,
        bindingGeneration: seededTask.bindingGeneration,
        bindingState: 'releasing',
        correlationId: buildRuntimeAccessReleaseBeginCorrelationId({
          requestId: 'req_file_runtime_release_502',
        }),
      });
      expect(JSON.stringify(releaseJson.mock.calls)).not.toMatch(
        /raw-secret-token|secret=|wmb_|ns_|repo_|mount|credential|control_root/,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[files] runtime_pending_readiness_failure %s',
        expect.stringContaining('"request_id":"release:begin:req_file_runtime_release_502"'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it.each(['ready', 'releasing', 'release_pending'] as const)(
    'treats %s runtime workspace records with terminal mount status as released',
    async (runtimeStatus) => {
      const deps = createDeps();
      const created = await createReadyLibrary(deps);
      const libraryId = String(created.id);
      const seededTask = await seedBoundTask({
        deps,
        libraryId,
        taskId: 'task_release_ready_terminal_mount',
        title: 'Release ready terminal mount task',
      });
      deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => ({
        ...activeRuntimeBinding(libraryId),
        status: runtimeStatus,
        mount_binding_status: 'released',
        release_operation_id: `op_${runtimeStatus}_terminal_mount_release`,
        drain_completed_at: '2026-05-09T12:00:00.000Z',
      }));

      const releaseJson = vi.fn();
      await expect(handleProjectFileLibraryRoutes({
        routeKind: 'fileLibraryRuntimeAccessRelease',
        method: 'POST',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        libraryId,
        req: { headers: { 'x-request-id': `req_${runtimeStatus}_terminal_mount_release` } } as never,
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
      await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId: libraryId,
      })).resolves.toMatchObject({
        taskId: seededTask.taskId,
        bindingGeneration: seededTask.bindingGeneration,
        bindingState: 'releasing',
        correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({
          beginCorrelationId: buildRuntimeAccessReleaseBeginCorrelationId({
            requestId: `req_${runtimeStatus}_terminal_mount_release`,
          }),
        }),
      });
    },
  );

  it('keeps the release fence when runtime workspace release is still pending', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_runtime_access_pending',
      title: 'Release runtime access pending task',
    });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => ({
      file_library_id: libraryId,
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      provider: 'afscp',
      task_home_binding_id: 'wmb_release_pending',
      afscp_mount_binding_id: 'wmb_release_pending',
      status: 'releasing',
      mount_binding_status: 'releasing',
      release_operation_id: 'op_release_pending',
      task_home_path: '/home/task_release_runtime_access_pending',
      workspace_path: '/home/task_release_runtime_access_pending/workspace',
      artifacts_path: '/home/task_release_runtime_access_pending/workspace/.artifacts',
      library_root_path: '.',
      created_at: '2026-05-09T00:00:00.000Z',
      updated_at: '2026-05-09T00:00:01.000Z',
    } satisfies InternalAgentWorkspaceBinding));

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
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
    });
  });

  it('converges a release-pending begin fence after sandbox-side release completes on a later request id', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_pending_converges',
      title: 'Release pending convergence task',
    });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn()
      .mockResolvedValueOnce({
        file_library_id: libraryId,
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        provider: 'afscp',
        task_home_binding_id: 'wmb_release_pending_converges',
        afscp_mount_binding_id: 'wmb_release_pending_converges',
        status: 'release_pending',
        mount_binding_status: 'releasing',
        release_operation_id: 'op_release_pending_converges',
        task_home_path: '/home/task_release_pending_converges',
        workspace_path: '/home/task_release_pending_converges/workspace',
        artifacts_path: '/home/task_release_pending_converges/workspace/.artifacts',
        library_root_path: '.',
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:01.000Z',
      } satisfies InternalAgentWorkspaceBinding)
      .mockResolvedValueOnce(null);

    const firstReleaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_runtime_access_release_pending_converges_first' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: firstReleaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);
    expect(firstReleaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: false,
      runtime_access_status: 'release_pending',
    });
    const beginCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
      requestId: 'req_runtime_access_release_pending_converges_first',
    });
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: beginCorrelationId,
    });

    const secondReleaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_runtime_access_release_pending_converges_second' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: secondReleaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledTimes(1);
    expect(secondReleaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: true,
      runtime_access_status: 'released',
    });
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({ beginCorrelationId }),
    });
  });

  it('retries runtime access release when a begin fence survives with an active runtime binding', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_begin_active_retry',
      title: 'Release begin active retry task',
    });
    const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const beginCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
      requestId: 'req_release_begin_crash_before_delete',
    });
    await expect(bindingRepo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      correlationId: beginCorrelationId,
    })).resolves.toMatchObject({ ok: true });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn()
      .mockResolvedValueOnce(activeRuntimeBinding(libraryId))
      .mockResolvedValueOnce(null);

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_begin_crash_converge' } } as never,
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
    await expect(bindingRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({ beginCorrelationId }),
    });
  });

  it('re-invokes runtime access release when a begin fence survives before a release operation is recorded', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_begin_releasing_retry',
      title: 'Release begin releasing retry task',
    });
    const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const beginCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
      requestId: 'req_release_begin_crash_after_releasing',
    });
    await expect(bindingRepo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      correlationId: beginCorrelationId,
    })).resolves.toMatchObject({ ok: true });
    let runtimeBinding: InternalAgentWorkspaceBinding | null = {
      ...activeRuntimeBinding(libraryId),
      status: 'releasing',
      mount_binding_status: 'releasing',
    };
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      runtimeBinding = null;
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_begin_releasing_converge' } } as never,
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
    await expect(bindingRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: buildRuntimeAccessReleaseCompleteCorrelationId({ beginCorrelationId }),
    });
  });

  it('keeps a begin fence pending when a releasing runtime binding already has a release operation', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_begin_releasing_operation_pending',
      title: 'Release begin releasing operation pending task',
    });
    const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const beginCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
      requestId: 'req_release_begin_releasing_operation_pending',
    });
    await expect(bindingRepo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      correlationId: beginCorrelationId,
    })).resolves.toMatchObject({ ok: true });
    const runtimeBinding: InternalAgentWorkspaceBinding = {
      ...activeRuntimeBinding(libraryId),
      status: 'releasing',
      mount_binding_status: 'releasing',
      release_operation_id: 'op_release_begin_releasing_operation_pending',
    };
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      throw new Error('unexpected runtime workspace release retry');
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_begin_releasing_operation_converge' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).not.toHaveBeenCalled();
    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: false,
      runtime_access_status: 'release_pending',
    });
    await expect(bindingRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: beginCorrelationId,
    });
  });

  it('does not let runtime release completion overwrite a restore-owned fence claim', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_complete_restore_claim',
      title: 'Release complete restore claim task',
    });
    const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const restoreCorrelationId = buildRuntimeAccessRestoreStartedCorrelationId({
      operationId: 'restore_op_release_complete_claim',
    });
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      const current = await bindingRepo.find({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId: libraryId,
      });
      if (!current) throw new Error('expected release fence to exist');
      await bindingRepo.claimRuntimeAccessReleaseForRestore({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        fileLibraryId: libraryId,
        taskId: seededTask.taskId,
        bindingGeneration: seededTask.bindingGeneration,
        releaseCorrelationId: current.correlationId,
        restoreCorrelationId,
      });
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_complete_restore_claim' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      file_library_id: libraryId,
    }));
    await expect(bindingRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: restoreCorrelationId,
    });
  });

  it('restores the runtime release fence to bound after direct restore reaches a terminal state', async () => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => ({
        operationId: 'op_restore_terminal_success',
        operationStatus: 'succeeded',
        sourceSavePointId: 'sp_user_002',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_restore_terminal',
      title: 'Release restore terminal task',
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_before_terminal_restore' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);
    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: true,
      runtime_access_status: 'released',
    });
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
    });

    const restoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_terminal_success',
          'idempotency-key': 'restore-key-terminal-success',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.preflightRestoreFileLibrary).not.toHaveBeenCalled();
    expect(storageAdapter.admitRestoreFileLibrary).not.toHaveBeenCalled();
    expect(restoreJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    }));
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      savePointId: expect.any(String),
      idempotencyKey: 'restore-key-terminal-success',
    }));
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'bound',
      correlationId: expect.stringMatching(/^restore:.*:terminal:req_restore_terminal_success$/),
    });
    await expect(deps.docStore.get(notebookTasksCollection('ws_default'), seededTask.taskId)).resolves.toMatchObject({
      workspace_file_library_id: libraryId,
      file_library_binding_generation: seededTask.bindingGeneration,
    });
  });

  it('reconciles a restore-started release fence when terminal restore association is missing', async () => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => {
        throw new Error('restore should be idempotency replayed');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_restore_missing_release_association',
      title: 'Restore missing release association task',
    });
    const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const beginCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
      requestId: 'release_begin_before_missing_association',
    });
    await expect(bindingRepo.beginRuntimeAccessRelease({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      correlationId: beginCorrelationId,
    })).resolves.toMatchObject({ ok: true });
    const operationId = 'restore_op_missing_release_association';
    const restoreCorrelationId = `${operationId}:restore_started`;
    await expect(bindingRepo.claimRuntimeAccessReleaseForRestore({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      releaseCorrelationId: beginCorrelationId,
      restoreCorrelationId,
    })).resolves.toMatchObject({ ok: true, claimed: true });
    const restoreRepo = new JsonDocFileLibraryRestoreOperationRepo(deps.docStore);
    const restoreOperation = await restoreRepo.create({
      id: operationId,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      afscpOperationId: 'op_restore_missing_release_association',
      sourceSavePointId: String(savePoint.id),
      sourceAfscpSavePointId: 'sp_user_002',
      status: 'succeeded',
      idempotencyKey: 'restore-key-missing-release-association',
      createdByUserId: OWNER_USER.id,
    });
    const publicOperationId = buildFileLibraryRestoreOperationPublicId(restoreOperation);

    const replayJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_missing_release_association_replay',
          'idempotency-key': 'restore-key-missing-release-association',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: replayJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.restoreFileLibrary).not.toHaveBeenCalled();
    expect(replayJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      id: publicOperationId,
      status: 'succeeded',
    }));
    await expect(bindingRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'bound',
    });
    await expect(restoreRepo.getById(
      'ws_default',
      'proj_1',
      libraryId,
      operationId,
    )).resolves.toMatchObject({
      runtime_access_release_task_id: seededTask.taskId,
      runtime_access_release_binding_generation: seededTask.bindingGeneration,
      runtime_access_release_restore_correlation_id: restoreCorrelationId,
    });
  });

  it('does not let an older terminal restore idempotency replay rollback a newer runtime release fence', async () => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => ({
        operationId: 'op_restore_old_terminal_success',
        operationStatus: 'succeeded',
        sourceSavePointId: 'sp_user_002',
      })),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });

    const oldRestoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_old_terminal_success',
          'idempotency-key': 'restore-key-old-terminal-success',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: oldRestoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);
    expect(oldRestoreJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      status: 'pending',
    }));
    await flushAsyncWork();

    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_newer_than_old_restore',
      title: 'Release newer than old restore task',
    });
    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_after_old_restore' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);
    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: true,
      runtime_access_status: 'released',
    });
    const releaseBeginCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
      requestId: 'req_release_after_old_restore',
    });
    const releaseCompleteCorrelationId = buildRuntimeAccessReleaseCompleteCorrelationId({
      beginCorrelationId: releaseBeginCorrelationId,
    });

    const replayJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_old_terminal_replay',
          'idempotency-key': 'restore-key-old-terminal-success',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: replayJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);
    expect(replayJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      status: 'succeeded',
    }));
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: releaseCompleteCorrelationId,
    });
  });

  it('does not let runtime release rollback reopen access after restore claims the fence', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_rollback_restore_claim',
      title: 'Release rollback restore claim task',
    });
    const bindingRepo = new JsonDocTaskFileLibraryBindingRepo(deps.docStore);
    const restoreCorrelationId = buildRuntimeAccessRestoreStartedCorrelationId({
      operationId: 'restore_op_release_rollback_claim',
    });
    let terminalChecks = 0;
    deps.notebookTerminalService.hasLiveSessionsForTask = vi.fn(async () => {
      terminalChecks += 1;
      if (terminalChecks === 2) {
        const current = await bindingRepo.find({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          fileLibraryId: libraryId,
        });
        if (!current) throw new Error('expected release fence to exist');
        await bindingRepo.claimRuntimeAccessReleaseForRestore({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          fileLibraryId: libraryId,
          taskId: seededTask.taskId,
          bindingGeneration: seededTask.bindingGeneration,
          releaseCorrelationId: current.correlationId,
          restoreCorrelationId,
        });
        return true;
      }
      return false;
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_rollback_restore_claim' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_BLOCKED',
      blockers: [{ code: 'active_terminal' }],
    }));
    await expect(bindingRepo.find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: restoreCorrelationId,
    });
  });

  it('rolls back a completed runtime release fence after durable restore capability denial', async () => {
    const storageAdapter = createStorageAdapter({
      restoreFileLibrary: vi.fn(async () => {
        throw new Error('file_library_capability_denied repo_hidden ns_hidden direct restore disabled');
      }),
    });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const savePoint = await createSavePointForRestore({ deps, libraryId });
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_before_restore_failure',
      title: 'Release before restore failure task',
    });
    let runtimeBinding: InternalAgentWorkspaceBinding | null = activeRuntimeBinding(libraryId);
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      runtimeBinding = {
        ...activeRuntimeBinding(libraryId),
        status: 'released',
        mount_binding_status: 'released',
        release_operation_id: 'op_release_before_restore_failure',
        drain_completed_at: '2026-05-09T12:00:00.000Z',
      };
    });
    deps.internalAgentWorkspaceBindingManager.findWorkspaceBinding = vi.fn(async () => runtimeBinding);

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_before_restore_failure' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);
    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: true,
      runtime_access_status: 'released',
    });
    const releaseBeginCorrelationId = buildRuntimeAccessReleaseBeginCorrelationId({
      requestId: 'req_release_before_restore_failure',
    });
    const releaseCompleteCorrelationId = buildRuntimeAccessReleaseCompleteCorrelationId({
      beginCorrelationId: releaseBeginCorrelationId,
    });
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'releasing',
      correlationId: releaseCompleteCorrelationId,
    });

    const restoreJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRestore',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: {
        headers: {
          'x-request-id': 'req_restore_failure_after_release',
          'idempotency-key': 'restore-key-failure-after-release',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: restoreJson,
      readBody: vi.fn().mockResolvedValue({
        save_point_id: savePoint.id,
      }),
    })).resolves.toBe(true);

    expect(storageAdapter.preflightRestoreFileLibrary).not.toHaveBeenCalled();
    expect(storageAdapter.admitRestoreFileLibrary).not.toHaveBeenCalled();
    expect(restoreJson).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      file_library_id: libraryId,
      source_save_point_id: savePoint.id,
      status: 'pending',
    }));
    await flushAsyncWork();
    expect(storageAdapter.restoreFileLibrary).toHaveBeenCalledTimes(1);
    await expect(deps.docStore.list<Record<string, unknown>>(
      'project_file_library_restore_operations',
      { workspace_id: 'ws_default', project_id: 'proj_1', library_id: libraryId },
    )).resolves.toEqual([
      expect.objectContaining({
        file_library_id: libraryId,
        source_save_point_id: savePoint.id,
        status: 'failed',
        idempotency_key: 'restore-key-failure-after-release',
        failure_reason: 'file_library_capability_denied',
      }),
    ]);
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'bound',
      correlationId: expect.stringMatching(/^restore:.*:terminal:req_restore_failure_after_release$/),
    });
    expect(runtimeBinding).toMatchObject({
      file_library_id: libraryId,
      status: 'released',
      mount_binding_status: 'released',
      release_operation_id: 'op_release_before_restore_failure',
    });
    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledTimes(1);
    expect(deps.internalAgentWorkspaceBindingManager.ensureWorkspaceBinding).not.toHaveBeenCalled();
    expect(JSON.stringify(restoreJson.mock.calls)).not.toMatch(/repo_hidden|ns_hidden|credential|control_root/);
  });

  it('rolls back the release fence when a hard blocker appears after admission', async () => {
    const deps = createDeps();
    deps.notebookTerminalService.hasLiveSessionsForTask = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_late_terminal',
      title: 'Release late terminal task',
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_late_terminal' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(deps.internalAgentPodManager.releasePod).toHaveBeenCalledWith(
      'ws_default',
      'proj_1',
      'task-release-late-terminal',
    );
    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).not.toHaveBeenCalled();
    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_BLOCKED',
      message: 'file_library_runtime_access_release_blocked',
      file_library_id: libraryId,
      blockers: [{ code: 'active_terminal' }],
      bound_task_id: seededTask.taskId,
    }));
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'bound',
    });
  });

  it('keeps runtime access release blocked when sandbox still reports active workloads', async () => {
    const deps = createDeps();
    deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      throw new Error('asbcp_runtime_error: delete_workspace_binding 409 {"error":"workspace binding has active workloads; delete workloads first: workload-task-active"}');
    });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_active_sandbox_workload',
      title: 'Release blocked by sandbox active workload',
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_active_sandbox_workload' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(deps.internalAgentPodManager.releasePod).toHaveBeenCalledWith(
      'ws_default',
      'proj_1',
      'task-release-active-sandbox-workload',
    );
    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 409, expect.objectContaining({
      error_code: 'FILE_LIBRARY_RUNTIME_ACCESS_RELEASE_BLOCKED',
      message: 'file_library_runtime_access_release_blocked',
      file_library_id: libraryId,
      blockers: [{ code: 'workspace_holder' }],
      bound_task_id: seededTask.taskId,
    }));
    await expect(new JsonDocTaskFileLibraryBindingRepo(deps.docStore).find({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      fileLibraryId: libraryId,
    })).resolves.toMatchObject({
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      bindingState: 'bound',
    });
  });

  it('releases residual task workspace holders for a completed task before releasing runtime access', async () => {
    const deps = createDeps();
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const seededTask = await seedBoundTask({
      deps,
      libraryId,
      taskId: 'task_release_residual_holder',
      title: 'Release residual holder task',
    });
    await new JsonDocTaskWorkspaceHolderRepo(deps.docStore).acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: seededTask.taskId,
      fileLibraryId: libraryId,
      taskHomeSegment: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
      holderId: 'holder_release_residual',
      holderKind: 'runner_workspace',
      leaseEpoch: 'lease_release_residual',
      issuedAt: '2026-05-09T00:00:00.000Z',
      expiresAt: '2999-05-09T00:00:00.000Z',
    });

    const releaseJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'fileLibraryRuntimeAccessRelease',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId,
      req: { headers: { 'x-request-id': 'req_release_residual_holder' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: releaseJson,
      readBody: vi.fn().mockResolvedValue({}),
    })).resolves.toBe(true);

    expect(deps.internalAgentPodManager.releasePod).toHaveBeenCalledWith(
      'ws_default',
      'proj_1',
      'task-release-residual-holder',
    );
    expect(deps.internalAgentWorkspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      fileLibraryId: libraryId,
    });
    expect(releaseJson).toHaveBeenCalledWith(expect.anything(), 200, {
      file_library_id: libraryId,
      released: true,
      runtime_access_status: 'released',
    });
    await expect(new JsonDocTaskWorkspaceHolderRepo(deps.docStore).listLiveByTask({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: seededTask.taskId,
      bindingGeneration: seededTask.bindingGeneration,
    })).resolves.toEqual([]);
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
    expect(deps.internalAgentPodManager.releasePod).not.toHaveBeenCalled();
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
      req: {
        headers: {
          'x-request-id': 'req_template_capability_denied',
          'idempotency-key': 'template-key-capability-denied',
        },
      } as never,
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

  it('requires an Idempotency-Key when creating a task file template', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);

    const createJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: { headers: { 'x-request-id': 'req_template_create_missing_idempotency' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: createJson,
      readBody: vi.fn().mockResolvedValue({
        name: 'Missing key template',
        source_library_id: String(created.id),
      }),
    })).resolves.toBe(true);

    expect(createJson).toHaveBeenCalledWith(expect.anything(), 422, {
      error_code: 'VALIDATION_ERROR',
      message: 'idempotency_key_required',
    });
    expect(storageAdapter.createTemplateFromLibrary).not.toHaveBeenCalled();
  });

  it('reuses a task file template create operation for the same source library and idempotency key', async () => {
    const createTemplateFromLibrary = vi.fn(async (input: Parameters<FileLibraryStoragePort['createTemplateFromLibrary']>[0]) => ({
      templateId: input.templateId,
      operationId: 'op_template_create_idempotent',
      operationStatus: 'succeeded' as const,
      sourceSavePointId: 'sp_template_source_idempotent',
    }));
    const storageAdapter = createStorageAdapter({ createTemplateFromLibrary });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const makeRequest = async (requestId: string, json: ReturnType<typeof vi.fn>) => handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {
        headers: {
          'x-request-id': requestId,
          'idempotency-key': 'template-create-key-1',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Idempotent template',
        source_library_id: libraryId,
      }),
    });

    const firstJson = vi.fn();
    const secondJson = vi.fn();
    await expect(makeRequest('req_template_create_idempotent_1', firstJson)).resolves.toBe(true);
    await expect(makeRequest('req_template_create_idempotent_2', secondJson)).resolves.toBe(true);

    const firstTemplate = firstJson.mock.calls[0]?.[2] as Record<string, unknown>;
    const secondTemplate = secondJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(secondTemplate).toEqual(firstTemplate);
    expect(createTemplateFromLibrary).toHaveBeenCalledTimes(1);
    await expect(new JsonDocProjectTaskFileTemplateRepo(deps.docStore).listByProject('ws_default', 'proj_1'))
      .resolves.toHaveLength(1);
    expect(JSON.stringify([firstTemplate, secondTemplate])).not.toMatch(/template-create-key-1|tmpl_|sp_template|repo_|credential|control_root/);
  });

  it('rejects a reused task file template create idempotency key when the request body changes', async () => {
    const createTemplateFromLibrary = vi.fn(async (input: Parameters<FileLibraryStoragePort['createTemplateFromLibrary']>[0]) => ({
      templateId: input.templateId,
      operationId: 'op_template_create_conflict_seed',
      operationStatus: 'succeeded' as const,
      sourceSavePointId: 'sp_template_source_conflict_seed',
    }));
    const storageAdapter = createStorageAdapter({ createTemplateFromLibrary });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const makeRequest = async (name: string, json: ReturnType<typeof vi.fn>) => handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {
        headers: {
          'x-request-id': `req_${name.replace(/\s+/g, '_').toLowerCase()}`,
          'idempotency-key': 'template-create-conflict-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name,
        source_library_id: libraryId,
      }),
    });

    const firstJson = vi.fn();
    const secondJson = vi.fn();
    await expect(makeRequest('Initial template', firstJson)).resolves.toBe(true);
    await expect(makeRequest('Changed template', secondJson)).resolves.toBe(true);

    expect(firstJson.mock.calls[0]?.[1]).toBe(201);
    expect(secondJson.mock.calls[0]?.[1]).toBe(409);
    expect(secondJson.mock.calls[0]?.[2]).toMatchObject({
      error_code: 'TASK_FILE_TEMPLATE_IDEMPOTENCY_CONFLICT',
      message: 'task_file_template_idempotency_conflict',
    });
    expect(createTemplateFromLibrary).toHaveBeenCalledTimes(1);
    await expect(new JsonDocProjectTaskFileTemplateRepo(deps.docStore).listByProject('ws_default', 'proj_1'))
      .resolves.toHaveLength(1);
  });

  it('creates and publishes a task file template as one idempotent product action', async () => {
    const createTemplateFromLibrary = vi.fn(async (input: Parameters<FileLibraryStoragePort['createTemplateFromLibrary']>[0]) => ({
      templateId: input.templateId,
      operationId: 'op_template_create_published_once',
      operationStatus: 'succeeded' as const,
      sourceSavePointId: 'sp_template_source_published_once',
    }));
    const storageAdapter = createStorageAdapter({ createTemplateFromLibrary });
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);

    const makeRequest = async (json: ReturnType<typeof vi.fn>) => handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplates',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      req: {
        headers: {
          'x-request-id': 'req_template_create_publish_once',
          'idempotency-key': 'template-create-publish-on-create-key',
        },
      } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Published starter',
        source_library_id: libraryId,
        publish_on_create: true,
      }),
    });

    const firstJson = vi.fn();
    const secondJson = vi.fn();
    await expect(makeRequest(firstJson)).resolves.toBe(true);
    await expect(makeRequest(secondJson)).resolves.toBe(true);

    expect(firstJson.mock.calls[0]?.[1]).toBe(201);
    expect(secondJson.mock.calls[0]?.[1]).toBe(200);
    expect(firstJson.mock.calls[0]?.[2]).toMatchObject({ status: 'published' });
    expect(secondJson.mock.calls[0]?.[2]).toEqual(firstJson.mock.calls[0]?.[2]);
    expect(createTemplateFromLibrary).toHaveBeenCalledTimes(1);
  });

  it('rejects publishing failed task file templates because their material must be saved again', async () => {
    const storageAdapter = createStorageAdapter();
    const deps = createDeps({ storageAdapter });
    const created = await createReadyLibrary(deps);
    const libraryId = String(created.id);
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const failedTemplate = await templateRepo.create({
      id: 'tftpl_failed_material',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      name: 'Failed material',
      status: 'failed',
      sourceLibraryId: libraryId,
      createdByUserId: OWNER_USER.id,
      afscpTemplateId: 'tmpl_failed_material',
    });

    const publishJson = vi.fn();
    await expect(handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplatePublish',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: failedTemplate.id,
      req: { headers: { 'x-request-id': 'req_template_publish_failed_material' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json: publishJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(publishJson).toHaveBeenCalledWith(expect.anything(), 409, {
      error_code: 'TASK_FILE_TEMPLATE_MATERIAL_NOT_READY',
      message: 'task_file_template_material_not_ready',
    });
    await expect(templateRepo.getById('ws_default', 'proj_1', failedTemplate.id))
      .resolves.toMatchObject({ status: 'failed' });
  });

  it('publishes an unpublished task file template without creating another source save point', async () => {
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
      req: {
        headers: {
          'x-request-id': 'req_template_create_draft',
          'idempotency-key': 'template-key-create-draft',
        },
      } as never,
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

    const publishRequest = async (json: ReturnType<typeof vi.fn>) => handleProjectFileLibraryRoutes({
      routeKind: 'taskFileTemplatePublish',
      method: 'POST',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskFileTemplateId: String(template.id),
      req: { headers: { 'x-request-id': 'req_template_publish_existing_snapshot' } } as never,
      res: createMockResponse(),
      deps,
      user: OWNER_USER,
      json,
      readBody: vi.fn(),
    });

    const publishJson = vi.fn();
    const replayJson = vi.fn();
    await expect(publishRequest(publishJson)).resolves.toBe(true);
    await expect(publishRequest(replayJson)).resolves.toBe(true);

    expect(createTemplateFromLibrary).toHaveBeenCalledTimes(1);
    const updatedInternal = await templateRepo.getById('ws_default', 'proj_1', String(template.id));
    expect(updatedInternal).toMatchObject({
      status: 'published',
      source_afscp_save_point_id: 'sp_template_source_1',
      afscp_create_operation_id: 'op_template_create_1',
    });
    expect(updatedInternal?.source_save_point_id).toEqual(expect.stringMatching(/^flsp_/));
    expect(updatedInternal?.source_save_point_id).toBe(initialInternal?.source_save_point_id);
    expect(updatedInternal?.afscp_template_id).toBe(initialInternal?.afscp_template_id);

    expect(publishJson.mock.calls[0]?.[2]).toMatchObject({
      id: template.id,
      status: 'published',
      source_save_point_id: updatedInternal?.source_save_point_id,
    });
    expect(replayJson.mock.calls[0]?.[2]).toEqual(publishJson.mock.calls[0]?.[2]);
    expect(JSON.stringify(publishJson.mock.calls)).not.toMatch(/tmpl_|sp_template_source|repo_|credential|control_root/);

    vi.mocked(storageAdapter.listSavePoints).mockResolvedValueOnce([
      {
        savePointId: 'sp_template_source_1',
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
      req: {
        headers: {
          'x-request-id': 'req_template_create',
          'idempotency-key': 'template-key-create-release',
        },
      } as never,
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
