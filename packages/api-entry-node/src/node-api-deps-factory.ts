import { join } from 'node:path';
import {
  CreateFileLibraryFolderUseCase,
  CreateFileLibraryObjectShareLinkUseCase,
  CreateFileLibraryCatalogUseCase,
  CreateProjectUseCase,
  DeleteFileLibraryObjectsUseCase,
  DeleteFileLibraryCatalogUseCase,
  DeleteProjectUseCase,
  DownloadFileLibraryObjectUseCase,
  GetFileLibraryObjectMetaUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  ListFileLibraryObjectsUseCase,
  ListFileLibraryCatalogsUseCase,
  MoveFileLibraryObjectUseCase,
  UploadFileLibraryObjectUseCase,
  UpdateFileLibraryCatalogUseCase,
  UpdateProjectUseCase,
} from '@mbos/application';
import {
  InMemoryCache,
  InMemoryJsonDocStore,
  InMemoryObjectStore,
  JsonDocFileLibraryCatalogRepo,
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
import {
  InternalAgentWorkspaceProvisionerImpl,
  parseCsiMountOptions,
} from './internal-agent-workspace-provisioner.js';
import { SandboxManagerClient } from './sandbox-manager-client.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  InMemoryFileLibraryGatewayManager,
  InMemoryFileLibraryOrchestrator,
  RealFileLibraryGatewayManager,
  RealFileLibraryOrchestrator,
  UnavailableFileLibraryOrchestrator,
} from './file-library-runtime.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { UniversalProxyService } from './universal-proxy-service.js';
import { NotebookTerminalService } from './notebook-terminal-service.js';

export function createDefaultNodeApiDeps(): NodeApiDeps {
  const projectRepo = createProjectRepoFactoryResult({}).projectRepo;
  const cache = new InMemoryCache();
  const docStore = new InMemoryJsonDocStore();
  const clock = new SystemClock();
  const fileLibraryCatalogRepo = new JsonDocFileLibraryCatalogRepo(docStore);
  const objectStore = new InMemoryObjectStore();
  const fileLibraryBucket = 'mbos-dev';
  const agentResourceService = new AgentResourceService(docStore, cache);

  const agentExecutionService = new AgentExecutionService(agentResourceService);
  const notebookTerminalService = new NotebookTerminalService(cache, agentExecutionService);
  const deps: NodeApiDeps = {
    governanceReportsDir: join(process.cwd(), 'artifacts/governance-reports'),
    governanceRunsDir: join(process.cwd(), 'artifacts/governance-runs'),
    governanceIncidentsDir: join(process.cwd(), 'artifacts/governance-incidents'),
    cache,
    docStore,
    chatResourceService: new ChatResourceService(docStore),
    endpointResourceService: new EndpointResourceService(docStore),
    agentResourceService,
    agentExecutionService,
    notebookTerminalService,
    fileLibraryBucket,
    createFileLibraryCatalogUseCase: new CreateFileLibraryCatalogUseCase(
      fileLibraryCatalogRepo,
      new SimpleIdGenerator(),
      clock,
      cache,
    ),
    createFileLibraryFolderUseCase: new CreateFileLibraryFolderUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
    createFileLibraryObjectShareLinkUseCase: new CreateFileLibraryObjectShareLinkUseCase(
      fileLibraryCatalogRepo,
      objectStore,
      clock,
      fileLibraryBucket,
    ),
    createProjectUseCase: new CreateProjectUseCase(projectRepo, new SimpleIdGenerator(), clock),
    uploadFileLibraryObjectUseCase: new UploadFileLibraryObjectUseCase(fileLibraryCatalogRepo, objectStore, clock, fileLibraryBucket),
    deleteFileLibraryCatalogUseCase: new DeleteFileLibraryCatalogUseCase(fileLibraryCatalogRepo, objectStore, cache, fileLibraryBucket),
    deleteFileLibraryObjectsUseCase: new DeleteFileLibraryObjectsUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
    moveFileLibraryObjectUseCase: new MoveFileLibraryObjectUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
    downloadFileLibraryObjectUseCase: new DownloadFileLibraryObjectUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
    getFileLibraryObjectMetaUseCase: new GetFileLibraryObjectMetaUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
    deleteProjectUseCase: new DeleteProjectUseCase(projectRepo),
    getProjectUseCase: new GetProjectUseCase(projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(projectRepo),
    listFileLibraryCatalogsUseCase: new ListFileLibraryCatalogsUseCase(fileLibraryCatalogRepo, cache),
    listFileLibraryObjectsUseCase: new ListFileLibraryObjectsUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
    updateFileLibraryCatalogUseCase: new UpdateFileLibraryCatalogUseCase(fileLibraryCatalogRepo, clock, cache),
    updateProjectUseCase: new UpdateProjectUseCase(projectRepo, clock),
    fileLibraryOrchestrator: new InMemoryFileLibraryOrchestrator(),
    fileLibraryGatewayManager: new InMemoryFileLibraryGatewayManager(),
    universalProxyService: UniversalProxyService.fromEnv(process.env),
  };
  notebookTerminalService.configureLifecycleHooks({
    onSessionClosed: async (session) => {
      await writeProjectAuditEvent(deps, {
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        actor: { type: 'user', id: session.userId },
        action: 'notebook.task.terminal.closed',
        resourceType: 'notebook_task_terminal_session',
        resourceId: session.id,
        metadata: {
          task_id: session.taskId,
          agent_id: session.agentId,
          status: session.status,
          close_reason: session.closeReason ?? null,
          exit_code: session.exitCode ?? null,
          created_at: session.createdAt,
          ended_at: session.endedAt ?? null,
        },
      });
    },
  });
  return deps;
}

export function createNodeApiDepsFromEnv(env: NodeJS.ProcessEnv): {
  deps: NodeApiDeps;
  lifecycle: Pick<ProjectRepoFactoryResult, 'shutdown'>;
  repoMode: 'postgres' | 'memory';
} {
  const universalProxyService = UniversalProxyService.fromEnv(env);
  const canEnableRealFileLibraries = Boolean(
    env.DATABASE_URL
      && env.MINIO_ENDPOINT
      && env.MINIO_ACCESS_KEY
      && env.MINIO_SECRET_KEY,
  );
  const sandboxUrl = env.SANDBOX_MANAGER_URL?.trim() || '';
  const sandboxServiceKey = env.SANDBOX_SERVICE_KEY?.trim() || '';
  const internalAgentWsBaseUrl = env.AGENT_EXECUTION_WS_BASE_URL?.trim() || '';
  const internalAgentMetadataHostOverride = env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE?.trim() || '';
  const internalAgentMetadataPortOverride = env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE?.trim() || '';
  const internalMountBucketEndpoint =
    env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT?.trim() || '';
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
  const fileLibraryCatalogRepo = new JsonDocFileLibraryCatalogRepo(docStore);
  const chatResourceService = new ChatResourceService(docStore);
  const endpointResourceService = new EndpointResourceService(docStore);
  const agentResourceService = new AgentResourceService(docStore, cache);
  const agentExecutionService = new AgentExecutionService(agentResourceService);
  const notebookTerminalService = new NotebookTerminalService(cache, agentExecutionService);
  const sandboxClient = sandboxUrl && sandboxServiceKey
    ? new SandboxManagerClient(sandboxUrl, sandboxServiceKey)
    : undefined;
  const internalAgentWorkspaceBindingManager = sandboxClient
    ? new InternalAgentWorkspaceProvisionerImpl(
        docStore,
        sandboxClient,
        {
          namespace: '',
          csiDriver: env.INTERNAL_AGENT_JUICEFS_CSI_DRIVER?.trim() || 'csi.juicefs.com',
          storageCapacity: env.INTERNAL_AGENT_WORKSPACE_CAPACITY?.trim() || '1Pi',
          storageClassName: env.INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME?.trim() || '',
          mountOptions: parseCsiMountOptions(env.INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS),
          subdir: env.INTERNAL_AGENT_JUICEFS_SUBDIR?.trim() || '',
          mountServiceAccount: env.INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT?.trim() || '',
          mountImage: env.INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE?.trim() || '',
          metadataHostOverride: internalAgentMetadataHostOverride || undefined,
          metadataPortOverride: internalAgentMetadataPortOverride || undefined,
          bucketEndpointForInternalMount: internalMountBucketEndpoint || undefined,
          storageCredentialSeed:
            env.FILE_LIBRARY_GATEWAY_ROOT_PASSWORD_SEED?.trim()
            || env.AGENTSMITH_SECRET_KEY?.trim()
            || undefined,
        },
      )
    : undefined;
  const internalAgentPodManager = sandboxClient
    ? new InternalAgentPodManagerImpl(
        sandboxClient,
        agentExecutionService,
        (internalAgentWsBaseUrl || `ws://localhost:${env.PORT ?? '20000'}`).replace(/\/+$/, ''),
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
  const fileLibraryBucket = env.MINIO_BUCKET ?? 'mbos-dev';
  const deps: NodeApiDeps = {
      governanceReportsDir: join(process.cwd(), 'artifacts/governance-reports'),
      governanceRunsDir: join(process.cwd(), 'artifacts/governance-runs'),
      governanceIncidentsDir: join(process.cwd(), 'artifacts/governance-incidents'),
      cache,
      docStore,
      chatResourceService,
      endpointResourceService,
      agentResourceService,
      agentExecutionService,
      notebookTerminalService,
      ...(internalAgentPodManager ? { internalAgentPodManager } : {}),
      ...(internalAgentWorkspaceBindingManager
        ? {
          internalAgentWorkspaceBindingManager,
          internalAgentWorkspaceProvisioner: internalAgentWorkspaceBindingManager,
        }
        : {}),
      fileLibraryBucket,
      createFileLibraryCatalogUseCase: new CreateFileLibraryCatalogUseCase(
        fileLibraryCatalogRepo,
        new SimpleIdGenerator(),
        clock,
        cache,
      ),
      createFileLibraryFolderUseCase: new CreateFileLibraryFolderUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
      createFileLibraryObjectShareLinkUseCase: new CreateFileLibraryObjectShareLinkUseCase(
        fileLibraryCatalogRepo,
        objectStore,
        clock,
        fileLibraryBucket,
      ),
      createProjectUseCase: new CreateProjectUseCase(factory.projectRepo, new SimpleIdGenerator(), clock),
      uploadFileLibraryObjectUseCase: new UploadFileLibraryObjectUseCase(fileLibraryCatalogRepo, objectStore, clock, fileLibraryBucket),
      deleteFileLibraryCatalogUseCase: new DeleteFileLibraryCatalogUseCase(fileLibraryCatalogRepo, objectStore, cache, fileLibraryBucket),
      deleteFileLibraryObjectsUseCase: new DeleteFileLibraryObjectsUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
      moveFileLibraryObjectUseCase: new MoveFileLibraryObjectUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
      downloadFileLibraryObjectUseCase: new DownloadFileLibraryObjectUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
      getFileLibraryObjectMetaUseCase: new GetFileLibraryObjectMetaUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
      deleteProjectUseCase: new DeleteProjectUseCase(factory.projectRepo),
      getProjectUseCase: new GetProjectUseCase(factory.projectRepo),
      listProjectsUseCase: new ListProjectsUseCase(factory.projectRepo),
      listFileLibraryCatalogsUseCase: new ListFileLibraryCatalogsUseCase(fileLibraryCatalogRepo, cache),
      listFileLibraryObjectsUseCase: new ListFileLibraryObjectsUseCase(fileLibraryCatalogRepo, objectStore, fileLibraryBucket),
      updateFileLibraryCatalogUseCase: new UpdateFileLibraryCatalogUseCase(fileLibraryCatalogRepo, clock, cache),
      updateProjectUseCase: new UpdateProjectUseCase(factory.projectRepo, clock),
      fileLibraryOrchestrator: canEnableRealFileLibraries
        ? new RealFileLibraryOrchestrator()
        : new UnavailableFileLibraryOrchestrator(),
      fileLibraryGatewayManager: canEnableRealFileLibraries
        ? new RealFileLibraryGatewayManager()
        : new InMemoryFileLibraryGatewayManager(),
      ...(universalProxyService ? { universalProxyService } : {}),
    };
  notebookTerminalService.configureLifecycleHooks({
    onSessionClosed: async (session) => {
      await writeProjectAuditEvent(deps, {
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        actor: { type: 'user', id: session.userId },
        action: 'notebook.task.terminal.closed',
        resourceType: 'notebook_task_terminal_session',
        resourceId: session.id,
        metadata: {
          task_id: session.taskId,
          agent_id: session.agentId,
          status: session.status,
          close_reason: session.closeReason ?? null,
          exit_code: session.exitCode ?? null,
          created_at: session.createdAt,
          ended_at: session.endedAt ?? null,
        },
      });
    },
  });

  return {
    deps,
    lifecycle: factory,
    repoMode: env.DATABASE_URL ? 'postgres' : 'memory',
  };
}
