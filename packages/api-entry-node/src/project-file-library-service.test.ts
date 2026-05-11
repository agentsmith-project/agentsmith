import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { describe, expect, it, vi } from 'vitest';
import type { NodeApiDeps } from './node-api-deps.js';
import type { FileLibraryStoragePort } from './file-library-afscp-storage.js';
import type { ProjectStoragePreflightResult } from './project-storage-bootstrap-service.js';
import {
  createAndProvisionProjectFileLibrary,
} from './project-file-library-service.js';

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

function createDeps(input: {
  ensureProjectStorageReady: NodeApiDeps['projectStorageBootstrapService']['ensureProjectStorageReady'];
  createRepoForLibrary?: FileLibraryStoragePort['createRepoForLibrary'];
}): Pick<NodeApiDeps, 'docStore' | 'fileLibraryStorageAdapter' | 'projectStorageBootstrapService'> {
  const createRepoForLibrary = input.createRepoForLibrary ?? vi.fn(async (repoInput) => ({
    namespaceId: repoInput.namespaceId,
    repoId: `repo_${repoInput.libraryId}`,
    operationId: `op_${repoInput.libraryId}`,
    operationStatus: 'succeeded' as const,
    projectStorageGeneration: repoInput.projectStorageGeneration,
  }));
  return {
    docStore: new InMemoryJsonDocStore(),
    fileLibraryStorageAdapter: {
      enabled: true,
      createRepoForLibrary,
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
});
