import type { JsonDocStorePort } from '@mbos/ports';
import {
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from './file-library-persistence.js';
import type { SandboxWorkspaceBindingBody, SandboxWorkspaceBindingResponse } from './sandbox-manager-client.js';
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
  mount_options?: string[];
  storage_class_name?: string;
  subdir?: string;
  created_at: string;
  updated_at: string;
}

export interface InternalAgentWorkspaceMount {
  bindingId: string;
  mountPath: '/workspace';
  readOnly?: boolean;
}

export interface InternalAgentWorkspaceProvisioner {
  ensureWorkspaceBinding(input: {
    workspaceId: string;
    projectId: string;
    fileLibraryId: string;
  }): Promise<{
    workspaceMount: InternalAgentWorkspaceMount;
    binding: InternalAgentWorkspaceBinding;
  }>;
  deleteWorkspaceBinding(input: {
    workspaceId: string;
    fileLibraryId: string;
  }): Promise<void>;
}

export type InternalAgentWorkspaceBindingManager = InternalAgentWorkspaceProvisioner;

interface InternalAgentWorkspaceK8sClient {
  ensureWorkspaceBinding(
    workspaceId: string,
    projectId: string,
    bindingId: string,
    body: SandboxWorkspaceBindingBody,
  ): Promise<SandboxWorkspaceBindingResponse>;
  deleteWorkspaceBinding(workspaceId: string, projectId: string, bindingId: string): Promise<void>;
}

function parseCsiMountOptions(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function bindingsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(INTERNAL_AGENT_WORKSPACE_COLLECTION, workspaceId);
}

export function sanitizeK8sName(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
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
      storageClassName?: string;
      mountOptions?: string[];
      subdir?: string;
      mountServiceAccount?: string;
      mountImage?: string;
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
    workspaceMount: InternalAgentWorkspaceMount;
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
      mount_options: this.options.mountOptions?.filter(Boolean) ?? [],
      storage_class_name: this.options.storageClassName?.trim() || '',
      subdir: this.options.subdir?.trim() || '',
      created_at: now,
      updated_at: now,
    };
    binding.updated_at = now;
    binding.filesystem_name = library.filesystem_name;
    binding.mount_options = this.options.mountOptions?.filter(Boolean) ?? binding.mount_options ?? [];
    binding.storage_class_name = this.options.storageClassName?.trim() || binding.storage_class_name || '';
    binding.subdir = this.options.subdir?.trim() || binding.subdir || '';

    const remoteBinding = await this.k8sClient.ensureWorkspaceBinding(input.workspaceId, input.projectId, input.fileLibraryId, {
      file_library_id: input.fileLibraryId,
      filesystem_name: library.filesystem_name,
      metadata_url: this.resolveMetadataUrlForInternalMount(mountAccess.metadata_url),
      ...(this.options.storageEndpointOverride?.trim()
        ? { storage_endpoint: this.options.storageEndpointOverride.trim() }
        : {}),
      ...(this.options.storageCapacity?.trim()
        ? { storage_capacity: this.options.storageCapacity.trim() }
        : {}),
      ...(this.options.storageClassName?.trim()
        ? { storage_class_name: this.options.storageClassName.trim() }
        : {}),
      ...(binding.mount_options && binding.mount_options.length > 0
        ? { mount_options: binding.mount_options }
        : {}),
      ...(binding.subdir ? { subdir: binding.subdir } : {}),
      ...(this.options.mountServiceAccount?.trim()
        ? { mount_service_account: this.options.mountServiceAccount.trim() }
        : {}),
      ...(this.options.mountImage?.trim()
        ? { mount_image: this.options.mountImage.trim() }
        : {}),
    });
    binding.namespace = remoteBinding.namespace || binding.namespace;
    binding.secret_name = remoteBinding.secret_name || binding.secret_name;
    binding.pv_name = remoteBinding.pv_name || binding.pv_name;
    binding.pvc_name = remoteBinding.pvc_name || binding.pvc_name;
    binding.volume_handle = remoteBinding.volume_handle || binding.volume_handle;
    await this.docStore.upsert(collection, input.fileLibraryId, binding);

    return {
      workspaceMount: {
        bindingId: binding.file_library_id,
        mountPath: '/workspace',
      },
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
    await this.k8sClient.deleteWorkspaceBinding(input.workspaceId, existing.project_id, input.fileLibraryId);
    await this.docStore.delete(collection, input.fileLibraryId);
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

}

export { parseCsiMountOptions };
