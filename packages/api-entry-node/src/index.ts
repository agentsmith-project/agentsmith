import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  ErrorResponseSchema,
} from '@mbos/contracts';
import {
  CancelAIReadyJobUseCase,
  BatchCancelSourceAIReadyUseCase,
  BatchStartSourceAIReadyUseCase,
  CancelSourceAIReadyUseCase,
  CreateAIReadyJobUseCase,
  CreateSourceLibraryUseCase,
  CreateProjectUseCase,
  CreateSourceUseCase,
  DeleteSourceLibraryUseCase,
  DeleteSourceUseCase,
  DeleteProjectUseCase,
  DownloadSourceUseCase,
  GetSourceUseCase,
  GetAIReadyJobUseCase,
  GetSourcesQuotaUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  ListSourceLibrariesUseCase,
  ListSourcesUseCase,
  RunQueuedAIReadyJobUseCase,
  RetrySourceAIReadyUseCase,
  StartSourceAIReadyUseCase,
  UpdateSourceLibraryUseCase,
  UpdateProjectUseCase,
  drainJobQueue,
} from '@mbos/application';
import {
  DeterministicEmbeddingProvider,
  FixedCharTextChunker,
  InMemoryJobQueue,
  InMemoryCache,
  InMemoryJsonDocStore,
  InMemoryObjectStore,
  JsonDocAIReadyJobRepo,
  JsonDocSourceRepo,
  JsonDocSourceLibraryRepo,
  MinioObjectStore,
  MongoJsonDocStore,
  NoopVectorStore,
  PgVectorStore,
  RedisCache,
  createProjectRepoFactoryResult,
  type ProjectRepoFactoryResult,
  SimpleIdGenerator,
  SystemClock,
  Utf8DocumentParser,
} from '@mbos/adapters-private';
import type { CachePort } from '@mbos/ports';
import {
  ACTIVE_CHAT_STREAMS,
} from './chat-stream-runtime.js';
import { matchChatRoute, type ChatRoute } from './chat-route-match.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import { handleChatStreamRoute } from './chat-stream-handler.js';
import { handleEndpointRoute } from './endpoint-route-handler.js';
import { verifyBearerToken } from './auth.js';
import { handleProjectSourceRoute } from './project-source-route-handler.js';
import { applyCors, json, proxyJsonRequest, readBody, unauthorized } from './http-utils.js';
import type { WorkspaceRecord } from './resource-models.js';
import { EndpointResourceService } from './endpoint-resource-service.js';
import { ChatResourceService } from './chat-resource-service.js';

export interface NodeApiDeps {
  cache: CachePort;
  chatResourceService: ChatResourceService;
  endpointResourceService: EndpointResourceService;
  sourceBucket: string;
  aiReadyJobQueue: InMemoryJobQueue;
  createAIReadyJobUseCase: CreateAIReadyJobUseCase;
  createSourceLibraryUseCase: CreateSourceLibraryUseCase;
  createProjectUseCase: CreateProjectUseCase;
  createSourceUseCase: CreateSourceUseCase;
  deleteSourceLibraryUseCase: DeleteSourceLibraryUseCase;
  deleteSourceUseCase: DeleteSourceUseCase;
  downloadSourceUseCase: DownloadSourceUseCase;
  getSourceUseCase: GetSourceUseCase;
  getAIReadyJobUseCase: GetAIReadyJobUseCase;
  getSourcesQuotaUseCase: GetSourcesQuotaUseCase;
  startSourceAIReadyUseCase: StartSourceAIReadyUseCase;
  cancelSourceAIReadyUseCase: CancelSourceAIReadyUseCase;
  retrySourceAIReadyUseCase: RetrySourceAIReadyUseCase;
  batchStartSourceAIReadyUseCase: BatchStartSourceAIReadyUseCase;
  batchCancelSourceAIReadyUseCase: BatchCancelSourceAIReadyUseCase;
  deleteProjectUseCase: DeleteProjectUseCase;
  getProjectUseCase: GetProjectUseCase;
  listProjectsUseCase: ListProjectsUseCase;
  listSourceLibrariesUseCase: ListSourceLibrariesUseCase;
  listSourcesUseCase: ListSourcesUseCase;
  updateSourceLibraryUseCase: UpdateSourceLibraryUseCase;
  updateProjectUseCase: UpdateProjectUseCase;
  cancelAIReadyJobUseCase: CancelAIReadyJobUseCase;
  runQueuedAIReadyJobUseCase: RunQueuedAIReadyJobUseCase;
}

export function createDefaultNodeApiDeps(): NodeApiDeps {
  const projectRepo = createProjectRepoFactoryResult({}).projectRepo;
  const cache = new InMemoryCache();
  const clock = new SystemClock();
  const docStore = new InMemoryJsonDocStore();
  const chatResourceService = new ChatResourceService(docStore);
  const sourceRepo = new JsonDocSourceRepo(docStore);
  const sourceLibraryRepo = new JsonDocSourceLibraryRepo(docStore);
  const aiReadyJobRepo = new JsonDocAIReadyJobRepo(docStore);
  const aiReadyJobQueue = new InMemoryJobQueue();
  const objectStore = new InMemoryObjectStore();
  const endpointResourceService = new EndpointResourceService(docStore);
  const sourceBucket = 'mbos-dev';
  const vectorStore = new NoopVectorStore();
  const parser = new Utf8DocumentParser();
  const chunker = new FixedCharTextChunker();
  const embeddings = new DeterministicEmbeddingProvider();
  const startSourceAIReadyUseCase = new StartSourceAIReadyUseCase(sourceRepo, clock, cache);
  const cancelSourceAIReadyUseCase = new CancelSourceAIReadyUseCase(sourceRepo, clock, cache);
  const runQueuedAIReadyJobUseCase = new RunQueuedAIReadyJobUseCase(
    sourceRepo,
    sourceLibraryRepo,
    aiReadyJobRepo,
    objectStore,
    parser,
    chunker,
    embeddings,
    vectorStore,
    clock,
    cache,
    sourceBucket,
  );

  return {
    cache,
    chatResourceService,
    endpointResourceService,
    sourceBucket,
    aiReadyJobQueue,
    createAIReadyJobUseCase: new CreateAIReadyJobUseCase(
      sourceRepo,
      sourceLibraryRepo,
      aiReadyJobRepo,
      aiReadyJobQueue,
      clock,
      cache,
    ),
    createSourceLibraryUseCase: new CreateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
    ),
    createProjectUseCase: new CreateProjectUseCase(projectRepo, new SimpleIdGenerator(), new SystemClock()),
    createSourceUseCase: new CreateSourceUseCase(
      sourceRepo,
      objectStore,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
      sourceBucket,
    ),
    deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, cache),
    deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, sourceBucket),
    downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, sourceBucket),
    deleteProjectUseCase: new DeleteProjectUseCase(projectRepo),
    getSourceUseCase: new GetSourceUseCase(sourceRepo),
    getAIReadyJobUseCase: new GetAIReadyJobUseCase(aiReadyJobRepo, cache),
    getSourcesQuotaUseCase: new GetSourcesQuotaUseCase(sourceRepo),
    startSourceAIReadyUseCase,
    cancelSourceAIReadyUseCase,
    retrySourceAIReadyUseCase: new RetrySourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchStartSourceAIReadyUseCase: new BatchStartSourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchCancelSourceAIReadyUseCase: new BatchCancelSourceAIReadyUseCase(cancelSourceAIReadyUseCase),
    getProjectUseCase: new GetProjectUseCase(projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(projectRepo),
    listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
    listSourcesUseCase: new ListSourcesUseCase(sourceRepo, cache),
    updateSourceLibraryUseCase: new UpdateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SystemClock(),
      cache,
    ),
    updateProjectUseCase: new UpdateProjectUseCase(projectRepo, new SystemClock()),
    cancelAIReadyJobUseCase: new CancelAIReadyJobUseCase(aiReadyJobRepo, clock, cache),
    runQueuedAIReadyJobUseCase,
  };
}

const OWNER_PROJECT_PERMISSIONS = [
  'project:read',
  'project:chat:access',
  'project:studio:access',
  'project:source:use',
  'project:source:manage',
  'project:endpoint:use',
  'project:endpoint:manage',
  'project:agent:use',
  'project:agent:manage',
  'project:resource_policy:manage',
  'project:credential:manage',
  'project:settings:manage',
  'project:member:view',
  'project:member:manage',
  'project:audit:view',
  'project:usage:view',
] as const;

const OPERATOR_PROJECT_PERMISSIONS = [
  'project:read',
  'project:chat:access',
  'project:source:use',
  'project:source:manage',
  'project:endpoint:use',
  'project:endpoint:manage',
  'project:credential:manage',
] as const;

const OWNER_WORKSPACE_PERMISSIONS = [
  'workspace:read',
  'workspace:project:create',
  'workspace:governance:update',
] as const;

function resolveProjectPermissions(ownerId: string, actorId: string): readonly string[] {
  if (ownerId === actorId) {
    return OWNER_PROJECT_PERMISSIONS;
  }
  return OPERATOR_PROJECT_PERMISSIONS;
}

function buildWorkspaceRecords(): WorkspaceRecord[] {
  const now = new Date().toISOString();
  const workspaceId = process.env.MBOS_DEFAULT_WORKSPACE_ID ?? 'ws_default';
  const workspaceName = process.env.MBOS_DEFAULT_WORKSPACE_NAME ?? 'Default Workspace';
  return [{
    id: workspaceId,
    name: workspaceName,
    created_at: now,
    updated_at: now,
  }];
}

function buildUpstreamUrl(baseUrl: string, proxyPath: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = proxyPath.replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

type ProjectsRoute =
  | { kind: 'workspacesCollection' }
  | { kind: 'workspaceItem'; workspaceId: string }
  | { kind: 'workspaceMembers'; workspaceId: string }
  | { kind: 'collection'; workspaceId: string }
  | { kind: 'item'; workspaceId: string; projectId: string }
  | { kind: 'sources'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraries'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraryItem'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryAIReadyJobs'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryAIReadyJobItem'; workspaceId: string; projectId: string; libraryId: string; jobId: string }
  | { kind: 'sourceLibraryAIReadyJobCancel'; workspaceId: string; projectId: string; libraryId: string; jobId: string }
  | { kind: 'sourcesQuota'; workspaceId: string; projectId: string }
  | { kind: 'sourceAIReadyStart'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceAIReadyCancel'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceAIReadyRetry'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceBatchAIReadyStart'; workspaceId: string; projectId: string }
  | { kind: 'sourceBatchAIReadyCancel'; workspaceId: string; projectId: string }
  | { kind: 'sourceItem'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceDownload'; workspaceId: string; projectId: string; sourceId: string }
  | ChatRoute
  | { kind: 'endpoints'; workspaceId: string; projectId: string }
  | { kind: 'endpointItem'; workspaceId: string; projectId: string; endpointId: string }
  | {
    kind: 'endpointProxy';
    workspaceId: string;
    projectId: string;
    endpointId: string;
    proxyPath: string;
  }
  | { kind: 'endpointImportOpenAICompatible'; workspaceId: string; projectId: string }
  | { kind: 'credentials'; workspaceId: string; projectId: string }
  | { kind: 'credentialItem'; workspaceId: string; projectId: string; credentialId: string }
  | { kind: 'credentialRotate'; workspaceId: string; projectId: string; credentialId: string };

function matchProjectsRoute(url: string): ProjectsRoute | null {
  const pathname = new URL(url, 'http://localhost').pathname;
  if (pathname === '/api/v1/workspaces' || pathname === '/api/v1/workspaces/') {
    return { kind: 'workspacesCollection' };
  }

  const workspaceItemMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/?$/);
  if (workspaceItemMatched) {
    return {
      kind: 'workspaceItem',
      workspaceId: decodeURIComponent(workspaceItemMatched[1]),
    };
  }

  const workspaceMembersMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/members\/?$/);
  if (workspaceMembersMatched) {
    return {
      kind: 'workspaceMembers',
      workspaceId: decodeURIComponent(workspaceMembersMatched[1]),
    };
  }

  const collectionMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/?$/);
  if (collectionMatched) {
    return { kind: 'collection', workspaceId: decodeURIComponent(collectionMatched[1]) };
  }

  const itemMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/?$/);
  if (itemMatched) {
    return {
      kind: 'item',
      workspaceId: decodeURIComponent(itemMatched[1]),
      projectId: decodeURIComponent(itemMatched[2]),
    };
  }

  const sourcesMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/?$/);
  if (sourcesMatched) {
    return {
      kind: 'sources',
      workspaceId: decodeURIComponent(sourcesMatched[1]),
      projectId: decodeURIComponent(sourcesMatched[2]),
    };
  }

  const sourceLibrariesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/?$/,
  );
  if (sourceLibrariesMatched) {
    return {
      kind: 'sourceLibraries',
      workspaceId: decodeURIComponent(sourceLibrariesMatched[1]),
      projectId: decodeURIComponent(sourceLibrariesMatched[2]),
    };
  }

  const sourceLibraryItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/?$/,
  );
  if (sourceLibraryItemMatched) {
    return {
      kind: 'sourceLibraryItem',
      workspaceId: decodeURIComponent(sourceLibraryItemMatched[1]),
      projectId: decodeURIComponent(sourceLibraryItemMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryItemMatched[3]),
    };
  }

  const sourceLibraryAIReadyJobsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/ai-ready-jobs\/?$/,
  );
  if (sourceLibraryAIReadyJobsMatched) {
    return {
      kind: 'sourceLibraryAIReadyJobs',
      workspaceId: decodeURIComponent(sourceLibraryAIReadyJobsMatched[1]),
      projectId: decodeURIComponent(sourceLibraryAIReadyJobsMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryAIReadyJobsMatched[3]),
    };
  }

  const sourceLibraryAIReadyJobCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/ai-ready-jobs\/([^/]+):cancel\/?$/,
  );
  if (sourceLibraryAIReadyJobCancelMatched) {
    return {
      kind: 'sourceLibraryAIReadyJobCancel',
      workspaceId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[1]),
      projectId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[3]),
      jobId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[4]),
    };
  }

  const sourceLibraryAIReadyJobItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/ai-ready-jobs\/([^/]+)\/?$/,
  );
  if (sourceLibraryAIReadyJobItemMatched) {
    return {
      kind: 'sourceLibraryAIReadyJobItem',
      workspaceId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[1]),
      projectId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[3]),
      jobId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[4]),
    };
  }

  const sourcesQuotaMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/quota\/?$/,
  );
  if (sourcesQuotaMatched) {
    return {
      kind: 'sourcesQuota',
      workspaceId: decodeURIComponent(sourcesQuotaMatched[1]),
      projectId: decodeURIComponent(sourcesQuotaMatched[2]),
    };
  }

  const sourceAIReadyStartMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/ai-ready\/start\/?$/,
  );
  if (sourceAIReadyStartMatched) {
    return {
      kind: 'sourceAIReadyStart',
      workspaceId: decodeURIComponent(sourceAIReadyStartMatched[1]),
      projectId: decodeURIComponent(sourceAIReadyStartMatched[2]),
      sourceId: decodeURIComponent(sourceAIReadyStartMatched[3]),
    };
  }

  const sourceAIReadyCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/ai-ready\/cancel\/?$/,
  );
  if (sourceAIReadyCancelMatched) {
    return {
      kind: 'sourceAIReadyCancel',
      workspaceId: decodeURIComponent(sourceAIReadyCancelMatched[1]),
      projectId: decodeURIComponent(sourceAIReadyCancelMatched[2]),
      sourceId: decodeURIComponent(sourceAIReadyCancelMatched[3]),
    };
  }

  const sourceAIReadyRetryMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/ai-ready\/retry\/?$/,
  );
  if (sourceAIReadyRetryMatched) {
    return {
      kind: 'sourceAIReadyRetry',
      workspaceId: decodeURIComponent(sourceAIReadyRetryMatched[1]),
      projectId: decodeURIComponent(sourceAIReadyRetryMatched[2]),
      sourceId: decodeURIComponent(sourceAIReadyRetryMatched[3]),
    };
  }

  const sourceBatchAIReadyStartMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/batch\/ai-ready\/start\/?$/,
  );
  if (sourceBatchAIReadyStartMatched) {
    return {
      kind: 'sourceBatchAIReadyStart',
      workspaceId: decodeURIComponent(sourceBatchAIReadyStartMatched[1]),
      projectId: decodeURIComponent(sourceBatchAIReadyStartMatched[2]),
    };
  }

  const sourceBatchAIReadyCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/batch\/ai-ready\/cancel\/?$/,
  );
  if (sourceBatchAIReadyCancelMatched) {
    return {
      kind: 'sourceBatchAIReadyCancel',
      workspaceId: decodeURIComponent(sourceBatchAIReadyCancelMatched[1]),
      projectId: decodeURIComponent(sourceBatchAIReadyCancelMatched[2]),
    };
  }

  const sourceItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/?$/,
  );
  if (sourceItemMatched) {
    return {
      kind: 'sourceItem',
      workspaceId: decodeURIComponent(sourceItemMatched[1]),
      projectId: decodeURIComponent(sourceItemMatched[2]),
      sourceId: decodeURIComponent(sourceItemMatched[3]),
    };
  }

  const sourceDownloadMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/download\/?$/,
  );
  if (sourceDownloadMatched) {
    return {
      kind: 'sourceDownload',
      workspaceId: decodeURIComponent(sourceDownloadMatched[1]),
      projectId: decodeURIComponent(sourceDownloadMatched[2]),
      sourceId: decodeURIComponent(sourceDownloadMatched[3]),
    };
  }

  const chatRoute = matchChatRoute(pathname);
  if (chatRoute) {
    return chatRoute;
  }

  const endpointImportMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/import-openai-compatible\/?$/,
  );
  if (endpointImportMatched) {
    return {
      kind: 'endpointImportOpenAICompatible',
      workspaceId: decodeURIComponent(endpointImportMatched[1]),
      projectId: decodeURIComponent(endpointImportMatched[2]),
    };
  }

  const endpointProxyMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/proxy\/(.+)$/,
  );
  if (endpointProxyMatched) {
    return {
      kind: 'endpointProxy',
      workspaceId: decodeURIComponent(endpointProxyMatched[1]),
      projectId: decodeURIComponent(endpointProxyMatched[2]),
      endpointId: decodeURIComponent(endpointProxyMatched[3]),
      proxyPath: endpointProxyMatched[4],
    };
  }

  const endpointItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/?$/,
  );
  if (endpointItemMatched) {
    return {
      kind: 'endpointItem',
      workspaceId: decodeURIComponent(endpointItemMatched[1]),
      projectId: decodeURIComponent(endpointItemMatched[2]),
      endpointId: decodeURIComponent(endpointItemMatched[3]),
    };
  }

  const endpointsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/?$/,
  );
  if (endpointsMatched) {
    return {
      kind: 'endpoints',
      workspaceId: decodeURIComponent(endpointsMatched[1]),
      projectId: decodeURIComponent(endpointsMatched[2]),
    };
  }

  const credentialRotateMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/credentials\/([^/]+)\/rotate\/?$/,
  );
  if (credentialRotateMatched) {
    return {
      kind: 'credentialRotate',
      workspaceId: decodeURIComponent(credentialRotateMatched[1]),
      projectId: decodeURIComponent(credentialRotateMatched[2]),
      credentialId: decodeURIComponent(credentialRotateMatched[3]),
    };
  }

  const credentialItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/credentials\/([^/]+)\/?$/,
  );
  if (credentialItemMatched) {
    return {
      kind: 'credentialItem',
      workspaceId: decodeURIComponent(credentialItemMatched[1]),
      projectId: decodeURIComponent(credentialItemMatched[2]),
      credentialId: decodeURIComponent(credentialItemMatched[3]),
    };
  }

  const credentialsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/credentials\/?$/,
  );
  if (credentialsMatched) {
    return {
      kind: 'credentials',
      workspaceId: decodeURIComponent(credentialsMatched[1]),
      projectId: decodeURIComponent(credentialsMatched[2]),
    };
  }

  return null;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, deps: NodeApiDeps): Promise<void> {
  applyCors(res);
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const route = matchProjectsRoute(req.url ?? '');
  if (!route) {
    json(res, 404, { code: 'NOT_FOUND', message: 'Route not found' });
    return;
  }

  try {
    const requestUrl = new URL(req.url ?? '', 'http://localhost');
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }

    const workspaces = buildWorkspaceRecords();
    const defaultWorkspace = workspaces[0];

    const handledProjectSourceRoute = await handleProjectSourceRoute({
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
      ownerWorkspacePermissions: OWNER_WORKSPACE_PERMISSIONS,
      resolveProjectPermissions,
    });
    if (handledProjectSourceRoute) {
      return;
    }

    const handledChatNonStream = await handleChatNonStreamRoute({
      route,
      method,
      req,
      res,
      deps,
      requestUrl,
      json,
      readBody,
    });
    if (handledChatNonStream) {
      return;
    }

    const handledChatStream = await handleChatStreamRoute({
      route,
      method,
      req,
      res,
      deps,
      json,
      readBody,
      buildUpstreamUrl,
      sseWrite,
    });
    if (handledChatStream) {
      return;
    }

    const handledEndpointRoute = await handleEndpointRoute({
      route,
      method,
      req,
      res,
      deps,
      json,
      readBody,
      buildUpstreamUrl,
      proxyJsonRequest,
    });
    if (handledEndpointRoute) {
      return;
    }

    json(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  } catch (error) {
    if (error instanceof Error && error.message === 'project_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'project_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'source_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_library_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'source_library_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'ai_ready_job_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'ai_ready_job_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_library_mismatch') {
      json(res, 422, { code: 'VALIDATION_ERROR', message: 'source_library_mismatch' });
      return;
    }

    const parsed = ErrorResponseSchema.safeParse({
      code: 'VALIDATION_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    json(res, 400, parsed.success ? parsed.data : { code: 'BAD_REQUEST', message: 'Bad request' });
  }
}

export function createNodeApiServer(
  port = 3010,
  deps = createDefaultNodeApiDeps(),
  lifecycle?: Pick<ProjectRepoFactoryResult, 'shutdown'>,
): http.Server {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, deps);
  });

  const jobWorkerInterval = setInterval(() => {
    void drainJobQueue(deps.aiReadyJobQueue, async (item) => {
      await deps.runQueuedAIReadyJobUseCase.execute({
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        libraryId: item.libraryId,
        jobId: item.jobId,
      });
    });
  }, 200);

  if (lifecycle) {
    server.on('close', () => {
      clearInterval(jobWorkerInterval);
      ACTIVE_CHAT_STREAMS.clear();
      void lifecycle.shutdown();
    });
  } else {
    server.on('close', () => {
      clearInterval(jobWorkerInterval);
      ACTIVE_CHAT_STREAMS.clear();
    });
  }

  server.listen(port);
  return server;
}

function startFromCli(): void {
  const portRaw = process.env.PORT;
  const port = portRaw ? Number(portRaw) : 3010;
  if (!Number.isInteger(port) || port <= 0) {
    // Keep startup validation explicit for ops.
    throw new Error('invalid_port');
  }

  const factory = createProjectRepoFactoryResult({
    databaseUrl: process.env.DATABASE_URL,
  });
  const cache = process.env.REDIS_URL
    ? new RedisCache({ url: process.env.REDIS_URL })
    : new InMemoryCache();
  const clock = new SystemClock();
  const docStore = process.env.MONGO_URL
    ? new MongoJsonDocStore({
      url: process.env.MONGO_URL,
      dbName: process.env.MONGO_DB_NAME ?? 'mbos',
    })
    : new InMemoryJsonDocStore();
  const chatResourceService = new ChatResourceService(docStore);
  const objectStore = process.env.MINIO_ENDPOINT
    ? new MinioObjectStore({
      endPoint: process.env.MINIO_ENDPOINT,
      port: Number(process.env.MINIO_PORT ?? '19000'),
      useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'mbos',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'mbos_dev_password',
    })
    : new InMemoryObjectStore();
  const sourceRepo = new JsonDocSourceRepo(docStore);
  const sourceLibraryRepo = new JsonDocSourceLibraryRepo(docStore);
  const aiReadyJobRepo = new JsonDocAIReadyJobRepo(docStore);
  const aiReadyJobQueue = new InMemoryJobQueue();
  const endpointResourceService = new EndpointResourceService(docStore);
  const sourceBucket = process.env.MINIO_BUCKET ?? 'mbos-dev';
  const parser = new Utf8DocumentParser();
  const chunker = new FixedCharTextChunker({
    chunkSize: Number(process.env.AIREADY_CHUNK_SIZE ?? '1000'),
    overlap: Number(process.env.AIREADY_CHUNK_OVERLAP ?? '100'),
  });
  const embeddings = new DeterministicEmbeddingProvider(
    Number(process.env.AIREADY_EMBEDDING_DIMENSIONS ?? '1536'),
  );
  const vectorStore = process.env.DATABASE_URL
    ? new PgVectorStore({
      databaseUrl: process.env.DATABASE_URL,
      embeddingDimensions: embeddings.dimensions(),
    })
    : new NoopVectorStore();
  if (vectorStore instanceof PgVectorStore) {
    void vectorStore.ensureSchema().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown_error';
      process.stderr.write(`[api-entry-node] pgvector schema init failed: ${message}\n`);
    });
  }
  const startSourceAIReadyUseCase = new StartSourceAIReadyUseCase(sourceRepo, clock, cache);
  const cancelSourceAIReadyUseCase = new CancelSourceAIReadyUseCase(sourceRepo, clock, cache);
  const runQueuedAIReadyJobUseCase = new RunQueuedAIReadyJobUseCase(
    sourceRepo,
    sourceLibraryRepo,
    aiReadyJobRepo,
    objectStore,
    parser,
    chunker,
    embeddings,
    vectorStore,
    clock,
    cache,
    sourceBucket,
  );
  const deps: NodeApiDeps = {
    cache,
    chatResourceService,
    endpointResourceService,
    sourceBucket,
    aiReadyJobQueue,
    createAIReadyJobUseCase: new CreateAIReadyJobUseCase(
      sourceRepo,
      sourceLibraryRepo,
      aiReadyJobRepo,
      aiReadyJobQueue,
      clock,
      cache,
    ),
    createSourceLibraryUseCase: new CreateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
    ),
    createProjectUseCase: new CreateProjectUseCase(factory.projectRepo, new SimpleIdGenerator(), new SystemClock()),
    createSourceUseCase: new CreateSourceUseCase(
      sourceRepo,
      objectStore,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
      sourceBucket,
    ),
    deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, cache),
    deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, sourceBucket),
    downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, sourceBucket),
    deleteProjectUseCase: new DeleteProjectUseCase(factory.projectRepo),
    getSourceUseCase: new GetSourceUseCase(sourceRepo),
    getAIReadyJobUseCase: new GetAIReadyJobUseCase(aiReadyJobRepo, cache),
    getSourcesQuotaUseCase: new GetSourcesQuotaUseCase(sourceRepo),
    startSourceAIReadyUseCase,
    cancelSourceAIReadyUseCase,
    retrySourceAIReadyUseCase: new RetrySourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchStartSourceAIReadyUseCase: new BatchStartSourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchCancelSourceAIReadyUseCase: new BatchCancelSourceAIReadyUseCase(cancelSourceAIReadyUseCase),
    getProjectUseCase: new GetProjectUseCase(factory.projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(factory.projectRepo),
    listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
    listSourcesUseCase: new ListSourcesUseCase(sourceRepo, cache),
    updateSourceLibraryUseCase: new UpdateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SystemClock(),
      cache,
    ),
    updateProjectUseCase: new UpdateProjectUseCase(factory.projectRepo, new SystemClock()),
    cancelAIReadyJobUseCase: new CancelAIReadyJobUseCase(aiReadyJobRepo, clock, cache),
    runQueuedAIReadyJobUseCase,
  };
  createNodeApiServer(port, deps, factory);
  // Keep log compact and machine-readable for local integration.
  process.stdout.write(`[api-entry-node] listening on ${port} (repo=${process.env.DATABASE_URL ? 'postgres' : 'memory'})\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startFromCli();
}
