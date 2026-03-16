import { join } from 'node:path';
import {
  CreateSourceFolderUseCase,
  CreateSourceObjectShareLinkUseCase,
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
  GetSourceObjectMetaUseCase,
  GetSourcesLimitUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  ListSourceLibraryObjectsUseCase,
  ListSourceLibrariesUseCase,
  ListSourcesUseCase,
  MoveSourceObjectUseCase,
  UploadSourceObjectUseCase,
  UpdateSourceLibraryUseCase,
  UpdateProjectUseCase,
} from '@mbos/application';
import {
  InMemoryCache,
  InMemoryJsonDocStore,
  InMemoryObjectStore,
  JsonDocSourceRepo,
  JsonDocSourceLibraryRepo,
  MinioObjectStore,
  MongoJsonDocStore,
  RedisCache,
  createProjectRepoFactoryResult,
  type ProjectRepoFactoryResult,
  SimpleIdGenerator,
  SystemClock,
} from '@mbos/adapters-private';
import { EndpointResourceService } from './endpoint-resource-service.js';
import { ChatResourceService } from './chat-resource-service.js';
import { AgentResourceService } from './agent-resource-service.js';
import { AgentExecutionService } from './agent-execution-service.js';
import { InternalAgentPodManagerImpl } from './internal-agent-pod-manager.js';
import { SandboxManagerClient } from './sandbox-manager-client.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  InMemoryFileLibraryGatewayManager,
  InMemoryFileLibraryOrchestrator,
  RealFileLibraryGatewayManager,
  RealFileLibraryOrchestrator,
  UnavailableFileLibraryOrchestrator,
} from './file-library-runtime.js';

export function createDefaultNodeApiDeps(): NodeApiDeps {
  const projectRepo = createProjectRepoFactoryResult({}).projectRepo;
  const cache = new InMemoryCache();
  const docStore = new InMemoryJsonDocStore();
  const clock = new SystemClock();
  const sourceRepo = new JsonDocSourceRepo(docStore);
  const sourceLibraryRepo = new JsonDocSourceLibraryRepo(docStore);
  const objectStore = new InMemoryObjectStore();
  const sourceBucket = 'mbos-dev';

  return {
    governanceReportsDir: join(process.cwd(), 'artifacts/governance-reports'),
    governanceRunsDir: join(process.cwd(), 'artifacts/governance-runs'),
    governanceIncidentsDir: join(process.cwd(), 'artifacts/governance-incidents'),
    cache,
    docStore,
    chatResourceService: new ChatResourceService(docStore),
    endpointResourceService: new EndpointResourceService(docStore),
    agentResourceService: new AgentResourceService(docStore),
    agentExecutionService: new AgentExecutionService(new AgentResourceService(docStore)),
    sourceBucket,
    createSourceLibraryUseCase: new CreateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SimpleIdGenerator(),
      clock,
      cache,
    ),
    createSourceFolderUseCase: new CreateSourceFolderUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    createSourceObjectShareLinkUseCase: new CreateSourceObjectShareLinkUseCase(
      sourceLibraryRepo,
      objectStore,
      clock,
      sourceBucket,
    ),
    createProjectUseCase: new CreateProjectUseCase(projectRepo, new SimpleIdGenerator(), clock),
    createSourceUseCase: new CreateSourceUseCase(
      sourceRepo,
      objectStore,
      new SimpleIdGenerator(),
      clock,
      cache,
      sourceBucket,
    ),
    uploadSourceObjectUseCase: new UploadSourceObjectUseCase(sourceLibraryRepo, objectStore, clock, sourceBucket),
    deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, objectStore, cache, sourceBucket),
    deleteSourceObjectsUseCase: new DeleteSourceObjectsUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, sourceBucket),
    moveSourceObjectUseCase: new MoveSourceObjectUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    downloadSourceObjectUseCase: new DownloadSourceObjectUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, sourceBucket),
    getSourceObjectMetaUseCase: new GetSourceObjectMetaUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    getSourceUseCase: new GetSourceUseCase(sourceRepo),
    getSourcesLimitUseCase: new GetSourcesLimitUseCase(sourceRepo),
    deleteProjectUseCase: new DeleteProjectUseCase(projectRepo),
    getProjectUseCase: new GetProjectUseCase(projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(projectRepo),
    listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
    listSourceLibraryObjectsUseCase: new ListSourceLibraryObjectsUseCase(sourceLibraryRepo, objectStore, sourceBucket),
    listSourcesUseCase: new ListSourcesUseCase(sourceRepo, cache),
    updateSourceLibraryUseCase: new UpdateSourceLibraryUseCase(sourceLibraryRepo, clock, cache),
    updateProjectUseCase: new UpdateProjectUseCase(projectRepo, clock),
    fileLibraryOrchestrator: new InMemoryFileLibraryOrchestrator(),
    fileLibraryGatewayManager: new InMemoryFileLibraryGatewayManager(),
  };
}

export function createNodeApiDepsFromEnv(env: NodeJS.ProcessEnv): {
  deps: NodeApiDeps;
  lifecycle: Pick<ProjectRepoFactoryResult, 'shutdown'>;
  repoMode: 'postgres' | 'memory';
} {
  const canEnableRealFileLibraries = Boolean(
    env.DATABASE_URL
      && env.MINIO_ENDPOINT
      && env.MINIO_ACCESS_KEY
      && env.MINIO_SECRET_KEY,
  );
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
  const cache = env.REDIS_URL ? new RedisCache({ url: env.REDIS_URL }) : new InMemoryCache();
  const clock = new SystemClock();
  const docStore = env.MONGO_URL
    ? new MongoJsonDocStore({
        url: env.MONGO_URL,
        dbName: env.MONGO_DB_NAME ?? 'mbos',
      })
    : new InMemoryJsonDocStore();
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
  const chatResourceService = new ChatResourceService(docStore);
  const endpointResourceService = new EndpointResourceService(docStore);
  const agentResourceService = new AgentResourceService(docStore);
  const agentExecutionService = new AgentExecutionService(agentResourceService);
  const sandboxClient = sandboxUrl && sandboxServiceKey
    ? new SandboxManagerClient(sandboxUrl, sandboxServiceKey)
    : undefined;
  const internalAgentPodManager = sandboxClient
    ? new InternalAgentPodManagerImpl(
        sandboxClient,
        agentExecutionService,
        (env.AGENT_EXECUTION_WS_BASE_URL?.trim() || `ws://localhost:${env.PORT ?? '20000'}`).replace(/\/+$/, ''),
        {
          startupTimeoutMs: Number(env.INTERNAL_AGENT_STARTUP_TIMEOUT_MS ?? '120000'),
        },
      )
    : undefined;
  if (sandboxClient) {
    void sandboxClient.checkReady().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown_error';
      process.stderr.write(`[api-entry-node] sandbox readyz preflight failed: ${message}\n`);
    });
  }
  const sourceBucket = env.MINIO_BUCKET ?? 'mbos-dev';

  return {
    deps: {
      governanceReportsDir: join(process.cwd(), 'artifacts/governance-reports'),
      governanceRunsDir: join(process.cwd(), 'artifacts/governance-runs'),
      governanceIncidentsDir: join(process.cwd(), 'artifacts/governance-incidents'),
      cache,
      docStore,
      chatResourceService,
      endpointResourceService,
      agentResourceService,
      agentExecutionService,
      ...(internalAgentPodManager ? { internalAgentPodManager } : {}),
      sourceBucket,
      createSourceLibraryUseCase: new CreateSourceLibraryUseCase(
        sourceLibraryRepo,
        new SimpleIdGenerator(),
        clock,
        cache,
      ),
      createSourceFolderUseCase: new CreateSourceFolderUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      createSourceObjectShareLinkUseCase: new CreateSourceObjectShareLinkUseCase(
        sourceLibraryRepo,
        objectStore,
        clock,
        sourceBucket,
      ),
      createProjectUseCase: new CreateProjectUseCase(factory.projectRepo, new SimpleIdGenerator(), clock),
      createSourceUseCase: new CreateSourceUseCase(
        sourceRepo,
        objectStore,
        new SimpleIdGenerator(),
        clock,
        cache,
        sourceBucket,
      ),
      uploadSourceObjectUseCase: new UploadSourceObjectUseCase(sourceLibraryRepo, objectStore, clock, sourceBucket),
      deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, objectStore, cache, sourceBucket),
      deleteSourceObjectsUseCase: new DeleteSourceObjectsUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, sourceBucket),
      moveSourceObjectUseCase: new MoveSourceObjectUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      downloadSourceObjectUseCase: new DownloadSourceObjectUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, sourceBucket),
      getSourceObjectMetaUseCase: new GetSourceObjectMetaUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      getSourceUseCase: new GetSourceUseCase(sourceRepo),
      getSourcesLimitUseCase: new GetSourcesLimitUseCase(sourceRepo),
      deleteProjectUseCase: new DeleteProjectUseCase(factory.projectRepo),
      getProjectUseCase: new GetProjectUseCase(factory.projectRepo),
      listProjectsUseCase: new ListProjectsUseCase(factory.projectRepo),
      listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
      listSourceLibraryObjectsUseCase: new ListSourceLibraryObjectsUseCase(sourceLibraryRepo, objectStore, sourceBucket),
      listSourcesUseCase: new ListSourcesUseCase(sourceRepo, cache),
      updateSourceLibraryUseCase: new UpdateSourceLibraryUseCase(sourceLibraryRepo, clock, cache),
      updateProjectUseCase: new UpdateProjectUseCase(factory.projectRepo, clock),
      fileLibraryOrchestrator: canEnableRealFileLibraries
        ? new RealFileLibraryOrchestrator()
        : new UnavailableFileLibraryOrchestrator(),
      fileLibraryGatewayManager: canEnableRealFileLibraries
        ? new RealFileLibraryGatewayManager()
        : new InMemoryFileLibraryGatewayManager(),
    },
    lifecycle: factory,
    repoMode: env.DATABASE_URL ? 'postgres' : 'memory',
  };
}
