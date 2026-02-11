import type http from 'node:http';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  CreateSourceFolderRequestSchema,
  CreateAIReadyJobRequestSchema,
  DeleteSourceObjectsRequestSchema,
  MoveSourceObjectRequestSchema,
  CreateProjectRequestSchema,
  CreateSourceLibraryRequestSchema,
  CreateSourceRequestSchema,
  UpdateProjectRequestSchema,
  UpdateSourceLibraryRequestSchema,
} from '@mbos/contracts';
import { drainJobQueue } from '@mbos/application';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';

interface WorkspaceRecordLike {
  id: string;
  created_at: string;
}

interface AnyRoute {
  kind: string;
  workspaceId?: string;
  projectId?: string;
  libraryId?: string;
  jobId?: string;
  sourceId?: string;
}

interface ProjectSourceHandlerArgs {
  route: AnyRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  workspaces: WorkspaceRecordLike[];
  defaultWorkspace?: WorkspaceRecordLike;
  requestUrl: URL;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  ownerWorkspacePermissions: readonly string[];
  resolveProjectPermissions: (ownerId: string, actorId: string) => readonly string[];
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
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
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
      fileSeen = true;
      const fileStream = Readable.toWeb(file) as unknown as WebReadableStream<Uint8Array>;
      uploadPromise = execute({
        fileName: info.filename || 'upload.bin',
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

export async function handleProjectSourceRoute(args: ProjectSourceHandlerArgs): Promise<boolean> {
  const {
    route,
    method,
    req,
    res,
    deps,
    user,
    workspaces,
    defaultWorkspace,
    requestUrl,
    json,
    readBody,
    ownerWorkspacePermissions,
    resolveProjectPermissions,
  } = args;

  if (route.kind === 'workspacesCollection' && method === 'GET') {
    json(res, 200, { items: workspaces, total: workspaces.length });
    return true;
  }

  if (route.kind === 'workspaceItem' && method === 'GET' && route.workspaceId) {
    const found = workspaces.find((item) => item.id === route.workspaceId);
    if (!found) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
      return true;
    }
    json(res, 200, found);
    return true;
  }

  if (route.kind === 'workspaceMembers' && method === 'GET' && route.workspaceId) {
    if (!defaultWorkspace || route.workspaceId !== defaultWorkspace.id) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
      return true;
    }
    const member = {
      id: `wm_${user.id}`,
      user_id: user.id,
      name: user.name,
      email: user.email,
      role: 'owner',
      governance_group: 'wheel',
      permissions: [...ownerWorkspacePermissions],
      status: 'active',
      joined_at: defaultWorkspace.created_at,
    };
    json(res, 200, { items: [member], total: 1 });
    return true;
  }

  const workspaceIdInRoute = route.workspaceId ?? null;
  if (workspaceIdInRoute && !workspaces.some((item) => item.id === workspaceIdInRoute)) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
    return true;
  }

  if (route.kind === 'collection' && method === 'GET' && route.workspaceId) {
    const listed = await deps.listProjectsUseCase.execute(route.workspaceId);
    json(res, 200, {
      items: listed.items.map((item) => ({
        ...item,
        role: item.owner_id === user.id ? 'owner' : 'developer',
        permissions: [...resolveProjectPermissions(item.owner_id, user.id)],
      })),
    });
    return true;
  }

  if (route.kind === 'collection' && method === 'POST' && route.workspaceId) {
    const raw = await readBody(req);
    const input = CreateProjectRequestSchema.parse(raw);
    const created = await deps.createProjectUseCase.execute({
      workspaceId: route.workspaceId,
      actorId: user.id,
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'item' && method === 'GET' && route.workspaceId && route.projectId) {
    const found = await deps.getProjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    json(res, 200, {
      ...found,
      role: found.owner_id === user.id ? 'owner' : 'developer',
      permissions: [...resolveProjectPermissions(found.owner_id, user.id)],
    });
    return true;
  }

  if (route.kind === 'item' && method === 'PATCH' && route.workspaceId && route.projectId) {
    const raw = await readBody(req);
    const input = UpdateProjectRequestSchema.parse(raw);
    const updated = await deps.updateProjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      input,
    });
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'item' && method === 'DELETE' && route.workspaceId && route.projectId) {
    await deps.deleteProjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'sources' && method === 'GET' && route.workspaceId && route.projectId) {
    const libraryId = requestUrl.searchParams.get('library_id') ?? undefined;
    const listed = await deps.listSourcesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId,
    });
    json(res, 200, listed);
    return true;
  }

  if (route.kind === 'sources' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = await readBody(req);
    const input = CreateSourceRequestSchema.parse(raw);
    const created = await deps.createSourceUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'sourceLibraries' && method === 'GET' && route.workspaceId && route.projectId) {
    const listed = await deps.listSourceLibrariesUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
    });
    json(res, 200, listed);
    return true;
  }

  if (route.kind === 'sourceLibraries' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = await readBody(req);
    const input = CreateSourceLibraryRequestSchema.parse(raw);
    const created = await deps.createSourceLibraryUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actorId: user.id,
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'sourceLibraryObjects' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId) {
    const prefix = requestUrl.searchParams.get('prefix') ?? undefined;
    const delimiter = requestUrl.searchParams.get('delimiter') ?? '/';
    const pageSizeRaw = requestUrl.searchParams.get('page_size');
    const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined;
    const continuationToken = requestUrl.searchParams.get('continuation_token') ?? undefined;
    const listed = await deps.listSourceLibraryObjectsUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      prefix,
      delimiter,
      pageSize,
      continuationToken,
    });
    json(res, 200, listed);
    return true;
  }

  if (route.kind === 'sourceLibraryFolders' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = CreateSourceFolderRequestSchema.parse(raw);
    await deps.createSourceFolderUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      input,
    });
    res.statusCode = 201;
    res.end();
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsUpload' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const workspaceId = route.workspaceId;
    const projectId = route.projectId;
    const libraryId = route.libraryId;
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'multipart_form_data_required' });
      return true;
    }

    const uploaded = await parseUploadAndExecute(req, (input) =>
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
    );
    json(res, 201, uploaded);
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsDownload' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId) {
    const key = requestUrl.searchParams.get('key') ?? '';
    const downloaded = await deps.downloadSourceObjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      key,
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

  if (route.kind === 'sourceLibraryObjectsDelete' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = DeleteSourceObjectsRequestSchema.parse(raw);
    const result = await deps.deleteSourceObjectsUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      input,
    });
    json(res, 200, result);
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsMove' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = MoveSourceObjectRequestSchema.parse(raw);
    await deps.moveSourceObjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      input,
    });
    res.statusCode = 200;
    res.end();
    return true;
  }

  if (route.kind === 'sourceLibraryObjectsMeta' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId) {
    const key = requestUrl.searchParams.get('key') ?? '';
    const meta = await deps.getSourceObjectMetaUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      key,
    });
    json(res, 200, meta);
    return true;
  }

  if (route.kind === 'sourceLibraryItem' && method === 'PATCH' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = UpdateSourceLibraryRequestSchema.parse(raw);
    const updated = await deps.updateSourceLibraryUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      input,
    });
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'sourceLibraryItem' && method === 'DELETE' && route.workspaceId && route.projectId && route.libraryId) {
    await deps.deleteSourceLibraryUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'sourceLibraryAIReadyJobs' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId) {
    const raw = await readBody(req);
    const input = CreateAIReadyJobRequestSchema.parse(raw);
    const created = await deps.createAIReadyJobUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      actorId: user.id,
      idempotencyKey: req.headers['idempotency-key']?.toString(),
      input,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'sourceLibraryAIReadyJobItem' && method === 'GET' && route.workspaceId && route.projectId && route.libraryId && route.jobId) {
    await drainJobQueue(deps.aiReadyJobQueue, async (item) => {
      await deps.runQueuedAIReadyJobUseCase.execute({
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        libraryId: item.libraryId,
        jobId: item.jobId,
      });
    });
    const found = await deps.getAIReadyJobUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      jobId: route.jobId,
    });
    json(res, 200, found);
    return true;
  }

  if (route.kind === 'sourceLibraryAIReadyJobCancel' && method === 'POST' && route.workspaceId && route.projectId && route.libraryId && route.jobId) {
    const updated = await deps.cancelAIReadyJobUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: route.libraryId,
      jobId: route.jobId,
    });
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'sourcesQuota' && method === 'GET' && route.workspaceId && route.projectId) {
    const libraryId = requestUrl.searchParams.get('library_id') ?? undefined;
    const quota = await deps.getSourcesQuotaUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId,
    });
    json(res, 200, quota);
    return true;
  }

  if (route.kind === 'sourceAIReadyStart' && method === 'POST' && route.workspaceId && route.projectId && route.sourceId) {
    const job = await deps.startSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (route.kind === 'sourceAIReadyCancel' && method === 'POST' && route.workspaceId && route.projectId && route.sourceId) {
    const job = await deps.cancelSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (route.kind === 'sourceAIReadyRetry' && method === 'POST' && route.workspaceId && route.projectId && route.sourceId) {
    const job = await deps.retrySourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, job);
    return true;
  }

  if (route.kind === 'sourceBatchAIReadyStart' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = (await readBody(req)) as { file_ids?: string[] };
    const sourceIds = Array.isArray(raw.file_ids) ? raw.file_ids : [];
    const jobs = await deps.batchStartSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceIds,
    });
    json(res, 200, jobs);
    return true;
  }

  if (route.kind === 'sourceBatchAIReadyCancel' && method === 'POST' && route.workspaceId && route.projectId) {
    const raw = (await readBody(req)) as { file_ids?: string[] };
    const sourceIds = Array.isArray(raw.file_ids) ? raw.file_ids : [];
    const jobs = await deps.batchCancelSourceAIReadyUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceIds,
    });
    json(res, 200, jobs);
    return true;
  }

  if (route.kind === 'sourceItem' && method === 'DELETE' && route.workspaceId && route.projectId && route.sourceId) {
    await deps.deleteSourceUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'sourceItem' && method === 'GET' && route.workspaceId && route.projectId && route.sourceId) {
    const source = await deps.getSourceUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
    });
    json(res, 200, source);
    return true;
  }

  if (route.kind === 'sourceDownload' && method === 'GET' && route.workspaceId && route.projectId && route.sourceId) {
    const source = await deps.downloadSourceUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sourceId: route.sourceId,
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
