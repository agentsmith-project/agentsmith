import type http from 'node:http';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  CreateFileLibraryShareLinkRequestSchema,
  CreateFileLibraryRequestSchema,
  CreateFileLibraryFolderRequestSchema,
  DeleteFileLibraryEntriesRequestSchema,
  FileLibraryDownloadQuerySchema,
  ListFileLibraryEntriesQuerySchema,
  MoveFileLibraryEntryRequestSchema,
  UpdateFileLibraryRequestSchema,
} from '@mbos/contracts';
import { Client as MinioClient } from 'minio';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  createFileLibraryRecord,
  deleteFileLibraryRecord,
  getFileLibrary,
  getFileLibraryBackend,
  getFileLibraryBackendInternal,
  getFileLibraryMountAccess,
  listFileLibraries,
  setFileLibraryBackend,
  setFileLibraryMountAccess,
  updateFileLibraryRecord,
} from './file-library-store.js';
import { getFileLibraryGatewayInternalCredentials } from './file-library-runtime.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

type GatewayObjectItem = {
  key: string;
  sizeBytes: number;
  etag?: string;
  lastModified: string;
};

function mapFileLibraryInfraError(error: unknown): {
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

async function parseUploadAndExecute(
  req: http.IncomingMessage,
  execute: (input: {
    fileName: string;
    fileStream: WebReadableStream<Uint8Array>;
    contentType?: string;
    contentLength?: number;
    prefix?: string;
    overwrite?: boolean;
  }) => Promise<unknown>,
  options?: {
    maxFileSizeBytes?: number;
  },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: options?.maxFileSizeBytes ? { fileSize: options.maxFileSizeBytes } : undefined,
    });
    let prefix: string | undefined;
    let overwrite = false;
    let uploadPromise: Promise<unknown> | null = null;
    let fileSeen = false;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    busboy.on('field', (name, value) => {
      if (name === 'prefix') {
        prefix = value;
      } else if (name === 'overwrite') {
        overwrite = value === 'true' || value === '1';
      }
    });

    busboy.on('file', (name, file, info) => {
      if (name !== 'file') {
        file.resume();
        return;
      }
      file.on('limit', () => {
        settle(() =>
          reject(
            Object.assign(new Error('file_library_max_file_size_exceeded'), {
              code: 'FILE_LIBRARY_MAX_FILE_SIZE_EXCEEDED',
              maxFileSizeBytes: options?.maxFileSizeBytes,
            }),
          ),
        );
      });
      fileSeen = true;
      const fileStream = Readable.toWeb(file) as unknown as WebReadableStream<Uint8Array>;
      uploadPromise = execute({
        fileName: info.filename || 'upload.bin',
        fileStream,
        contentType: info.mimeType || 'application/octet-stream',
        contentLength: undefined,
        prefix,
        overwrite,
      });
      uploadPromise.catch((error) => settle(() => reject(error)));
    });

    busboy.on('error', (error) => settle(() => reject(error)));
    busboy.on('finish', async () => {
      if (!fileSeen || !uploadPromise) {
        settle(() => reject(new Error('file_required')));
        return;
      }
      try {
        const result = await uploadPromise;
        settle(() => resolve(result));
      } catch (error) {
        settle(() => reject(error));
      }
    });

    req.pipe(busboy);
  });
}

function buildFilesystemName(workspaceId: string, projectId: string, libraryName: string): string {
  const ws = workspaceId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12) || 'ws';
  const proj = projectId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12) || 'project';
  const slug = libraryName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'filelib';
  return `flib-${ws}-${proj}-${slug}`.slice(0, 63).replace(/-+$/g, '');
}

function normalizePath(input?: string | null): string {
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

function ensureDirectoryPath(input: string): string {
  const normalized = normalizePath(input);
  if (!normalized) {
    throw new Error('invalid_file_library_directory_path');
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function fileLibraryBucketName(filesystemName: string): string {
  return filesystemName;
}

function guessContentType(path: string): string | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return undefined;
}

async function createGatewayClient(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  filesystemName: string;
}): Promise<MinioClient> {
  const backend = getFileLibraryBackendInternal(args.workspaceId, args.projectId, args.libraryId);
  if (!backend?.metadata_url) {
    throw new Error('file_library_backend_not_found');
  }
  if (!args.deps.fileLibraryGatewayManager) {
    throw new Error('file_library_gateway_unavailable');
  }
  const gateway = await args.deps.fileLibraryGatewayManager.ensureGateway({
    libraryId: args.libraryId,
    filesystemName: args.filesystemName,
    metadataUrl: backend.metadata_url,
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

async function listGatewayObjects(
  client: MinioClient,
  bucket: string,
  options: {
    prefix: string;
    pageSize: number;
    continuationToken?: string;
  },
): Promise<{
  path: string;
  objects: GatewayObjectItem[];
  commonPrefixes: string[];
  nextContinuationToken: string | null;
}> {
  const stream = client.listObjectsV2(
    bucket,
    options.prefix,
    false,
    options.continuationToken ?? undefined,
  );
  const objects: GatewayObjectItem[] = [];
  const commonPrefixes: string[] = [];
  let lastKey: string | null = null;
  let truncated = false;
  try {
    for await (const item of stream as unknown as AsyncIterable<{
      name?: string;
      prefix?: string;
      size?: number;
      etag?: string;
      lastModified?: Date;
    }>) {
      if (typeof item.prefix === 'string') {
        commonPrefixes.push(item.prefix);
        lastKey = item.prefix;
      } else if (typeof item.name === 'string') {
        objects.push({
          key: item.name,
          sizeBytes: item.size ?? 0,
          etag: item.etag,
          lastModified: item.lastModified?.toISOString?.() ?? new Date().toISOString(),
        });
        lastKey = item.name;
      }
      if (objects.length + commonPrefixes.length >= options.pageSize) {
        truncated = true;
        if (typeof (stream as unknown as { destroy?: () => void }).destroy === 'function') {
          (stream as unknown as { destroy: () => void }).destroy();
        }
        break;
      }
    }
  } catch {
    // stream may throw after destroy; treat as normal truncation
  }
  return {
    path: options.prefix,
    objects,
    commonPrefixes,
    nextContinuationToken: truncated ? lastKey : null,
  };
}

async function assertFileLibraryEmpty(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  filesystemName: string;
}): Promise<void> {
  const client = await createGatewayClient(args);
  const bucket = fileLibraryBucketName(args.filesystemName);
  const listed = await listGatewayObjects(client, bucket, {
    prefix: '',
    pageSize: 1,
  });
  if (listed.commonPrefixes.length > 0 || listed.objects.length > 0) {
    throw new Error('file_library_not_empty');
  }
}

async function copyObject(
  client: MinioClient,
  bucket: string,
  fromKey: string,
  toKey: string,
  overwrite = false,
): Promise<void> {
  if (!overwrite) {
    try {
      await client.statObject(bucket, toKey);
      throw new Error('destination_exists');
    } catch (error) {
      if (error instanceof Error && error.message === 'destination_exists') {
        throw error;
      }
    }
  }
  await client.copyObject(bucket, toKey, `/${bucket}/${fromKey}`);
}

async function deleteMany(client: MinioClient, bucket: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  if (typeof (client as unknown as { removeObjects?: unknown }).removeObjects === 'function') {
    await (client as unknown as { removeObjects: (bucketName: string, keysToDelete: string[]) => Promise<void> })
      .removeObjects(bucket, keys);
    return;
  }
  for (const key of keys) {
    await client.removeObject(bucket, key);
  }
}

export async function handleProjectFileLibraryRoutes(args: {
  routeKind:
    | 'fileLibraries'
    | 'fileLibraryItem'
    | 'fileLibraryBackend'
    | 'fileLibraryStorageCredentialExchange'
    | 'fileLibraryEntries'
    | 'fileLibraryFolders'
    | 'fileLibraryDelete'
    | 'fileLibraryMove'
    | 'fileLibraryUpload'
    | 'fileLibraryDownload'
    | 'fileLibraryMeta'
    | 'fileLibraryShareLink';
  method: string;
  workspaceId: string;
  projectId: string;
  libraryId?: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const {
    routeKind,
    method,
    workspaceId,
    projectId,
    libraryId,
    deps,
    user,
    req,
    res,
    json,
    readBody,
  } = args;

  if (routeKind === 'fileLibraries' && method === 'GET') {
    json(res, 200, { items: listFileLibraries(workspaceId, projectId) });
    return true;
  }

  if (routeKind === 'fileLibraries' && method === 'POST') {
    const parsed = CreateFileLibraryRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_create_request' });
      return true;
    }
    if (!deps.fileLibraryOrchestrator) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const filesystemName = buildFilesystemName(workspaceId, projectId, parsed.data.name);
    const created = createFileLibraryRecord({
      workspaceId,
      projectId,
      name: parsed.data.name,
      description: parsed.data.description,
      filesystemName,
      createdByUserId: user.user_id,
    });
    try {
      const provisioned = await deps.fileLibraryOrchestrator.provisionLibrary({
        libraryId: created.id,
        workspaceId,
        projectId,
        libraryName: created.name,
        filesystemName: created.filesystem_name,
        requestedByUserId: user.user_id,
      });
      setFileLibraryBackend(workspaceId, projectId, created.id, {
        library_id: created.id,
        filesystem_name: provisioned.filesystemName,
        provisioning_status: 'ready',
        gateway_status: 'not_started',
        postgres: provisioned.postgres,
        minio: provisioned.minio,
        metadata_url: provisioned.metadataUrl,
      });
      setFileLibraryMountAccess(workspaceId, projectId, created.id, {
        filesystem_name: provisioned.filesystemName,
        metadata_url: provisioned.metadataUrl,
        recommended_mount_path: `~/Agentsmith/${created.name}`,
        platform_notes: [
          'Linux requires FUSE support.',
          'macOS requires macFUSE.',
          'Windows requires JuiceFS-supported filesystem dependencies.',
        ],
        recommended_mount_commands: {
          linux: `juicefs mount '${provisioned.metadataUrl}' '$HOME/Agentsmith/${created.name.replace(/'/g, '')}'`,
          macos: `juicefs mount '${provisioned.metadataUrl}' '$HOME/Agentsmith/${created.name.replace(/'/g, '')}'`,
          windows: `juicefs mount "${provisioned.metadataUrl}" X:`,
        },
        created_at: new Date().toISOString(),
      });
      updateFileLibraryRecord(workspaceId, projectId, created.id, { status: 'ready' });
      json(res, 201, getFileLibrary(workspaceId, projectId, created.id));
    } catch (error) {
      updateFileLibraryRecord(workspaceId, projectId, created.id, { status: 'failed' });
      const mapped = mapFileLibraryInfraError(error);
      const record = getFileLibrary(workspaceId, projectId, created.id);
      json(res, mapped.statusCode, {
        error_code: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
          ? 'FILE_LIBRARY_PROVISIONING_FAILED'
          : mapped.errorCode,
        message: mapped.message,
        library: record,
      });
    }
    return true;
  }

  if (!libraryId) {
    return false;
  }

  const library = getFileLibrary(workspaceId, projectId, libraryId);
  if (!library) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' });
    return true;
  }

  if (routeKind === 'fileLibraryItem' && method === 'GET') {
    json(res, 200, library);
    return true;
  }

  if (routeKind === 'fileLibraryItem' && method === 'PATCH') {
    const parsed = UpdateFileLibraryRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_update_request' });
      return true;
    }
    const updated = updateFileLibraryRecord(workspaceId, projectId, libraryId, parsed.data);
    json(res, 200, updated);
    return true;
  }

  if (routeKind === 'fileLibraryItem' && method === 'DELETE') {
    if (!deps.fileLibraryOrchestrator) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    updateFileLibraryRecord(workspaceId, projectId, libraryId, { status: 'deleting' });
    try {
      await assertFileLibraryEmpty({
        deps,
        workspaceId,
        projectId,
        libraryId,
        filesystemName: library.filesystem_name,
      });
      await deps.fileLibraryOrchestrator.deleteLibrary({
        libraryId,
        filesystemName: library.filesystem_name,
      });
      await deps.fileLibraryGatewayManager?.stopGateway(libraryId);
      await deps.internalAgentWorkspaceProvisioner?.deleteWorkspaceBinding({
        workspaceId,
        fileLibraryId: libraryId,
      });
      deleteFileLibraryRecord(workspaceId, projectId, libraryId);
      res.statusCode = 204;
      res.end();
    } catch (error) {
      updateFileLibraryRecord(workspaceId, projectId, libraryId, { status: 'degraded' });
      const mapped = mapFileLibraryInfraError(error);
      if (mapped.errorCode === 'FILE_LIBRARY_NOT_EMPTY') {
        updateFileLibraryRecord(workspaceId, projectId, libraryId, { status: 'ready' });
      }
      json(res, mapped.statusCode, {
        error_code: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
          ? 'FILE_LIBRARY_DELETE_FAILED'
          : mapped.errorCode,
        message: mapped.message,
      });
    }
    return true;
  }

  if (routeKind === 'fileLibraryBackend' && method === 'GET') {
    const backend = getFileLibraryBackend(workspaceId, projectId, libraryId);
    if (!backend) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_backend_not_found' });
      return true;
    }
    if (deps.fileLibraryGatewayManager) {
      const health = await deps.fileLibraryGatewayManager.getHealth(libraryId);
      json(res, 200, {
        ...backend,
        gateway_status: health.status === 'failed' ? 'failed' : health.status,
        last_error: health.lastError ?? backend.last_error,
      });
      return true;
    }
    json(res, 200, backend);
    return true;
  }

  if (routeKind === 'fileLibraryEntries' && method === 'GET') {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const parsed = ListFileLibraryEntriesQuerySchema.safeParse(Object.fromEntries(parsedUrl.searchParams.entries()));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_entries_query' });
      return true;
    }
    const path = parsed.data.path ? ensureDirectoryPath(parsed.data.path) : '';
    const pageSize = parsed.data.page_size ?? 200;
    const client = await createGatewayClient({
      deps,
      workspaceId,
      projectId,
      libraryId,
      filesystemName: library.filesystem_name,
    });
    const bucket = fileLibraryBucketName(library.filesystem_name);
    const listed = await listGatewayObjects(client, bucket, {
      prefix: path,
      pageSize,
      continuationToken: parsed.data.continuation_token,
    });
    let items = [
      ...listed.commonPrefixes.map((prefix) => ({
        kind: 'directory' as const,
        path: prefix,
        name: prefix.slice(path.length).replace(/\/$/, ''),
      })),
      ...listed.objects
        .filter((item) => item.key !== path)
        .map((item) => ({
          kind: 'file' as const,
          path: item.key,
          name: item.key.slice(path.length),
          size_bytes: item.sizeBytes,
          content_type: guessContentType(item.key),
          modified_at: item.lastModified,
          etag: item.etag,
        })),
    ];
    if (parsed.data.search) {
      const needle = parsed.data.search.toLowerCase();
      items = items.filter((item) => item.name.toLowerCase().includes(needle));
    }
    const direction = parsed.data.sort_order === 'desc' ? -1 : 1;
    const sortBy = parsed.data.sort_by;
    items.sort((a, b) => {
      if (sortBy === 'size_bytes') {
        const av = a.kind === 'file' ? a.size_bytes : -1;
        const bv = b.kind === 'file' ? b.size_bytes : -1;
        return (av - bv) * direction;
      }
      if (sortBy === 'modified_at') {
        const av = a.kind === 'file' ? Date.parse(a.modified_at) : 0;
        const bv = b.kind === 'file' ? Date.parse(b.modified_at) : 0;
        return (av - bv) * direction;
      }
      return a.name.localeCompare(b.name) * direction;
    });
    json(res, 200, {
      path,
      items,
      next_continuation_token: listed.nextContinuationToken,
    });
    return true;
  }

  if (routeKind === 'fileLibraryFolders' && method === 'POST') {
    const parsed = CreateFileLibraryFolderRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_folder_request' });
      return true;
    }
    const folderPath = ensureDirectoryPath(parsed.data.path);
    const client = await createGatewayClient({
      deps,
      workspaceId,
      projectId,
      libraryId,
      filesystemName: library.filesystem_name,
    });
    await client.putObject(fileLibraryBucketName(library.filesystem_name), folderPath, Buffer.alloc(0), 0, {
      'Content-Type': 'application/x-directory',
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (routeKind === 'fileLibraryDelete' && method === 'POST') {
    const parsed = DeleteFileLibraryEntriesRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_delete_request' });
      return true;
    }
    const client = await createGatewayClient({
      deps,
      workspaceId,
      projectId,
      libraryId,
      filesystemName: library.filesystem_name,
    });
    const bucket = fileLibraryBucketName(library.filesystem_name);
    const results: Array<{ path: string; status: 'deleted' | 'not_found' | 'error'; error_code?: string; message?: string }> = [];
    for (const rawPath of parsed.data.paths) {
      const normalized = normalizePath(rawPath);
      try {
        const dirPath = rawPath.endsWith('/') ? ensureDirectoryPath(rawPath) : normalized;
        if (rawPath.endsWith('/')) {
          const listed = await listGatewayObjects(client, bucket, {
            prefix: dirPath,
            pageSize: 1000,
          });
          const keys = [
            ...listed.commonPrefixes,
            ...listed.objects.map((item) => item.key),
          ].filter((key) => key !== dirPath);
          await deleteMany(client, bucket, [dirPath, ...keys]);
        } else {
          await client.removeObject(bucket, dirPath);
        }
        results.push({ path: rawPath, status: 'deleted' });
      } catch (error) {
        results.push({
          path: rawPath,
          status: 'error',
          error_code: 'file_library_delete_failed',
          message: error instanceof Error ? error.message : 'file_library_delete_failed',
        });
      }
    }
    json(res, 200, { results });
    return true;
  }

  if (routeKind === 'fileLibraryMove' && method === 'POST') {
    const parsed = MoveFileLibraryEntryRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_move_request' });
      return true;
    }
    const client = await createGatewayClient({
      deps,
      workspaceId,
      projectId,
      libraryId,
      filesystemName: library.filesystem_name,
    });
    const bucket = fileLibraryBucketName(library.filesystem_name);
    const overwrite = parsed.data.overwrite ?? false;
    if (parsed.data.from_path.endsWith('/')) {
      const fromPath = ensureDirectoryPath(parsed.data.from_path);
      const toPath = ensureDirectoryPath(parsed.data.to_path);
      const listed = await listGatewayObjects(client, bucket, { prefix: fromPath, pageSize: 1000 });
      await client.putObject(bucket, toPath, Buffer.alloc(0), 0, { 'Content-Type': 'application/x-directory' });
      for (const item of listed.objects) {
        const target = `${toPath}${item.key.slice(fromPath.length)}`;
        await copyObject(client, bucket, item.key, target, overwrite);
      }
      const keysToDelete = [fromPath, ...listed.objects.map((item) => item.key)];
      await deleteMany(client, bucket, keysToDelete);
    } else {
      const fromPath = normalizePath(parsed.data.from_path);
      const toPath = normalizePath(parsed.data.to_path);
      await copyObject(client, bucket, fromPath, toPath, overwrite);
      await client.removeObject(bucket, fromPath);
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (routeKind === 'fileLibraryUpload' && method === 'POST') {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      json(res, 415, {
        error_code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'file_library_upload_requires_multipart_form_data',
      });
      return true;
    }

    try {
      const uploaded = await parseUploadAndExecute(
        req,
        async ({ fileName, fileStream, contentType: uploadedContentType, prefix, overwrite }) => {
          const normalizedPrefix = prefix ? ensureDirectoryPath(prefix) : '';
          const objectPath = normalizePath(`${normalizedPrefix}${fileName}`);
          const client = await createGatewayClient({
            deps,
            workspaceId,
            projectId,
            libraryId,
            filesystemName: library.filesystem_name,
          });
          const bucket = fileLibraryBucketName(library.filesystem_name);
          const nodeStream = Readable.fromWeb(fileStream as globalThis.ReadableStream<Uint8Array>);
          if (!(overwrite ?? false)) {
            try {
              await client.statObject(bucket, objectPath);
              throw new Error('file_library_destination_exists');
            } catch (error) {
              if (error instanceof Error && error.message === 'file_library_destination_exists') {
                throw error;
              }
            }
          }
          await client.putObject(bucket, objectPath, nodeStream, undefined, {
            'Content-Type': uploadedContentType || guessContentType(objectPath) || 'application/octet-stream',
          });
          const stat = await client.statObject(bucket, objectPath);
          return {
            kind: 'file' as const,
            path: objectPath,
            name: fileName,
            size_bytes: stat.size,
            content_type: stat.metaData?.['content-type'] ?? uploadedContentType ?? guessContentType(objectPath),
            modified_at: stat.lastModified.toISOString(),
            etag: stat.etag,
          };
        },
        { maxFileSizeBytes: 1024 * 1024 * 1024 },
      );
      json(res, 201, uploaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'file_library_upload_failed';
      json(res, message === 'file_library_destination_exists' ? 409 : 400, {
        error_code: message === 'file_library_destination_exists' ? 'RESOURCE_CONFLICT' : 'FILE_LIBRARY_UPLOAD_FAILED',
        message,
      });
    }
    return true;
  }

  if (routeKind === 'fileLibraryDownload' && method === 'GET') {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const parsed = FileLibraryDownloadQuerySchema.safeParse(Object.fromEntries(parsedUrl.searchParams.entries()));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_download_query' });
      return true;
    }
    try {
      const objectPath = normalizePath(parsed.data.path);
      const client = await createGatewayClient({
        deps,
        workspaceId,
        projectId,
        libraryId,
        filesystemName: library.filesystem_name,
      });
      const bucket = fileLibraryBucketName(library.filesystem_name);
      const stat = await client.statObject(bucket, objectPath);
      const objectStream = await client.getObject(bucket, objectPath);
      const fileName = objectPath.split('/').at(-1) || 'download.bin';
      res.statusCode = 200;
      res.setHeader('Content-Type', stat.metaData?.['content-type'] ?? guessContentType(objectPath) ?? 'application/octet-stream');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      objectStream.on('error', () => {
        if (!res.writableEnded) {
          res.destroy(new Error('file_library_download_stream_failed'));
        }
      });
      objectStream.pipe(res);
    } catch (error) {
      json(res, 404, {
        error_code: 'RESOURCE_NOT_FOUND',
        message: error instanceof Error ? error.message : 'file_library_download_not_found',
      });
    }
    return true;
  }

  if (routeKind === 'fileLibraryMeta' && method === 'GET') {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const path = parsedUrl.searchParams.get('path') ?? parsedUrl.searchParams.get('key') ?? '';
    if (!path.trim()) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_meta_query' });
      return true;
    }
    try {
      const objectPath = normalizePath(path);
      const client = await createGatewayClient({
        deps,
        workspaceId,
        projectId,
        libraryId,
        filesystemName: library.filesystem_name,
      });
      const stat = await client.statObject(fileLibraryBucketName(library.filesystem_name), objectPath);
      json(res, 200, {
        key: objectPath,
        size_bytes: stat.size,
        content_type: stat.metaData?.['content-type'] ?? guessContentType(objectPath) ?? 'application/octet-stream',
        etag: stat.etag,
        last_modified: stat.lastModified.toISOString(),
        user_metadata: stat.metaData,
      });
    } catch (error) {
      json(res, 404, {
        error_code: 'RESOURCE_NOT_FOUND',
        message: error instanceof Error ? error.message : 'file_library_meta_not_found',
      });
    }
    return true;
  }

  if (routeKind === 'fileLibraryShareLink' && method === 'POST') {
    const parsed = CreateFileLibraryShareLinkRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_share_link_request' });
      return true;
    }
    try {
      const objectPath = normalizePath(parsed.data.path);
      const client = await createGatewayClient({
        deps,
        workspaceId,
        projectId,
        libraryId,
        filesystemName: library.filesystem_name,
      });
      const bucket = fileLibraryBucketName(library.filesystem_name);
      const expirySeconds = parsed.data.expires_in_seconds ?? 60 * 60;
      const url = await client.presignedGetObject(bucket, objectPath, expirySeconds);
      json(res, 200, {
        key: objectPath,
        url,
        expires_at: new Date(Date.now() + expirySeconds * 1000).toISOString(),
      });
    } catch (error) {
      json(res, 404, {
        error_code: 'RESOURCE_NOT_FOUND',
        message: error instanceof Error ? error.message : 'file_library_share_link_not_found',
      });
    }
    return true;
  }

  if (routeKind === 'fileLibraryStorageCredentialExchange' && method === 'POST') {
    const access = getFileLibraryMountAccess(workspaceId, projectId, libraryId);
    if (!access) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_mount_access_not_found' });
      return true;
    }
    json(res, 200, access);
    return true;
  }

  return false;
}
