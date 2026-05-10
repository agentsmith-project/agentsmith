import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';
import {
  InternalAgentWorkspaceProvisionerImpl,
  type InternalAgentWorkspaceBinding,
  InternalAgentWorkspaceProvisioningError,
} from './internal-agent-workspace-provisioner.js';
import type { AfscpWorkloadMountBindingStatus } from './afscp-client.js';
import { AfscpClientError } from './afscp-error-mapper.js';
import { JsonDocProjectFileLibraryAfscpMappingRepo } from './file-library-afscp-storage.js';
import { ProjectAfscpResourceOwnershipStore } from './project-afscp-namespace-store.js';
import {
  buildTaskHomeSegment,
} from './notebook-task/task-models.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

describe('task home segment model', () => {
  it('uses a legal task id directly as the task HOME segment', () => {
    expect(buildTaskHomeSegment({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      taskId: 'task_ABC.123-ok',
    })).toBe('task_ABC.123-ok');
  });

  it('hashes reserved or invalid task ids without sanitizing them in place', () => {
    const reserved = createHash('sha256')
      .update('ws_demo/proj_demo/taskhash-existing')
      .digest('hex')
      .slice(0, 32);
    const invalid = createHash('sha256')
      .update('ws_demo/proj_demo/task with spaces')
      .digest('hex')
      .slice(0, 32);

    expect(buildTaskHomeSegment({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      taskId: 'taskhash-existing',
    })).toBe(`taskhash-${reserved}`);
    expect(buildTaskHomeSegment({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      taskId: 'task with spaces',
    })).toBe(`taskhash-${invalid}`);
  });

});

describe('InternalAgentWorkspaceProvisionerImpl', () => {
  async function seedReadyAfscpLibrary(input: {
    docStore: InMemoryJsonDocStore;
    libraryId: string;
    name?: string;
  }): Promise<JsonDocProjectFileLibraryAfscpMappingRepo> {
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(input.docStore);
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(input.docStore);
    await catalogRepo.save({
      id: input.libraryId,
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      name: input.name ?? 'Workspace Library',
      description: 'Demo library',
      status: 'ready',
      version: 1,
      file_library_home_segment: input.libraryId,
      source: 'agent_task_files',
      created_by_user_id: 'user_demo',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    await mappingRepo.saveReady({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      libraryId: input.libraryId,
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      projectStorageGeneration: 7,
      operationId: 'op_repo_create',
      operationStatus: 'succeeded',
    });
    return mappingRepo;
  }

  function readyProjectStorageService() {
    return {
      enabled: true,
      bootstrapProjectStorage: vi.fn(),
      reconcileProjectStorage: vi.fn(),
      ensureProjectStorageReady: vi.fn().mockResolvedValue({
        status: 'ready',
        namespaceId: 'ns_project_1',
        stage: 'ready',
        generation: 7,
        nextAction: 'none',
        retryable: false,
        lastErrorCode: null,
      }),
    };
  }

  it('creates a real AFSCP workload mount binding before delegating an opaque sandbox binding', async () => {
    const docStore = new InMemoryJsonDocStore();
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);

    await catalogRepo.save({
      id: 'flib_demo',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      name: 'Workspace Library',
      description: 'Demo library',
      status: 'ready',
      version: 1,
      file_library_home_segment: 'flib_demo',
      source: 'agent_task_files',
      created_by_user_id: 'user_demo',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    await mappingRepo.saveReady({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      libraryId: 'flib_demo',
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      projectStorageGeneration: 7,
      operationId: 'op_repo_create',
      operationStatus: 'succeeded',
    });

    const createWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_mount_create',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_task_demo' },
      result: null,
      error: null,
    });
    const getWorkloadMountBinding = vi.fn().mockResolvedValue({
      mount_binding_id: 'wmb_task_demo',
      namespace_id: 'ns_project_1',
      repo_id: 'repo_file_library_1',
      volume_id: 'vol_shared',
      mount_path: '/home/task_demo',
      read_only: false,
      status: 'issued',
      lease_expires_at: '2026-03-19T01:00:00.000Z',
    });
    const revokeWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_mount_revoke',
      operation_state: 'queued',
      resource: { type: 'workload_mount_binding', id: 'wmb_task_demo' },
      result: null,
      error: null,
    });

    const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
      binding_id: 'wmb_task_demo',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      namespace_id: 'ns_project_1',
      mount_binding_id: 'wmb_task_demo',
      status: 'ready',
    });

    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding,
        deleteWorkspaceBinding: vi.fn().mockResolvedValue(undefined),
      },
      {
        afscpProductClient: {
          createWorkloadMountBinding,
          getWorkloadMountBinding,
          revokeWorkloadMountBinding,
        },
        projectStorageBootstrapService: {
          enabled: true,
          bootstrapProjectStorage: vi.fn(),
          reconcileProjectStorage: vi.fn(),
          ensureProjectStorageReady: vi.fn().mockResolvedValue({
            status: 'ready',
            namespaceId: 'ns_project_1',
            stage: 'ready',
            generation: 7,
            nextAction: 'none',
            retryable: false,
            lastErrorCode: null,
          }),
        },
        mappingRepo,
        resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      },
    );

    const result = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_demo',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
      requestId: 'req_task_demo',
    });

    expect(createWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      mountPath: '/home/task_demo',
      readOnly: false,
      leaseSeconds: 3600,
      actor: { type: 'user', id: 'user_demo' },
    }));
    expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      mountBindingId: 'wmb_task_demo',
    }));
    expect(ensureWorkspaceBinding).toHaveBeenCalledWith(
      'ws_demo',
      'proj_demo',
      'wmb_task_demo',
      {
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_task_demo',
      },
    );
    expect(JSON.stringify(ensureWorkspaceBinding.mock.calls[0]?.[3])).not.toMatch(
      /destination|task_home_path|workspace_path|artifacts_path|mount_path|working_dir|sub_path|metadata_url|storage_endpoint|storage_bucket_url|filesystem_name|juicefs|secret_name|pv_name|pvc_name|access_key/i,
    );
    expect(result.workspaceMount).toEqual({
      bindingId: 'wmb_task_demo',
      mountPath: '/home/task_demo',
      taskHomePath: '/home/task_demo',
      workspacePath: '/home/task_demo/workspace',
      artifactsPath: '/home/task_demo/workspace/.artifacts',
      libraryRootPath: '.',
    });
    expect(result.binding.provider).toBe('afscp');
    expect(result.binding.task_home_binding_id).toBe('wmb_task_demo');
    expect(result.binding.afscp_mount_binding_id).toBe('wmb_task_demo');
    expect(result.binding.afscp_namespace_id).toBe('ns_project_1');
    expect(result.binding.afscp_repo_id).toBe('repo_file_library_1');
    expect(result.binding.project_storage_generation).toBe(7);
    expect(result.binding.mount_binding_status).toBe('issued');
    expect(revokeWorkloadMountBinding).not.toHaveBeenCalled();
  });

  it.each(['releasing', 'released', 'revoked', 'expired', 'failed', 'uncertain'] as const)(
    'fails closed instead of reusing or replacing an existing %s AFSCP workload mount binding',
    async (status) => {
      const docStore = new InMemoryJsonDocStore();
      const mappingRepo = await seedReadyAfscpLibrary({
        docStore,
        libraryId: 'flib_existing_mount_state',
      });
      const existingBinding: InternalAgentWorkspaceBinding = {
        file_library_id: 'flib_existing_mount_state',
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        provider: 'afscp',
        task_home_binding_id: 'wmb_existing_terminal',
        afscp_mount_binding_id: 'wmb_existing_terminal',
        afscp_namespace_id: 'ns_project_1',
        afscp_repo_id: 'repo_file_library_1',
        afscp_volume_id: 'vol_shared',
        project_storage_generation: 7,
        status: 'ready',
        mount_binding_status: status as AfscpWorkloadMountBindingStatus,
        lease_expires_at: '2026-03-19T01:00:00.000Z',
        task_home_path: '/home/task_demo',
        workspace_path: '/home/task_demo/workspace',
        artifacts_path: '/home/task_demo/workspace/.artifacts',
        library_root_path: '.',
        created_at: '2026-03-19T00:00:00.000Z',
        updated_at: '2026-03-19T00:00:00.000Z',
      };
      await docStore.upsert<InternalAgentWorkspaceBinding>(
        resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
        existingBinding.file_library_id,
        existingBinding,
      );
      const createWorkloadMountBinding = vi.fn();
      const getWorkloadMountBinding = vi.fn().mockResolvedValue({
        mount_binding_id: 'wmb_existing_terminal',
        namespace_id: 'ns_project_1',
        repo_id: 'repo_file_library_1',
        volume_id: 'vol_shared',
        mount_path: '/home/task_demo',
        read_only: false,
        status,
        lease_expires_at: '2026-03-19T01:00:00.000Z',
      });
      const ensureWorkspaceBinding = vi.fn();
      const provisioner = new InternalAgentWorkspaceProvisionerImpl(
        docStore,
        {
          ensureWorkspaceBinding,
          deleteWorkspaceBinding: vi.fn().mockResolvedValue(undefined),
        },
        {
          afscpProductClient: {
            createWorkloadMountBinding,
            getWorkloadMountBinding,
            revokeWorkloadMountBinding: vi.fn(),
          },
          projectStorageBootstrapService: readyProjectStorageService(),
          mappingRepo,
          resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
        },
      );

      await expect(provisioner.ensureWorkspaceBinding({
        workspaceId: 'ws_demo',
        projectId: 'proj_demo',
        fileLibraryId: 'flib_existing_mount_state',
        taskId: 'task_demo',
        actorUserId: 'user_demo',
      })).rejects.toMatchObject({
        code: 'AGENT_WORKSPACE_AFSCP_ERROR',
        retryable: false,
        metadata: {
          reason: 'mount_binding_status_unusable',
          mount_binding_status: status,
        },
      });
      expect(createWorkloadMountBinding).not.toHaveBeenCalled();
      expect(ensureWorkspaceBinding).not.toHaveBeenCalled();
    },
  );

  it('fails closed when a newly created AFSCP workload mount binding reads back as unusable', async () => {
    const docStore = new InMemoryJsonDocStore();
    const mappingRepo = await seedReadyAfscpLibrary({
      docStore,
      libraryId: 'flib_created_unusable',
    });
    const createWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_mount_create_unusable',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_created_unusable' },
      result: null,
      error: null,
    });
    const getWorkloadMountBinding = vi.fn().mockResolvedValue({
      mount_binding_id: 'wmb_created_unusable',
      namespace_id: 'ns_project_1',
      repo_id: 'repo_file_library_1',
      volume_id: 'vol_shared',
      mount_path: '/home/task_demo',
      read_only: false,
      status: 'expired',
      lease_expires_at: '2026-03-19T01:00:00.000Z',
    });
    const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
      binding_id: 'wmb_created_unusable',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      namespace_id: 'ns_project_1',
      mount_binding_id: 'wmb_created_unusable',
      status: 'ready',
    });
    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding,
        deleteWorkspaceBinding: vi.fn().mockResolvedValue(undefined),
      },
      {
        afscpProductClient: {
          createWorkloadMountBinding,
          getWorkloadMountBinding,
          revokeWorkloadMountBinding: vi.fn(),
        },
        projectStorageBootstrapService: readyProjectStorageService(),
        mappingRepo,
        resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      },
    );

    await expect(provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_created_unusable',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
    })).rejects.toMatchObject({
      code: 'AGENT_WORKSPACE_AFSCP_ERROR',
      retryable: false,
      metadata: {
        reason: 'mount_binding_status_unusable',
        mount_binding_status: 'expired',
      },
    });
    expect(createWorkloadMountBinding).toHaveBeenCalled();
    expect(ensureWorkspaceBinding).not.toHaveBeenCalled();
    await expect(docStore.get(
      resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
      'flib_created_unusable',
    )).resolves.toBeNull();
  });

  it('fails closed with a typed error when project storage is not ready before mount issuance', async () => {
    const docStore = new InMemoryJsonDocStore();
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
    await catalogRepo.save({
      id: 'flib_pending_storage',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      name: 'Pending Storage Library',
      description: 'Demo library',
      status: 'ready',
      version: 1,
      file_library_home_segment: 'flib_pending_storage',
      source: 'agent_task_files',
      created_by_user_id: 'user_demo',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    const createWorkloadMountBinding = vi.fn();
    const ensureWorkspaceBinding = vi.fn();
    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding,
        deleteWorkspaceBinding: vi.fn().mockResolvedValue(undefined),
      },
      {
        afscpProductClient: {
          createWorkloadMountBinding,
          getWorkloadMountBinding: vi.fn(),
          revokeWorkloadMountBinding: vi.fn(),
        },
        projectStorageBootstrapService: {
          enabled: true,
          bootstrapProjectStorage: vi.fn(),
          reconcileProjectStorage: vi.fn(),
          ensureProjectStorageReady: vi.fn().mockResolvedValue({
            status: 'pending',
            stage: 'volume_binding',
            generation: 7,
            nextAction: 'wait',
            retryable: true,
            lastErrorCode: 'storage_operation_pending',
          }),
        },
        mappingRepo,
        resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      },
    );

    await expect(provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_pending_storage',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
    })).rejects.toMatchObject({
      code: 'AGENT_WORKSPACE_AFSCP_PROJECT_STORAGE_NOT_READY',
      retryable: true,
    });
    await expect(provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_pending_storage',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
    })).rejects.toBeInstanceOf(InternalAgentWorkspaceProvisioningError);
    expect(createWorkloadMountBinding).not.toHaveBeenCalled();
    expect(ensureWorkspaceBinding).not.toHaveBeenCalled();
  });

  it('maps AFSCP unavailable and permission errors to fail-closed typed provisioning errors', async () => {
    const docStore = new InMemoryJsonDocStore();
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
    await catalogRepo.save({
      id: 'flib_afscp_error',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      name: 'AFSCP Error Library',
      description: 'Demo library',
      status: 'ready',
      version: 1,
      file_library_home_segment: 'flib_afscp_error',
      source: 'agent_task_files',
      created_by_user_id: 'user_demo',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });
    await mappingRepo.saveReady({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      libraryId: 'flib_afscp_error',
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      projectStorageGeneration: 7,
      operationId: 'op_repo_create',
      operationStatus: 'succeeded',
    });
    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding: vi.fn(),
        deleteWorkspaceBinding: vi.fn().mockResolvedValue(undefined),
      },
      {
        afscpProductClient: {
          createWorkloadMountBinding: vi.fn().mockRejectedValue(new AfscpClientError({
            status: 503,
            code: 'unavailable',
            message: 'unavailable',
            retryable: true,
            correlation_id: 'corr-afscp',
          })),
          getWorkloadMountBinding: vi.fn(),
          revokeWorkloadMountBinding: vi.fn(),
        },
        projectStorageBootstrapService: {
          enabled: true,
          bootstrapProjectStorage: vi.fn(),
          reconcileProjectStorage: vi.fn(),
          ensureProjectStorageReady: vi.fn().mockResolvedValue({
            status: 'ready',
            namespaceId: 'ns_project_1',
            stage: 'ready',
            generation: 7,
            nextAction: 'none',
            retryable: false,
            lastErrorCode: null,
          }),
        },
        mappingRepo,
        resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      },
    );

    await expect(provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_afscp_error',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
    })).rejects.toMatchObject({
      code: 'AGENT_WORKSPACE_AFSCP_UNAVAILABLE',
      retryable: true,
    });
  });
});
