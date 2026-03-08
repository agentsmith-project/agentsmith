import { join } from 'node:path';
import {
  CancelAIReadyJobUseCase,
  BatchCancelSourceAIReadyUseCase,
  BatchStartSourceAIReadyUseCase,
  CancelSourceAIReadyUseCase,
  CreateSourceFolderUseCase,
  CreateSourceObjectShareLinkUseCase,
  CreateAIReadyJobUseCase,
  CreateSourceLibraryUseCase,
  CreateProjectUseCase,
  CreateSourceUseCase,
  DeleteSourceObjectsUseCase,
  DeleteSourceLibraryUseCase,
  DeleteSourceUseCase,
  DeleteProjectUseCase,
  DownloadSourceObjectUseCase,
  DownloadSourceUseCase,
  GetSourceUseCase,
  GetAIReadyJobUseCase,
  GetSourceObjectMetaUseCase,
  GetSourcesLimitUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  ListSourceLibraryObjectsUseCase,
  ListSourceLibrariesUseCase,
  ListSourcesUseCase,
  MoveSourceObjectUseCase,
  RunQueuedAIReadyJobUseCase,
  RetrySourceAIReadyUseCase,
  StartSourceAIReadyUseCase,
  UploadSourceObjectUseCase,
  UpdateSourceLibraryUseCase,
  UpdateProjectUseCase,
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
import { EndpointResourceService } from './endpoint-resource-service.js';
import { ChatResourceService } from './chat-resource-service.js';
import { AgentResourceService } from './agent-resource-service.js';
import { AgentRuntimeService } from './agent-runtime-service.js';
import { InternalAgentPodManagerImpl } from './internal-agent-pod-manager.js';
import { SandboxManagerClient } from './sandbox-manager-client.js';
import type { NodeApiDeps } from './node-api-deps.js';

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
  const agentResourceService = new AgentResourceService(docStore);
  const agentRuntimeService = new AgentRuntimeService(agentResourceService);
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
    releaseReportsDir: join(process.cwd(), 'artifacts/release-reports'),
    releaseRunsDir: join(process.cwd(), 'artifacts/release-runs'),
    releaseEscalationsDir: join(process.cwd(), 'artifacts/release-escalations'),
    cache,
    docStore,
    chatResourceService,
    endpointResourceService,
    agentResourceService,
    agentRuntimeService,
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
    createSourceFolderUseCase: new CreateSourceFolderUseCase(
      sourceLibraryRepo,
      objectStore,
      sourceBucket,
    ),
    createSourceObjectShareLinkUseCase: new CreateSourceObjectShareLinkUseCase(
      sourceLibraryRepo,
      objectStore,
      clock,
      sourceBucket,
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
    uploadSourceObjectUseCase: new UploadSourceObjectUseCase(
      sourceLibraryRepo,
      objectStore,
      clock,
      sourceBucket,
    ),
    deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, objectStore, cache, sourceBucket),
    deleteSourceObjectsUseCase: new DeleteSourceObjectsUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, sourceBucket),
    moveSourceObjectUseCase: new MoveSourceObjectUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    downloadSourceObjectUseCase: new DownloadSourceObjectUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, sourceBucket),
    getSourceObjectMetaUseCase: new GetSourceObjectMetaUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    deleteProjectUseCase: new DeleteProjectUseCase(projectRepo),
    getSourceUseCase: new GetSourceUseCase(sourceRepo),
    getAIReadyJobUseCase: new GetAIReadyJobUseCase(aiReadyJobRepo, cache),
    getSourcesLimitUseCase: new GetSourcesLimitUseCase(sourceRepo),
    startSourceAIReadyUseCase,
    cancelSourceAIReadyUseCase,
    retrySourceAIReadyUseCase: new RetrySourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchStartSourceAIReadyUseCase: new BatchStartSourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchCancelSourceAIReadyUseCase: new BatchCancelSourceAIReadyUseCase(cancelSourceAIReadyUseCase),
    getProjectUseCase: new GetProjectUseCase(projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(projectRepo),
    listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
    listSourceLibraryObjectsUseCase: new ListSourceLibraryObjectsUseCase(sourceLibraryRepo, objectStore, sourceBucket),
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

export function createNodeApiDepsFromEnv(env: NodeJS.ProcessEnv): {
  deps: NodeApiDeps;
  lifecycle: Pick<ProjectRepoFactoryResult, 'shutdown'>;
  repoMode: 'postgres' | 'memory';
} {
  const sandboxUrl = env.SANDBOX_MANAGER_URL?.trim() || '';
  const sandboxServiceKey = env.SANDBOX_SERVICE_KEY?.trim() || '';
  if ((sandboxUrl && !sandboxServiceKey) || (!sandboxUrl && sandboxServiceKey)) {
    throw Object.assign(new Error('sandbox_manager_config_incomplete: both SANDBOX_MANAGER_URL and SANDBOX_SERVICE_KEY must be set'), {
      code: 'SANDBOX_MANAGER_CONFIG_INCOMPLETE',
    });
  }

  const factory = createProjectRepoFactoryResult({
    databaseUrl: env.DATABASE_URL,
  });
  const cache = env.REDIS_URL
    ? new RedisCache({ url: env.REDIS_URL })
    : new InMemoryCache();
  const clock = new SystemClock();
  const docStore = env.MONGO_URL
    ? new MongoJsonDocStore({
      url: env.MONGO_URL,
      dbName: env.MONGO_DB_NAME ?? 'mbos',
    })
    : new InMemoryJsonDocStore();
  const chatResourceService = new ChatResourceService(docStore);
  const objectStore = env.MINIO_ENDPOINT
    ? new MinioObjectStore({
      endPoint: env.MINIO_ENDPOINT,
      port: Number(env.MINIO_PORT ?? '19000'),
      useSSL: (env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey: env.MINIO_ACCESS_KEY ?? 'mbos',
      secretKey: env.MINIO_SECRET_KEY ?? 'mbos_dev_password',
    })
    : new InMemoryObjectStore();
  const sourceRepo = new JsonDocSourceRepo(docStore);
  const sourceLibraryRepo = new JsonDocSourceLibraryRepo(docStore);
  const aiReadyJobRepo = new JsonDocAIReadyJobRepo(docStore);
  const aiReadyJobQueue = new InMemoryJobQueue();
  const endpointResourceService = new EndpointResourceService(docStore);
  const agentResourceService = new AgentResourceService(docStore);
  const agentRuntimeService = new AgentRuntimeService(agentResourceService);
  const sandboxClient = sandboxUrl && sandboxServiceKey
    ? new SandboxManagerClient(sandboxUrl, sandboxServiceKey)
    : undefined;
  const internalAgentPodManager = sandboxClient
    ? new InternalAgentPodManagerImpl(
      sandboxClient,
      agentRuntimeService,
      (env.AGENT_RUNTIME_WS_BASE_URL?.trim() || `ws://localhost:${env.PORT ?? '20000'}`).replace(/\/+$/, ''),
      {
        startupTimeoutMs: Number(env.INTERNAL_AGENT_STARTUP_TIMEOUT_MS ?? '120000'),
      },
    )
    : undefined;
  if (sandboxClient) {
    // Startup preflight is advisory only. AgentSmith must still run without sandbox reachability.
    void sandboxClient.checkReady().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown_error';
      process.stderr.write(`[api-entry-node] sandbox readyz preflight failed: ${message}\n`);
    });
  }
  const sourceBucket = env.MINIO_BUCKET ?? 'mbos-dev';
  const parser = new Utf8DocumentParser();
  const chunker = new FixedCharTextChunker({
    chunkSize: Number(env.AIREADY_CHUNK_SIZE ?? '1000'),
    overlap: Number(env.AIREADY_CHUNK_OVERLAP ?? '100'),
  });
  const embeddings = new DeterministicEmbeddingProvider(
    Number(env.AIREADY_EMBEDDING_DIMENSIONS ?? '1536'),
  );
  const vectorStore = env.DATABASE_URL
    ? new PgVectorStore({
      databaseUrl: env.DATABASE_URL,
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

  return {
    deps: {
      releaseReportsDir: join(process.cwd(), 'artifacts/release-reports'),
      releaseRunsDir: join(process.cwd(), 'artifacts/release-runs'),
      releaseEscalationsDir: join(process.cwd(), 'artifacts/release-escalations'),
      cache,
      docStore,
      chatResourceService,
      endpointResourceService,
      agentResourceService,
      agentRuntimeService,
      ...(internalAgentPodManager ? { internalAgentPodManager } : {}),
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
      createSourceFolderUseCase: new CreateSourceFolderUseCase(
        sourceLibraryRepo,
        objectStore,
        sourceBucket,
      ),
      createSourceObjectShareLinkUseCase: new CreateSourceObjectShareLinkUseCase(
        sourceLibraryRepo,
        objectStore,
        clock,
        sourceBucket,
      ),
      createProjectUseCase: new CreateProjectUseCase(
        factory.projectRepo,
        new SimpleIdGenerator(),
        new SystemClock(),
      ),
      createSourceUseCase: new CreateSourceUseCase(
        sourceRepo,
        objectStore,
        new SimpleIdGenerator(),
        new SystemClock(),
        cache,
        sourceBucket,
      ),
      uploadSourceObjectUseCase: new UploadSourceObjectUseCase(
        sourceLibraryRepo,
        objectStore,
        clock,
        sourceBucket,
      ),
      deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, objectStore, cache, sourceBucket),
      deleteSourceObjectsUseCase: new DeleteSourceObjectsUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, sourceBucket),
      moveSourceObjectUseCase: new MoveSourceObjectUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      downloadSourceObjectUseCase: new DownloadSourceObjectUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, sourceBucket),
      getSourceObjectMetaUseCase: new GetSourceObjectMetaUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      deleteProjectUseCase: new DeleteProjectUseCase(factory.projectRepo),
      getSourceUseCase: new GetSourceUseCase(sourceRepo),
      getAIReadyJobUseCase: new GetAIReadyJobUseCase(aiReadyJobRepo, cache),
      getSourcesLimitUseCase: new GetSourcesLimitUseCase(sourceRepo),
      startSourceAIReadyUseCase,
      cancelSourceAIReadyUseCase,
      retrySourceAIReadyUseCase: new RetrySourceAIReadyUseCase(startSourceAIReadyUseCase),
      batchStartSourceAIReadyUseCase: new BatchStartSourceAIReadyUseCase(startSourceAIReadyUseCase),
      batchCancelSourceAIReadyUseCase: new BatchCancelSourceAIReadyUseCase(cancelSourceAIReadyUseCase),
      getProjectUseCase: new GetProjectUseCase(factory.projectRepo),
      listProjectsUseCase: new ListProjectsUseCase(factory.projectRepo),
      listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
      listSourceLibraryObjectsUseCase: new ListSourceLibraryObjectsUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      listSourcesUseCase: new ListSourcesUseCase(sourceRepo, cache),
      updateSourceLibraryUseCase: new UpdateSourceLibraryUseCase(
        sourceLibraryRepo,
        new SystemClock(),
        cache,
      ),
      updateProjectUseCase: new UpdateProjectUseCase(factory.projectRepo, new SystemClock()),
      cancelAIReadyJobUseCase: new CancelAIReadyJobUseCase(aiReadyJobRepo, clock, cache),
      runQueuedAIReadyJobUseCase,
    },
    lifecycle: factory,
    repoMode: env.DATABASE_URL ? 'postgres' : 'memory',
  };
}
