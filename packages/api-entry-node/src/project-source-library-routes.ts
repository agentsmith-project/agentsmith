import type http from 'node:http';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  CreateAIReadyJobRequestSchema,
  CreateSourceFolderRequestSchema,
  CreateSourceLibraryRequestSchema,
  CreateSourceRequestSchema,
  DeleteSourceObjectsRequestSchema,
  ListSourceObjectsQuerySchema,
  MoveSourceObjectRequestSchema,
  SourceObjectDownloadQuerySchema,
  SourceObjectShareLinkCreateRequestSchema,
  UpdateSourceLibraryRequestSchema,
} from '@mbos/contracts';
import { drainJobQueue } from '@mbos/application';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import {
  checkProjectSourceLibraryLimitLimits,
} from './project-resource-policy-enforcer.js';
import { getProjectResourcePolicyOrDefault } from './project-resource-policy-store.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

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
            Object.assign(new Error('source_library_max_file_size_exceeded'), {
              code: 'SOURCE_LIBRARY_MAX_FILE_SIZE_EXCEEDED',
              maxFileSizeBytes: options?.maxFileSizeBytes,
            }),
          ),
        );
      });
      fileSeen = true;
      const fileStream = Readable.toWeb(file) as unknown as WebReadableStream<Uint8Array>;
      const originalFileName = info.filename || 'upload.bin';
      const latin1ToUtf8 = Buffer.from(originalFileName, 'latin1').toString('utf8');
      const hasCjk = (value: string) => /[\u3400-\u9FFF]/.test(value);
      const decodedFileName =
        (originalFileName.includes('�') && !latin1ToUtf8.includes('�'))
        || (!hasCjk(originalFileName) && hasCjk(latin1ToUtf8))
          ? latin1ToUtf8
          : originalFileName;
      uploadPromise = execute({
        fileName: decodedFileName,
        fileStream,
        contentType: info.mimeType || 'application/octet-stream',
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

export async function handleProjectSourceLibraryRoutes(args: {
  routeKind:
    | 'sources'
    | 'sourceLibraries'
    | 'sourceLibraryObjects'
    | 'sourceLibraryFolders'
    | 'sourceLibraryObjectsUpload'
    | 'sourceLibraryObjectsDownload'
    | 'sourceLibraryObjectsDelete'
    | 'sourceLibraryObjectsMove'
    | 'sourceLibraryObjectsMeta'
    | 'sourceLibraryObjectsShareLink'
    | 'sourceLibraryItem'
    | 'sourceLibraryAIReadyJobs'
    | 'sourceLibraryAIReadyJobItem'
    | 'sourceLibraryAIReadyJobCancel'
    | 'sourceAIReadyStart'
    | 'sourceAIReadyCancel'
    | 'sourceAIReadyRetry'
    | 'sourceBatchAIReadyStart'
    | 'sourceBatchAIReadyCancel'
    | 'sourceItem'
    | 'sourceDownload';
  method: string;
  workspaceId: string;
  projectId: string;
  libraryId?: string;
  sourceId?: string;
  jobId?: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  requestUrl: URL;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  requestId: string | null;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  enforceSourceLibraryPreflight: (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
  }) => Promise<boolean>;
  enforceSourceLibraryLimit: (params: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    routeKind: string;
    currentFileCount: number;
    nextFileSizeBytes: number;
  }) => Promise<boolean>;
  enforceSourceLibraryAccessBySourceId: (params: {
    workspaceId: string;
    projectId: string;
    sourceId: string;
    routeKind: string;
  }) => Promise<boolean>;
}): Promise<boolean> {
  const {
    routeKind,
    method,
    workspaceId,
    projectId,
    libraryId,
    sourceId,
    jobId,
    req,
    res,
    requestUrl,
    deps,
    user,
    requestId,
    json,
    readBody,
    enforceSourceLibraryPreflight,
    enforceSourceLibraryLimit,
    enforceSourceLibraryAccessBySourceId,
  } = args;

  if (routeKind === 'sources' && method === 'GET') {
    const requestedLibraryId = requestUrl.searchParams.get('library_id') ?? undefined;
    const libraries = await deps.listSourceLibrariesUseCase.execute({
      workspaceId,
      projectId,
    });
    const ownedLibraries = libraries.items.filter((item) => item.created_by_user_id === user.id);
    const effectiveLibraryId = requestedLibraryId ?? ownedLibraries[0]?.id;
    if (!effectiveLibraryId) {
      json(res, 200, { items: [] });
      return true;
    }
    const matched = ownedLibraries.find((item) => item.id === effectiveLibraryId);
    if (!matched) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'source_library_not_visible' });
      return true;
    }
    const listed = await deps.listSourcesUseCase.execute({
      workspaceId,
      projectId,
      libraryId: effectiveLibraryId,
    });
    json(res, 200, listed);
    return true;
  }

  if (routeKind === 'sources' && method === 'POST') {
    const raw = await readBody(req);
    const input = CreateSourceRequestSchema.parse(raw);
    const libraries = await deps.listSourceLibrariesUseCase.execute({
      workspaceId,
      projectId,
    });
    const targetLibrary = libraries.items.find((item) => item.id === input.library_id);
    if (!targetLibrary || targetLibrary.created_by_user_id !== user.id) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'source_library_not_visible' });
      return true;
    }
    const sourceBytes = Buffer.from(input.content_base64, 'base64').byteLength;
    const listed = await deps.listSourcesUseCase.execute({
      workspaceId,
      projectId,
      libraryId: input.library_id,
    });
    if (!(await enforceSourceLibraryLimit({
      workspaceId,
      projectId,
      libraryId: input.library_id,
      routeKind,
      currentFileCount: listed.items.length,
      nextFileSizeBytes: sourceBytes,
    }))) {
      return true;
    }
    const created = await deps.createSourceUseCase.execute({
      workspaceId,
      projectId,
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (routeKind === 'sourceLibraries' && method === 'GET') {
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId,
      projectId,
    });
    json(res, 200, listed);
    return true;
  }

  if (routeKind === 'sourceLibraries' && method === 'POST') {
    const raw = await readBody(req);
    const input = CreateSourceLibraryRequestSchema.parse(raw);
    const created = await deps.createSourceLibraryUseCase.execute({
      workspaceId,
      projectId,
      actorId: user.id,
      input: {
        ...input,
        visibility: input.visibility ?? 'shared',
      },
    });
    json(res, 201, created);
    return true;
  }

  if (routeKind === 'sourceLibraryObjects' && method === 'GET' && libraryId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const query = ListSourceObjectsQuerySchema.parse({
      prefix: requestUrl.searchParams.get('prefix') ?? undefined,
      delimiter: requestUrl.searchParams.get('delimiter') ?? '/',
      page_size: requestUrl.searchParams.get('page_size') ?? undefined,
      continuation_token: requestUrl.searchParams.get('continuation_token') ?? undefined,
      search: requestUrl.searchParams.get('search') ?? undefined,
      sort_by: requestUrl.searchParams.get('sort_by') ?? undefined,
      sort_order: requestUrl.searchParams.get('sort_order') ?? undefined,
    });
    const listed = await deps.listSourceLibraryObjectsUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      prefix: query.prefix,
      delimiter: query.delimiter,
      pageSize: query.page_size,
      continuationToken: query.continuation_token,
      search: query.search,
      sortBy: query.sort_by,
      sortOrder: query.sort_order,
    });
    json(res, 200, listed);
    return true;
  }

  if (routeKind === 'sourceLibraryFolders' && method === 'POST' && libraryId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const raw = await readBody(req);
    const input = CreateSourceFolderRequestSchema.parse(raw);
    await deps.createSourceFolderUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      input,
    });
    res.statusCode = 201;
    res.end();
    return true;
  }

  if (routeKind === 'sourceLibraryObjectsUpload' && method === 'POST' && libraryId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const listed = await deps.listSourcesUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
    });
    const rawContentType = req.headers['content-type'];
    const contentType = Array.isArray(rawContentType) ? rawContentType.join(';') : rawContentType ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'multipart_form_data_required' });
      return true;
    }
    if (!(await enforceSourceLibraryLimit({
      workspaceId,
      projectId,
      libraryId,
      routeKind,
      currentFileCount: listed.items.length,
      nextFileSizeBytes: 0,
    }))) {
      return true;
    }
    const uploadLimitSnapshot = checkProjectSourceLibraryLimitLimits({
      workspaceId,
      projectId,
      userId: user.id,
      policy: getProjectResourcePolicyOrDefault(
        workspaceId,
        projectId,
        'source_library',
        libraryId,
      ),
      currentFileCount: listed.items.length,
      nextFileSizeBytes: 0,
    });

    let uploaded: unknown;
    try {
      uploaded = await parseUploadAndExecute(
        req,
        (input) =>
          deps.uploadSourceObjectUseCase.execute({
            workspaceId,
            projectId,
            libraryId,
            fileName: input.fileName,
            fileStream: input.fileStream,
            contentType: input.contentType,
            contentLength: input.contentLength,
            prefix: input.prefix,
            overwrite: input.overwrite,
          }),
        {
          maxFileSizeBytes: uploadLimitSnapshot.effective_max_file_size_bytes,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'source_library_max_file_size_exceeded') {
        const effectiveLimit = uploadLimitSnapshot.effective_max_file_size_bytes ?? 0;
        await writeProjectAuditEvent(deps, {
          workspaceId,
          projectId,
          actor: { type: 'user', id: user.id },
          action: 'resource_policy.limit_exceeded',
          result: 'error',
          requestId,
          resourceType: 'source_library',
          resourceId: libraryId,
          errorCode: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
          errorMessage: 'resource_policy_spending_limit_exceeded',
          metadata: {
            governance_kind: 'resource_policy',
            enforcement_kind: 'spending_limit',
            route_kind: routeKind,
            limit_key: 'source_library.max_file_size_bytes',
            effective_limit: effectiveLimit,
            current_usage: effectiveLimit + 1,
            usage_unit: 'bytes',
            effective_max_file_size_bytes: effectiveLimit,
            current_file_size_bytes: effectiveLimit + 1,
            scope: uploadLimitSnapshot.scope,
          },
        });
        await writeProjectUsageFact(deps, {
          workspaceId,
          projectId,
          resourceType: 'source_library',
          resourceId: libraryId,
          endUserId: user.id,
          requestId,
          requests: 1,
          result: 'error',
          errorCode: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
          metadata: {
            stage: 'preflight',
            governance_kind: 'resource_policy',
            enforcement_kind: 'spending_limit',
            route_kind: routeKind,
            limit_key: 'source_library.max_file_size_bytes',
            effective_limit: effectiveLimit,
            current_usage: effectiveLimit + 1,
            usage_unit: 'bytes',
            scope: uploadLimitSnapshot.scope,
          },
        });
        res.setHeader('Retry-After', '86400');
        json(res, 429, {
          error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
          message: 'resource_policy_spending_limit_exceeded',
          resource_type: 'source_library',
          resource_id: libraryId,
          limit_key: 'source_library.max_file_size_bytes',
          retry_after_seconds: 86_400,
        });
        return true;
      }
      throw error;
    }
    json(res, 201, uploaded);
    return true;
  }

  if (routeKind === 'sourceLibraryObjectsDownload' && method === 'GET' && libraryId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const rawKey = requestUrl.searchParams.get('key') ?? '';
    if (!rawKey.trim()) {
      throw new Error('invalid_key');
    }
    const query = SourceObjectDownloadQuerySchema.parse({
      key: rawKey,
    });
    const downloaded = await deps.downloadSourceObjectUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      key: query.key,
    });
    res.statusCode = 200;
    res.setHeader('content-type', downloaded.contentType);
    res.setHeader(
      'content-disposition',
      `attachment; filename=\"${encodeURIComponent(downloaded.key.split('/').at(-1) || 'download')}\"`,
    );
    const nodeStream = Readable.fromWeb(downloaded.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    nodeStream.on('error', () => {
      if (!res.writableEnded) {
        res.end();
      }
    });
    nodeStream.pipe(res);
    return true;
  }

  if (routeKind === 'sourceLibraryObjectsDelete' && method === 'POST' && libraryId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const raw = await readBody(req);
    const input = DeleteSourceObjectsRequestSchema.parse(raw);
    const result = await deps.deleteSourceObjectsUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      input,
    });
    json(res, 200, result);
    return true;
  }

  if (routeKind === 'sourceLibraryObjectsMove' && method === 'POST' && libraryId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const raw = await readBody(req);
    const input = MoveSourceObjectRequestSchema.parse(raw);
    await deps.moveSourceObjectUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      input,
    });
    res.statusCode = 200;
    res.end();
    return true;
  }

  if (routeKind === 'sourceLibraryObjectsMeta' && method === 'GET' && libraryId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const key = requestUrl.searchParams.get('key') ?? '';
    const meta = await deps.getSourceObjectMetaUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      key,
    });
    json(res, 200, meta);
    return true;
  }

  if (routeKind === 'sourceLibraryObjectsShareLink' && method === 'POST' && libraryId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const raw = await readBody(req);
    const input = SourceObjectShareLinkCreateRequestSchema.parse(raw);
    const shareLink = await deps.createSourceObjectShareLinkUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      input,
    });
    json(res, 200, shareLink);
    return true;
  }

  if (routeKind === 'sourceLibraryItem' && method === 'PATCH' && libraryId) {
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId,
      projectId,
    });
    const target = listed.items.find((item) => item.id === libraryId) ?? null;
    if (!target || target.created_by_user_id !== user.id) {
      json(res, 403, {
        error_code: 'FORBIDDEN',
        message: 'source_library_not_visible',
      });
      return true;
    }
    const raw = await readBody(req);
    const input = UpdateSourceLibraryRequestSchema.parse(raw);
    const updated = await deps.updateSourceLibraryUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      input,
    });
    json(res, 200, updated);
    return true;
  }

  if (routeKind === 'sourceLibraryItem' && method === 'DELETE' && libraryId) {
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId,
      projectId,
    });
    const target = listed.items.find((item) => item.id === libraryId) ?? null;
    if (!target || target.created_by_user_id !== user.id) {
      json(res, 403, {
        error_code: 'FORBIDDEN',
        message: 'source_library_not_visible',
      });
      return true;
    }
    await deps.deleteSourceLibraryUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (routeKind === 'sourceLibraryAIReadyJobs' && method === 'POST' && libraryId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const raw = await readBody(req);
    const input = CreateAIReadyJobRequestSchema.parse(raw);
    const created = await deps.createAIReadyJobUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      actorId: user.id,
      idempotencyKey: req.headers['idempotency-key']?.toString(),
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (routeKind === 'sourceLibraryAIReadyJobItem' && method === 'GET' && libraryId && jobId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    await drainJobQueue(deps.aiReadyJobQueue, async (item) => {
      await deps.runQueuedAIReadyJobUseCase.execute({
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        libraryId: item.libraryId,
        jobId: item.jobId,
      });
    });
    const found = await deps.getAIReadyJobUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      jobId,
    });
    json(res, 200, found);
    return true;
  }

  if (routeKind === 'sourceLibraryAIReadyJobCancel' && method === 'POST' && libraryId && jobId) {
    if (!(await enforceSourceLibraryPreflight({ workspaceId, projectId, libraryId, routeKind }))) {
      return true;
    }
    const updated = await deps.cancelAIReadyJobUseCase.execute({
      workspaceId,
      projectId,
      libraryId,
      jobId,
    });
    json(res, 200, updated);
    return true;
  }

  if (routeKind === 'sourceAIReadyStart' && method === 'POST' && sourceId) {
    if (!(await enforceSourceLibraryAccessBySourceId({ workspaceId, projectId, sourceId, routeKind }))) {
      return true;
    }
    const job = await deps.startSourceAIReadyUseCase.execute({
      workspaceId,
      projectId,
      sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (routeKind === 'sourceAIReadyCancel' && method === 'POST' && sourceId) {
    if (!(await enforceSourceLibraryAccessBySourceId({ workspaceId, projectId, sourceId, routeKind }))) {
      return true;
    }
    const job = await deps.cancelSourceAIReadyUseCase.execute({
      workspaceId,
      projectId,
      sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (routeKind === 'sourceAIReadyRetry' && method === 'POST' && sourceId) {
    if (!(await enforceSourceLibraryAccessBySourceId({ workspaceId, projectId, sourceId, routeKind }))) {
      return true;
    }
    const job = await deps.retrySourceAIReadyUseCase.execute({
      workspaceId,
      projectId,
      sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (routeKind === 'sourceBatchAIReadyStart' && method === 'POST') {
    const raw = (await readBody(req)) as { file_ids?: string[] };
    const sourceIds = Array.isArray(raw.file_ids) ? raw.file_ids : [];
    for (const currentSourceId of sourceIds) {
      if (!(await enforceSourceLibraryAccessBySourceId({
        workspaceId,
        projectId,
        sourceId: currentSourceId,
        routeKind,
      }))) {
        return true;
      }
    }
    const jobs = await deps.batchStartSourceAIReadyUseCase.execute({
      workspaceId,
      projectId,
      sourceIds,
    });
    json(res, 200, jobs);
    return true;
  }

  if (routeKind === 'sourceBatchAIReadyCancel' && method === 'POST') {
    const raw = (await readBody(req)) as { file_ids?: string[] };
    const sourceIds = Array.isArray(raw.file_ids) ? raw.file_ids : [];
    for (const currentSourceId of sourceIds) {
      if (!(await enforceSourceLibraryAccessBySourceId({
        workspaceId,
        projectId,
        sourceId: currentSourceId,
        routeKind,
      }))) {
        return true;
      }
    }
    const jobs = await deps.batchCancelSourceAIReadyUseCase.execute({
      workspaceId,
      projectId,
      sourceIds,
    });
    json(res, 200, jobs);
    return true;
  }

  if (routeKind === 'sourceItem' && method === 'DELETE' && sourceId) {
    await deps.deleteSourceUseCase.execute({
      workspaceId,
      projectId,
      sourceId,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (routeKind === 'sourceItem' && method === 'GET' && sourceId) {
    const source = await deps.getSourceUseCase.execute({
      workspaceId,
      projectId,
      sourceId,
    });
    json(res, 200, source);
    return true;
  }

  if (routeKind === 'sourceDownload' && method === 'GET' && sourceId) {
    const source = await deps.downloadSourceUseCase.execute({
      workspaceId,
      projectId,
      sourceId,
    });
    res.statusCode = 200;
    res.setHeader('content-type', source.source.content_type);
    res.setHeader(
      'content-disposition',
      `attachment; filename=\"${encodeURIComponent(source.source.name)}\"`,
    );
    res.end(Buffer.from(source.body));
    return true;
  }

  return false;
}
