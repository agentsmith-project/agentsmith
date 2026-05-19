import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { describe, expect, it, vi } from 'vitest';
import {
  buildFileLibraryRecord,
  JsonDocProjectFileLibraryCatalogRepo,
} from './file-library-persistence.js';
import type { FileLibraryStoragePort } from './file-library-afscp-storage.js';
import type { InternalAgentWorkspaceBindingManager } from './internal-agent-workspace-provisioner.js';
import { JsonDocTaskWorkspaceHolderRepo } from './notebook-task/task-file-library-bindings.js';
import {
  ProjectAfscpNamespaceStore,
} from './project-afscp-namespace-store.js';
import { ProjectStorageLifecycleService } from './project-storage-lifecycle-service.js';

function createStorageAdapter(overrides: Partial<FileLibraryStoragePort> = {}): FileLibraryStoragePort {
  return {
    enabled: true,
    deleteRepoForLibrary: vi.fn(async () => undefined),
    createRepoForLibrary: vi.fn(),
    getOperationProjection: vi.fn(),
    assertEmpty: vi.fn(),
    listSavePoints: vi.fn(),
    createSavePoint: vi.fn(),
    restoreFileLibrary: vi.fn(),
    reconcileRestoreOperation: vi.fn(),
    createTemplateFromLibrary: vi.fn(),
    cloneTemplateToLibrary: vi.fn(),
    reconcileLibraryProvisioning: vi.fn(),
    listEntries: vi.fn(),
    createFolder: vi.fn(),
    deletePaths: vi.fn(),
    moveEntry: vi.fn(),
    uploadObject: vi.fn(),
    downloadObject: vi.fn(),
    getObjectMeta: vi.fn(),
    ...overrides,
  } as FileLibraryStoragePort;
}

function createWorkspaceBindingManager(): InternalAgentWorkspaceBindingManager {
  return {
    ensureWorkspaceBinding: vi.fn(),
    deleteWorkspaceBinding: vi.fn(async () => undefined),
  } as InternalAgentWorkspaceBindingManager;
}

async function seedReadyLibrary(input: {
  docStore: InMemoryJsonDocStore;
  workspaceId?: string;
  projectId?: string;
  libraryId?: string;
}): Promise<void> {
  await new JsonDocProjectFileLibraryCatalogRepo(input.docStore).save(buildFileLibraryRecord({
    id: input.libraryId ?? 'flib_123',
    workspaceId: input.workspaceId ?? 'ws_default',
    projectId: input.projectId ?? 'proj_1',
    name: 'Shared Docs',
    createdByUserId: 'user_owner',
  }));
  await new JsonDocProjectFileLibraryCatalogRepo(input.docStore).update(
    input.workspaceId ?? 'ws_default',
    input.projectId ?? 'proj_1',
    input.libraryId ?? 'flib_123',
    { status: 'ready' },
  );
}

describe('ProjectStorageLifecycleService', () => {
  it('blocks project storage, releases bindings and sessions, deletes repos, and tombstones the namespace mapping', async () => {
    const docStore = new InMemoryJsonDocStore();
    const namespaceStore = new ProjectAfscpNamespaceStore(docStore, () => '2026-05-09T00:00:00.000Z');
    await namespaceStore.markProjectNamespaceReady({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      namespaceUpsertOperationId: 'op_namespace_ready',
      volumeBindingOperationId: 'op_binding_ready',
    });
    await seedReadyLibrary({ docStore });
    await new JsonDocTaskWorkspaceHolderRepo(docStore).acquire({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      fileLibraryId: 'flib_123',
      taskHomeSegment: 'taskhome_1',
      bindingGeneration: 1,
      holderId: 'holder_1',
      holderKind: 'runner_workspace',
      leaseEpoch: 'lease_1',
      issuedAt: '2026-05-09T00:00:00.000Z',
      expiresAt: '2026-05-09T01:00:00.000Z',
    });
    const storageAdapter = createStorageAdapter();
    const workspaceBindingManager = createWorkspaceBindingManager();
    const service = new ProjectStorageLifecycleService({
      docStore,
      namespaceStore,
      fileLibraryStorageAdapter: storageAdapter,
      internalAgentWorkspaceBindingManager: workspaceBindingManager,
      nowIso: () => '2026-05-09T00:00:10.000Z',
    });

    await expect(service.beginProjectStorageTeardown({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'user_owner',
      requestId: 'req_project_delete',
      reason: 'project_delete',
    })).resolves.toMatchObject({
      status: 'tombstoned',
      deletedRepositories: 1,
      releasedMountBindings: 1,
      drainedSessions: 1,
    });

    expect(storageAdapter.deleteRepoForLibrary).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      libraryId: 'flib_123',
      actorUserId: 'user_owner',
      requestId: 'req_project_delete',
      reason: 'project_delete',
    }));
    expect(workspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      fileLibraryId: 'flib_123',
    });
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    })).resolves.toMatchObject({
      status: 'tombstoned',
      stage: 'tombstoned',
      generation: 2,
      next_action: 'none',
      retryable: false,
      last_error_code: 'project_storage_tombstoned',
    });
    await expect(new JsonDocProjectFileLibraryCatalogRepo(docStore).getById(
      'ws_default',
      'proj_1',
      'flib_123',
    )).resolves.toMatchObject({
      status: 'deleted',
    });
    await expect(docStore.list('agent_task_workspace_holders')).resolves.toEqual([
      expect.objectContaining({
        holder_state: 'released',
        released_at: '2026-05-09T00:00:10.000Z',
      }),
    ]);
  });

  it('keeps a retryable deleting mapping and exposes reconcile when repo teardown is still pending', async () => {
    const docStore = new InMemoryJsonDocStore();
    const namespaceStore = new ProjectAfscpNamespaceStore(docStore, () => '2026-05-09T00:00:00.000Z');
    await namespaceStore.markProjectNamespaceReady({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      namespaceUpsertOperationId: 'op_namespace_ready',
      volumeBindingOperationId: 'op_binding_ready',
    });
    await seedReadyLibrary({ docStore });
    const deleteRepoForLibrary = vi.fn()
      .mockRejectedValueOnce(new Error('file_library_repo_delete_pending'))
      .mockResolvedValueOnce(undefined);
    const service = new ProjectStorageLifecycleService({
      docStore,
      namespaceStore,
      fileLibraryStorageAdapter: createStorageAdapter({ deleteRepoForLibrary }),
      internalAgentWorkspaceBindingManager: createWorkspaceBindingManager(),
      nowIso: () => '2026-05-09T00:00:10.000Z',
    });

    await expect(service.beginProjectStorageTeardown({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'user_owner',
      requestId: 'req_project_delete',
      reason: 'project_delete',
    })).resolves.toMatchObject({
      status: 'retryable',
      retryable: true,
      lastErrorCode: 'file_library_repo_delete_pending',
    });
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    })).resolves.toMatchObject({
      status: 'deleting',
      stage: 'terminal_lifecycle',
      next_action: 'retry_now',
      retryable: true,
      last_error_code: 'file_library_repo_delete_pending',
    });

    await expect(service.reconcileProjectStorageTeardown({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      requestId: 'req_reconcile_delete',
    })).resolves.toMatchObject({
      status: 'tombstoned',
      retryable: false,
    });
    expect(deleteRepoForLibrary).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'release-incomplete 409',
      Object.assign(new Error('asbcp_error: delete_workspace_binding 409 release terminal fact missing'), {
        code: 'AGENT_SANDBOX_RELEASE_INCOMPLETE',
        status: 409,
        operation: 'delete_workspace_binding',
        retryable: true,
        requestId: 'asbcp_req_binding_release_409',
      }),
    ],
    [
      'generic binding delete failure',
      new Error('workspace_binding_delete_failed'),
    ],
  ])('does not delete repos when workspace binding delete fails with %s', async (_caseName, bindingError) => {
    const docStore = new InMemoryJsonDocStore();
    const namespaceStore = new ProjectAfscpNamespaceStore(docStore, () => '2026-05-09T00:00:00.000Z');
    await namespaceStore.markProjectNamespaceReady({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      namespaceUpsertOperationId: 'op_namespace_ready',
      volumeBindingOperationId: 'op_binding_ready',
    });
    await seedReadyLibrary({ docStore });
    const deleteRepoForLibrary = vi.fn(async () => undefined);
    const workspaceBindingManager = createWorkspaceBindingManager();
    workspaceBindingManager.deleteWorkspaceBinding = vi.fn(async () => {
      throw bindingError;
    });
    const service = new ProjectStorageLifecycleService({
      docStore,
      namespaceStore,
      fileLibraryStorageAdapter: createStorageAdapter({ deleteRepoForLibrary }),
      internalAgentWorkspaceBindingManager: workspaceBindingManager,
      nowIso: () => '2026-05-09T00:00:10.000Z',
    });

    await expect(service.beginProjectStorageTeardown({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'user_owner',
      requestId: 'req_project_delete_binding_failed',
      reason: 'project_delete',
    })).resolves.toMatchObject({
      status: 'retryable',
      retryable: true,
      deletedRepositories: 0,
      releasedMountBindings: 0,
    });

    expect(workspaceBindingManager.deleteWorkspaceBinding).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      fileLibraryId: 'flib_123',
    });
    expect(deleteRepoForLibrary).not.toHaveBeenCalled();
    await expect(namespaceStore.getProjectNamespace({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    })).resolves.toMatchObject({
      status: 'deleting',
      retryable: true,
    });
    await expect(new JsonDocProjectFileLibraryCatalogRepo(docStore).getById(
      'ws_default',
      'proj_1',
      'flib_123',
    )).resolves.toMatchObject({
      status: 'deleting',
      delete_correlation_id: 'req_project_delete_binding_failed',
    });
  });
});
