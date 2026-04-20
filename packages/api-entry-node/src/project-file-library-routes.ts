import type http from 'node:http';
import Busboy from 'busboy';
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
import type { Client as MinioClient } from 'minio';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  JsonDocProjectFileLibraryBackendRepo,
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from './file-library-persistence.js';
import {
  createFileLibraryGatewayClient,
  fileLibraryBucketName,
  guessFileLibraryContentType,
  normalizeFileLibraryPath,
} from './file-library-gateway-client.js';
import {
  awaitAbortableOperation,
  bindAbortSignal,
  createAbortError,
  createHttpOperationEnvelope,
  openGatewayObjectDownload,
  parseMultipartUploadAndExecute,
  pipeGatewayDownloadToHttpResponse,
  putGatewayObjectStream,
} from './object-stream-bridge.js';
import { resolveFileLibraryStorageBucketUrlForClientMount } from './file-library-runtime.js';
import {
  createAndProvisionProjectFileLibrary,
  mapFileLibraryInfraError,
} from './project-file-library-service.js';
import type { FileLibraryDesktopMountAccess, FileLibraryMountAccess } from './file-library-model.js';
import { notebookTasksCollection } from './notebook-task/task-store.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

type GatewayObjectItem = {
  key: string;
  sizeBytes: number;
  etag?: string;
  lastModified: string;
};

const FILE_LIBRARY_FOLDER_CREATE_MAX_ATTEMPTS = 3;
const FILE_LIBRARY_FOLDER_VISIBILITY_MAX_POLLS = 5;
const FILE_LIBRARY_FOLDER_RETRY_DELAY_MS = 150;

function ensureDirectoryPath(input: string): string {
  const normalized = normalizeFileLibraryPath(input);
  if (!normalized) {
    throw new Error('invalid_file_library_directory_path');
  }
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

async function listGatewayObjects(
  client: MinioClient,
  bucket: string,
  options: {
    prefix: string;
    pageSize: number;
    continuationToken?: string;
    signal?: AbortSignal;
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
  let removeAbortListener: () => void = () => {};
  const destroyStream = (reason?: unknown) => {
    const destroy = (stream as unknown as { destroy?: (error?: Error) => void }).destroy;
    if (typeof destroy === 'function') {
      destroy.call(stream, createAbortError(reason, 'file_library_gateway_list_aborted'));
    }
  };
  removeAbortListener = bindAbortSignal(options.signal, destroyStream);
  try {
    for await (const item of stream as unknown as AsyncIterable<{
      name?: string;
      prefix?: string;
      size?: number;
      etag?: string;
      lastModified?: Date;
    }>) {
      if (options.signal?.aborted) {
        throw createAbortError(options.signal.reason, 'file_library_gateway_list_aborted');
      }
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
        destroyStream('file_library_gateway_list_truncated');
        break;
      }
    }
  } catch (error) {
    if (options.signal?.aborted) {
      throw createAbortError(options.signal.reason, 'file_library_gateway_list_aborted');
    }
    if (!truncated) {
      throw error;
    }
    // stream may throw after destroy; treat as normal truncation
  } finally {
    removeAbortListener();
  }
  if (options.signal?.aborted) {
    throw createAbortError(options.signal.reason, 'file_library_gateway_list_aborted');
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
  const client = await createFileLibraryGatewayClient(args);
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
  signal?: AbortSignal,
  abortMessage = 'file_library_move_aborted',
): Promise<void> {
  if (!overwrite) {
    try {
      await awaitAbortableOperation(
        client.statObject(bucket, toKey),
        {
          signal,
          abortMessage,
        },
      );
      throw new Error('destination_exists');
    } catch (error) {
      if (error instanceof Error && error.message === 'destination_exists') {
        throw error;
      }
    }
  }
  await awaitAbortableOperation(
    client.copyObject(bucket, toKey, `/${bucket}/${fromKey}`),
    {
      signal,
      abortMessage,
    },
  );
}

async function deleteMany(
  client: MinioClient,
  bucket: string,
  keys: string[],
  signal?: AbortSignal,
  abortMessage = 'file_library_move_aborted',
): Promise<void> {
  if (keys.length === 0) return;
  if (typeof (client as unknown as { removeObjects?: unknown }).removeObjects === 'function') {
    await awaitAbortableOperation(
      (client as unknown as { removeObjects: (bucketName: string, keysToDelete: string[]) => Promise<void> })
        .removeObjects(bucket, keys),
      {
        signal,
        abortMessage,
      },
    );
    return;
  }
  for (const key of keys) {
    await awaitAbortableOperation(
      client.removeObject(bucket, key),
      {
        signal,
        abortMessage,
      },
    );
  }
}

function isOwnedFileLibrary(library: { created_by_user_id?: string }, ownerUserId: string): boolean {
  return typeof library.created_by_user_id === 'string' && library.created_by_user_id === ownerUserId;
}

function firstHeaderValue(input: string | string[] | undefined): string | null {
  if (!input) return null;
  const raw = Array.isArray(input) ? input[0] : input;
  const first = raw.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function folderParentPath(folderPath: string): string {
  const trimmedPath = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
  const lastSlash = trimmedPath.lastIndexOf('/');
  if (lastSlash < 0) {
    return '';
  }
  return `${trimmedPath.slice(0, lastSlash + 1)}`;
}

function isRetriableFolderCreateError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (code === 'NoSuchBucket' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
    return true;
  }
  return message.includes('no such bucket')
    || message.includes('specified bucket does not exist')
    || message.includes('socket hang up')
    || message.includes('connection reset')
    || message.includes('econnrefused')
    || message.includes('econnreset')
    || message.includes('etimedout')
    || message.includes('timed out')
    || message.includes('file_library_folder_not_visible');
}

async function waitForAbortableDelay(
  ms: number,
  signal: AbortSignal | undefined,
  abortMessage: string,
): Promise<void> {
  if (signal?.aborted) {
    throw createAbortError(signal.reason, abortMessage);
  }
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutHandle);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError(signal.reason, abortMessage));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForFolderVisibility(args: {
  client: MinioClient;
  bucket: string;
  folderPath: string;
  signal?: AbortSignal;
}): Promise<void> {
  const parentPath = folderParentPath(args.folderPath);
  for (let attempt = 0; attempt < FILE_LIBRARY_FOLDER_VISIBILITY_MAX_POLLS; attempt += 1) {
    const listed = await listGatewayObjects(args.client, args.bucket, {
      prefix: parentPath,
      pageSize: 1000,
      signal: args.signal,
    });
    const isVisible = listed.commonPrefixes.includes(args.folderPath)
      || listed.objects.some((item) => item.key === args.folderPath);
    if (isVisible) {
      return;
    }
    if (attempt < FILE_LIBRARY_FOLDER_VISIBILITY_MAX_POLLS - 1) {
      await waitForAbortableDelay(
        FILE_LIBRARY_FOLDER_RETRY_DELAY_MS,
        args.signal,
        'file_library_folder_create_aborted',
      );
    }
  }
  throw new Error('file_library_folder_not_visible');
}

async function createFolderAndWaitForVisibility(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  filesystemName: string;
  folderPath: string;
  signal?: AbortSignal;
}): Promise<void> {
  const bucket = fileLibraryBucketName(args.filesystemName);

  for (let attempt = 0; attempt < FILE_LIBRARY_FOLDER_CREATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const client = await awaitAbortableOperation(
        createFileLibraryGatewayClient({
          deps: args.deps,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          libraryId: args.libraryId,
          filesystemName: args.filesystemName,
          signal: args.signal,
        }),
        {
          signal: args.signal,
          abortMessage: 'file_library_folder_create_aborted',
        },
      );
      await awaitAbortableOperation(
        client.putObject(bucket, args.folderPath, Buffer.alloc(0), 0, {
          'Content-Type': 'application/x-directory',
        }),
        {
          signal: args.signal,
          abortMessage: 'file_library_folder_create_aborted',
        },
      );
      await waitForFolderVisibility({
        client,
        bucket,
        folderPath: args.folderPath,
        signal: args.signal,
      });
      return;
    } catch (error) {
      const canRetry = isRetriableFolderCreateError(error) && attempt < FILE_LIBRARY_FOLDER_CREATE_MAX_ATTEMPTS - 1;
      if (!canRetry) {
        throw error;
      }
      await waitForAbortableDelay(
        FILE_LIBRARY_FOLDER_RETRY_DELAY_MS * (attempt + 1),
        args.signal,
        'file_library_folder_create_aborted',
      );
    }
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function inferRequestOrigin(req: http.IncomingMessage): string {
  const publicWebBaseUrl = process.env.PUBLIC_WEB_BASE_URL?.trim();
  if (publicWebBaseUrl) {
    return normalizeBaseUrl(publicWebBaseUrl);
  }

  const origin = firstHeaderValue(req.headers.origin);
  if (origin) {
    return normalizeBaseUrl(origin);
  }

  const referer = firstHeaderValue(req.headers.referer);
  if (referer) {
    try {
      const parsed = new URL(referer);
      return normalizeBaseUrl(parsed.origin);
    } catch {
      // fall through to host-based inference
    }
  }

  const host = firstHeaderValue(req.headers['x-forwarded-host']) ?? firstHeaderValue(req.headers.host) ?? 'localhost';
  const proto = firstHeaderValue(req.headers['x-forwarded-proto'])
    ?? (((req.socket as { encrypted?: boolean }).encrypted ?? false) ? 'https' : 'http');
  return normalizeBaseUrl(`${proto}://${host}`);
}

function normalizeDesktopMetadataUrl(metadataUrl: string): string {
  try {
    const parsed = new URL(metadataUrl);
    const host = process.env.FILE_LIBRARY_CLIENT_POSTGRES_HOST?.trim();
    const port = process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT?.trim();
    if (host) {
      parsed.hostname = host;
    }
    if (port) {
      parsed.port = port;
    }
    return parsed.toString();
  } catch {
    return metadataUrl;
  }
}

function normalizeClientStorageBucketUrl(storageBucketUrl?: string): string | undefined {
  return resolveFileLibraryStorageBucketUrlForClientMount(storageBucketUrl);
}

function rewriteMountCommandUrls(
  command: string,
  originalMetadataUrl: string,
  normalizedMetadataUrl: string,
  originalStorageBucketUrl?: string,
  normalizedStorageBucketUrl?: string,
): string {
  let updated = command.replaceAll(originalMetadataUrl, normalizedMetadataUrl);
  if (originalStorageBucketUrl && normalizedStorageBucketUrl) {
    updated = updated.replaceAll(originalStorageBucketUrl, normalizedStorageBucketUrl);
  }
  return updated;
}

function toClientMountAccess(access: FileLibraryMountAccess): FileLibraryMountAccess {
  const normalizedMetadataUrl = normalizeDesktopMetadataUrl(access.metadata_url);
  const normalizedStorageBucketUrl = normalizeClientStorageBucketUrl(access.storage_bucket_url);
  return {
    ...access,
    metadata_url: normalizedMetadataUrl,
    storage_bucket_url: normalizedStorageBucketUrl,
    recommended_mount_commands: {
      linux: rewriteMountCommandUrls(
        access.recommended_mount_commands.linux,
        access.metadata_url,
        normalizedMetadataUrl,
        access.storage_bucket_url,
        normalizedStorageBucketUrl,
      ),
      macos: rewriteMountCommandUrls(
        access.recommended_mount_commands.macos,
        access.metadata_url,
        normalizedMetadataUrl,
        access.storage_bucket_url,
        normalizedStorageBucketUrl,
      ),
      windows: rewriteMountCommandUrls(
        access.recommended_mount_commands.windows,
        access.metadata_url,
        normalizedMetadataUrl,
        access.storage_bucket_url,
        normalizedStorageBucketUrl,
      ),
    },
  };
}

function toDesktopMountAccess(
  req: http.IncomingMessage,
  access: FileLibraryMountAccess,
): FileLibraryDesktopMountAccess {
  return {
    filesystem_name: access.filesystem_name,
    metadata_url: normalizeDesktopMetadataUrl(access.metadata_url),
    storage_bucket_url: normalizeClientStorageBucketUrl(access.storage_bucket_url),
    deployment_base_url: inferRequestOrigin(req),
    default_mount_roots: {
      linux: '~/AgentSmith',
      macos: '~/AgentSmith',
      windows: '%USERPROFILE%\\AgentSmith',
    },
    windows_requires_drive_letter: true,
    created_at: access.created_at,
  };
}

export async function handleProjectFileLibraryRoutes(args: {
  routeKind:
    | 'fileLibraries'
    | 'fileLibraryItem'
    | 'fileLibraryBackend'
    | 'fileLibraryStorageCredentialExchange'
    | 'fileLibraryDesktopMountAccess'
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
  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(deps.docStore);
  const backendRepo = new JsonDocProjectFileLibraryBackendRepo(deps.docStore);
  const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(deps.docStore);

  if (routeKind === 'fileLibraries' && method === 'GET') {
    json(res, 200, { items: await catalogRepo.listByProjectForOwner(workspaceId, projectId, user.id) });
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
    try {
      const updated = await createAndProvisionProjectFileLibrary({
        deps,
        workspaceId,
        projectId,
        userId: user.id,
        name: parsed.data.name,
        description: parsed.data.description,
      });
      json(res, 201, updated);
    } catch (error) {
      const mapped = mapFileLibraryInfraError(error);
      json(res, mapped.statusCode, {
        error_code: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
          ? 'FILE_LIBRARY_PROVISIONING_FAILED'
          : mapped.errorCode,
        message: mapped.message,
      });
    }
    return true;
  }

  if (!libraryId) {
    return false;
  }

  const library = await catalogRepo.getById(workspaceId, projectId, libraryId);
  if (!library || !isOwnedFileLibrary(library, user.id)) {
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
    const updated = await catalogRepo.update(workspaceId, projectId, libraryId, parsed.data);
    json(res, 200, updated);
    return true;
  }

  if (routeKind === 'fileLibraryItem' && method === 'DELETE') {
    if (!deps.fileLibraryOrchestrator) {
      json(res, 503, { error_code: 'SERVICE_UNAVAILABLE', message: 'file_library_backend_unavailable' });
      return true;
    }
    const tasks = await deps.docStore.list<{
      status?: string;
      workspace_file_library_id?: string;
    }>(notebookTasksCollection(workspaceId), {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    const activeTask = tasks.find((task) => (
      task.status === 'active' && task.workspace_file_library_id === libraryId
    ));
    if (activeTask) {
      json(res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'file_library_task_in_use' });
      return true;
    }
    await catalogRepo.update(workspaceId, projectId, libraryId, { status: 'deleting' });
    try {
      const backend = await backendRepo.getInternal(workspaceId, projectId, libraryId);
      const mountAccess = await mountAccessRepo.getById(workspaceId, projectId, libraryId);
      const canFastDeleteFailedLibrary = library.status === 'failed' && !backend && !mountAccess;
      if (canFastDeleteFailedLibrary) {
        await catalogRepo.delete(workspaceId, projectId, libraryId);
        res.statusCode = 204;
        res.end();
        return true;
      }
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
      await (deps.internalAgentWorkspaceBindingManager ?? deps.internalAgentWorkspaceProvisioner)?.deleteWorkspaceBinding({
        workspaceId,
        fileLibraryId: libraryId,
      });
      await mountAccessRepo.delete(workspaceId, projectId, libraryId);
      await backendRepo.delete(workspaceId, projectId, libraryId);
      await catalogRepo.delete(workspaceId, projectId, libraryId);
      res.statusCode = 204;
      res.end();
    } catch (error) {
      await catalogRepo.update(workspaceId, projectId, libraryId, { status: 'degraded' });
      const mapped = mapFileLibraryInfraError(error);
      if (mapped.errorCode === 'FILE_LIBRARY_NOT_EMPTY') {
        await catalogRepo.update(workspaceId, projectId, libraryId, { status: 'ready' });
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
    const backend = await backendRepo.getPublic(workspaceId, projectId, libraryId);
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
    const client = await createFileLibraryGatewayClient({
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
          content_type: guessFileLibraryContentType(item.key),
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
    const operation = createHttpOperationEnvelope({ req, res });
    try {
      const parsed = CreateFileLibraryFolderRequestSchema.safeParse(await readBody(req));
      operation.markRequestBodyConsumed();
      if (!parsed.success) {
        json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_folder_request' });
        return true;
      }
      const folderPath = ensureDirectoryPath(parsed.data.path);
      await createFolderAndWaitForVisibility({
        deps,
        workspaceId,
        projectId,
        libraryId,
        filesystemName: library.filesystem_name,
        folderPath,
        signal: operation.signal,
      });
      if (operation.signal.aborted) {
        return true;
      }
      res.statusCode = 204;
      res.end();
      return true;
    } catch (error) {
      if (operation.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return true;
      }
      throw error;
    } finally {
      operation.cleanup();
    }
  }

  if (routeKind === 'fileLibraryDelete' && method === 'POST') {
    const parsed = DeleteFileLibraryEntriesRequestSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_delete_request' });
      return true;
    }
    const client = await createFileLibraryGatewayClient({
      deps,
      workspaceId,
      projectId,
      libraryId,
      filesystemName: library.filesystem_name,
    });
    const bucket = fileLibraryBucketName(library.filesystem_name);
    const results: Array<{ path: string; status: 'deleted' | 'not_found' | 'error'; error_code?: string; message?: string }> = [];
    for (const rawPath of parsed.data.paths) {
      const normalized = normalizeFileLibraryPath(rawPath);
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
    const operation = createHttpOperationEnvelope({ req, res });
    try {
      const parsed = MoveFileLibraryEntryRequestSchema.safeParse(await readBody(req));
      operation.markRequestBodyConsumed();
      if (!parsed.success) {
        json(res, 400, { error_code: 'VALIDATION_ERROR', message: 'invalid_file_library_move_request' });
        return true;
      }
      const client = await awaitAbortableOperation(
        createFileLibraryGatewayClient({
          deps,
          workspaceId,
          projectId,
          libraryId,
          filesystemName: library.filesystem_name,
          signal: operation.signal,
        }),
        {
          signal: operation.signal,
          abortMessage: 'file_library_move_aborted',
        },
      );
      const bucket = fileLibraryBucketName(library.filesystem_name);
      const overwrite = parsed.data.overwrite ?? false;
      if (parsed.data.from_path.endsWith('/')) {
        const fromPath = ensureDirectoryPath(parsed.data.from_path);
        const toPath = ensureDirectoryPath(parsed.data.to_path);
        const listed = await listGatewayObjects(client, bucket, {
          prefix: fromPath,
          pageSize: 1000,
          signal: operation.signal,
        });
        await awaitAbortableOperation(
          client.putObject(bucket, toPath, Buffer.alloc(0), 0, { 'Content-Type': 'application/x-directory' }),
          {
            signal: operation.signal,
            abortMessage: 'file_library_move_aborted',
          },
        );
        for (const item of listed.objects) {
          const target = `${toPath}${item.key.slice(fromPath.length)}`;
          await copyObject(client, bucket, item.key, target, overwrite, operation.signal);
        }
        const keysToDelete = [fromPath, ...listed.objects.map((item) => item.key)];
        await deleteMany(client, bucket, keysToDelete, operation.signal);
      } else {
        const fromPath = normalizeFileLibraryPath(parsed.data.from_path);
        const toPath = normalizeFileLibraryPath(parsed.data.to_path);
        await copyObject(client, bucket, fromPath, toPath, overwrite, operation.signal);
        await awaitAbortableOperation(
          client.removeObject(bucket, fromPath),
          {
            signal: operation.signal,
            abortMessage: 'file_library_move_aborted',
          },
        );
      }
      if (operation.signal.aborted) {
        return true;
      }
      res.statusCode = 204;
      res.end();
      return true;
    } catch (error) {
      if (operation?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return true;
      }
      throw error;
    } finally {
      operation.cleanup();
    }
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

    const operation = createHttpOperationEnvelope({ req, res });
    try {
      const uploaded = await parseMultipartUploadAndExecute(
        req,
        async ({ fileName, fileStream, contentType: uploadedContentType, prefix, overwrite, signal }) => {
          const normalizedPrefix = prefix ? ensureDirectoryPath(prefix) : '';
          const objectPath = normalizeFileLibraryPath(`${normalizedPrefix}${fileName}`);
          const client = await awaitAbortableOperation(
            createFileLibraryGatewayClient({
              deps,
              workspaceId,
              projectId,
              libraryId,
              filesystemName: library.filesystem_name,
              signal,
            }),
            {
              signal,
              abortMessage: 'file_library_upload_aborted',
            },
          );
          const bucket = fileLibraryBucketName(library.filesystem_name);
          if (!(overwrite ?? false)) {
            try {
              await awaitAbortableOperation(
                client.statObject(bucket, objectPath),
                {
                  signal,
                  abortMessage: 'file_library_upload_aborted',
                },
              );
              throw new Error('file_library_destination_exists');
            } catch (error) {
              if (error instanceof Error && error.message === 'file_library_destination_exists') {
                throw error;
              }
            }
          }
          await putGatewayObjectStream(client, bucket, objectPath, fileStream, {
            contentType: uploadedContentType || guessFileLibraryContentType(objectPath) || 'application/octet-stream',
            signal,
          });
          const stat = await awaitAbortableOperation(
            client.statObject(bucket, objectPath),
            {
              signal,
              abortMessage: 'file_library_upload_aborted',
            },
          );
          return {
            kind: 'file' as const,
            path: objectPath,
            name: fileName,
            size_bytes: stat.size,
            content_type: stat.metaData?.['content-type'] ?? uploadedContentType ?? guessFileLibraryContentType(objectPath),
            modified_at: stat.lastModified.toISOString(),
            etag: stat.etag,
          };
        },
        (headers) =>
          Busboy({
            headers,
            limits: { fileSize: 1024 * 1024 * 1024 },
          }),
        {
          signal: operation.signal,
        },
      );
      if (operation.signal.aborted) {
        return true;
      }
      json(res, 201, uploaded);
    } catch (error) {
      if (operation.signal.aborted) {
        return true;
      }
      const message = error instanceof Error ? error.message : 'file_library_upload_failed';
      const isDestinationConflict = message === 'file_library_destination_exists';
      json(res, isDestinationConflict ? 409 : 400, {
        error_code: isDestinationConflict ? 'destination_exists' : 'FILE_LIBRARY_UPLOAD_FAILED',
        message: isDestinationConflict ? 'destination_exists' : message,
      });
    } finally {
      operation.cleanup();
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
    const operation = createHttpOperationEnvelope({ req, res });
    try {
      const objectPath = normalizeFileLibraryPath(parsed.data.path);
      const client = await awaitAbortableOperation(
        createFileLibraryGatewayClient({
          deps,
          workspaceId,
          projectId,
          libraryId,
          filesystemName: library.filesystem_name,
          signal: operation.signal,
        }),
        {
          signal: operation.signal,
          abortMessage: 'file_library_download_aborted',
        },
      );
      const bucket = fileLibraryBucketName(library.filesystem_name);
      const stat = await awaitAbortableOperation(
        client.statObject(bucket, objectPath),
        {
          signal: operation.signal,
          abortMessage: 'file_library_download_aborted',
        },
      );
      const download = await openGatewayObjectDownload(client, bucket, objectPath, {
        signal: operation.signal,
      });
      if (operation.signal.aborted) {
        await download.cancel(operation.signal.reason);
        return true;
      }
      const fileName = objectPath.split('/').at(-1) || 'download.bin';
      res.statusCode = 200;
      res.setHeader('Content-Type', stat.metaData?.['content-type'] ?? guessFileLibraryContentType(objectPath) ?? 'application/octet-stream');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      pipeGatewayDownloadToHttpResponse({
        req,
        res,
        download,
        streamErrorMessage: 'file_library_download_stream_failed',
      });
    } catch (error) {
      if (operation.signal.aborted) {
        return true;
      }
      json(res, 404, {
        error_code: 'RESOURCE_NOT_FOUND',
        message: error instanceof Error ? error.message : 'file_library_download_not_found',
      });
    } finally {
      operation.cleanup();
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
    let operation: ReturnType<typeof createHttpOperationEnvelope> | null = null;
    try {
      operation = createHttpOperationEnvelope({ req, res });
      const objectPath = normalizeFileLibraryPath(path);
      const client = await awaitAbortableOperation(
        createFileLibraryGatewayClient({
          deps,
          workspaceId,
          projectId,
          libraryId,
          filesystemName: library.filesystem_name,
          signal: operation.signal,
        }),
        {
          signal: operation.signal,
          abortMessage: 'file_library_meta_aborted',
        },
      );
      const stat = await awaitAbortableOperation(
        client.statObject(fileLibraryBucketName(library.filesystem_name), objectPath),
        {
          signal: operation.signal,
          abortMessage: 'file_library_meta_aborted',
        },
      );
      if (operation.signal.aborted) {
        return true;
      }
      json(res, 200, {
        key: objectPath,
        size_bytes: stat.size,
        content_type: stat.metaData?.['content-type'] ?? guessFileLibraryContentType(objectPath) ?? 'application/octet-stream',
        etag: stat.etag,
        last_modified: stat.lastModified.toISOString(),
        user_metadata: stat.metaData,
      });
    } catch (error) {
      if (operation?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return true;
      }
      json(res, 404, {
        error_code: 'RESOURCE_NOT_FOUND',
        message: error instanceof Error ? error.message : 'file_library_meta_not_found',
      });
    } finally {
      operation?.cleanup();
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
      const objectPath = normalizeFileLibraryPath(parsed.data.path);
      const client = await createFileLibraryGatewayClient({
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
    const access = await mountAccessRepo.getById(workspaceId, projectId, libraryId);
    if (!access) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_mount_access_not_found' });
      return true;
    }
    json(res, 200, {
      client_mount_access: toClientMountAccess(access),
    });
    return true;
  }

  if (routeKind === 'fileLibraryDesktopMountAccess' && method === 'POST') {
    const access = await mountAccessRepo.getById(workspaceId, projectId, libraryId);
    if (!access) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_mount_access_not_found' });
      return true;
    }
    json(res, 200, {
      desktop_mount_access: toDesktopMountAccess(req, access),
    });
    return true;
  }

  return false;
}
