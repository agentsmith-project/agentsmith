import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { describe, expect, it, vi } from 'vitest';
import type { NodeApiDeps } from './node-api-deps.js';
import type { FileLibraryStoragePort } from './file-library-afscp-storage.js';
import type { ProjectStoragePreflightResult } from './project-storage-bootstrap-service.js';
import {
  DEFAULT_FILE_LIBRARY_PROJECT_STORAGE_READY_WAIT,
  createAndCloneTaskFileTemplateLibrary,
  createAndProvisionProjectFileLibrary,
  mapFileLibraryInfraError,
} from './project-file-library-service.js';
import type { TaskFileTemplateRecord } from './file-library-persistence.js';

function pendingProjectStorage(stage: 'namespace_upsert' | 'volume_binding' = 'namespace_upsert'): ProjectStoragePreflightResult {
  return {
    status: 'pending',
    stage,
    generation: 1,
    nextAction: 'wait',
    retryable: false,
    lastErrorCode: null,
  };
}

function readyProjectStorage(namespaceId = 'ns_project_1'): ProjectStoragePreflightResult {
  return {
    status: 'ready',
    namespaceId,
    stage: 'ready',
    generation: 1,
    nextAction: 'none',
    retryable: false,
    lastErrorCode: null,
  };
}

function templateRecord(): TaskFileTemplateRecord {
  return {
    id: 'tftpl_waited_clone',
    workspace_id: 'ws_default',
    project_id: 'proj_1',
    name: 'Waited template',
    status: 'published',
    source_library_id: 'flib_source_template',
    created_by_user_id: 'user_1',
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    afscp_template_id: 'tmpl_waited_clone',
  };
}

function createDeps(input: {
  ensureProjectStorageReady: NodeApiDeps['projectStorageBootstrapService']['ensureProjectStorageReady'];
  createRepoForLibrary?: FileLibraryStoragePort['createRepoForLibrary'];
  cloneTemplateToLibrary?: FileLibraryStoragePort['cloneTemplateToLibrary'];
}): Pick<NodeApiDeps, 'docStore' | 'fileLibraryStorageAdapter' | 'projectStorageBootstrapService'> {
  const createRepoForLibrary = input.createRepoForLibrary ?? vi.fn(async (repoInput) => ({
    namespaceId: repoInput.namespaceId,
    repoId: `repo_${repoInput.libraryId}`,
    operationId: `op_${repoInput.libraryId}`,
    operationStatus: 'succeeded' as const,
    projectStorageGeneration: repoInput.projectStorageGeneration,
  }));
  const cloneTemplateToLibrary = input.cloneTemplateToLibrary ?? vi.fn<FileLibraryStoragePort['cloneTemplateToLibrary']>(async (cloneInput) => ({
    namespaceId: cloneInput.namespaceId,
    repoId: `repo_${cloneInput.libraryId}`,
    operationId: `op_${cloneInput.libraryId}_template_clone`,
    operationStatus: 'succeeded' as const,
    projectStorageGeneration: cloneInput.projectStorageGeneration,
  }));
  return {
    docStore: new InMemoryJsonDocStore(),
    fileLibraryStorageAdapter: {
      enabled: true,
      createRepoForLibrary,
      cloneTemplateToLibrary,
    } as FileLibraryStoragePort,
    projectStorageBootstrapService: {
      enabled: true,
      bootstrapProjectStorage: vi.fn(async () => undefined),
      reconcileProjectStorage: vi.fn(async () => undefined),
      ensureProjectStorageReady: input.ensureProjectStorageReady,
    },
  };
}

describe('project file library service storage readiness wait', () => {
  it('maps sandbox rate limiting to retryable runtime readiness conflict', () => {
    expect(mapFileLibraryInfraError(Object.assign(new Error('rate limited'), {
      code: 'AGENT_SANDBOX_RATE_LIMITED',
      status: 429,
      retryable: true,
    }))).toEqual({
      statusCode: 409,
      errorCode: 'FILE_LIBRARY_RETRYABLE_INFRASTRUCTURE_CONFLICT',
      message: 'file_library_retryable_infrastructure_conflict',
      context: {
        retryable: true,
        retry_after_ms: 2_000,
      },
    });
  });

  it('maps AFSCP revoke idempotency conflict to retryable runtime readiness conflict', () => {
    expect(mapFileLibraryInfraError(Object.assign(new Error('afscp revoke conflict'), {
      code: 'AGENT_WORKSPACE_AFSCP_ERROR',
      statusCode: 409,
      retryable: false,
      metadata: {
        afscp_error: {
          status: 409,
          code: 'conflict',
          retryable: false,
          correlation_id: 'req_runtime_revoke_conflict',
        },
      },
    }))).toEqual({
      statusCode: 409,
      errorCode: 'FILE_LIBRARY_RETRYABLE_INFRASTRUCTURE_CONFLICT',
      message: 'file_library_retryable_infrastructure_conflict',
      context: {
        retryable: true,
        retry_after_ms: 2_000,
      },
    });
  });

  it('uses a bounded cold-bootstrap wait budget above the e2e request default', () => {
    expect(DEFAULT_FILE_LIBRARY_PROJECT_STORAGE_READY_WAIT).toMatchObject({
      timeoutMs: 45_000,
      intervalMs: 250,
    });
  });

  it('counts the initial ensure call against the strict project storage wait deadline', async () => {
    let nowMs = 1_000;
    const ensureProjectStorageReady = vi.fn(async () => {
      nowMs += 20_000;
      return pendingProjectStorage();
    });
    const createRepoForLibrary = vi.fn<FileLibraryStoragePort['createRepoForLibrary']>();
    const deps = createDeps({ ensureProjectStorageReady, createRepoForLibrary });

    await expect(createAndProvisionProjectFileLibrary({
      deps: deps as NodeApiDeps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      userId: 'user_1',
      name: 'Task Files',
      requestId: 'req_deadline',
      projectStorageReadyWait: {
        timeoutMs: 15_000,
        intervalMs: 250,
        now: () => nowMs,
        sleep: vi.fn(async () => undefined),
      },
    })).rejects.toMatchObject({
      name: 'FileLibraryProjectStorageNotReadyError',
      message: 'project_storage_pending',
    });

    expect(ensureProjectStorageReady).toHaveBeenCalledTimes(1);
    expect(createRepoForLibrary).not.toHaveBeenCalled();
    await expect(deps.docStore.list('project_file_libraries')).resolves.toEqual([]);
  });

  it('honors abort signals during project storage wait without creating a half-provisioned library', async () => {
    let nowMs = 1_000;
    const abortController = new AbortController();
    const ensureProjectStorageReady = vi.fn(async () => pendingProjectStorage('volume_binding'));
    const createRepoForLibrary = vi.fn<FileLibraryStoragePort['createRepoForLibrary']>();
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
      abortController.abort();
    });
    const deps = createDeps({ ensureProjectStorageReady, createRepoForLibrary });

    await expect(createAndProvisionProjectFileLibrary({
      deps: deps as NodeApiDeps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      userId: 'user_1',
      name: 'Task Files',
      requestId: 'req_abort',
      projectStorageReadyWait: {
        timeoutMs: 15_000,
        intervalMs: 250,
        signal: abortController.signal,
        now: () => nowMs,
        sleep,
      },
    })).rejects.toMatchObject({
      name: 'FileLibraryProjectStorageNotReadyError',
      message: 'project_storage_pending',
    });

    expect(ensureProjectStorageReady).toHaveBeenCalledTimes(1);
    expect(createRepoForLibrary).not.toHaveBeenCalled();
    await expect(deps.docStore.list('project_file_libraries')).resolves.toEqual([]);
  });

  it('waits for project storage readiness before cloning a task file template library', async () => {
    let nowMs = 1_000;
    const ensureProjectStorageReady = vi.fn()
      .mockResolvedValueOnce(pendingProjectStorage('namespace_upsert'))
      .mockResolvedValueOnce(readyProjectStorage('ns_waited_clone'));
    const cloneTemplateToLibrary = vi.fn<FileLibraryStoragePort['cloneTemplateToLibrary']>(async (input) => ({
      namespaceId: input.namespaceId,
      repoId: `repo_${input.libraryId}`,
      operationId: `op_${input.libraryId}_template_clone`,
      operationStatus: 'succeeded' as const,
      projectStorageGeneration: input.projectStorageGeneration,
    }));
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });
    const deps = createDeps({ ensureProjectStorageReady, cloneTemplateToLibrary });

    const created = await createAndCloneTaskFileTemplateLibrary({
      deps: deps as NodeApiDeps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      userId: 'user_1',
      template: templateRecord(),
      name: 'Template workspace',
      requestId: 'req_clone_wait',
      projectStorageReadyWait: {
        timeoutMs: 15_000,
        intervalMs: 250,
        now: () => nowMs,
        sleep,
      },
    });

    expect(created).toMatchObject({
      name: 'Template workspace',
      status: 'ready',
    });
    expect(ensureProjectStorageReady).toHaveBeenCalledTimes(2);
    expect(cloneTemplateToLibrary).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_waited_clone',
      templateId: 'tmpl_waited_clone',
      projectStorageGeneration: 1,
    }));
  });

  it('does not create a template clone library when bounded project storage wait times out', async () => {
    let nowMs = 1_000;
    const ensureProjectStorageReady = vi.fn(async () => pendingProjectStorage('namespace_upsert'));
    const cloneTemplateToLibrary = vi.fn<FileLibraryStoragePort['cloneTemplateToLibrary']>();
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });
    const deps = createDeps({ ensureProjectStorageReady, cloneTemplateToLibrary });

    await expect(createAndCloneTaskFileTemplateLibrary({
      deps: deps as NodeApiDeps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      userId: 'user_1',
      template: templateRecord(),
      name: 'Timed out template workspace',
      requestId: 'req_clone_timeout',
      projectStorageReadyWait: {
        timeoutMs: 500,
        intervalMs: 250,
        now: () => nowMs,
        sleep,
      },
    })).rejects.toMatchObject({
      name: 'FileLibraryProjectStorageNotReadyError',
      message: 'project_storage_pending',
    });

    expect(cloneTemplateToLibrary).not.toHaveBeenCalled();
    await expect(deps.docStore.list('project_file_libraries')).resolves.toEqual([]);
  });
});
