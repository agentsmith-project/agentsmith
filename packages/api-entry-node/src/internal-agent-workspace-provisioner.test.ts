import { describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { JsonDocProjectFileLibraryCatalogRepo, JsonDocProjectFileLibraryMountAccessRepo } from './file-library-persistence.js';
import {
  InternalAgentWorkspaceProvisionerImpl,
  parseCsiMountOptions,
  sanitizeK8sName,
} from './internal-agent-workspace-provisioner.js';

describe('sanitizeK8sName', () => {
  it('does not leave a trailing dash after truncation', () => {
    expect(
      sanitizeK8sName(
        'juicefs-pv-feishu-demo-workspace-proj-1773965427268-85257-flib-52deaa10bf04',
        'fallback',
      ),
    ).toBe('juicefs-pv-feishu-demo-workspace-proj-1773965427268-85257-flib');
  });
});

describe('parseCsiMountOptions', () => {
  it('parses comma and newline separated options', () => {
    expect(parseCsiMountOptions('cache-size=204800,writeback_cache\nbuffer-size=1024')).toEqual([
      'cache-size=204800',
      'writeback_cache',
      'buffer-size=1024',
    ]);
  });
});

describe('InternalAgentWorkspaceProvisionerImpl', () => {
  it('delegates workspace binding lifecycle to sandbox and mirrors the binding record', async () => {
    const docStore = new InMemoryJsonDocStore();
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(docStore);

    await catalogRepo.save({
      id: 'flib_demo',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      name: 'Workspace Library',
      description: 'Demo library',
      status: 'ready',
      filesystem_name: 'jfs_ws_demo_proj_demo_workspace_library',
      created_by_user_id: 'user_demo',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    } as never);
    await mountAccessRepo.save('ws_demo', 'proj_demo', 'flib_demo', {
      filesystem_name: 'jfs_ws_demo_proj_demo_workspace_library',
      metadata_url: 'postgres://juicefs:secret@localhost:5432/juicefs_demo',
      storage_bucket_url: 'http://localhost:19000/jfs_ws_demo_proj_demo_workspace_library',
      recommended_mount_path: '~/Agentsmith/Workspace Library',
      platform_notes: [],
      recommended_mount_commands: {
        linux: 'juicefs mount ...',
        macos: 'juicefs mount ...',
        windows: 'juicefs mount ...',
      },
      created_at: '2026-03-19T00:00:00.000Z',
    });

    const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
      binding_id: 'flib_demo',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      file_library_id: 'flib_demo',
      status: 'ready',
      namespace: 'agentsmith-sandbox',
      secret_name: 'juicefs-secret-demo',
      pv_name: 'juicefs-pv-demo',
      pvc_name: 'juicefs-pvc-demo',
      volume_handle: 'juicefs-demo',
      filesystem_name: 'jfs_ws_demo_proj_demo_workspace_library',
      mount_path: '/workspace/task_demo',
      storage_class_name: 'juicefs-static',
      mount_options: ['writeback_cache', 'cache-size=204800'],
      subdir: '/workspaces/ws_demo/flib_demo',
    });

    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding,
        deleteWorkspaceBinding: vi.fn().mockResolvedValue(undefined),
      },
      {
        namespace: '',
        storageCapacity: '2Ti',
        storageClassName: 'juicefs-static',
        mountOptions: ['writeback_cache', 'cache-size=204800'],
        subdir: '/workspaces/ws_demo/flib_demo',
        mountServiceAccount: 'juicefs-mount',
        mountImage: 'juicedata/mount:ce-v1.3.1',
        metadataHostOverride: 'postgres-external.agentsmith-sandbox.svc.cluster.local',
        metadataPortOverride: '5432',
        bucketEndpointForInternalMount: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000',
      },
    );

    const result = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_demo',
      taskId: 'task_demo',
    });

    expect(ensureWorkspaceBinding).toHaveBeenCalledWith(
      'ws_demo',
      'proj_demo',
      'flib_demo',
      expect.objectContaining({
        file_library_id: 'flib_demo',
        filesystem_name: 'jfs_ws_demo_proj_demo_workspace_library',
        metadata_url: 'postgres://juicefs:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/juicefs_demo?sslmode=disable',
        mount_path: '/workspace/task_demo',
        storage_endpoint: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000',
        storage_class_name: 'juicefs-static',
        mount_options: ['writeback_cache', 'cache-size=204800'],
        subdir: '/workspaces/ws_demo/flib_demo',
        mount_service_account: 'juicefs-mount',
        mount_image: 'juicedata/mount:ce-v1.3.1',
      }),
    );
    expect(result.workspaceMount).toEqual({
      bindingId: 'flib_demo',
      mountPath: '/workspace/task_demo',
    });
    expect(result.binding.pvc_name).toBe('juicefs-pvc-demo');
    expect(result.binding.storage_class_name).toBe('juicefs-static');
  });

  it('always rewrites metadata host for internal mounts when an override is configured', async () => {
    const docStore = new InMemoryJsonDocStore();
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(docStore);

    await catalogRepo.save({
      id: 'flib_public',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      name: 'Workspace Library',
      description: 'Demo library',
      status: 'ready',
      filesystem_name: 'jfs_ws_demo_proj_demo_workspace_library',
      created_by_user_id: 'user_demo',
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    } as never);
    await mountAccessRepo.save('ws_demo', 'proj_demo', 'flib_public', {
      filesystem_name: 'jfs_ws_demo_proj_demo_workspace_library',
      metadata_url: 'postgres://juicefs:secret@192.168.0.220:15432/juicefs_demo',
      storage_bucket_url: 'http://192.168.0.220:19000/jfs_ws_demo_proj_demo_workspace_library',
      recommended_mount_path: '~/Agentsmith/Workspace Library',
      platform_notes: [],
      recommended_mount_commands: {
        linux: 'juicefs mount ...',
        macos: 'juicefs mount ...',
        windows: 'juicefs mount ...',
      },
      created_at: '2026-03-19T00:00:00.000Z',
    });

    const ensureWorkspaceBinding = vi.fn().mockResolvedValue({
      binding_id: 'flib_public',
      workspace_id: 'ws_demo',
      project_id: 'proj_demo',
      file_library_id: 'flib_public',
      status: 'ready',
      namespace: 'agentsmith-sandbox',
      secret_name: 'juicefs-secret-demo',
      pv_name: 'juicefs-pv-demo',
      pvc_name: 'juicefs-pvc-demo',
      volume_handle: 'juicefs-demo',
      filesystem_name: 'jfs_ws_demo_proj_demo_workspace_library',
      mount_path: '/workspace/task_public',
    });

    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureWorkspaceBinding,
        deleteWorkspaceBinding: vi.fn().mockResolvedValue(undefined),
      },
      {
        namespace: '',
        metadataHostOverride: 'postgres-external.agentsmith-sandbox.svc.cluster.local',
        metadataPortOverride: '5432',
      },
    );

    await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_public',
      taskId: 'task_public',
    });

    expect(ensureWorkspaceBinding).toHaveBeenCalledWith(
      'ws_demo',
      'proj_demo',
      'flib_public',
      expect.objectContaining({
        metadata_url: 'postgres://juicefs:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/juicefs_demo',
        mount_path: '/workspace/task_public',
      }),
    );
  });
});
