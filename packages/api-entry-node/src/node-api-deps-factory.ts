import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  CreateProjectUseCase,
  DeleteProjectUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  UpdateProjectUseCase,
} from '@mbos/application';
import {
  InMemoryCache,
  InMemoryJsonDocStore,
  DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS,
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
import { createAgentPresenceStore } from './agent-presence-store.js';
import { InternalAgentPodManagerImpl } from './internal-agent-pod-manager.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import { InternalAgentWorkspaceProvisionerImpl } from './internal-agent-workspace-provisioner.js';
import { SandboxManagerClient } from './sandbox-manager-client.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { UniversalProxyService } from './universal-proxy-service.js';
import { NotebookTerminalService } from './notebook-terminal-service.js';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import { INTERNAL_AGENT_KEEPALIVE_INTERVAL_SECONDS } from '@mbos/contracts';
import {
  evaluateProjectPermissions,
  evaluateResourcePolicyAuthorization,
} from './project-authz-engine.js';
import { isDeveloperAgentRunner } from './agent-runner-profile.js';
import { parseAfscpConfig } from './afscp-config.js';
import { AfscpBootstrapClient, AfscpClient, AfscpProductClient } from './afscp-client.js';
import {
  ProjectAfscpNamespaceStore,
  ProjectAfscpResourceOwnershipStore,
} from './project-afscp-namespace-store.js';
import {
  ProjectStorageBootstrapService,
  type ProjectStorageBootstrapServicePort,
  type ProjectStoragePreflightResult,
} from './project-storage-bootstrap-service.js';
import { ProjectStorageLifecycleService } from './project-storage-lifecycle-service.js';
import { AfscpResourceOwnershipGuard } from './afscp-resource-ownership-guard.js';
import {
  AfscpFileLibraryStorageAdapter,
  JsonDocProjectFileLibraryAfscpMappingRepo,
  normalizeAfscpFileLibraryPath,
  type FileLibraryDownloadResult,
  type FileLibraryEntry,
  type FileLibraryObjectMeta,
  type FileLibraryStoragePort,
} from './file-library-afscp-storage.js';
import { guessFileLibraryContentType } from './file-library-content-type.js';

function deriveWebSocketBaseFromHttpBase(value: string | undefined | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'ws:';
    } else if (parsed.protocol === 'https:') {
      parsed.protocol = 'wss:';
    } else if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return '';
    }
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function configureNotebookTerminalAuthorization(deps: Pick<
  NodeApiDeps,
  'docStore' | 'getProjectUseCase' | 'notebookTerminalService' | 'agentResourceService'
>): void {
  deps.notebookTerminalService.configureAuthorizationHooks({
    authorizeTerminalUse: async (input) => {
      try {
        const project = await deps.getProjectUseCase.execute({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
        });
        const evaluation = await evaluateProjectPermissions({
          docStore: deps.docStore,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          projectOwnerId: project.owner_id,
          projectGovernance: project.governance_json,
          actorUserId: input.userId,
          requiredPermissions: input.requiredPermissions,
        });
        if (!evaluation.decisions.every((decision) => decision.granted)) {
          return false;
        }
        const runnerId = input.resolvedRunnerId.trim();
        if (!runnerId) {
          return false;
        }
        const runner = await deps.agentResourceService.getAgent(
          input.workspaceId,
          input.projectId,
          runnerId,
        );
        if (!runner || runner.status !== 'enabled') {
          return false;
        }
        if (!isDeveloperAgentRunner(runner)) {
          return true;
        }
        const policyDecision = await evaluateResourcePolicyAuthorization({
          docStore: deps.docStore,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          resourceType: 'agent',
          resourceId: runner.id,
          subjectType: 'user',
          subjectId: input.userId,
        });
        if (!policyDecision.allowed) {
          return false;
        }
        const runnerEvaluation = await evaluateProjectPermissions({
          docStore: deps.docStore,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          projectOwnerId: project.owner_id,
          projectGovernance: project.governance_json,
          actorUserId: input.userId,
          requiredPermissions: ['project:agent_task:use', 'project:agent_task:terminal', 'project:agent_runner:manage'],
        });
        return runnerEvaluation.decisions.every((decision) => decision.granted);
      } catch {
        return false;
      }
    },
  });
}

type DefaultStoredFileLibraryEntry =
  | {
      kind: 'directory';
      path: string;
      modifiedAt: string;
    }
  | {
      kind: 'file';
      path: string;
      body: Buffer;
      contentType: string;
      modifiedAt: string;
      etag: string;
    };

type DefaultStoredFileLibraryRepo = {
  namespaceId: string;
  repoId: string;
  projectStorageGeneration: number;
  entries: Map<string, DefaultStoredFileLibraryEntry>;
  savePoints: Map<string, { id: string; message?: string; createdAt: string }>;
};

type DefaultStoredTemplate = {
  namespaceId: string;
  templateId: string;
  sourceRepo: DefaultStoredFileLibraryRepo;
  sourceSavePointId: string;
};

function sanitizeDefaultAfscpSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'default';
}

function createDefaultProjectStorageReadyResult(input: {
  workspaceId: string;
  projectId: string;
}): ProjectStoragePreflightResult {
  return {
    status: 'ready',
    namespaceId: `ns_${sanitizeDefaultAfscpSegment(input.workspaceId)}_${sanitizeDefaultAfscpSegment(input.projectId)}`,
    stage: 'ready',
    generation: 1,
    nextAction: 'none',
    retryable: false,
    lastErrorCode: null,
  };
}

function createDefaultReadyProjectStorageBootstrapService(): ProjectStorageBootstrapServicePort {
  return {
    enabled: true,
    bootstrapProjectStorage: async () => undefined,
    reconcileProjectStorage: async () => undefined,
    ensureProjectStorageReady: async (input) => createDefaultProjectStorageReadyResult(input),
  };
}

function defaultRepoKey(input: { workspaceId: string; projectId: string; libraryId: string }): string {
  return `${input.workspaceId}:${input.projectId}:${input.libraryId}`;
}

function defaultNowIso(): string {
  return new Date().toISOString();
}

function normalizeDefaultObjectPath(input: string): string {
  const normalized = normalizeAfscpFileLibraryPath(input);
  if (!normalized) {
    throw new Error('invalid_file_library_path');
  }
  return normalized;
}

function normalizeDefaultDirectoryPath(input: string): string {
  const normalized = normalizeAfscpFileLibraryPath(input);
  return normalized ? `${normalized}/` : '';
}

function defaultPathName(pathValue: string): string {
  const trimmed = pathValue.endsWith('/') ? pathValue.slice(0, -1) : pathValue;
  return trimmed.split('/').at(-1) ?? trimmed;
}

function defaultFileMeta(
  pathValue: string,
  entry: Extract<DefaultStoredFileLibraryEntry, { kind: 'file' }>,
): FileLibraryObjectMeta {
  return {
    key: pathValue,
    size_bytes: entry.body.length,
    content_type: entry.contentType,
    etag: entry.etag,
    last_modified: entry.modifiedAt,
    user_metadata: {
      'content-type': entry.contentType,
    },
  };
}

function presentDefaultEntry(entry: DefaultStoredFileLibraryEntry): FileLibraryEntry {
  if (entry.kind === 'directory') {
    return {
      kind: 'directory',
      path: entry.path,
      name: defaultPathName(entry.path),
    };
  }
  return {
    kind: 'file',
    path: entry.path,
    name: defaultPathName(entry.path),
    size_bytes: entry.body.length,
    content_type: entry.contentType,
    modified_at: entry.modifiedAt,
    etag: entry.etag,
  };
}

function ensureDefaultParentDirectories(repo: DefaultStoredFileLibraryRepo, pathValue: string): void {
  const segments = pathValue.split('/');
  segments.pop();
  let current = '';
  for (const segment of segments) {
    if (!segment) continue;
    current = current ? `${current}${segment}/` : `${segment}/`;
    if (!repo.entries.has(current)) {
      repo.entries.set(current, {
        kind: 'directory',
        path: current,
        modifiedAt: defaultNowIso(),
      });
    }
  }
}

async function readDefaultWebStream(stream: WebReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function createDefaultInMemoryFileLibraryStorageAdapter(): FileLibraryStoragePort {
  const repos = new Map<string, DefaultStoredFileLibraryRepo>();
  const templates = new Map<string, DefaultStoredTemplate>();

  const requireRepo = (input: { workspaceId: string; projectId: string; libraryId: string }): DefaultStoredFileLibraryRepo => {
    const repo = repos.get(defaultRepoKey(input));
    if (!repo) {
      throw new Error('file_library_afscp_mapping_not_found');
    }
    return repo;
  };

  return {
    enabled: true,
    async getOperationProjection() {
      throw new Error('file_library_operation_not_found');
    },
    async createRepoForLibrary(input) {
      const key = defaultRepoKey(input);
      let repo = repos.get(key);
      if (!repo) {
        repo = {
          namespaceId: input.namespaceId,
          repoId: `repo_${sanitizeDefaultAfscpSegment(input.libraryId)}`,
          projectStorageGeneration: input.projectStorageGeneration,
          entries: new Map(),
          savePoints: new Map(),
        };
        repos.set(key, repo);
      }
      return {
        namespaceId: repo.namespaceId,
        repoId: repo.repoId,
        operationId: `op_${sanitizeDefaultAfscpSegment(input.libraryId)}`,
        operationStatus: 'succeeded',
        projectStorageGeneration: repo.projectStorageGeneration,
      };
    },
    async deleteRepoForLibrary(input) {
      repos.delete(defaultRepoKey(input));
    },
    async assertEmpty(input) {
      const repo = requireRepo(input);
      if (repo.entries.size > 0) {
        throw new Error('file_library_not_empty');
      }
    },
    async listSavePoints(input) {
      const repo = requireRepo(input);
      return Array.from(repo.savePoints.values()).map((savePoint) => ({
        savePointId: savePoint.id,
        repoId: repo.repoId,
        ...(savePoint.message ? { message: savePoint.message } : {}),
        createdAt: savePoint.createdAt,
      }));
    },
    async createSavePoint(input) {
      const repo = requireRepo(input);
      const id = `sp_${sanitizeDefaultAfscpSegment(input.libraryId)}_${repo.savePoints.size + 1}`;
      const createdAt = defaultNowIso();
      repo.savePoints.set(id, {
        id,
        message: input.message,
        createdAt,
      });
      return {
        operationId: `op_${sanitizeDefaultAfscpSegment(input.libraryId)}_save_point_${repo.savePoints.size}`,
        operationStatus: 'succeeded',
        savePointId: id,
        createdAt,
      };
    },
    async createRestorePreview(input) {
      requireRepo(input);
      return {
        operationId: `op_${sanitizeDefaultAfscpSegment(input.libraryId)}_restore_preview`,
        operationStatus: 'succeeded',
        restorePlanId: `plan_${sanitizeDefaultAfscpSegment(input.libraryId)}`,
        sourceSavePointId: input.savePointId,
      };
    },
    async reconcileRestorePreview(input) {
      requireRepo(input);
      return {
        operationId: input.operationId,
        operationStatus: 'succeeded',
        restorePlanId: `plan_${sanitizeDefaultAfscpSegment(input.libraryId)}`,
        sourceSavePointId: null,
      };
    },
    async runRestorePreview(input) {
      requireRepo(input);
      return {
        operationId: `op_${sanitizeDefaultAfscpSegment(input.libraryId)}_restore_run`,
        operationStatus: 'succeeded',
        restorePlanId: `plan_${sanitizeDefaultAfscpSegment(input.libraryId)}`,
        sourceSavePointId: null,
      };
    },
    async discardRestorePreview(input) {
      requireRepo(input);
      return {
        operationId: `op_${sanitizeDefaultAfscpSegment(input.libraryId)}_restore_discard`,
        operationStatus: 'succeeded',
        restorePlanId: `plan_${sanitizeDefaultAfscpSegment(input.libraryId)}`,
        sourceSavePointId: null,
      };
    },
    async createTemplateFromLibrary(input) {
      const repo = requireRepo(input);
      const sourceSavePointId = `sp_${sanitizeDefaultAfscpSegment(input.libraryId)}_template_${templates.size + 1}`;
      repo.savePoints.set(sourceSavePointId, {
        id: sourceSavePointId,
        message: `Template source ${input.templateId}`,
        createdAt: defaultNowIso(),
      });
      templates.set(input.templateId, {
        namespaceId: repo.namespaceId,
        templateId: input.templateId,
        sourceRepo: repo,
        sourceSavePointId,
      });
      return {
        operationId: `op_${sanitizeDefaultAfscpSegment(input.libraryId)}_template_create`,
        operationStatus: 'succeeded',
        templateId: input.templateId,
        sourceSavePointId,
      };
    },
    async cloneTemplateToLibrary(input) {
      const template = templates.get(input.templateId);
      if (!template || template.namespaceId !== input.namespaceId) {
        throw new Error('file_library_template_clone_failed');
      }
      const key = defaultRepoKey(input);
      const repo: DefaultStoredFileLibraryRepo = {
        namespaceId: input.namespaceId,
        repoId: `repo_${sanitizeDefaultAfscpSegment(input.libraryId)}`,
        projectStorageGeneration: input.projectStorageGeneration,
        entries: new Map(template.sourceRepo.entries),
        savePoints: new Map(),
      };
      repos.set(key, repo);
      return {
        namespaceId: repo.namespaceId,
        repoId: repo.repoId,
        operationId: `op_${sanitizeDefaultAfscpSegment(input.libraryId)}_template_clone`,
        operationStatus: 'succeeded',
        projectStorageGeneration: repo.projectStorageGeneration,
      };
    },
    async reconcileLibraryProvisioning(input) {
      const repo = requireRepo(input);
      return {
        namespaceId: repo.namespaceId,
        repoId: repo.repoId,
        operationId: `op_${sanitizeDefaultAfscpSegment(input.libraryId)}_template_clone`,
        operationStatus: 'succeeded',
        projectStorageGeneration: repo.projectStorageGeneration,
        lastErrorCode: null,
      };
    },
    async listEntries(input) {
      const repo = requireRepo(input);
      const directoryPath = normalizeDefaultDirectoryPath(input.path);
      const children = new Map<string, DefaultStoredFileLibraryEntry>();
      for (const entry of repo.entries.values()) {
        if (!entry.path.startsWith(directoryPath) || entry.path === directoryPath) continue;
        const remainder = entry.path.slice(directoryPath.length);
        const firstSegment = remainder.split('/')[0];
        if (!firstSegment) continue;
        const childPath = remainder.includes('/') ? `${directoryPath}${firstSegment}/` : entry.path;
        if (children.has(childPath)) continue;
        children.set(childPath, childPath.endsWith('/') && childPath !== entry.path
          ? { kind: 'directory', path: childPath, modifiedAt: entry.modifiedAt }
          : entry);
      }
      let items = Array.from(children.values()).map(presentDefaultEntry);
      if (input.search) {
        const needle = input.search.toLowerCase();
        items = items.filter((item) => item.name.toLowerCase().includes(needle));
      }
      const direction = input.sortOrder === 'desc' ? -1 : 1;
      items = items.sort((left, right) => {
        if (input.sortBy === 'size_bytes') {
          const leftSize = left.kind === 'file' ? left.size_bytes : -1;
          const rightSize = right.kind === 'file' ? right.size_bytes : -1;
          return (leftSize - rightSize) * direction;
        }
        if (input.sortBy === 'modified_at') {
          const leftModified = left.kind === 'file' ? Date.parse(left.modified_at) : 0;
          const rightModified = right.kind === 'file' ? Date.parse(right.modified_at) : 0;
          return (leftModified - rightModified) * direction;
        }
        return left.name.localeCompare(right.name) * direction;
      });
      return {
        path: directoryPath,
        items: items.slice(0, input.pageSize),
        nextContinuationToken: items.length > input.pageSize ? items[input.pageSize - 1]?.path ?? null : null,
      };
    },
    async createFolder(input) {
      const repo = requireRepo(input);
      const folderPath = normalizeDefaultDirectoryPath(input.folderPath);
      if (!folderPath) {
        throw new Error('invalid_file_library_directory_path');
      }
      ensureDefaultParentDirectories(repo, folderPath);
      repo.entries.set(folderPath, {
        kind: 'directory',
        path: folderPath,
        modifiedAt: defaultNowIso(),
      });
    },
    async deletePaths(input) {
      const repo = requireRepo(input);
      return input.paths.map((rawPath) => {
        const pathValue = rawPath.endsWith('/') ? normalizeDefaultDirectoryPath(rawPath) : normalizeDefaultObjectPath(rawPath);
        const deleteKeys = Array.from(repo.entries.keys()).filter((key) => key === pathValue || key.startsWith(pathValue.endsWith('/') ? pathValue : `${pathValue}/`));
        if (deleteKeys.length === 0) {
          return { path: rawPath, status: 'not_found' };
        }
        for (const key of deleteKeys) {
          repo.entries.delete(key);
        }
        return { path: rawPath, status: 'deleted' };
      });
    },
    async moveEntry(input) {
      const repo = requireRepo(input);
      const fromPath = input.fromPath.endsWith('/') ? normalizeDefaultDirectoryPath(input.fromPath) : normalizeDefaultObjectPath(input.fromPath);
      const toPath = input.toPath.endsWith('/') ? normalizeDefaultDirectoryPath(input.toPath) : normalizeDefaultObjectPath(input.toPath);
      const moving = Array.from(repo.entries.entries()).filter(([key]) => key === fromPath || key.startsWith(fromPath.endsWith('/') ? fromPath : `${fromPath}/`));
      if (moving.length === 0) {
        throw new Error('file_library_object_not_found');
      }
      const destinationExists = Array.from(repo.entries.keys()).some((key) => key === toPath || key.startsWith(toPath.endsWith('/') ? toPath : `${toPath}/`));
      if (destinationExists && !input.overwrite) {
        throw new Error('file_library_destination_exists');
      }
      if (destinationExists) {
        for (const key of Array.from(repo.entries.keys())) {
          if (key === toPath || key.startsWith(toPath.endsWith('/') ? toPath : `${toPath}/`)) {
            repo.entries.delete(key);
          }
        }
      }
      for (const [key, entry] of moving) {
        repo.entries.delete(key);
        const nextPath = key === fromPath ? toPath : `${toPath}${key.slice(fromPath.length)}`;
        repo.entries.set(nextPath, { ...entry, path: nextPath, modifiedAt: defaultNowIso() });
      }
    },
    async uploadObject(input) {
      const repo = requireRepo(input);
      const objectPath = normalizeDefaultObjectPath(input.objectPath);
      if (!input.overwrite && repo.entries.has(objectPath)) {
        throw new Error('file_library_destination_exists');
      }
      const body = await readDefaultWebStream(input.body);
      const entry: Extract<DefaultStoredFileLibraryEntry, { kind: 'file' }> = {
        kind: 'file',
        path: objectPath,
        body,
        contentType: input.contentType ?? guessFileLibraryContentType(objectPath) ?? 'application/octet-stream',
        modifiedAt: defaultNowIso(),
        etag: `"default-${body.length}-${Date.now().toString(36)}"`,
      };
      ensureDefaultParentDirectories(repo, objectPath);
      repo.entries.set(objectPath, entry);
      return presentDefaultEntry(entry) as Extract<FileLibraryEntry, { kind: 'file' }>;
    },
    async downloadObject(input): Promise<FileLibraryDownloadResult> {
      const repo = requireRepo(input);
      const objectPath = normalizeDefaultObjectPath(input.objectPath);
      const entry = repo.entries.get(objectPath);
      if (!entry || entry.kind !== 'file') {
        throw new Error('file_library_object_not_found');
      }
      return {
        meta: defaultFileMeta(objectPath, entry),
        download: {
          stream: Readable.from([entry.body]),
          cancel: async () => undefined,
        },
      };
    },
    async getObjectMeta(input): Promise<FileLibraryObjectMeta> {
      const repo = requireRepo(input);
      const objectPath = normalizeDefaultObjectPath(input.objectPath);
      const entry = repo.entries.get(objectPath);
      if (!entry || entry.kind !== 'file') {
        throw new Error('file_library_object_not_found');
      }
      return defaultFileMeta(objectPath, entry);
    },
  };
}

export function createDefaultNodeApiDeps(): NodeApiDeps {
  const projectRepo = createProjectRepoFactoryResult({}).projectRepo;
  const cache = new InMemoryCache();
  const docStore = new InMemoryJsonDocStore();
  const clock = new SystemClock();
  const agentPresenceStore = createAgentPresenceStore(cache);
  const agentResourceService = new AgentResourceService(docStore, cache, agentPresenceStore);
  const projectAfscpNamespaceStore = new ProjectAfscpNamespaceStore(docStore);
  const projectAfscpResourceOwnershipStore = new ProjectAfscpResourceOwnershipStore(docStore);
  const fileLibraryStorageAdapter = createDefaultInMemoryFileLibraryStorageAdapter();

  const agentExecutionService = new AgentExecutionService(agentResourceService);
  const notebookTerminalService = new NotebookTerminalService(cache, agentExecutionService);
  let internalWorkloadCoordinator: InternalWorkloadCoordinator | undefined;
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
    projectAfscpNamespaceStore,
    projectStorageBootstrapService: createDefaultReadyProjectStorageBootstrapService(),
    projectStorageLifecycleService: new ProjectStorageLifecycleService({
      docStore,
      namespaceStore: projectAfscpNamespaceStore,
      fileLibraryStorageAdapter,
    }),
    afscpResourceOwnershipGuard: AfscpResourceOwnershipGuard.disabled(),
    fileLibraryStorageAdapter,
    createProjectUseCase: new CreateProjectUseCase(projectRepo, new SimpleIdGenerator(), clock),
    deleteProjectUseCase: new DeleteProjectUseCase(projectRepo),
    getProjectUseCase: new GetProjectUseCase(projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(projectRepo),
    updateProjectUseCase: new UpdateProjectUseCase(projectRepo, clock),
    universalProxyService: UniversalProxyService.fromEnv(process.env),
  };
  configureNotebookTerminalAuthorization(deps);
  notebookTerminalService.configureLifecycleHooks({
    onSessionCreated: async (session) => {
      if (!internalWorkloadCoordinator) return;
      const workloadId = sanitizeWorkloadId(session.taskId);
      await internalWorkloadCoordinator.acquireHolder({
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        workloadId,
        holderKind: 'terminal_session',
        holderId: session.id,
      });
    },
    onSessionClosed: async (session) => {
      if (internalWorkloadCoordinator) {
        const workloadId = sanitizeWorkloadId(session.taskId);
        await internalWorkloadCoordinator.releaseHolder({
          workspaceId: session.workspaceId,
          projectId: session.projectId,
          workloadId,
          holderKind: 'terminal_session',
          holderId: session.id,
        });
      }
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
  const afscpConfig = parseAfscpConfig(env);
  const sandboxUrl = env.SANDBOX_MANAGER_URL?.trim() || '';
  const sandboxServiceKey = env.SANDBOX_SERVICE_KEY?.trim() || '';
  const internalAgentWsBaseUrl = env.AGENT_EXECUTION_WS_BASE_URL?.trim()
    || deriveWebSocketBaseFromHttpBase(env.AGENT_EXECUTION_HTTP_BASE_URL)
    || deriveWebSocketBaseFromHttpBase(env.INTERNAL_API_BASE_URL);
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
        mongoClientOptions: DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS,
      })
    : new InMemoryJsonDocStore();
  const chatResourceService = new ChatResourceService(docStore);
  const endpointResourceService = new EndpointResourceService(docStore);
  const agentPresenceStore = createAgentPresenceStore(cache);
  const agentResourceService = new AgentResourceService(docStore, cache, agentPresenceStore);
  const agentExecutionService = new AgentExecutionService(agentResourceService);
  const notebookTerminalService = new NotebookTerminalService(cache, agentExecutionService);
  const projectAfscpNamespaceStore = new ProjectAfscpNamespaceStore(docStore);
  const projectAfscpResourceOwnershipStore = new ProjectAfscpResourceOwnershipStore(docStore);
  const fileLibraryAfscpMappingRepo = new JsonDocProjectFileLibraryAfscpMappingRepo(docStore);
  const afscpClient = afscpConfig.enabled
    ? new AfscpClient({
        baseUrl: afscpConfig.baseUrl,
        callerService: afscpConfig.callerService,
        serviceToken: afscpConfig.serviceToken,
        bootstrapServiceToken: afscpConfig.bootstrapServiceToken,
        bootstrapCallerService: afscpConfig.bootstrapCallerService,
      })
    : undefined;
  const afscpBootstrapClient = afscpClient ? new AfscpBootstrapClient(afscpClient) : undefined;
  const afscpProductClient = afscpClient ? new AfscpProductClient(afscpClient) : undefined;
  const projectStorageBootstrapService = afscpConfig.enabled && afscpBootstrapClient
    ? new ProjectStorageBootstrapService({
        namespaceStore: projectAfscpNamespaceStore,
        resourceOwnershipStore: projectAfscpResourceOwnershipStore,
        client: afscpBootstrapClient,
        defaultVolumeId: afscpConfig.defaultVolumeId,
        productCallerService: afscpConfig.callerService,
        orchestratorCallerService: afscpConfig.orchestratorCallerService,
      })
    : ProjectStorageBootstrapService.disabled();
  const afscpResourceOwnershipGuard = afscpConfig.enabled
    ? new AfscpResourceOwnershipGuard(projectAfscpNamespaceStore, projectAfscpResourceOwnershipStore)
    : AfscpResourceOwnershipGuard.disabled();
  const fileLibraryStorageAdapter = afscpConfig.enabled && afscpProductClient
    ? new AfscpFileLibraryStorageAdapter({
        client: afscpProductClient,
        mappingRepo: fileLibraryAfscpMappingRepo,
        projectAfscpNamespaceStore,
        resourceOwnershipStore: projectAfscpResourceOwnershipStore,
      })
    : AfscpFileLibraryStorageAdapter.disabled();
  const sandboxClient = sandboxUrl && sandboxServiceKey
    ? new SandboxManagerClient(sandboxUrl, sandboxServiceKey)
    : undefined;
  const internalAgentWorkspaceBindingManager = sandboxClient && afscpProductClient
    ? new InternalAgentWorkspaceProvisionerImpl(
        docStore,
        sandboxClient,
        {
          afscpProductClient,
          projectStorageBootstrapService,
          mappingRepo: fileLibraryAfscpMappingRepo,
          resourceOwnershipStore: projectAfscpResourceOwnershipStore,
        },
      )
    : undefined;
  const internalAgentPodManager = sandboxClient && internalAgentWsBaseUrl
    ? new InternalAgentPodManagerImpl(
        sandboxClient,
        agentExecutionService,
        internalAgentWsBaseUrl.replace(/\/+$/, ''),
        {
          startupTimeoutMs: Number(env.INTERNAL_AGENT_STARTUP_TIMEOUT_MS ?? '300000'),
        },
      )
    : undefined;
  const internalWorkloadCoordinator = internalAgentPodManager
    ? new InternalWorkloadCoordinator(
        internalAgentPodManager,
        { keepaliveIntervalMs: INTERNAL_AGENT_KEEPALIVE_INTERVAL_SECONDS * 1000 },
      )
    : undefined;
  const projectStorageLifecycleService = new ProjectStorageLifecycleService({
    docStore,
    namespaceStore: projectAfscpNamespaceStore,
    fileLibraryStorageAdapter,
    ...(internalAgentWorkspaceBindingManager ? { internalAgentWorkspaceBindingManager } : {}),
  });
  if (sandboxClient) {
    void sandboxClient.checkReady().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown_error';
      process.stderr.write(`[api-entry-node] sandbox readyz preflight failed: ${message}\n`);
    });
  }
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
      projectAfscpNamespaceStore,
      projectStorageBootstrapService,
      projectStorageLifecycleService,
      afscpResourceOwnershipGuard,
      fileLibraryStorageAdapter,
      ...(internalAgentPodManager ? { internalAgentPodManager } : {}),
      ...(internalWorkloadCoordinator ? { internalWorkloadCoordinator } : {}),
      ...(internalAgentWorkspaceBindingManager
        ? {
          internalAgentWorkspaceBindingManager,
          internalAgentWorkspaceProvisioner: internalAgentWorkspaceBindingManager,
        }
        : {}),
      createProjectUseCase: new CreateProjectUseCase(factory.projectRepo, new SimpleIdGenerator(), clock),
      deleteProjectUseCase: new DeleteProjectUseCase(factory.projectRepo),
      getProjectUseCase: new GetProjectUseCase(factory.projectRepo),
      listProjectsUseCase: new ListProjectsUseCase(factory.projectRepo),
      updateProjectUseCase: new UpdateProjectUseCase(factory.projectRepo, clock),
      ...(universalProxyService ? { universalProxyService } : {}),
    };
  configureNotebookTerminalAuthorization(deps);
  notebookTerminalService.configureLifecycleHooks({
    onSessionCreated: async (session) => {
      if (!internalWorkloadCoordinator) return;
      const workloadId = sanitizeWorkloadId(session.taskId);
      await internalWorkloadCoordinator.acquireHolder({
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        workloadId,
        holderKind: 'terminal_session',
        holderId: session.id,
      });
    },
    onSessionClosed: async (session) => {
      if (internalWorkloadCoordinator) {
        const workloadId = sanitizeWorkloadId(session.taskId);
        await internalWorkloadCoordinator.releaseHolder({
          workspaceId: session.workspaceId,
          projectId: session.projectId,
          workloadId,
          holderKind: 'terminal_session',
          holderId: session.id,
        });
      }
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
