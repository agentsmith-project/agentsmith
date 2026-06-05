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

  function workloadMountBindingNotFoundError(): AfscpClientError {
    return new AfscpClientError({
      status: 404,
      code: 'afscp_resource_not_found',
      message: 'afscp_resource_not_found',
      retryable: false,
      resource_kind: 'workload_mount_binding',
    });
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

  it('retries ASBCP workspace binding readiness without recreating the AFSCP mount binding', async () => {
    const docStore = new InMemoryJsonDocStore();
    const mappingRepo = await seedReadyAfscpLibrary({
      docStore,
      libraryId: 'flib_readiness_retry',
    });
    const createWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_mount_create',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_readiness_retry' },
      result: null,
      error: null,
    });
    const getWorkloadMountBinding = vi.fn().mockResolvedValue({
      mount_binding_id: 'wmb_readiness_retry',
      namespace_id: 'ns_project_1',
      repo_id: 'repo_file_library_1',
      volume_id: 'vol_shared',
      mount_path: '/home/task_demo',
      read_only: false,
      status: 'issued',
      lease_expires_at: '2026-03-19T01:00:00.000Z',
    });
    const readinessError = Object.assign(new Error('raw pvc pending detail must stay server-side'), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 503,
      operation: 'ensure_workspace_binding',
      asbcpCode: 'not_ready',
      retryable: true,
      requestId: 'asbcp_req_binding_retry',
      retryAfterMs: 1_000,
    });
    const ensureWorkspaceBinding = vi.fn()
      .mockRejectedValueOnce(readinessError)
      .mockRejectedValueOnce(readinessError)
      .mockResolvedValue({
        binding_id: 'wmb_readiness_retry',
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_readiness_retry',
        status: 'ready',
      });
    const readinessSleep = vi.fn(async () => undefined);
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
        readinessSleep,
      },
    );

    const result = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_readiness_retry',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
      requestId: 'req_binding_retry',
    });

    expect(createWorkloadMountBinding).toHaveBeenCalledTimes(1);
    expect(getWorkloadMountBinding).toHaveBeenCalledTimes(1);
    expect(ensureWorkspaceBinding).toHaveBeenCalledTimes(3);
    expect(readinessSleep).toHaveBeenCalledTimes(2);
    expect(readinessSleep).toHaveBeenCalledWith(1_000);
    expect(result.workspaceMount.bindingId).toBe('wmb_readiness_retry');
    expect(result.binding.status).toBe('ready');
  });

  it('retries ASBCP workspace binding PVC lookup readiness without recreating the AFSCP mount binding', async () => {
    const docStore = new InMemoryJsonDocStore();
    const mappingRepo = await seedReadyAfscpLibrary({
      docStore,
      libraryId: 'flib_pvc_lookup_retry',
    });
    const createWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_mount_create',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_pvc_lookup_retry' },
      result: null,
      error: null,
    });
    const getWorkloadMountBinding = vi.fn().mockResolvedValue({
      mount_binding_id: 'wmb_pvc_lookup_retry',
      namespace_id: 'ns_project_1',
      repo_id: 'repo_file_library_1',
      volume_id: 'vol_shared',
      mount_path: '/home/task_demo',
      read_only: false,
      status: 'issued',
      lease_expires_at: '2026-03-19T01:00:00.000Z',
    });
    const pvcLookupError = Object.assign(new Error('asbcp internal readiness'), {
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      status: 500,
      operation: 'ensure_workspace_binding',
      asbcpCode: 'internal_error',
      retryable: true,
      asbcpRetryable: true,
      requestId: 'asbcp_req_pvc_lookup_pending',
    });
    const ensureWorkspaceBinding = vi.fn()
      .mockRejectedValueOnce(pvcLookupError)
      .mockResolvedValue({
        binding_id: 'wmb_pvc_lookup_retry',
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_pvc_lookup_retry',
        status: 'ready',
      });
    const readinessSleep = vi.fn(async () => undefined);
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
        readinessSleep,
      },
    );

    const result = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_pvc_lookup_retry',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
      requestId: 'req_pvc_lookup_retry',
    });

    expect(createWorkloadMountBinding).toHaveBeenCalledTimes(1);
    expect(getWorkloadMountBinding).toHaveBeenCalledTimes(1);
    expect(ensureWorkspaceBinding).toHaveBeenCalledTimes(2);
    expect(readinessSleep).toHaveBeenCalledTimes(1);
    expect(readinessSleep).toHaveBeenCalledWith(1_000);
    expect(result.workspaceMount.bindingId).toBe('wmb_pvc_lookup_retry');
    expect(result.binding.status).toBe('ready');
  });

  it('keeps terminal binding truth after AFSCP revoke so the next ensure rotates to the next generation', async () => {
    const docStore = new InMemoryJsonDocStore();
    const mappingRepo = await seedReadyAfscpLibrary({
      docStore,
      libraryId: 'flib_release_poll',
    });
    const binding: InternalAgentWorkspaceBinding = {
      file_library_id: 'flib_release_poll',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      provider: 'afscp',
      task_home_binding_id: 'wmb_release_poll',
      afscp_mount_binding_id: 'wmb_release_poll',
      afscp_namespace_id: 'ns_project_1',
      afscp_repo_id: 'repo_file_library_1',
      afscp_volume_id: 'vol_shared',
      project_storage_generation: 7,
      status: 'ready',
      mount_binding_status: 'issued',
      mount_binding_generation: 2,
      lease_expires_at: '2026-03-19T01:00:00.000Z',
      task_home_path: '/home/task_demo',
      workspace_path: '/home/task_demo/workspace',
      artifacts_path: '/home/task_demo/workspace/.artifacts',
      library_root_path: '.',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    };
    const collection = resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo');
    await docStore.upsert(collection, binding.file_library_id, binding);
    const deleteWorkspaceBinding = vi.fn().mockResolvedValue(undefined);
    const revokeWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_release_poll',
      operation_state: 'queued',
      resource: { type: 'workload_mount_binding', id: 'wmb_release_poll' },
      result: null,
      error: null,
    });
    const pollOperation = vi.fn().mockResolvedValue({
      operation_id: 'op_release_poll',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_release_poll' },
      result: null,
      error: null,
    });
    const createWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_mount_after_release',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_after_release' },
      result: null,
      error: null,
    });
    const getWorkloadMountBinding = vi.fn().mockImplementation(async (input: { mountBindingId: string }) => {
      if (input.mountBindingId === 'wmb_release_poll') {
        return {
          mount_binding_id: 'wmb_release_poll',
          namespace_id: 'ns_project_1',
          repo_id: 'repo_file_library_1',
          volume_id: 'vol_shared',
          mount_path: '/home/task_demo',
          read_only: false,
          status: 'released',
          lease_expires_at: '2026-03-19T01:00:00.000Z',
        };
      }
      return {
        mount_binding_id: 'wmb_after_release',
        namespace_id: 'ns_project_1',
        repo_id: 'repo_file_library_1',
        volume_id: 'vol_shared',
        mount_path: '/home/task_demo',
        read_only: false,
        status: 'issued',
        lease_expires_at: '2026-03-19T02:00:00.000Z',
      };
    });
    const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
      binding_id: 'wmb_after_release',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      namespace_id: 'ns_project_1',
      mount_binding_id: 'wmb_after_release',
      status: 'ready',
    });
    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding,
        deleteWorkspaceBinding,
      },
      {
        afscpProductClient: {
          createWorkloadMountBinding,
          getWorkloadMountBinding,
          revokeWorkloadMountBinding,
          pollOperation,
        },
        projectStorageBootstrapService: readyProjectStorageService(),
        mappingRepo,
        resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
      },
    );

    await expect(provisioner.deleteWorkspaceBinding({
      workspaceId: 'ws_demo',
      fileLibraryId: binding.file_library_id,
    })).resolves.toBeUndefined();

    expect(deleteWorkspaceBinding).toHaveBeenCalledWith('ws_demo', 'proj_demo', 'wmb_release_poll');
    expect(revokeWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      mountBindingId: 'wmb_release_poll',
    }));
    expect(pollOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'op_release_poll',
    }));
    await expect(docStore.get<InternalAgentWorkspaceBinding>(collection, binding.file_library_id)).resolves.toMatchObject({
      file_library_id: binding.file_library_id,
      status: 'released',
      mount_binding_status: 'released',
      task_home_binding_id: 'wmb_release_poll',
      afscp_mount_binding_id: 'wmb_release_poll',
      task_home_path: '/home/task_demo',
      mount_binding_generation: 2,
      release_operation_id: 'op_release_poll',
      drain_completed_at: expect.any(String),
    });
    await expect(provisioner.findWorkspaceBinding({
      workspaceId: 'ws_demo',
      fileLibraryId: binding.file_library_id,
    })).resolves.toMatchObject({
      file_library_id: binding.file_library_id,
      status: 'released',
      mount_binding_status: 'released',
      mount_binding_generation: 2,
    });

    const ensured = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: binding.file_library_id,
      taskId: 'task_demo',
      actorUserId: 'user_demo',
      requestId: 'req_after_release',
    });

    expect(createWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      mountPath: '/home/task_demo',
      idempotencyKey: expect.stringContaining(':g3:'),
    }));
    expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      mountBindingId: 'wmb_release_poll',
    }));
    expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      mountBindingId: 'wmb_after_release',
    }));
    expect(ensureWorkspaceBinding).toHaveBeenCalledWith(
      'ws_demo',
      'proj_demo',
      'wmb_after_release',
      {
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_after_release',
      },
    );
    expect(ensured.workspaceMount.bindingId).toBe('wmb_after_release');
    expect(ensured.binding.previous_afscp_mount_binding_id).toBe('wmb_release_poll');
    expect(ensured.binding.mount_binding_generation).toBe(3);
  });

  it('keeps pending release truth when AFSCP revoke cannot be confirmed synchronously', async () => {
    const docStore = new InMemoryJsonDocStore();
    const binding: InternalAgentWorkspaceBinding = {
      file_library_id: 'flib_release_pending',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      provider: 'afscp',
      task_home_binding_id: 'wmb_release_pending',
      afscp_mount_binding_id: 'wmb_release_pending',
      afscp_namespace_id: 'ns_project_1',
      afscp_repo_id: 'repo_file_library_1',
      afscp_volume_id: 'vol_shared',
      project_storage_generation: 7,
      status: 'ready',
      mount_binding_status: 'issued',
      mount_binding_generation: 2,
      lease_expires_at: '2026-03-19T01:00:00.000Z',
      task_home_path: '/home/task_demo',
      workspace_path: '/home/task_demo/workspace',
      artifacts_path: '/home/task_demo/workspace/.artifacts',
      library_root_path: '.',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    };
    const collection = resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo');
    await docStore.upsert(collection, binding.file_library_id, binding);
    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding: vi.fn(),
        deleteWorkspaceBinding: vi.fn().mockResolvedValue(undefined),
      },
      {
        afscpProductClient: {
          createWorkloadMountBinding: vi.fn(),
          getWorkloadMountBinding: vi.fn(),
          revokeWorkloadMountBinding: vi.fn().mockResolvedValue({
            operation_id: 'op_release_pending',
            operation_state: 'queued',
            resource: { type: 'workload_mount_binding', id: 'wmb_release_pending' },
            result: null,
            error: null,
          }),
        },
      },
    );

    await expect(provisioner.deleteWorkspaceBinding({
      workspaceId: 'ws_demo',
      fileLibraryId: binding.file_library_id,
    })).resolves.toBeUndefined();

    await expect(docStore.get<InternalAgentWorkspaceBinding>(collection, binding.file_library_id)).resolves.toMatchObject({
      status: 'releasing',
      mount_binding_status: 'releasing',
      release_operation_id: 'op_release_pending',
      release_requested_at: expect.any(String),
      drain_started_at: expect.any(String),
    });
    await expect(provisioner.findWorkspaceBinding({
      workspaceId: 'ws_demo',
      fileLibraryId: binding.file_library_id,
    })).resolves.toMatchObject({
      file_library_id: binding.file_library_id,
      status: 'releasing',
      mount_binding_status: 'releasing',
    });
  });

  it('treats AFSCP revoke not_found as an idempotent terminal release for a non-terminal local binding', async () => {
    const docStore = new InMemoryJsonDocStore();
    const binding: InternalAgentWorkspaceBinding = {
      file_library_id: 'flib_release_gc',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      provider: 'afscp',
      task_home_binding_id: 'wmb_release_gc',
      afscp_mount_binding_id: 'wmb_release_gc',
      afscp_namespace_id: 'ns_project_1',
      afscp_repo_id: 'repo_file_library_1',
      afscp_volume_id: 'vol_shared',
      project_storage_generation: 7,
      status: 'ready',
      mount_binding_status: 'issued',
      mount_binding_generation: 3,
      lease_expires_at: '2026-03-19T01:00:00.000Z',
      task_home_path: '/home/task_demo',
      workspace_path: '/home/task_demo/workspace',
      artifacts_path: '/home/task_demo/workspace/.artifacts',
      library_root_path: '.',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    };
    const collection = resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo');
    await docStore.upsert(collection, binding.file_library_id, binding);
    const deleteWorkspaceBinding = vi.fn().mockResolvedValue(undefined);
    const revokeWorkloadMountBinding = vi.fn().mockRejectedValue(workloadMountBindingNotFoundError());
    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding: vi.fn(),
        deleteWorkspaceBinding,
      },
      {
        afscpProductClient: {
          createWorkloadMountBinding: vi.fn(),
          getWorkloadMountBinding: vi.fn(),
          revokeWorkloadMountBinding,
        },
      },
    );

    await expect(provisioner.deleteWorkspaceBinding({
      workspaceId: 'ws_demo',
      fileLibraryId: binding.file_library_id,
    })).resolves.toBeUndefined();

    expect(deleteWorkspaceBinding).toHaveBeenCalledWith('ws_demo', 'proj_demo', 'wmb_release_gc');
    expect(revokeWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      mountBindingId: 'wmb_release_gc',
    }));
    await expect(docStore.get<InternalAgentWorkspaceBinding>(collection, binding.file_library_id)).resolves.toMatchObject({
      file_library_id: binding.file_library_id,
      status: 'released',
      mount_binding_status: 'released',
      task_home_binding_id: 'wmb_release_gc',
      afscp_mount_binding_id: 'wmb_release_gc',
      mount_binding_generation: 3,
      release_requested_at: expect.any(String),
      drain_started_at: expect.any(String),
      drain_completed_at: expect.any(String),
    });
  });

  it('uses a generation-scoped revoke idempotency key for recreated task HOME mounts', async () => {
    const docStore = new InMemoryJsonDocStore();
    const collection = resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo');
    const baseBinding: InternalAgentWorkspaceBinding = {
      file_library_id: 'flib_revoke_key',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      provider: 'afscp',
      task_home_binding_id: 'wmb_revoke_key_g1',
      afscp_mount_binding_id: 'wmb_revoke_key_g1',
      afscp_namespace_id: 'ns_project_1',
      afscp_repo_id: 'repo_file_library_1',
      afscp_volume_id: 'vol_shared',
      project_storage_generation: 7,
      status: 'ready',
      mount_binding_status: 'issued',
      mount_binding_generation: 1,
      lease_expires_at: '2026-03-19T01:00:00.000Z',
      task_home_path: '/home/task_demo',
      workspace_path: '/home/task_demo/workspace',
      artifacts_path: '/home/task_demo/workspace/.artifacts',
      library_root_path: '.',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    };
    await docStore.upsert(collection, baseBinding.file_library_id, baseBinding);
    const revokeWorkloadMountBinding = vi.fn().mockImplementation(async (input: { mountBindingId: string }) => ({
      operation_id: `op_revoke_${input.mountBindingId}`,
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: input.mountBindingId },
      result: null,
      error: null,
    }));
    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding: vi.fn(),
        deleteWorkspaceBinding: vi.fn().mockResolvedValue(undefined),
      },
      {
        afscpProductClient: {
          createWorkloadMountBinding: vi.fn(),
          getWorkloadMountBinding: vi.fn(),
          revokeWorkloadMountBinding,
        },
      },
    );

    await provisioner.deleteWorkspaceBinding({
      workspaceId: 'ws_demo',
      fileLibraryId: baseBinding.file_library_id,
    });
    const firstKey = revokeWorkloadMountBinding.mock.calls[0]?.[0].idempotencyKey;

    await docStore.upsert(collection, baseBinding.file_library_id, {
      ...baseBinding,
      task_home_binding_id: 'wmb_revoke_key_g2',
      afscp_mount_binding_id: 'wmb_revoke_key_g2',
      mount_binding_generation: 2,
      status: 'ready',
      mount_binding_status: 'issued',
      updated_at: '2026-03-19T00:05:00.000Z',
    });
    await provisioner.deleteWorkspaceBinding({
      workspaceId: 'ws_demo',
      fileLibraryId: baseBinding.file_library_id,
    });
    const secondKey = revokeWorkloadMountBinding.mock.calls[1]?.[0].idempotencyKey;

    expect(firstKey).toMatch(/^workspace-mount-revoke:g1:/);
    expect(secondKey).toMatch(/^workspace-mount-revoke:g2:/);
    expect(secondKey).not.toBe(firstKey);
  });

  it.each(['released', 'revoked', 'expired', 'deleted'] as const)(
    'treats an existing %s tombstone delete as an idempotent no-op',
    async (status) => {
      const docStore = new InMemoryJsonDocStore();
      const mountStatus = (status === 'deleted' ? 'released' : status) as AfscpWorkloadMountBindingStatus;
      const binding: InternalAgentWorkspaceBinding = {
        file_library_id: `flib_terminal_${status}`,
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        provider: 'afscp',
        task_home_binding_id: `wmb_terminal_${status}`,
        afscp_mount_binding_id: `wmb_terminal_${status}`,
        afscp_namespace_id: 'ns_project_1',
        afscp_repo_id: 'repo_file_library_1',
        afscp_volume_id: 'vol_shared',
        project_storage_generation: 7,
        status,
        mount_binding_status: mountStatus,
        mount_binding_generation: 4,
        release_operation_id: 'op_terminal_release',
        release_requested_at: '2026-03-19T00:10:00.000Z',
        drain_started_at: '2026-03-19T00:10:01.000Z',
        drain_completed_at: '2026-03-19T00:10:02.000Z',
        lease_expires_at: '2026-03-19T01:00:00.000Z',
        task_home_path: '/home/task_demo',
        workspace_path: '/home/task_demo/workspace',
        artifacts_path: '/home/task_demo/workspace/.artifacts',
        library_root_path: '.',
        created_at: '2026-03-19T00:00:00.000Z',
        updated_at: '2026-03-19T00:10:02.000Z',
      };
      const collection = resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo');
      await docStore.upsert(collection, binding.file_library_id, binding);
      const deleteWorkspaceBinding = vi.fn().mockResolvedValue(undefined);
      const revokeWorkloadMountBinding = vi.fn().mockRejectedValue(workloadMountBindingNotFoundError());
      const provisioner = new InternalAgentWorkspaceProvisionerImpl(
        docStore,
        {
          ensureWorkspaceBinding: vi.fn(),
          deleteWorkspaceBinding,
        },
        {
          afscpProductClient: {
            createWorkloadMountBinding: vi.fn(),
            getWorkloadMountBinding: vi.fn(),
            revokeWorkloadMountBinding,
          },
        },
      );

      await expect(provisioner.deleteWorkspaceBinding({
        workspaceId: 'ws_demo',
        fileLibraryId: binding.file_library_id,
      })).resolves.toBeUndefined();

      expect(deleteWorkspaceBinding).not.toHaveBeenCalled();
      expect(revokeWorkloadMountBinding).not.toHaveBeenCalled();
      await expect(docStore.get<InternalAgentWorkspaceBinding>(collection, binding.file_library_id)).resolves.toMatchObject({
        status,
        mount_binding_status: mountStatus,
        afscp_mount_binding_id: binding.afscp_mount_binding_id,
        mount_binding_generation: 4,
        release_operation_id: 'op_terminal_release',
        drain_completed_at: '2026-03-19T00:10:02.000Z',
        updated_at: '2026-03-19T00:10:02.000Z',
      });
    },
  );

  function legacyCreateIdempotencyKey(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
    taskHomePath: string;
  }): string {
    const digest = createHash('sha256')
      .update(`${input.workspaceId}:${input.projectId}:${input.fileLibraryId}:${input.taskHomePath}`)
      .digest('base64url')
      .slice(0, 48);
    return `workspace-mount-create:${digest}`;
  }

  it.each(['released', 'revoked'] as const)(
    'rotates an existing terminal %s AFSCP workload mount binding before sandbox ensure',
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
        mount_binding_generation: 4,
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
      const createWorkloadMountBinding = vi.fn().mockResolvedValue({
        operation_id: 'op_mount_rotate',
        operation_state: 'succeeded',
        resource: { type: 'workload_mount_binding', id: 'wmb_rotated' },
        result: null,
        error: null,
      });
      const getWorkloadMountBinding = vi.fn().mockImplementation(async (input: { mountBindingId: string }) => {
        if (input.mountBindingId === 'wmb_existing_terminal') {
          return {
            mount_binding_id: 'wmb_existing_terminal',
            namespace_id: 'ns_project_1',
            repo_id: 'repo_file_library_1',
            volume_id: 'vol_shared',
            mount_path: '/home/task_demo',
            read_only: false,
            status,
            lease_expires_at: '2026-03-19T01:00:00.000Z',
          };
        }
        return {
          mount_binding_id: 'wmb_rotated',
          namespace_id: 'ns_project_1',
          repo_id: 'repo_file_library_1',
          volume_id: 'vol_shared',
          mount_path: '/home/task_demo',
          read_only: false,
          status: 'issued',
          lease_expires_at: '2026-03-19T02:00:00.000Z',
        };
      });
      const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
        binding_id: 'wmb_rotated',
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_rotated',
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

      const result = await provisioner.ensureWorkspaceBinding({
        workspaceId: 'ws_demo',
        projectId: 'proj_demo',
        fileLibraryId: 'flib_existing_mount_state',
        taskId: 'task_demo',
        actorUserId: 'user_demo',
      });

      expect(createWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
        namespaceId: 'ns_project_1',
        repoId: 'repo_file_library_1',
        mountPath: '/home/task_demo',
        idempotencyKey: expect.stringContaining(':g5:'),
      }));
      expect(createWorkloadMountBinding.mock.calls[0]?.[0].idempotencyKey).not.toBe(
        legacyCreateIdempotencyKey({
          workspaceId: 'ws_demo',
          projectId: 'proj_demo',
          fileLibraryId: 'flib_existing_mount_state',
          taskHomePath: '/home/task_demo',
        }),
      );
      expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
        namespaceId: 'ns_project_1',
        mountBindingId: 'wmb_existing_terminal',
      }));
      expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
        namespaceId: 'ns_project_1',
        mountBindingId: 'wmb_rotated',
      }));
      expect(ensureWorkspaceBinding).toHaveBeenCalledWith(
        'ws_demo',
        'proj_demo',
        'wmb_rotated',
        {
          namespace_id: 'ns_project_1',
          mount_binding_id: 'wmb_rotated',
        },
      );
      expect(result.workspaceMount.bindingId).toBe('wmb_rotated');
      expect(result.binding.task_home_binding_id).toBe('wmb_rotated');
      expect(result.binding.afscp_mount_binding_id).toBe('wmb_rotated');
      expect(result.binding.mount_binding_status).toBe('issued');
      expect(result.binding.mount_binding_generation).toBe(5);
      expect(result.binding.previous_afscp_mount_binding_id).toBe('wmb_existing_terminal');

      await expect(docStore.get<InternalAgentWorkspaceBinding>(
        resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
        'flib_existing_mount_state',
      )).resolves.toMatchObject({
        task_home_binding_id: 'wmb_rotated',
        afscp_mount_binding_id: 'wmb_rotated',
        mount_binding_status: 'issued',
        mount_binding_generation: 5,
        previous_afscp_mount_binding_id: 'wmb_existing_terminal',
      });
    },
  );

  it.each(['released', 'revoked'] as const)(
    'rotates generation when a missing local tombstone replays a terminal %s AFSCP create result',
    async (status) => {
      const docStore = new InMemoryJsonDocStore();
      const mappingRepo = await seedReadyAfscpLibrary({
        docStore,
        libraryId: 'flib_missing_tombstone_replay',
      });
      const replayedMountBindingId = `wmb_replayed_${status}`;
      const createWorkloadMountBinding = vi.fn()
        .mockResolvedValueOnce({
          operation_id: 'op_mount_replay_terminal',
          operation_state: 'succeeded',
          resource: { type: 'workload_mount_binding', id: replayedMountBindingId },
          result: null,
          error: null,
        })
        .mockResolvedValueOnce({
          operation_id: 'op_mount_after_replay',
          operation_state: 'succeeded',
          resource: { type: 'workload_mount_binding', id: 'wmb_after_missing_tombstone' },
          result: null,
          error: null,
        });
      const getWorkloadMountBinding = vi.fn().mockImplementation(async (input: { mountBindingId: string }) => {
        if (input.mountBindingId === replayedMountBindingId) {
          return {
            mount_binding_id: replayedMountBindingId,
            namespace_id: 'ns_project_1',
            repo_id: 'repo_file_library_1',
            volume_id: 'vol_shared',
            mount_path: '/home/task_demo',
            read_only: false,
            status,
            lease_expires_at: '2026-03-19T01:00:00.000Z',
          };
        }
        return {
          mount_binding_id: 'wmb_after_missing_tombstone',
          namespace_id: 'ns_project_1',
          repo_id: 'repo_file_library_1',
          volume_id: 'vol_shared',
          mount_path: '/home/task_demo',
          read_only: false,
          status: 'issued',
          lease_expires_at: '2026-03-19T02:00:00.000Z',
        };
      });
      const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
        binding_id: 'wmb_after_missing_tombstone',
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_after_missing_tombstone',
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

      const result = await provisioner.ensureWorkspaceBinding({
        workspaceId: 'ws_demo',
        projectId: 'proj_demo',
        fileLibraryId: 'flib_missing_tombstone_replay',
        taskId: 'task_demo',
        actorUserId: 'user_demo',
      });

      expect(createWorkloadMountBinding).toHaveBeenCalledTimes(2);
      expect(createWorkloadMountBinding.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        namespaceId: 'ns_project_1',
        repoId: 'repo_file_library_1',
        mountPath: '/home/task_demo',
        idempotencyKey: expect.stringContaining(':g1:'),
      }));
      expect(createWorkloadMountBinding.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
        namespaceId: 'ns_project_1',
        repoId: 'repo_file_library_1',
        mountPath: '/home/task_demo',
        idempotencyKey: expect.stringContaining(':g2:'),
      }));
      expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
        namespaceId: 'ns_project_1',
        mountBindingId: replayedMountBindingId,
      }));
      expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
        namespaceId: 'ns_project_1',
        mountBindingId: 'wmb_after_missing_tombstone',
      }));
      expect(ensureWorkspaceBinding).toHaveBeenCalledWith(
        'ws_demo',
        'proj_demo',
        'wmb_after_missing_tombstone',
        {
          namespace_id: 'ns_project_1',
          mount_binding_id: 'wmb_after_missing_tombstone',
        },
      );
      expect(result.workspaceMount.bindingId).toBe('wmb_after_missing_tombstone');
      expect(result.binding.previous_afscp_mount_binding_id).toBe(replayedMountBindingId);
      expect(result.binding.mount_binding_generation).toBe(2);
      expect(result.binding.mount_binding_status).toBe('issued');
      await expect(docStore.get<InternalAgentWorkspaceBinding>(
        resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
        'flib_missing_tombstone_replay',
      )).resolves.toMatchObject({
        afscp_mount_binding_id: 'wmb_after_missing_tombstone',
        mount_binding_generation: 2,
        previous_afscp_mount_binding_id: replayedMountBindingId,
        mount_binding_status: 'issued',
      });
    },
  );

  it('rotates a terminal tombstone when the old AFSCP workload mount binding was already GCed', async () => {
    const docStore = new InMemoryJsonDocStore();
    const mappingRepo = await seedReadyAfscpLibrary({
      docStore,
      libraryId: 'flib_terminal_missing_remote',
    });
    const existingBinding: InternalAgentWorkspaceBinding = {
      file_library_id: 'flib_terminal_missing_remote',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      provider: 'afscp',
      task_home_binding_id: 'wmb_missing_terminal',
      afscp_mount_binding_id: 'wmb_missing_terminal',
      afscp_namespace_id: 'ns_project_1',
      afscp_repo_id: 'repo_file_library_1',
      afscp_volume_id: 'vol_shared',
      project_storage_generation: 7,
      status: 'released',
      mount_binding_status: 'released',
      mount_binding_generation: 6,
      release_operation_id: 'op_missing_terminal_release',
      drain_completed_at: '2026-03-19T00:10:02.000Z',
      lease_expires_at: '2026-03-19T01:00:00.000Z',
      task_home_path: '/home/task_demo',
      workspace_path: '/home/task_demo/workspace',
      artifacts_path: '/home/task_demo/workspace/.artifacts',
      library_root_path: '.',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:10:02.000Z',
    };
    await docStore.upsert<InternalAgentWorkspaceBinding>(
      resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
      existingBinding.file_library_id,
      existingBinding,
    );
    const createWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_mount_after_gc',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_after_gc' },
      result: null,
      error: null,
    });
    const getWorkloadMountBinding = vi.fn().mockImplementation(async (input: { mountBindingId: string }) => {
      if (input.mountBindingId === 'wmb_missing_terminal') {
        throw workloadMountBindingNotFoundError();
      }
      return {
        mount_binding_id: 'wmb_after_gc',
        namespace_id: 'ns_project_1',
        repo_id: 'repo_file_library_1',
        volume_id: 'vol_shared',
        mount_path: '/home/task_demo',
        read_only: false,
        status: 'issued',
        lease_expires_at: '2026-03-19T02:00:00.000Z',
      };
    });
    const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
      binding_id: 'wmb_after_gc',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      namespace_id: 'ns_project_1',
      mount_binding_id: 'wmb_after_gc',
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

    const result = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_terminal_missing_remote',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
    });

    expect(createWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      mountPath: '/home/task_demo',
      idempotencyKey: expect.stringContaining(':g7:'),
    }));
    expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      mountBindingId: 'wmb_missing_terminal',
    }));
    expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      mountBindingId: 'wmb_after_gc',
    }));
    expect(ensureWorkspaceBinding).toHaveBeenCalledWith(
      'ws_demo',
      'proj_demo',
      'wmb_after_gc',
      {
        namespace_id: 'ns_project_1',
        mount_binding_id: 'wmb_after_gc',
      },
    );
    expect(result.workspaceMount.bindingId).toBe('wmb_after_gc');
    expect(result.binding.previous_afscp_mount_binding_id).toBe('wmb_missing_terminal');
    expect(result.binding.mount_binding_generation).toBe(7);
  });

  it('rotates a ready local binding with terminal mount status when the old AFSCP binding was already GCed', async () => {
    const docStore = new InMemoryJsonDocStore();
    const mappingRepo = await seedReadyAfscpLibrary({
      docStore,
      libraryId: 'flib_ready_terminal_mount_missing_remote',
    });
    const existingBinding: InternalAgentWorkspaceBinding = {
      file_library_id: 'flib_ready_terminal_mount_missing_remote',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      provider: 'afscp',
      task_home_binding_id: 'wmb_ready_terminal_mount',
      afscp_mount_binding_id: 'wmb_ready_terminal_mount',
      afscp_namespace_id: 'ns_project_1',
      afscp_repo_id: 'repo_file_library_1',
      afscp_volume_id: 'vol_shared',
      project_storage_generation: 7,
      status: 'ready',
      mount_binding_status: 'released',
      mount_binding_generation: 6,
      release_operation_id: 'op_ready_terminal_mount_release',
      drain_completed_at: '2026-03-19T00:10:02.000Z',
      lease_expires_at: '2026-03-19T01:00:00.000Z',
      task_home_path: '/home/task_demo',
      workspace_path: '/home/task_demo/workspace',
      artifacts_path: '/home/task_demo/workspace/.artifacts',
      library_root_path: '.',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:10:02.000Z',
    };
    await docStore.upsert<InternalAgentWorkspaceBinding>(
      resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
      existingBinding.file_library_id,
      existingBinding,
    );
    const createWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_mount_after_ready_terminal_gc',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_after_ready_terminal_gc' },
      result: null,
      error: null,
    });
    const getWorkloadMountBinding = vi.fn().mockImplementation(async (input: { mountBindingId: string }) => {
      if (input.mountBindingId === 'wmb_ready_terminal_mount') {
        throw workloadMountBindingNotFoundError();
      }
      return {
        mount_binding_id: 'wmb_after_ready_terminal_gc',
        namespace_id: 'ns_project_1',
        repo_id: 'repo_file_library_1',
        volume_id: 'vol_shared',
        mount_path: '/home/task_demo',
        read_only: false,
        status: 'issued',
        lease_expires_at: '2026-03-19T02:00:00.000Z',
      };
    });
    const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
      binding_id: 'wmb_after_ready_terminal_gc',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      namespace_id: 'ns_project_1',
      mount_binding_id: 'wmb_after_ready_terminal_gc',
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

    const result = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_ready_terminal_mount_missing_remote',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
    });

    expect(createWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: 'ns_project_1',
      repoId: 'repo_file_library_1',
      mountPath: '/home/task_demo',
      idempotencyKey: expect.stringContaining(':g7:'),
    }));
    expect(result.workspaceMount.bindingId).toBe('wmb_after_ready_terminal_gc');
    expect(result.binding.previous_afscp_mount_binding_id).toBe('wmb_ready_terminal_mount');
    expect(result.binding.mount_binding_generation).toBe(7);
  });

  it.each(['releasing', 'release_pending'] as const)(
    'rotates a %s local binding when terminal mount status proves the old release completed',
    async (localStatus) => {
      const docStore = new InMemoryJsonDocStore();
      const libraryId = `flib_${localStatus}_terminal_mount_reacquire`;
      const mappingRepo = await seedReadyAfscpLibrary({
        docStore,
        libraryId,
      });
      const oldMountBindingId = `wmb_${localStatus}_terminal_mount`;
      const newMountBindingId = `wmb_after_${localStatus}_terminal_mount`;
      const existingBinding: InternalAgentWorkspaceBinding = {
        file_library_id: libraryId,
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        provider: 'afscp',
        task_home_binding_id: oldMountBindingId,
        afscp_mount_binding_id: oldMountBindingId,
        afscp_namespace_id: 'ns_project_1',
        afscp_repo_id: 'repo_file_library_1',
        afscp_volume_id: 'vol_shared',
        project_storage_generation: 7,
        status: localStatus,
        mount_binding_status: 'released',
        mount_binding_generation: 6,
        release_operation_id: `op_${localStatus}_terminal_mount_release`,
        drain_completed_at: '2026-03-19T00:10:02.000Z',
        lease_expires_at: '2026-03-19T01:00:00.000Z',
        task_home_path: '/home/task_demo',
        workspace_path: '/home/task_demo/workspace',
        artifacts_path: '/home/task_demo/workspace/.artifacts',
        library_root_path: '.',
        created_at: '2026-03-19T00:00:00.000Z',
        updated_at: '2026-03-19T00:10:02.000Z',
      };
      await docStore.upsert<InternalAgentWorkspaceBinding>(
        resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
        existingBinding.file_library_id,
        existingBinding,
      );
      const createWorkloadMountBinding = vi.fn().mockResolvedValue({
        operation_id: `op_mount_after_${localStatus}_terminal_mount`,
        operation_state: 'succeeded',
        resource: { type: 'workload_mount_binding', id: newMountBindingId },
        result: null,
        error: null,
      });
      const getWorkloadMountBinding = vi.fn().mockImplementation(async (input: { mountBindingId: string }) => {
        if (input.mountBindingId === oldMountBindingId) {
          return {
            mount_binding_id: oldMountBindingId,
            namespace_id: 'ns_project_1',
            repo_id: 'repo_file_library_1',
            volume_id: 'vol_shared',
            mount_path: '/home/task_demo',
            read_only: false,
            status: 'released',
            lease_expires_at: '2026-03-19T01:00:00.000Z',
          };
        }
        return {
          mount_binding_id: newMountBindingId,
          namespace_id: 'ns_project_1',
          repo_id: 'repo_file_library_1',
          volume_id: 'vol_shared',
          mount_path: '/home/task_demo',
          read_only: false,
          status: 'issued',
          lease_expires_at: '2026-03-19T02:00:00.000Z',
        };
      });
      const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
        binding_id: newMountBindingId,
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        namespace_id: 'ns_project_1',
        mount_binding_id: newMountBindingId,
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

      const result = await provisioner.ensureWorkspaceBinding({
        workspaceId: 'ws_demo',
        projectId: 'proj_demo',
        fileLibraryId: libraryId,
        taskId: 'task_demo',
        actorUserId: 'user_demo',
      });

      expect(getWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
        namespaceId: 'ns_project_1',
        mountBindingId: oldMountBindingId,
      }));
      expect(createWorkloadMountBinding).toHaveBeenCalledWith(expect.objectContaining({
        namespaceId: 'ns_project_1',
        repoId: 'repo_file_library_1',
        mountPath: '/home/task_demo',
        idempotencyKey: expect.stringContaining(':g7:'),
      }));
      expect(ensureWorkspaceBinding).toHaveBeenCalledWith(
        'ws_demo',
        'proj_demo',
        newMountBindingId,
        {
          namespace_id: 'ns_project_1',
          mount_binding_id: newMountBindingId,
        },
      );
      expect(result.workspaceMount.bindingId).toBe(newMountBindingId);
      expect(result.binding.status).toBe('ready');
      expect(result.binding.mount_binding_status).toBe('issued');
      expect(result.binding.previous_afscp_mount_binding_id).toBe(oldMountBindingId);
      expect(result.binding.mount_binding_generation).toBe(7);
      await expect(docStore.get<InternalAgentWorkspaceBinding>(
        resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
        libraryId,
      )).resolves.toMatchObject({
        afscp_mount_binding_id: newMountBindingId,
        previous_afscp_mount_binding_id: oldMountBindingId,
        mount_binding_generation: 7,
        mount_binding_status: 'issued',
        status: 'ready',
      });
    },
  );

  it('does not rotate a terminal tombstone when the old AFSCP binding lookup fails with a non-missing error', async () => {
    const docStore = new InMemoryJsonDocStore();
    const mappingRepo = await seedReadyAfscpLibrary({
      docStore,
      libraryId: 'flib_terminal_lookup_unavailable',
    });
    const existingBinding: InternalAgentWorkspaceBinding = {
      file_library_id: 'flib_terminal_lookup_unavailable',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      provider: 'afscp',
      task_home_binding_id: 'wmb_lookup_unavailable',
      afscp_mount_binding_id: 'wmb_lookup_unavailable',
      afscp_namespace_id: 'ns_project_1',
      afscp_repo_id: 'repo_file_library_1',
      afscp_volume_id: 'vol_shared',
      project_storage_generation: 7,
      status: 'released',
      mount_binding_status: 'released',
      mount_binding_generation: 6,
      release_operation_id: 'op_lookup_unavailable_release',
      drain_completed_at: '2026-03-19T00:10:02.000Z',
      lease_expires_at: '2026-03-19T01:00:00.000Z',
      task_home_path: '/home/task_demo',
      workspace_path: '/home/task_demo/workspace',
      artifacts_path: '/home/task_demo/workspace/.artifacts',
      library_root_path: '.',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:10:02.000Z',
    };
    await docStore.upsert<InternalAgentWorkspaceBinding>(
      resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
      existingBinding.file_library_id,
      existingBinding,
    );
    const createWorkloadMountBinding = vi.fn();
    const getWorkloadMountBinding = vi.fn().mockRejectedValue(new AfscpClientError({
      status: 503,
      code: 'unavailable',
      message: 'unavailable',
      retryable: true,
      resource_kind: 'workload_mount_binding',
    }));
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
      fileLibraryId: 'flib_terminal_lookup_unavailable',
      taskId: 'task_demo',
      actorUserId: 'user_demo',
    })).rejects.toMatchObject({
      code: 'AGENT_WORKSPACE_AFSCP_UNAVAILABLE',
      retryable: true,
    });
    expect(createWorkloadMountBinding).not.toHaveBeenCalled();
    expect(ensureWorkspaceBinding).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', true],
    ['releasing', true],
    ['expired', false],
    ['failed', false],
    ['uncertain', false],
  ] as const)(
    'fails closed instead of rotating an existing unsafe %s AFSCP workload mount binding',
    async (status, retryable) => {
      const docStore = new InMemoryJsonDocStore();
      const mappingRepo = await seedReadyAfscpLibrary({
        docStore,
        libraryId: 'flib_existing_transitional_mount_state',
      });
      const existingBinding: InternalAgentWorkspaceBinding = {
        file_library_id: 'flib_existing_transitional_mount_state',
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        provider: 'afscp',
        task_home_binding_id: 'wmb_existing_transitional',
        afscp_mount_binding_id: 'wmb_existing_transitional',
        afscp_namespace_id: 'ns_project_1',
        afscp_repo_id: 'repo_file_library_1',
        afscp_volume_id: 'vol_shared',
        project_storage_generation: 7,
        status: 'ready',
        mount_binding_status: status as AfscpWorkloadMountBindingStatus,
        mount_binding_generation: 4,
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
        mount_binding_id: 'wmb_existing_transitional',
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
        fileLibraryId: 'flib_existing_transitional_mount_state',
        taskId: 'task_demo',
        actorUserId: 'user_demo',
      })).rejects.toMatchObject({
        code: 'AGENT_WORKSPACE_AFSCP_ERROR',
        retryable,
        metadata: {
          reason: 'mount_binding_status_unusable',
          mount_binding_status: status,
        },
      });
      expect(createWorkloadMountBinding).not.toHaveBeenCalled();
      expect(ensureWorkspaceBinding).not.toHaveBeenCalled();
    },
  );

  it.each(['releasing', 'release_pending'] as const)(
    'fails closed when the local workspace binding is already %s with non-terminal mount release',
    async (status) => {
      const docStore = new InMemoryJsonDocStore();
      const libraryId = `flib_local_${status}`;
      const mappingRepo = await seedReadyAfscpLibrary({
        docStore,
        libraryId,
      });
      const existingBinding: InternalAgentWorkspaceBinding = {
        file_library_id: libraryId,
        workspace_id: 'ws_demo',
        project_id: 'proj_demo',
        provider: 'afscp',
        task_home_binding_id: `wmb_local_${status}`,
        afscp_mount_binding_id: `wmb_local_${status}`,
        afscp_namespace_id: 'ns_project_1',
        afscp_repo_id: 'repo_file_library_1',
        afscp_volume_id: 'vol_shared',
        project_storage_generation: 7,
        status,
        mount_binding_status: 'releasing',
        mount_binding_generation: 4,
        release_operation_id: 'op_local_release_pending',
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
      const projectStorageBootstrapService = readyProjectStorageService();
      const createWorkloadMountBinding = vi.fn();
      const getWorkloadMountBinding = vi.fn();
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
          projectStorageBootstrapService,
          mappingRepo,
          resourceOwnershipStore: new ProjectAfscpResourceOwnershipStore(docStore),
        },
      );

      await expect(provisioner.ensureWorkspaceBinding({
        workspaceId: 'ws_demo',
        projectId: 'proj_demo',
        fileLibraryId: libraryId,
        taskId: 'task_demo',
        actorUserId: 'user_demo',
      })).rejects.toMatchObject({
        code: 'AGENT_WORKSPACE_AFSCP_ERROR',
        retryable: true,
        metadata: {
          reason: 'workspace_binding_releasing',
          workspace_binding_status: status,
        },
      });
      expect(projectStorageBootstrapService.ensureProjectStorageReady).not.toHaveBeenCalled();
      expect(createWorkloadMountBinding).not.toHaveBeenCalled();
      expect(getWorkloadMountBinding).not.toHaveBeenCalled();
      expect(ensureWorkspaceBinding).not.toHaveBeenCalled();
    },
  );

  it('uses a generation-scoped idempotency key for repeatable terminal binding rotation attempts', async () => {
    const docStore = new InMemoryJsonDocStore();
    const mappingRepo = await seedReadyAfscpLibrary({
      docStore,
      libraryId: 'flib_rotation_key',
    });
    const existingBinding: InternalAgentWorkspaceBinding = {
      file_library_id: 'flib_rotation_key',
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
      mount_binding_status: 'released',
      mount_binding_generation: 8,
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
    const createWorkloadMountBinding = vi.fn().mockResolvedValue({
      operation_id: 'op_mount_rotate',
      operation_state: 'succeeded',
      resource: { type: 'workload_mount_binding', id: 'wmb_rotated' },
      result: null,
      error: null,
    });
    const getWorkloadMountBinding = vi.fn().mockImplementation(async (input: { mountBindingId: string }) => {
      if (input.mountBindingId === 'wmb_existing_terminal') {
        return {
          mount_binding_id: 'wmb_existing_terminal',
          namespace_id: 'ns_project_1',
          repo_id: 'repo_file_library_1',
          volume_id: 'vol_shared',
          mount_path: '/home/task_demo',
          read_only: false,
          status: 'released',
          lease_expires_at: '2026-03-19T01:00:00.000Z',
        };
      }
      return {
        mount_binding_id: 'wmb_rotated',
        namespace_id: 'ns_project_1',
        repo_id: 'repo_file_library_1',
        volume_id: 'vol_shared',
        mount_path: '/home/task_demo',
        read_only: false,
        status: 'expired',
        lease_expires_at: '2026-03-19T02:00:00.000Z',
      };
    });
    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding: vi.fn(),
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

    for (const requestId of ['req_retry_1', 'req_retry_2']) {
      await expect(provisioner.ensureWorkspaceBinding({
        workspaceId: 'ws_demo',
        projectId: 'proj_demo',
        fileLibraryId: 'flib_rotation_key',
        taskId: 'task_demo',
        actorUserId: 'user_demo',
        requestId,
      })).rejects.toMatchObject({
        code: 'AGENT_WORKSPACE_AFSCP_ERROR',
      });
    }

    const firstKey = createWorkloadMountBinding.mock.calls[0]?.[0].idempotencyKey;
    const secondKey = createWorkloadMountBinding.mock.calls[1]?.[0].idempotencyKey;
    expect(firstKey).toBe(secondKey);
    expect(firstKey).toContain(':g9:');
    expect(firstKey).not.toBe(legacyCreateIdempotencyKey({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_rotation_key',
      taskHomePath: '/home/task_demo',
    }));
    await expect(docStore.get<InternalAgentWorkspaceBinding>(
      resolveWorkspaceScopedCollection('internal_agent_file_library_workspaces', 'ws_demo'),
      'flib_rotation_key',
    )).resolves.toMatchObject({
      afscp_mount_binding_id: 'wmb_existing_terminal',
      mount_binding_generation: 8,
    });
  });

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
