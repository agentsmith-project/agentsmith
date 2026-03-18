import { describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  buildFileLibraryRecord,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from './file-library-persistence.js';
import { InternalAgentWorkspaceProvisionerImpl } from './internal-agent-workspace-provisioner.js';

describe('internal-agent-workspace-provisioner', () => {
  it('creates and stores a stable workspace binding for a file library', async () => {
    const docStore = new InMemoryJsonDocStore();
    const k8sClient = {
      ensureSecret: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolume: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolumeClaim: vi.fn().mockResolvedValue(undefined),
    };
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(docStore);
    const library = buildFileLibraryRecord({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      name: 'Project Workspace',
      filesystemName: 'ws-proj-workspace',
      createdByUserId: 'user_1',
      status: 'ready',
    });
    await catalogRepo.save(library);
    await mountAccessRepo.save('ws_1', 'proj_1', library.id, {
      filesystem_name: library.filesystem_name,
      metadata_url: 'postgres://juicefs-user:secret@db:5432/juicefs',
      recommended_mount_path: '/tmp/mount',
      platform_notes: [],
      recommended_mount_commands: {
        linux: 'juicefs mount',
        macos: 'juicefs mount',
        windows: 'juicefs mount',
      },
      created_at: new Date().toISOString(),
    });

    const provisioner = new InternalAgentWorkspaceProvisionerImpl(docStore, k8sClient, {
      namespace: 'agentsmith-sandbox',
    });

    const result = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_1',
      projectId: 'proj_1',
      fileLibraryId: library.id,
    });

    expect(result.claimName).toMatch(/^juicefs-pvc-/);
    expect(result.mountPath).toBe('/workspace');
    expect(k8sClient.ensureSecret).toHaveBeenCalledTimes(1);
    expect(k8sClient.ensurePersistentVolume).toHaveBeenCalledTimes(1);
    expect(k8sClient.ensurePersistentVolumeClaim).toHaveBeenCalledTimes(1);
    expect(k8sClient.ensureSecret).toHaveBeenCalledWith(
      'agentsmith-sandbox',
      expect.objectContaining({
        stringData: expect.objectContaining({
          name: 'ws-proj-workspace',
          metaurl: 'postgres://juicefs-user:secret@db:5432/juicefs',
          storage: 's3',
          bucket: expect.stringContaining('/jfs-lib-'),
          'access-key': expect.stringMatching(/^jfsm_/),
          'secret-key': expect.any(String),
        }),
      }),
    );
  });

  it('rewrites localhost metadata urls for internal k8s mounts when a host override is configured', async () => {
    const docStore = new InMemoryJsonDocStore();
    const k8sClient = {
      ensureSecret: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolume: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolumeClaim: vi.fn().mockResolvedValue(undefined),
    };
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(docStore);
    const library = buildFileLibraryRecord({
      workspaceId: 'ws_rewrite',
      projectId: 'proj_rewrite',
      name: 'Rewrite Workspace',
      filesystemName: 'rewrite-workspace',
      createdByUserId: 'user_1',
      status: 'ready',
    });
    await catalogRepo.save(library);
    await mountAccessRepo.save('ws_rewrite', 'proj_rewrite', library.id, {
      filesystem_name: library.filesystem_name,
      metadata_url: 'postgres://juicefs-user:secret@localhost:15432/juicefs',
      recommended_mount_path: '/tmp/mount',
      platform_notes: [],
      recommended_mount_commands: {
        linux: 'juicefs mount',
        macos: 'juicefs mount',
        windows: 'juicefs mount',
      },
      created_at: new Date().toISOString(),
    });

    const provisioner = new InternalAgentWorkspaceProvisionerImpl(docStore, k8sClient, {
      namespace: 'agentsmith-sandbox',
      metadataHostOverride: '172.19.0.1',
    });

    await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_rewrite',
      projectId: 'proj_rewrite',
      fileLibraryId: library.id,
    });

    expect(k8sClient.ensureSecret).toHaveBeenCalledWith(
      'agentsmith-sandbox',
      expect.objectContaining({
        stringData: expect.objectContaining({
          metaurl: 'postgres://juicefs-user:secret@172.19.0.1:15432/juicefs',
        }),
      }),
    );
  });

  it('writes an internal storage endpoint override into the JuiceFS CSI secret', async () => {
    const docStore = new InMemoryJsonDocStore();
    const k8sClient = {
      ensureSecret: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolume: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolumeClaim: vi.fn().mockResolvedValue(undefined),
    };
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(docStore);
    const library = buildFileLibraryRecord({
      workspaceId: 'ws_storage',
      projectId: 'proj_storage',
      name: 'Storage Workspace',
      filesystemName: 'storage-workspace',
      createdByUserId: 'user_1',
      status: 'ready',
    });
    await catalogRepo.save(library);
    await mountAccessRepo.save('ws_storage', 'proj_storage', library.id, {
      filesystem_name: library.filesystem_name,
      metadata_url: 'postgres://juicefs-user:secret@db:5432/juicefs',
      recommended_mount_path: '/tmp/mount',
      platform_notes: [],
      recommended_mount_commands: {
        linux: 'juicefs mount',
        macos: 'juicefs mount',
        windows: 'juicefs mount',
      },
      created_at: new Date().toISOString(),
    });

    const provisioner = new InternalAgentWorkspaceProvisionerImpl(docStore, k8sClient, {
      namespace: 'agentsmith-sandbox',
      storageEndpointOverride: 'http://172.19.0.1:19000',
      storageCredentialSeed: 'seed-for-tests',
    });

    await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_storage',
      projectId: 'proj_storage',
      fileLibraryId: library.id,
    });

    expect(k8sClient.ensureSecret).toHaveBeenCalledWith(
      'agentsmith-sandbox',
      expect.objectContaining({
        stringData: expect.objectContaining({
          storage: 's3',
          bucket: expect.stringMatching(/^http:\/\/172\.19\.0\.1:19000\/jfs-lib-/),
          'access-key': expect.stringMatching(/^jfsm_/),
          'secret-key': expect.any(String),
        }),
      }),
    );
  });

  it('reuses an existing workspace binding document for repeated provisioning', async () => {
    const docStore = new InMemoryJsonDocStore();
    const k8sClient = {
      ensureSecret: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolume: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolumeClaim: vi.fn().mockResolvedValue(undefined),
    };
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(docStore);
    const library = buildFileLibraryRecord({
      workspaceId: 'ws_2',
      projectId: 'proj_2',
      name: 'Quant Workspace',
      filesystemName: 'quant-workspace',
      createdByUserId: 'user_1',
      status: 'ready',
    });
    await catalogRepo.save(library);
    await mountAccessRepo.save('ws_2', 'proj_2', library.id, {
      filesystem_name: library.filesystem_name,
      metadata_url: 'postgres://juicefs-user:secret@db:5432/juicefs',
      recommended_mount_path: '/tmp/mount',
      platform_notes: [],
      recommended_mount_commands: {
        linux: 'juicefs mount',
        macos: 'juicefs mount',
        windows: 'juicefs mount',
      },
      created_at: new Date().toISOString(),
    });

    const provisioner = new InternalAgentWorkspaceProvisionerImpl(docStore, k8sClient, {
      namespace: 'agentsmith-sandbox',
    });

    const first = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_2',
      projectId: 'proj_2',
      fileLibraryId: library.id,
    });
    const second = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_2',
      projectId: 'proj_2',
      fileLibraryId: library.id,
    });

    expect(second.claimName).toBe(first.claimName);
    expect(second.binding.secret_name).toBe(first.binding.secret_name);
    expect(k8sClient.ensureSecret).toHaveBeenCalledTimes(2);
  });

  it('deletes k8s resources and stored binding on cleanup', async () => {
    const docStore = new InMemoryJsonDocStore();
    const k8sClient = {
      ensureSecret: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolume: vi.fn().mockResolvedValue(undefined),
      ensurePersistentVolumeClaim: vi.fn().mockResolvedValue(undefined),
      deleteSecret: vi.fn().mockResolvedValue(undefined),
      deletePersistentVolume: vi.fn().mockResolvedValue(undefined),
      deletePersistentVolumeClaim: vi.fn().mockResolvedValue(undefined),
    };
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(docStore);
    const library = buildFileLibraryRecord({
      workspaceId: 'ws_3',
      projectId: 'proj_3',
      name: 'Cleanup Workspace',
      filesystemName: 'cleanup-workspace',
      createdByUserId: 'user_1',
      status: 'ready',
    });
    await catalogRepo.save(library);
    await mountAccessRepo.save('ws_3', 'proj_3', library.id, {
      filesystem_name: library.filesystem_name,
      metadata_url: 'postgres://juicefs-user:secret@db:5432/juicefs',
      recommended_mount_path: '/tmp/mount',
      platform_notes: [],
      recommended_mount_commands: {
        linux: 'juicefs mount',
        macos: 'juicefs mount',
        windows: 'juicefs mount',
      },
      created_at: new Date().toISOString(),
    });
    const provisioner = new InternalAgentWorkspaceProvisionerImpl(docStore, k8sClient, {
      namespace: 'agentsmith-sandbox',
    });

    const binding = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_3',
      projectId: 'proj_3',
      fileLibraryId: library.id,
    });
    await provisioner.deleteWorkspaceBinding({
      workspaceId: 'ws_3',
      fileLibraryId: library.id,
    });

    expect(k8sClient.deletePersistentVolumeClaim).toHaveBeenCalledWith('agentsmith-sandbox', binding.claimName);
    expect(k8sClient.deletePersistentVolume).toHaveBeenCalledWith(binding.binding.pv_name);
    expect(k8sClient.deleteSecret).toHaveBeenCalledWith('agentsmith-sandbox', binding.binding.secret_name);
  });
});
