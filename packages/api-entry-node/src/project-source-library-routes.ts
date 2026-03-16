import type http from 'node:http';
import {
  CreateAIReadyJobRequestSchema,
  CreateSourceRequestSchema,
} from '@mbos/contracts';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

export async function handleProjectSourceLibraryRoutes(args: {
  routeKind:
    | 'sources'
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
