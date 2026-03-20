import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { V1PersistentVolume, V1PersistentVolumeClaim, V1Secret } from '@kubernetes/client-node';
import { JsonDocProjectFileLibraryMountAccessRepo } from './file-library-persistence.js';
import {
  InternalAgentWorkspaceProvisionerImpl,
  parseCsiMountOptions,
  sanitizeK8sName,
} from './internal-agent-workspace-provisioner.js';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';

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
  it('creates CSI resources with explicit storage class and mount options', async () => {
    const docStore = new InMemoryJsonDocStore();
    const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(docStore);
    const ensured: {
      secret?: V1Secret;
      pv?: V1PersistentVolume;
      pvc?: V1PersistentVolumeClaim;
    } = {};

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
      recommended_mount_path: '~/Agentsmith/Workspace Library',
      platform_notes: [],
      recommended_mount_commands: {
        linux: 'juicefs mount ...',
        macos: 'juicefs mount ...',
        windows: 'juicefs mount ...',
      },
      created_at: '2026-03-19T00:00:00.000Z',
    });

    const provisioner = new InternalAgentWorkspaceProvisionerImpl(
      docStore,
      {
        ensureSecret: async (_namespace, secret) => {
          ensured.secret = secret;
        },
        ensurePersistentVolume: async (volume) => {
          ensured.pv = volume;
        },
        ensurePersistentVolumeClaim: async (_namespace, claim) => {
          ensured.pvc = claim;
        },
        deleteSecret: async () => undefined,
        deletePersistentVolume: async () => undefined,
        deletePersistentVolumeClaim: async () => undefined,
      },
      {
        namespace: 'agentsmith-sandbox',
        storageCapacity: '2Ti',
        storageClassName: 'juicefs-static',
        mountOptions: ['writeback_cache', 'cache-size=204800'],
        subdir: '/workspaces/ws_demo/flib_demo',
        mountServiceAccount: 'juicefs-mount',
        mountImage: 'juicedata/mount:ce-v1.3.1',
        metadataHostOverride: 'kind-gateway',
        storageEndpointOverride: 'http://minio.internal:19000',
        storageCredentialSeed: 'seed-demo',
      },
    );

    const result = await provisioner.ensureWorkspaceBinding({
      workspaceId: 'ws_demo',
      projectId: 'proj_demo',
      fileLibraryId: 'flib_demo',
    });

    expect(result.claimName).toBeTruthy();
    expect(result.mountPath).toBe('/workspace');
    expect(ensured.secret?.stringData?.metaurl).toBe('postgres://juicefs:secret@kind-gateway:5432/juicefs_demo?sslmode=disable');
    expect(ensured.secret?.stringData?.bucket).toBe('http://minio.internal:19000/jfs-lib-flib-demo');
    expect(ensured.secret?.metadata?.labels?.['juicefs.com/validate-secret']).toBe('true');
    expect(ensured.pv?.spec?.fsType).toBe('juicefs');
    expect(ensured.pv?.spec?.storageClassName).toBe('juicefs-static');
    expect(ensured.pv?.spec?.mountOptions).toEqual(['writeback_cache', 'cache-size=204800']);
    expect(ensured.pv?.spec?.csi?.volumeAttributes).toEqual({
      subdir: '/workspaces/ws_demo/flib_demo',
      'juicefs/mount-service-account': 'juicefs-mount',
      'juicefs/mount-image': 'juicedata/mount:ce-v1.3.1',
    });
    expect(ensured.pvc?.spec?.storageClassName).toBe('juicefs-static');
    expect(result.binding.storage_class_name).toBe('juicefs-static');
    expect(result.binding.mount_options).toEqual(['writeback_cache', 'cache-size=204800']);
    expect(result.binding.subdir).toBe('/workspaces/ws_demo/flib_demo');
  });
});
