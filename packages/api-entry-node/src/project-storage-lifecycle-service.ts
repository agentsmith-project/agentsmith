import type { JsonDocStorePort } from '@mbos/ports';
import {
  FILE_LIBRARY_CATALOG_COLLECTION,
  JsonDocProjectFileLibraryCatalogRepo,
} from './file-library-persistence.js';
import type { FileLibraryStoragePort } from './file-library-afscp-storage.js';
import type { InternalAgentWorkspaceBindingManager } from './internal-agent-workspace-provisioner.js';
import { JsonDocTaskWorkspaceHolderRepo } from './notebook-task/task-file-library-bindings.js';
import {
  PROJECT_AFSCP_NAMESPACE_COLLECTION,
  type ProjectAfscpNamespaceMapping,
  type ProjectAfscpNamespaceStore,
} from './project-afscp-namespace-store.js';

export type ProjectStorageTeardownReason =
  | 'project_delete'
  | 'project_disable'
  | 'workspace_delete'
  | 'workspace_disable'
  | 'lifecycle_reconcile';

export interface ProjectStorageTeardownResult {
  status: 'tombstoned' | 'retryable';
  retryable: boolean;
  lastErrorCode: string | null;
  deletedRepositories: number;
  releasedMountBindings: number;
  drainedSessions: number;
}

export interface ProjectStorageLifecycleServicePort {
  readonly enabled: boolean;
  beginProjectStorageTeardown(input: {
    workspaceId: string;
    projectId: string;
    actorUserId: string;
    requestId?: string;
    reason: ProjectStorageTeardownReason;
  }): Promise<ProjectStorageTeardownResult>;
  reconcileProjectStorageTeardown(input: {
    workspaceId: string;
    projectId: string;
    requestId?: string;
  }): Promise<ProjectStorageTeardownResult>;
  beginWorkspaceStorageTeardown(input: {
    workspaceId: string;
    actorUserId: string;
    requestId?: string;
    reason: Extract<ProjectStorageTeardownReason, 'workspace_delete' | 'workspace_disable'>;
  }): Promise<ProjectStorageTeardownResult[]>;
  reconcileWorkspaceStorageTeardown(input: {
    workspaceId: string;
    requestId?: string;
  }): Promise<ProjectStorageTeardownResult[]>;
}

interface ProjectStorageLifecycleServiceOptions {
  docStore: JsonDocStorePort;
  namespaceStore: ProjectAfscpNamespaceStore;
  fileLibraryStorageAdapter?: FileLibraryStoragePort;
  internalAgentWorkspaceBindingManager?: InternalAgentWorkspaceBindingManager;
  nowIso?: () => string;
}

class DisabledProjectStorageLifecycleService implements ProjectStorageLifecycleServicePort {
  readonly enabled = false;

  async beginProjectStorageTeardown(): Promise<ProjectStorageTeardownResult> {
    return {
      status: 'tombstoned',
      retryable: false,
      lastErrorCode: null,
      deletedRepositories: 0,
      releasedMountBindings: 0,
      drainedSessions: 0,
    };
  }

  async reconcileProjectStorageTeardown(): Promise<ProjectStorageTeardownResult> {
    return this.beginProjectStorageTeardown();
  }

  async beginWorkspaceStorageTeardown(): Promise<ProjectStorageTeardownResult[]> {
    return [];
  }

  async reconcileWorkspaceStorageTeardown(): Promise<ProjectStorageTeardownResult[]> {
    return [];
  }
}

const PUBLIC_TEARDOWN_ERRORS = new Set([
  'file_library_afscp_mapping_not_found',
  'file_library_backend_unavailable',
  'file_library_repo_delete_failed',
  'file_library_repo_delete_pending',
  'file_library_storage_admin_action_required',
]);

function safeTeardownErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return PUBLIC_TEARDOWN_ERRORS.has(message) ? message : 'project_storage_teardown_failed';
}

export class ProjectStorageLifecycleService implements ProjectStorageLifecycleServicePort {
  readonly enabled = true;
  private readonly docStore: JsonDocStorePort;
  private readonly namespaceStore: ProjectAfscpNamespaceStore;
  private readonly fileLibraryStorageAdapter?: FileLibraryStoragePort;
  private readonly internalAgentWorkspaceBindingManager?: InternalAgentWorkspaceBindingManager;
  private readonly nowIso: () => string;

  static disabled(): ProjectStorageLifecycleServicePort {
    return new DisabledProjectStorageLifecycleService();
  }

  constructor(options: ProjectStorageLifecycleServiceOptions) {
    this.docStore = options.docStore;
    this.namespaceStore = options.namespaceStore;
    this.fileLibraryStorageAdapter = options.fileLibraryStorageAdapter;
    this.internalAgentWorkspaceBindingManager = options.internalAgentWorkspaceBindingManager;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
  }

  async beginProjectStorageTeardown(input: {
    workspaceId: string;
    projectId: string;
    actorUserId: string;
    requestId?: string;
    reason: ProjectStorageTeardownReason;
  }): Promise<ProjectStorageTeardownResult> {
    return this.teardownProjectStorage(input);
  }

  async reconcileProjectStorageTeardown(input: {
    workspaceId: string;
    projectId: string;
    requestId?: string;
  }): Promise<ProjectStorageTeardownResult> {
    return this.teardownProjectStorage({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: 'project-storage-lifecycle',
      requestId: input.requestId,
      reason: 'lifecycle_reconcile',
    });
  }

  async beginWorkspaceStorageTeardown(input: {
    workspaceId: string;
    actorUserId: string;
    requestId?: string;
    reason: Extract<ProjectStorageTeardownReason, 'workspace_delete' | 'workspace_disable'>;
  }): Promise<ProjectStorageTeardownResult[]> {
    const projectIds = await this.listWorkspaceStorageProjectIds(input.workspaceId);
    const results: ProjectStorageTeardownResult[] = [];
    for (const projectId of projectIds) {
      results.push(await this.teardownProjectStorage({
        workspaceId: input.workspaceId,
        projectId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        reason: input.reason,
      }));
    }
    return results;
  }

  async reconcileWorkspaceStorageTeardown(input: {
    workspaceId: string;
    requestId?: string;
  }): Promise<ProjectStorageTeardownResult[]> {
    const projectIds = await this.listWorkspaceStorageProjectIds(input.workspaceId);
    const results: ProjectStorageTeardownResult[] = [];
    for (const projectId of projectIds) {
      results.push(await this.reconcileProjectStorageTeardown({
        workspaceId: input.workspaceId,
        projectId,
        requestId: input.requestId,
      }));
    }
    return results;
  }

  private async teardownProjectStorage(input: {
    workspaceId: string;
    projectId: string;
    actorUserId: string;
    requestId?: string;
    reason: ProjectStorageTeardownReason;
  }): Promise<ProjectStorageTeardownResult> {
    await this.namespaceStore.markProjectNamespaceDeleting({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      lastErrorCode: null,
    });
    const now = this.nowIso();
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(this.docStore);
    const libraries = await catalogRepo.listByProject(input.workspaceId, input.projectId);
    const drainedSessions = await new JsonDocTaskWorkspaceHolderRepo(this.docStore).releaseByProject({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      releasedAt: now,
    });
    let releasedMountBindings = 0;
    let deletedRepositories = 0;
    let lastErrorCode: string | null = null;

    for (const library of libraries) {
      await catalogRepo.update(input.workspaceId, input.projectId, library.id, {
        status: library.status === 'deleted' ? 'deleted' : 'deleting',
        ...(input.requestId ? { delete_correlation_id: input.requestId } : {}),
        updated_at: now,
      });
      try {
        await this.internalAgentWorkspaceBindingManager?.deleteWorkspaceBinding({
          workspaceId: input.workspaceId,
          fileLibraryId: library.id,
        });
        if (this.internalAgentWorkspaceBindingManager) {
          releasedMountBindings += 1;
        }
      } catch (error) {
        lastErrorCode = safeTeardownErrorCode(error);
      }

      if (this.fileLibraryStorageAdapter?.enabled && library.status !== 'deleted') {
        try {
          await this.fileLibraryStorageAdapter.deleteRepoForLibrary({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            libraryId: library.id,
            actorUserId: input.actorUserId,
            requestId: input.requestId,
            reason: input.reason,
          });
          deletedRepositories += 1;
          await catalogRepo.update(input.workspaceId, input.projectId, library.id, {
            status: 'deleted',
            ...(input.requestId ? { delete_correlation_id: input.requestId } : {}),
            updated_at: now,
          });
        } catch (error) {
          lastErrorCode = safeTeardownErrorCode(error);
        }
      }
    }

    if (lastErrorCode) {
      await this.namespaceStore.markProjectNamespaceDeleting({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        lastErrorCode,
        retryable: true,
      });
      return {
        status: 'retryable',
        retryable: true,
        lastErrorCode,
        deletedRepositories,
        releasedMountBindings,
        drainedSessions,
      };
    }

    await this.namespaceStore.markProjectNamespaceTombstoned({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
    return {
      status: 'tombstoned',
      retryable: false,
      lastErrorCode: null,
      deletedRepositories,
      releasedMountBindings,
      drainedSessions,
    };
  }

  private async listWorkspaceStorageProjectIds(workspaceId: string): Promise<string[]> {
    const namespaceMappings = await this.docStore.list<ProjectAfscpNamespaceMapping>(PROJECT_AFSCP_NAMESPACE_COLLECTION, {
      workspace_id: workspaceId,
    });
    const fileLibraries = await this.docStore.list<{ project_id?: string }>(FILE_LIBRARY_CATALOG_COLLECTION, {
      workspace_id: workspaceId,
    });
    const projectIds = new Set<string>();
    for (const mapping of namespaceMappings) {
      if (mapping.project_id) {
        projectIds.add(mapping.project_id);
      }
    }
    for (const library of fileLibraries) {
      if (typeof library.project_id === 'string' && library.project_id.trim()) {
        projectIds.add(library.project_id);
      }
    }
    return [...projectIds].sort();
  }
}
