import { Client as MinioClient } from 'minio';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  JsonDocProjectFileLibraryBackendRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from './file-library-persistence.js';
import {
  getFileLibraryGatewayInternalCredentials,
  resolveFileLibraryStorageBucketUrlForGatewayRuntime,
} from './file-library-runtime.js';

export function normalizeFileLibraryPath(input?: string | null): string {
  const value = (input ?? '').trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (!value) return '';
  const segments = value.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error('invalid_file_library_path');
    }
  }
  return segments.join('/');
}

export function fileLibraryBucketName(filesystemName: string): string {
  return filesystemName;
}

export function guessFileLibraryContentType(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return undefined;
}

export async function getProjectFileLibraryRecord(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}) {
  return new JsonDocProjectFileLibraryCatalogRepo(args.deps.docStore).getById(
    args.workspaceId,
    args.projectId,
    args.libraryId,
  );
}

export async function createFileLibraryGatewayClient(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  filesystemName: string;
}): Promise<MinioClient> {
  const backend = await new JsonDocProjectFileLibraryBackendRepo(args.deps.docStore).getInternal(
    args.workspaceId,
    args.projectId,
    args.libraryId,
  );
  const mountAccess = await new JsonDocProjectFileLibraryMountAccessRepo(args.deps.docStore).getById(
    args.workspaceId,
    args.projectId,
    args.libraryId,
  );
  if (!backend?.internal_metadata_url) {
    throw new Error('file_library_backend_not_found');
  }
  if (!args.deps.fileLibraryGatewayManager) {
    throw new Error('file_library_gateway_unavailable');
  }
  const gateway = await args.deps.fileLibraryGatewayManager.ensureGateway({
    libraryId: args.libraryId,
    filesystemName: args.filesystemName,
    metadataUrl: backend.internal_metadata_url,
    storageBucketUrl: resolveFileLibraryStorageBucketUrlForGatewayRuntime(mountAccess?.storage_bucket_url),
  });
  const url = new URL(gateway.loopbackUrl);
  const credentials = getFileLibraryGatewayInternalCredentials(args.libraryId);
  return new MinioClient({
    endPoint: url.hostname,
    port: Number(url.port),
    useSSL: url.protocol === 'https:',
    accessKey: credentials.accessKey,
    secretKey: credentials.secretKey,
  });
}
