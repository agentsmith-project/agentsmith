import type { NodeApiDeps } from './node-api-deps.js';
import {
  buildFileLibraryRecord,
  JsonDocProjectFileLibraryBackendRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
  normalizeFileLibraryMetadataUrl,
} from './file-library-persistence.js';

export function mapFileLibraryInfraError(error: unknown): {
  statusCode: number;
  errorCode: string;
  message: string;
} {
  const message = error instanceof Error ? error.message : 'file_library_operation_failed';
  if (message === 'file_library_juicefs_cli_missing') {
    return { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message };
  }
  if (message === 'file_library_mc_cli_missing') {
    return { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message };
  }
  if (message.startsWith('file_library_env_missing_')) {
    return { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message };
  }
  if (message === 'file_library_backend_unavailable') {
    return { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message };
  }
  if (message === 'file_library_not_empty') {
    return { statusCode: 409, errorCode: 'FILE_LIBRARY_NOT_EMPTY', message };
  }
  return {
    statusCode: 502,
    errorCode: 'FILE_LIBRARY_OPERATION_FAILED',
    message,
  };
}

export function buildFilesystemName(workspaceId: string, projectId: string, libraryName: string): string {
  const ws = workspaceId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12) || 'ws';
  const proj = projectId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12) || 'project';
  const slug = libraryName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'filelib';
  return `flib-${ws}-${proj}-${slug}`.slice(0, 63).replace(/-+$/g, '');
}

export async function createAndProvisionProjectFileLibrary(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  userId: string;
  name: string;
  description?: string;
}) {
  if (!input.deps.fileLibraryOrchestrator) {
    throw new Error('file_library_backend_unavailable');
  }

  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(input.deps.docStore);
  const backendRepo = new JsonDocProjectFileLibraryBackendRepo(input.deps.docStore);
  const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(input.deps.docStore);

  const filesystemName = buildFilesystemName(input.workspaceId, input.projectId, input.name);
  const created = buildFileLibraryRecord({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    filesystemName,
    createdByUserId: input.userId,
  });
  await catalogRepo.save(created);

  try {
    const provisioned = await input.deps.fileLibraryOrchestrator.provisionLibrary({
      libraryId: created.id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryName: created.name,
      filesystemName: created.filesystem_name,
      requestedByUserId: input.userId,
    });
    const normalizedMetadataUrl = normalizeFileLibraryMetadataUrl(provisioned.metadataUrl);
    const normalizedInternalMetadataUrl = normalizeFileLibraryMetadataUrl(provisioned.internalMetadataUrl);
    const recommendedCacheDir = `$HOME/.juicefs/cache/agentsmith/${created.filesystem_name}`;
    const storageBucketUrl = `${provisioned.minio.endpoint.replace(/\/+$/, '')}/${provisioned.minio.bucket}`;
    await backendRepo.save(input.workspaceId, input.projectId, created.id, {
      library_id: created.id,
      filesystem_name: provisioned.filesystemName,
      provisioning_status: 'ready',
      gateway_status: 'not_started',
      postgres: provisioned.postgres,
      minio: provisioned.minio,
      metadata_url: normalizedMetadataUrl,
      internal_metadata_url: normalizedInternalMetadataUrl,
    });
    await mountAccessRepo.save(input.workspaceId, input.projectId, created.id, {
      filesystem_name: provisioned.filesystemName,
      metadata_url: normalizedMetadataUrl,
      storage_bucket_url: storageBucketUrl,
      recommended_mount_path: `~/Agentsmith/${created.name}`,
      platform_notes: [
        'Linux requires FUSE support.',
        'macOS requires macFUSE.',
        'Windows requires JuiceFS-supported filesystem dependencies.',
        'Use a dedicated JuiceFS cache directory for this mounted environment.',
        'Use the provided bucket URL override so mount clients use a reachable object-storage endpoint for this deployment.',
        'For live observation and verification, prefer zero metadata cache settings so local mounts reflect recent agent writes promptly.',
      ],
      recommended_mount_commands: {
        linux: `juicefs mount '${normalizedMetadataUrl}' '$HOME/Agentsmith/${created.name.replace(/'/g, '')}' --bucket '${storageBucketUrl}' --cache-dir '${recommendedCacheDir}' --check-storage --attr-cache 0 --entry-cache 0 --dir-entry-cache 0`,
        macos: `juicefs mount '${normalizedMetadataUrl}' '$HOME/Agentsmith/${created.name.replace(/'/g, '')}' --bucket '${storageBucketUrl}' --cache-dir '${recommendedCacheDir}' --check-storage --attr-cache 0 --entry-cache 0 --dir-entry-cache 0`,
        windows: `juicefs mount "${normalizedMetadataUrl}" X: --bucket "${storageBucketUrl}" --cache-dir "%USERPROFILE%\\\\.juicefs\\\\cache\\\\agentsmith\\\\${created.filesystem_name}" --check-storage --attr-cache 0 --entry-cache 0 --dir-entry-cache 0`,
      },
      created_at: new Date().toISOString(),
    });
    return await catalogRepo.update(input.workspaceId, input.projectId, created.id, { status: 'ready' });
  } catch (error) {
    await catalogRepo.update(input.workspaceId, input.projectId, created.id, { status: 'failed' });
    throw error;
  }
}
