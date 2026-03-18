import { ApiException, CoreV1Api, KubeConfig, type V1PersistentVolume, type V1PersistentVolumeClaim, type V1Secret } from '@kubernetes/client-node';
import type { JsonDocStorePort } from '@mbos/ports';
import { createHash } from 'node:crypto';
import {
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from './file-library-persistence.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

const INTERNAL_AGENT_WORKSPACE_COLLECTION = 'internal_agent_file_library_workspaces';

export interface InternalAgentWorkspaceBinding {
  file_library_id: string;
  workspace_id: string;
  project_id: string;
  namespace: string;
  secret_name: string;
  pv_name: string;
  pvc_name: string;
  volume_handle: string;
  filesystem_name: string;
  created_at: string;
  updated_at: string;
}

export interface InternalAgentWorkspaceProvisioner {
  ensureWorkspaceBinding(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
  }): Promise<{
    claimName: string;
    mountPath: '/workspace';
    binding: InternalAgentWorkspaceBinding;
  }>;
  deleteWorkspaceBinding(input: {
    workspaceId: string;
    fileLibraryId: string;
  }): Promise<void>;
}

interface InternalAgentWorkspaceK8sClient {
  ensureSecret(namespace: string, secret: V1Secret): Promise<void>;
  ensurePersistentVolume(volume: V1PersistentVolume): Promise<void>;
  ensurePersistentVolumeClaim(namespace: string, claim: V1PersistentVolumeClaim): Promise<void>;
  deleteSecret(namespace: string, name: string): Promise<void>;
  deletePersistentVolume(name: string): Promise<void>;
  deletePersistentVolumeClaim(namespace: string, name: string): Promise<void>;
}

function bindingsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(INTERNAL_AGENT_WORKSPACE_COLLECTION, workspaceId);
}

function sanitizeK8sName(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return normalized || fallback;
}

function sanitizeSlug(value: string, fallback: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63) || fallback;
}

function deterministicBucket(fileLibraryId: string): string {
  return `jfs-lib-${sanitizeSlug(fileLibraryId, 'library').replace(/_/g, '-')}`.slice(0, 63);
}

function deterministicMinioUser(fileLibraryId: string): string {
  return `jfsm_${sanitizeSlug(fileLibraryId, 'library')}`.slice(0, 40);
}

function deriveSecret(seed: string, namespace: string, fileLibraryId: string, size = 32): string {
  const digest = createHash('sha256')
    .update(`${seed}:${namespace}:${fileLibraryId}`)
    .digest('base64url');
  return digest.slice(0, size);
}

function bindingNames(workspaceId: string, projectId: string, fileLibraryId: string): {
  secretName: string;
  pvName: string;
  pvcName: string;
  volumeHandle: string;
} {
  const suffix = sanitizeK8sName(`${workspaceId}-${projectId}-${fileLibraryId}`, 'file-library');
  return {
    secretName: sanitizeK8sName(`juicefs-secret-${suffix}`, 'juicefs-secret'),
    pvName: sanitizeK8sName(`juicefs-pv-${suffix}`, 'juicefs-pv'),
    pvcName: sanitizeK8sName(`juicefs-pvc-${suffix}`, 'juicefs-pvc'),
    volumeHandle: sanitizeK8sName(`juicefs-${suffix}`, 'juicefs-volume'),
  };
}

export class KubernetesInternalAgentWorkspaceK8sClient implements InternalAgentWorkspaceK8sClient {
  private readonly core: CoreV1Api;

  constructor() {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    this.core = kubeConfig.makeApiClient(CoreV1Api);
  }

  async ensureSecret(namespace: string, secret: V1Secret): Promise<void> {
    const name = secret.metadata?.name;
    if (!name) throw new Error('secret_name_required');
    try {
      const existing = await this.core.readNamespacedSecret({
        name,
        namespace,
      });
      await this.core.replaceNamespacedSecret({
        name,
        namespace,
        body: {
        ...secret,
        metadata: {
          ...secret.metadata,
          resourceVersion: existing.metadata?.resourceVersion,
        },
        },
      });
    } catch (error) {
      if (error instanceof ApiException && error.code === 404) {
        await this.core.createNamespacedSecret({
          namespace,
          body: secret,
        });
        return;
      }
      throw error;
    }
  }

  async ensurePersistentVolume(volume: V1PersistentVolume): Promise<void> {
    const name = volume.metadata?.name;
    if (!name) throw new Error('persistent_volume_name_required');
    try {
      await this.core.readPersistentVolume({
        name,
      });
    } catch (error) {
      if (error instanceof ApiException && error.code === 404) {
        await this.core.createPersistentVolume({
          body: volume,
        });
        return;
      }
      throw error;
    }
  }

  async ensurePersistentVolumeClaim(namespace: string, claim: V1PersistentVolumeClaim): Promise<void> {
    const name = claim.metadata?.name;
    if (!name) throw new Error('persistent_volume_claim_name_required');
    try {
      await this.core.readNamespacedPersistentVolumeClaim({
        name,
        namespace,
      });
    } catch (error) {
      if (error instanceof ApiException && error.code === 404) {
        await this.core.createNamespacedPersistentVolumeClaim({
          namespace,
          body: claim,
        });
        return;
      }
      throw error;
    }
  }

  async deleteSecret(namespace: string, name: string): Promise<void> {
    try {
      await this.core.deleteNamespacedSecret({
        name,
        namespace,
      });
    } catch (error) {
      if (error instanceof ApiException && error.code === 404) return;
      throw error;
    }
  }

  async deletePersistentVolume(name: string): Promise<void> {
    try {
      await this.core.deletePersistentVolume({
        name,
      });
    } catch (error) {
      if (error instanceof ApiException && error.code === 404) return;
      throw error;
    }
  }

  async deletePersistentVolumeClaim(namespace: string, name: string): Promise<void> {
    try {
      await this.core.deleteNamespacedPersistentVolumeClaim({
        name,
        namespace,
      });
    } catch (error) {
      if (error instanceof ApiException && error.code === 404) return;
      throw error;
    }
  }
}

export class InternalAgentWorkspaceProvisionerImpl implements InternalAgentWorkspaceProvisioner {
  private readonly catalogRepo: JsonDocProjectFileLibraryCatalogRepo;
  private readonly mountAccessRepo: JsonDocProjectFileLibraryMountAccessRepo;

  constructor(
    private readonly docStore: JsonDocStorePort,
    private readonly k8sClient: InternalAgentWorkspaceK8sClient,
    private readonly options: {
      namespace: string;
      csiDriver?: string;
      storageCapacity?: string;
      metadataHostOverride?: string;
      storageEndpointOverride?: string;
      storageCredentialSeed?: string;
    },
  ) {
    this.catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(docStore);
    this.mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(docStore);
  }

  async ensureWorkspaceBinding(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
  }): Promise<{
    claimName: string;
    mountPath: '/workspace';
    binding: InternalAgentWorkspaceBinding;
  }> {
    const library = await this.catalogRepo.getById(input.workspaceId, input.projectId, input.fileLibraryId);
    if (!library) {
      throw Object.assign(new Error('file_library_not_found'), { code: 'FILE_LIBRARY_NOT_FOUND' });
    }
    const mountAccess = await this.mountAccessRepo.getById(input.workspaceId, input.projectId, input.fileLibraryId);
    if (!mountAccess?.metadata_url) {
      throw Object.assign(new Error('file_library_workspace_access_unavailable'), {
        code: 'FILE_LIBRARY_WORKSPACE_ACCESS_UNAVAILABLE',
      });
    }

    const collection = bindingsCollection(input.workspaceId);
    const existing = await this.docStore.get<InternalAgentWorkspaceBinding>(collection, input.fileLibraryId);
    const now = new Date().toISOString();
    const names = bindingNames(input.workspaceId, input.projectId, input.fileLibraryId);
    const binding: InternalAgentWorkspaceBinding = existing ?? {
      file_library_id: input.fileLibraryId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      namespace: this.options.namespace,
      secret_name: names.secretName,
      pv_name: names.pvName,
      pvc_name: names.pvcName,
      volume_handle: names.volumeHandle,
      filesystem_name: library.filesystem_name,
      created_at: now,
      updated_at: now,
    };
    binding.updated_at = now;
    binding.filesystem_name = library.filesystem_name;

    await this.k8sClient.ensureSecret(
      binding.namespace,
      this.buildSecret(binding, this.resolveMetadataUrlForInternalMount(mountAccess.metadata_url)),
    );
    await this.k8sClient.ensurePersistentVolume(this.buildPersistentVolume(binding));
    await this.k8sClient.ensurePersistentVolumeClaim(binding.namespace, this.buildPersistentVolumeClaim(binding));
    await this.docStore.upsert(collection, input.fileLibraryId, binding);

    return {
      claimName: binding.pvc_name,
      mountPath: '/workspace',
      binding,
    };
  }

  async deleteWorkspaceBinding(input: {
    workspaceId: string;
    fileLibraryId: string;
  }): Promise<void> {
    const collection = bindingsCollection(input.workspaceId);
    const existing = await this.docStore.get<InternalAgentWorkspaceBinding>(collection, input.fileLibraryId);
    if (!existing) return;
    await this.k8sClient.deletePersistentVolumeClaim(existing.namespace, existing.pvc_name);
    await this.k8sClient.deletePersistentVolume(existing.pv_name);
    await this.k8sClient.deleteSecret(existing.namespace, existing.secret_name);
    await this.docStore.delete(collection, input.fileLibraryId);
  }

  private buildSecret(binding: InternalAgentWorkspaceBinding, metadataUrl: string): V1Secret {
    const storageEndpoint = this.options.storageEndpointOverride?.trim() || 'http://localhost:19000';
    const bucketName = deterministicBucket(binding.file_library_id);
    const storageCredentialSeed = this.options.storageCredentialSeed?.trim() || 'agentsmith-file-library-gateway-seed';
    return {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: binding.secret_name,
        namespace: binding.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentsmith',
          'mbos.io/file-library-id': binding.file_library_id,
        },
      },
      type: 'Opaque',
      stringData: {
        name: binding.filesystem_name,
        metaurl: metadataUrl,
        storage: 's3',
        bucket: `${storageEndpoint.replace(/\/+$/, '')}/${bucketName}`,
        'access-key': deterministicMinioUser(binding.file_library_id),
        'secret-key': deriveSecret(storageCredentialSeed, 'minio-backend-user', binding.file_library_id, 32),
      },
    };
  }

  private resolveMetadataUrlForInternalMount(metadataUrl: string): string {
    const hostOverride = this.options.metadataHostOverride?.trim();
    if (!hostOverride) return metadataUrl;
    let parsed: URL;
    try {
      parsed = new URL(metadataUrl);
    } catch {
      return metadataUrl;
    }
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return metadataUrl;
    }
    parsed.hostname = hostOverride;
    return parsed.toString();
  }

  private buildPersistentVolume(binding: InternalAgentWorkspaceBinding): V1PersistentVolume {
    return {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: {
        name: binding.pv_name,
        labels: {
          'app.kubernetes.io/managed-by': 'agentsmith',
          'mbos.io/file-library-id': binding.file_library_id,
        },
      },
      spec: {
        capacity: { storage: this.options.storageCapacity ?? '1Pi' },
        accessModes: ['ReadWriteMany'],
        persistentVolumeReclaimPolicy: 'Retain',
        volumeMode: 'Filesystem',
        storageClassName: '',
        csi: {
          driver: this.options.csiDriver ?? 'csi.juicefs.com',
          volumeHandle: binding.volume_handle,
          nodePublishSecretRef: {
            name: binding.secret_name,
            namespace: binding.namespace,
          },
        },
      },
    };
  }

  private buildPersistentVolumeClaim(binding: InternalAgentWorkspaceBinding): V1PersistentVolumeClaim {
    return {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: binding.pvc_name,
        namespace: binding.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'agentsmith',
          'mbos.io/file-library-id': binding.file_library_id,
        },
      },
      spec: {
        accessModes: ['ReadWriteMany'],
        storageClassName: '',
        volumeName: binding.pv_name,
        resources: {
          requests: {
            storage: this.options.storageCapacity ?? '1Pi',
          },
        },
      },
    };
  }
}
