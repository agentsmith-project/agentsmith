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
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import { handleChatStreamRoute } from './chat-stream-handler.js';
import { handleEndpointRoute } from './endpoint-route-handler.js';
import { verifyBearerToken } from './auth.js';
import { handleProjectSourceRoute } from './project-source-route-handler.js';
import { applyCors, json, proxyJsonRequest, readBody, unauthorized } from './http-utils.js';
import { EndpointResourceService } from './endpoint-resource-service.js';
import { ChatResourceService } from './chat-resource-service.js';
import { matchProjectsRoute } from './projects-route-match.js';
import {
  OWNER_WORKSPACE_PERMISSIONS,
  buildWorkspaceRecords,
  resolveProjectPermissions,
} from './workspace-permissions.js';

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

function buildUpstreamUrl(baseUrl: string, proxyPath: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = proxyPath.replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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
