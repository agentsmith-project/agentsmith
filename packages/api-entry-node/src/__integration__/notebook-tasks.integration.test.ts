import http, { type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { AGENT_TASK_RUNNER_SPEC } from '@mbos/agent-runner';
import { createDefaultNodeApiDeps } from '../index.js';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  getNotebookTaskRunStopRequestForRun,
  getNotebookTaskRunState,
  requestNotebookTaskRunStop,
} from '../notebook-task/task-run-coordination.js';
import type { TaskRecord } from '../notebook-task/task-models.js';
import { getTasks } from '../notebook-task/task-runtime-state.js';
import { notebookTaskMessagesCollection, notebookTasksCollection } from '../notebook-task/task-store.js';
import { issueInternalTicket } from '../internal-ticket-store.js';
import { sanitizeWorkloadId } from '../internal-agent-pod-manager.js';
import { NotebookTerminalService } from '../notebook-terminal-service.js';
import {
  deleteProjectMembershipRecord,
  saveProjectGroup,
  saveProjectPermissionTemplate,
  upsertProjectMembershipRecord,
  upsertProjectMemberPermissionState,
} from '../project-member-governance-persistence.js';
import type {
  ProjectGroupRecord,
  ProjectPermissionTemplateRecord,
} from '../project-member-governance-types.js';
import {
  apiFetch,
  apiFetchWithToken,
  startServerReady as startServer,
  startServerWithDepsReady as startServerWithDeps,
} from './test-support.js';

const upstreamServers: Server[] = [];
const sockets: WebSocket[] = [];
let previousManagedExecutionHttpBase: string | undefined;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function normalizeApiBasePath(input: string): string {
  return input.replace(/\/api\/v1\/api\/v1(?=\/|$)/g, '/api/v1');
}

type TaskActivityItemForTest = {
  id: string;
  task_id: string;
  kind: 'user_intent' | 'runner_output';
  actor: 'user' | 'runner';
  content: string;
  created_at: string;
  run_id?: string;
};

type TerminalSessionResponseForTest = {
  terminal_session_id: string;
  runner_session_id?: string;
  status?: string;
  close_reason?: string | null;
  ws_url?: string | null;
};

function taskActivityPath(workspaceId: string, projectId: string, taskId: string): string {
  return `/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/activity`;
}

function taskRunsPath(workspaceId: string, projectId: string, taskId: string): string {
  return `/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/runs`;
}

function taskRunInit(
  intent: string,
  options?: {
    headers?: Record<string, string>;
    extraBody?: Record<string, unknown>;
  },
): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify({
      intent,
      ...options?.extraBody,
    }),
  };
}

function createExecutionTicketGate(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
): {
  gateReached: Promise<void>;
  releaseGate: () => void;
} {
  const originalSet = deps.cache.set.bind(deps.cache);
  const gateReached = createDeferred<void>();
  let releaseGate: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let gateArmed = false;
  deps.cache.set = async (key, value, ttlSeconds) => {
    if (!gateArmed && key.startsWith('internal:ticket:exec_')) {
      gateArmed = true;
      gateReached.resolve();
      await gate;
    }
    return originalSet(key, value, ttlSeconds);
  };
  return {
    gateReached: gateReached.promise,
    releaseGate: () => releaseGate?.(),
  };
}

beforeEach(() => {
  previousManagedExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
  process.env.AGENT_EXECUTION_HTTP_BASE_URL = 'http://127.0.0.1:20000/api/v1';
});

afterEach(async () => {
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      // ignore cleanup failures in tests
    }
  }
  sockets.length = 0;
  await Promise.all(
    upstreamServers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.closeIdleConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
  upstreamServers.length = 0;
  if (previousManagedExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
  else process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousManagedExecutionHttpBase;
});

async function startUpstreamServer(): Promise<{
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
  lastPath: () => string;
}> {
  let body: unknown = null;
  let path = '';
  const server = http.createServer((req, res) => {
    void (async () => {
      path = req.url ?? '';
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, echoed: body }));
    })();
  });
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('invalid_notebook_upstream_port');
  }
  upstreamServers.push(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    lastBody: () => body,
    lastPath: () => path,
  };
}

async function createFileLibrary(
  baseUrl: string,
  name = 'Notebook Workspace',
  options?: {
    workspaceId?: string;
    projectId?: string;
  },
): Promise<{ id: string; name: string }> {
  const workspaceId = options?.workspaceId ?? 'ws_default';
  const projectId = options?.projectId ?? 'proj_1';
  const createLibraryRes = await apiFetch(
    baseUrl,
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/file-libraries`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description: 'task workspace library' }),
    },
  );
  expect(createLibraryRes.status).toBe(201);
  return (await createLibraryRes.json()) as { id: string; name: string };
}

function configureManagedTaskRunnerRuntimeDeps(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
): void {
  deps.internalAgentPodManager ??= {
    ensureAgentReady: vi.fn(async () => undefined),
    keepalive: vi.fn(async () => undefined),
    releasePod: vi.fn(async () => undefined),
  } as never;
  deps.internalAgentWorkspaceBindingManager ??= {
    ensureWorkspaceBinding: vi.fn(async (input: {
      workspaceId: string;
      projectId: string;
      fileLibraryId: string;
      taskId: string;
    }) => ({
      binding: {
        id: `bind_${input.taskId}`,
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        file_library_id: input.fileLibraryId,
        kind: 'juicefs_volume',
        status: 'ready',
        metadata_url: 'postgres://jfsu_user:secret@localhost:15432/jfs_managed?sslmode=disable',
        storage_bucket_url: 'http://localhost:19000/jfs-managed',
        created_at: '2026-04-05T00:00:00.000Z',
        updated_at: '2026-04-05T00:00:00.000Z',
      },
      workspaceMount: {
        bindingId: `bind_${input.taskId}`,
        volumeName: 'juicefs-task',
        mountPath: `/workspace/${input.taskId}`,
        fileLibraryId: input.fileLibraryId,
      },
    })),
  } as never;
}

async function grantDeveloperRunnerProjectPermissions(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  projectId: string,
  userId = 'user_test',
): Promise<void> {
  await upsertProjectMemberPermissionState(deps.docStore, 'ws_default', projectId, userId, {
    mode: 'custom',
    template: null,
    permissions: [
      'project:agent_task:use',
      'project:agent_runner:manage',
    ],
  });
}

async function createDefaultManagedTaskRunner(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  name: string,
  options?: {
    workspaceId?: string;
    projectId?: string;
    endpointBaseUrl?: string;
  },
): Promise<{ runnerId: string; endpointId: string }> {
  const workspaceId = options?.workspaceId ?? 'ws_default';
  const projectId = options?.projectId ?? 'proj_1';
  configureManagedTaskRunnerRuntimeDeps(deps);
  const credential = await deps.endpointResourceService.createCredential(workspaceId, projectId, {
    name: `${name}-credential`,
    value: 'sk-test',
  });
  const endpoint = await deps.endpointResourceService.createEndpoint(workspaceId, projectId, {
    name: `${name}-endpoint`,
    model: 'gpt-5-codex',
    type: 'custom',
    mode: 'openai',
    base_url: options?.endpointBaseUrl ?? 'https://example.com/v1',
    credential_ref: credential.id,
    model_profile: {
      max_context_tokens: 204800,
      max_output_tokens: 128000,
      supports_file: false,
      supports_tool_call: true,
      supports_reasoning: false,
      price_input_per_1m: 0,
      price_output_per_1m: 0,
      cache_read_discount_ratio: 0,
      cache_write_discount_ratio: 0,
    },
  });
  const runner = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner(workspaceId, projectId, {
    name,
    runner_provider: 'managed',
    status: 'enabled',
    presence: 'managed',
    runner_status: 'ready',
    endpointId: endpoint.id,
    owner_id: 'user_test',
    visibility: 'private',
    capabilities: {
      task_execution: true,
      terminal: true,
      artifacts: true,
      streaming_completion: true,
      multimodal_completion: false,
      file_inputs: true,
      url_inputs: true,
    },
    execution_preferences_json: {
      task: {
        endpoint_id: endpoint.id,
        wire_api: 'chat',
        model: 'gpt-5-codex',
      },
    },
  });
  return { runnerId: runner.id, endpointId: endpoint.id };
}

async function ensureDefaultManagedTaskRunner(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  name: string,
  options?: {
    workspaceId?: string;
    projectId?: string;
    endpointBaseUrl?: string;
  },
): Promise<{ runnerId: string; endpointId: string }> {
  const workspaceId = options?.workspaceId ?? 'ws_default';
  const projectId = options?.projectId ?? 'proj_1';
  const existing = (await deps.agentResourceService.listAgents(workspaceId, projectId)).find((item) =>
    item.runner_provider === 'managed'
    && item.status === 'enabled'
    && item.is_default === true
    && item.runner_status === 'ready'
    && typeof item.default_endpoint_id === 'string'
    && item.default_endpoint_id.trim().length > 0,
  );
  if (existing) {
    return {
      runnerId: existing.id,
      endpointId: existing.default_endpoint_id.trim(),
    };
  }
  return createDefaultManagedTaskRunner(deps, name, options);
}

async function createNotebookTaskProject(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  workspaceId: string,
  projectId: string | undefined,
  name: string,
): Promise<string> {
  if (projectId) return projectId;
  const project = await deps.createProjectUseCase.execute({
    workspaceId,
    actorId: 'user_test',
    input: {
      name,
      visibility: 'private',
      join_policy: 'approval_required',
    },
  });
  return project.id;
}

async function createDeveloperTaskRunner(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  name: string,
  options?: {
    workspaceId?: string;
    projectId?: string;
  },
): Promise<{ runnerId: string; endpointId: string }> {
  const workspaceId = options?.workspaceId ?? 'ws_default';
  const projectId = options?.projectId ?? 'proj_1';
  await upsertProjectMembershipRecord(deps.docStore, workspaceId, projectId, {
    project_id: projectId,
    user_id: 'user_test',
    user_email: 'test@example.com',
    user_name: 'Test User',
    status: 'active',
    joined_at: new Date().toISOString(),
  });
  await grantDeveloperRunnerProjectPermissions(deps, projectId);
  const credential = await deps.endpointResourceService.createCredential(workspaceId, projectId, {
    name: `${name}-credential`,
    value: 'sk-test',
  });
  const endpoint = await deps.endpointResourceService.createEndpoint(workspaceId, projectId, {
    name: `${name}-endpoint`,
    model: 'gpt-5-codex',
    type: 'custom',
    mode: 'openai',
    base_url: 'https://example.com/v1',
    credential_ref: credential.id,
    model_profile: {
      max_context_tokens: 204800,
      max_output_tokens: 128000,
      supports_file: false,
      supports_tool_call: true,
      supports_reasoning: false,
      price_input_per_1m: 0,
      price_output_per_1m: 0,
      cache_read_discount_ratio: 0,
      cache_write_discount_ratio: 0,
    },
  });
  const runner = await deps.agentResourceService.createAgent(workspaceId, projectId, {
    name,
    runner_provider: 'developer',
    status: 'enabled',
    presence: 'online',
    runner_status: 'ready',
    default_endpoint_id: endpoint.id,
    owner_id: 'user_test',
    visibility: 'private',
    capabilities: {
      task_execution: true,
      terminal: true,
      artifacts: true,
      streaming_completion: true,
      multimodal_completion: false,
    },
  });
  await deps.agentResourceService.markAgentConnected(runner.id, {
    remote_ip: '127.0.0.1',
    protocol_version: '1.0',
    last_pong_at: new Date().toISOString(),
  });
  return { runnerId: runner.id, endpointId: endpoint.id };
}

async function createExternalNotebookExecutionAgent(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  name: string,
  options?: {
    workspaceId?: string;
    projectId?: string;
    endpointBaseUrl?: string;
  },
): Promise<{ agentId: string; endpointId: string }> {
  const created = await createDeveloperTaskRunner(deps, name, options);
  return {
    agentId: created.runnerId,
    endpointId: created.endpointId,
  };
}

async function createNotebookTaskForAgent(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  baseUrl: string,
  input: {
    title: string;
    agentId: string;
    boundRunnerId?: string;
    workspaceFileLibraryId: string;
    workspaceId?: string;
    projectId?: string;
    authToken?: string;
  },
): Promise<{ id: string; projectId: string }> {
  const workspaceId = input.workspaceId ?? 'ws_default';
  const projectId = await createNotebookTaskProject(
    deps,
    workspaceId,
    input.projectId ?? (input.boundRunnerId ? undefined : 'proj_1'),
    `${input.title} Project`,
  );
  const authToken = input.authToken ?? 'test-token';
  await ensureDefaultManagedTaskRunner(deps, `${input.title}-default-runner`, {
    workspaceId,
    projectId,
  });
  const workspaceFileLibraryId = input.boundRunnerId && !input.projectId
    ? (await createFileLibrary(baseUrl, `${input.title} Workspace`, {
        workspaceId,
        projectId,
      })).id
    : input.workspaceFileLibraryId;
  const createTaskRes = await apiFetchWithToken(
    baseUrl,
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks`,
    authToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        workspace_file_library_id: workspaceFileLibraryId,
        ...(input.boundRunnerId ? { bound_runner_id: input.boundRunnerId } : {}),
      }),
    },
  );
  expect(createTaskRes.status, await createTaskRes.clone().text()).toBe(201);
  return await createTaskRes.json() as { id: string; projectId: string };
}

async function createDedicatedExternalNotebookTaskForAgent(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  baseUrl: string,
  taskTitle: string,
  options?: {
    workspaceId?: string;
    authToken?: string;
  },
): Promise<{ taskId: string; agentId: string; projectId: string }> {
  const workspaceId = options?.workspaceId ?? 'ws_default';
  const projectId = await createNotebookTaskProject(
    deps,
    workspaceId,
    undefined,
    `${taskTitle} Project`,
  );
  const workspaceLibrary = await createFileLibrary(baseUrl, `${taskTitle} Workspace`, {
    workspaceId,
    projectId,
  });
  const { agentId } = await createExternalNotebookExecutionAgent(deps, `${taskTitle}-agent`, {
    workspaceId,
    projectId,
  });
  const task = await createNotebookTaskForAgent(deps, baseUrl, {
    title: taskTitle,
    agentId,
    boundRunnerId: agentId,
    workspaceFileLibraryId: workspaceLibrary.id,
    workspaceId,
    projectId,
    authToken: options?.authToken,
  });
  return {
    taskId: task.id,
    agentId,
    projectId,
  };
}

async function createActiveExternalTaskForTerminal(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  baseUrl: string,
  taskTitle: string,
  options?: {
    workspaceId?: string;
    projectId?: string;
    useDedicatedProject?: boolean;
    authToken?: string;
    agentOwnerId?: string;
    createNewWorkspace?: boolean;
  },
): Promise<{ taskId: string; agentId: string; projectId: string }> {
  const workspaceId = options?.workspaceId ?? 'ws_default';
  const projectId = options?.projectId ?? (
    options?.useDedicatedProject
      ? await createNotebookTaskProject(deps, workspaceId, undefined, `${taskTitle} Project`)
      : 'proj_1'
  );
  const authToken = options?.authToken ?? 'test-token';
  const agentOwnerId = options?.agentOwnerId ?? 'user_test';
  const createNewWorkspace = options?.createNewWorkspace ?? false;

  await ensureDefaultManagedTaskRunner(deps, `${taskTitle}-default-runner`, {
    workspaceId,
    projectId,
  });
  const { runnerId } = await createDeveloperTaskRunner(deps, `${taskTitle}-runner`, {
    workspaceId,
    projectId,
  });
  if (agentOwnerId !== 'user_test') {
    await deps.agentResourceService.updateAgent(workspaceId, projectId, runnerId, {
      owner_id: agentOwnerId,
    });
  }

  const workspaceLibrary = createNewWorkspace
    ? null
    : await createFileLibrary(baseUrl, `${taskTitle} Workspace`, {
        workspaceId,
        projectId,
      });
  const createTaskRes = await apiFetchWithToken(
    baseUrl,
    `/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks`,
    authToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: taskTitle,
        ...(createNewWorkspace
          ? {
            workspace_mode: 'create_new',
            workspace_name: `${taskTitle} Workspace`,
          }
          : {
            workspace_file_library_id: workspaceLibrary?.id,
          }),
        bound_runner_id: runnerId,
      }),
    },
  );
  expect(createTaskRes.status, await createTaskRes.clone().text()).toBe(201);
  const task = await createTaskRes.json() as { id: string };
  return { taskId: task.id, agentId: runnerId, projectId };
}

async function createActiveInternalTaskForTerminal(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
  baseUrl: string,
  taskTitle: string,
): Promise<{ taskId: string; agentId: string }> {
  const { runnerId } = await createDefaultManagedTaskRunner(deps, `${taskTitle}-runner`);

  const workspaceLibrary = await createFileLibrary(baseUrl, `${taskTitle} Workspace`);
  const task = await createNotebookTaskForAgent(deps, baseUrl, {
    title: taskTitle,
    agentId: runnerId,
    workspaceFileLibraryId: workspaceLibrary.id,
  });
  return { taskId: task.id, agentId: runnerId };
}

describe('api-entry-node notebook task routes', () => {
  it('isolates notebook tasks by owner for both external and internal agents', async () => {
    const { baseUrl, deps } = await startServer();
    await createDefaultManagedTaskRunner(deps, 'owner-isolation-default-runner');
    const internalWorkspaceLibrary = await createFileLibrary(baseUrl, 'Internal Isolation Workspace');
    const externalWorkspaceLibrary = await createFileLibrary(baseUrl, 'External Isolation Workspace');

    const createInternalTask = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      'test-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Internal owner task',
          workspace_file_library_id: internalWorkspaceLibrary.id,
        }),
      },
    );
    expect(createInternalTask.status).toBe(201);
    const internalTask = await createInternalTask.json() as { id: string };

    const externalCreatedAt = new Date().toISOString();
    const externalTask: TaskRecord = {
      id: 'task_external_isolated',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_test',
      title: 'External owner task',
      workspace_file_library_id: externalWorkspaceLibrary.id,
      workspace_file_library_name: externalWorkspaceLibrary.name,
      status: 'active',
      attached_inputs: [],
      created_at: externalCreatedAt,
      updated_at: externalCreatedAt,
      last_activity_at: externalCreatedAt,
    };
    getTasks('ws_default', 'proj_1').unshift(externalTask);
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection('ws_default'), externalTask.id, externalTask);

    const ownerList = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      'test-token',
    );
    expect(ownerList.status).toBe(200);
    const ownerListBody = await ownerList.json() as { items: Array<{ id: string }> };
    expect(ownerListBody.items.map((item) => item.id)).toContain(internalTask.id);
    expect(ownerListBody.items.map((item) => item.id)).toContain(externalTask.id);

    const otherList = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      'owner-token',
    );
    expect(otherList.status).toBe(200);
    const otherListBody = await otherList.json() as { items: Array<{ id: string }> };
    expect(otherListBody.items.map((item) => item.id)).not.toContain(internalTask.id);
    expect(otherListBody.items.map((item) => item.id)).not.toContain(externalTask.id);

    const otherGet = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${internalTask.id}`,
      'owner-token',
    );
    expect(otherGet.status).toBe(404);

    const otherActivity = await apiFetchWithToken(
      baseUrl,
      taskActivityPath('ws_default', 'proj_1', internalTask.id),
      'owner-token',
    );
    expect(otherActivity.status).toBe(404);

    const otherWorkspaceAccess = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${internalTask.id}/workspace-access`,
      'owner-token',
      { method: 'POST' },
    );
    expect(otherWorkspaceAccess.status).toBe(404);

    const otherExternalGet = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${externalTask.id}`,
      'owner-token',
    );
    expect(otherExternalGet.status).toBe(404);
  });

  it('auto-initializes a workspace when creating an agent task without an explicit workspace file library', async () => {
    const { baseUrl, deps } = await startServer();
    await createDefaultManagedTaskRunner(deps, 'auto-workspace-default-runner');
    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Agent task default workspace',
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    await expect(createTaskRes.json()).resolves.toMatchObject({
      title: 'Agent task default workspace',
      workspace_file_library_id: expect.stringMatching(/^flib_/),
      workspace_file_library_name: 'Agent task default workspace Workspace',
    });
  });

  it('auto-initializes a workspace file library when create-new mode is requested', async () => {
    const { baseUrl, deps } = await startServer();
    await createDefaultManagedTaskRunner(deps, 'auto-create-new-default-runner');

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Notebook task with auto workspace',
          workspace_mode: 'create_new',
          workspace_name: 'Auto Workspace',
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const createdTask = await createTaskRes.json() as { workspace_file_library_id: string; workspace_file_library_name: string };
    expect(createdTask.workspace_file_library_id).toMatch(/^flib_/);
    expect(createdTask.workspace_file_library_name).toBe('Auto Workspace');
  });

  it.each(['agent_id', 'agent_name', 'runner_id', 'runner_selection'])(
    'rejects legacy selector field %s on task create',
    async (field) => {
      const { baseUrl, deps } = await startServer();
      await createDefaultManagedTaskRunner(deps, `legacy-selector-default-${field}`);
      const createTaskRes = await apiFetch(
        baseUrl,
        '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Legacy selector task',
            [field]: 'legacy-selector',
          }),
        },
      );

      expect(createTaskRes.status).toBe(400);
      await expect(createTaskRes.json()).resolves.toMatchObject({
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: [field],
      });
    },
  );

  it.each(['role', 'content', 'agent_id', 'agent_name', 'runner_id'])(
    'rejects legacy selector field %s on task run payload',
    async (field) => {
      const { baseUrl, deps } = await startServer();
      await ensureDefaultManagedTaskRunner(deps, `legacy-selector-run-payload-default-${field}`);
      const createTaskRes = await apiFetch(
        baseUrl,
        '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Runnerless task',
          }),
        },
      );
      expect(createTaskRes.status).toBe(201);
      const task = await createTaskRes.json() as { id: string };

      const runRes = await apiFetch(
        baseUrl,
        taskRunsPath('ws_default', 'proj_1', task.id),
        taskRunInit('run with legacy selector', {
          extraBody: { [field]: 'legacy-selector' },
        }),
      );

      expect(runRes.status).toBe(400);
      await expect(runRes.json()).resolves.toMatchObject({
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: [field],
      });
    },
  );

  it('fails task create when no ready default Agent Runner exists', async () => {
    const { baseUrl } = await startServer();
    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Agent task without runner',
        }),
      },
    );
    expect(createTaskRes.status).toBe(409);
    await expect(createTaskRes.json()).resolves.toMatchObject({
      error_code: 'agent_runner_unavailable',
      message: 'agent_runner_unavailable',
    });
  });

  it('fails task create when an eligible Agent Runner exists but no default is configured', async () => {
    const { baseUrl, deps } = await startServer();
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'non-default-runner-endpoint',
      model: 'gpt-5-codex',
      type: 'custom',
      base_url: 'https://example.com/v1',
      status: 'active',
      upstream_protocol: 'openai_chat_completions',
      model_profile: {
        max_context_tokens: 128000,
        max_output_tokens: 8192,
        supports_file: false,
        supports_tool_call: true,
        supports_reasoning: false,
        price_input_per_1m: 0,
        price_output_per_1m: 0,
        cache_read_discount_ratio: 0,
        cache_write_discount_ratio: 0,
      },
    });
    await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'non-default-task-runner',
      runner_provider: 'managed',
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      is_default: false,
      default_endpoint_id: endpoint.id,
      owner_id: 'user_test',
      visibility: 'private',
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: true,
      },
    } as never);
    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Agent task with non-default runner only',
        }),
      },
    );
    expect(createTaskRes.status).toBe(409);
    await expect(createTaskRes.json()).resolves.toMatchObject({
      error_code: 'agent_runner_unavailable',
      message: 'agent_runner_unavailable',
    });
  });

  it('ignores legacy project default conflicts when no deployment default projection exists', async () => {
    const { baseUrl, deps } = await startServer();
    const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
      name: 'legacy-conflicting-default-runners-credential',
      value: 'sk-test',
    });
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'legacy-conflicting-default-runners-endpoint',
      model: 'gpt-5-codex',
      type: 'custom',
      mode: 'openai',
      base_url: 'https://example.com/v1',
      credential_ref: credential.id,
      model_profile: {
        max_context_tokens: 204800,
      },
    });
    for (const name of ['conflicting-default-runner-a', 'conflicting-default-runner-b']) {
      await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name,
        runner_provider: 'managed',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        owner_id: 'user_test',
        visibility: 'private',
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
          streaming_completion: true,
          multimodal_completion: false,
        },
      });
    }
    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Agent task with conflicting default runners',
        }),
      },
    );
    expect(createTaskRes.status).toBe(409);
    await expect(createTaskRes.json()).resolves.toMatchObject({
      error_code: 'agent_runner_unavailable',
      message: 'agent_runner_unavailable',
    });
  });

  it('fails task create when the default Agent Runner lacks required task capabilities', async () => {
    const { baseUrl, deps } = await startServer();
    const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
      name: 'capability-mismatch-runner-credential',
      value: 'sk-test',
    });
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'capability-mismatch-runner-endpoint',
      model: 'gpt-5-codex',
      type: 'custom',
      mode: 'openai',
      base_url: 'https://example.com/v1',
      credential_ref: credential.id,
      model_profile: {
        max_context_tokens: 204800,
        max_output_tokens: 128000,
        supports_file: false,
        supports_tool_call: true,
        supports_reasoning: false,
        price_input_per_1m: 0,
        price_output_per_1m: 0,
        cache_read_discount_ratio: 0,
        cache_write_discount_ratio: 0,
      },
    });
    await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
      name: 'capability-mismatch-runner',
      runner_provider: 'managed',
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      endpointId: endpoint.id,
      owner_id: 'user_test',
      visibility: 'private',
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: false,
        streaming_completion: true,
        multimodal_completion: false,
      },
    });
    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Agent task with capability mismatch',
        }),
      },
    );
    expect(createTaskRes.status).toBe(409);
    await expect(createTaskRes.json()).resolves.toMatchObject({
      error_code: 'agent_runner_capability_mismatch',
      message: 'agent_runner_capability_mismatch',
    });
  });

  it('returns task-bound workspace access for notebook task file libraries', async () => {
    const { baseUrl, deps } = await startServer();
    await createDefaultManagedTaskRunner(deps, 'workspace-access-default-runner');
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Workspace Access Library');

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Workspace Access Task',
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const workspaceAccessRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/workspace-access`,
      { method: 'POST' },
    );
    expect(workspaceAccessRes.status).toBe(200);
    await expect(workspaceAccessRes.json()).resolves.toMatchObject({
      task_id: task.id,
      workspace_binding_mode: 'file_library',
      container_workspace_path: null,
      library_root_path: '.',
      workspace_dir_name: workspaceLibrary.filesystem_name,
      file_library_id: workspaceLibrary.id,
      file_library_name: workspaceLibrary.name,
      filesystem_name: expect.any(String),
      metadata_url: expect.stringContaining('sslmode=disable'),
      recommended_mount_path: expect.any(String),
      created_at: expect.any(String),
    });
  });

  it('allows scoped execution tickets for task workspace access and rejects mismatched scope', async () => {
    const { baseUrl, deps } = await startServer();
    await createDefaultManagedTaskRunner(deps, 'workspace-access-ticket-default-runner');
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook-agent',
      runner_provider: 'managed',
      status: 'enabled',
      config: {
        image: 'runner:v1',
        _internal_raw_key: 'ask_test',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_external',
          wire_api: 'responses',
          model: 'placeholder-model',
        },
      },
    });

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Workspace Access via Execution Ticket',
          workspace_mode: 'create_new',
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string; workspace_file_library_id: string };
    expect(task.workspace_file_library_id).toBeTruthy();

    const goodTicket = await issueInternalTicket(deps.cache, {
      purpose: 'agent_execution',
      userId: 'user_test',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      payload: {
        endpoint_id: 'ep_external',
        task_id: task.id,
        runner_session_id: task.id,
        agent_runner_id: agent.id,
      },
      maxUses: 5,
    });

    const goodRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/workspace-access`,
      goodTicket.ticket,
      { method: 'POST' },
    );
    expect(goodRes.status).toBe(200);

    const badScopeTicket = await issueInternalTicket(deps.cache, {
      purpose: 'agent_execution',
      userId: 'user_test',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      payload: {
        endpoint_id: 'ep_external',
        task_id: 'task_other',
        runner_session_id: 'task_other',
        agent_runner_id: agent.id,
      },
      maxUses: 5,
    });

    const badScopeRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/workspace-access`,
      badScopeTicket.ticket,
      { method: 'POST' },
    );
    expect(badScopeRes.status).toBe(403);
    await expect(badScopeRes.json()).resolves.toMatchObject({
      error_code: 'INTERNAL_TICKET_SCOPE_MISMATCH',
    });
  });

  it('returns task-bound workspace access for create_new notebook workspaces owned by the task creator', async () => {
    const { baseUrl, deps } = await startServer();
    await createDefaultManagedTaskRunner(deps, 'create-new-workspace-default-runner');

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Create New Workspace Access Task',
          workspace_mode: 'create_new',
          workspace_name: 'Create New Workspace Access',
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string; workspace_file_library_id: string };
    expect(task.workspace_file_library_id).toBeTruthy();

    const workspaceAccessRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/workspace-access`,
      { method: 'POST' },
    );
    expect(workspaceAccessRes.status).toBe(200);
    await expect(workspaceAccessRes.json()).resolves.toMatchObject({
      task_id: task.id,
      workspace_binding_mode: 'file_library',
      container_workspace_path: null,
      library_root_path: '.',
      file_library_id: task.workspace_file_library_id,
      metadata_url: expect.any(String),
      created_at: expect.any(String),
    });
  });

  it('creates distinct workspace filesystems for different users even when create_new notebook task names match', async () => {
    const { baseUrl, deps } = await startServer();
    await createDefaultManagedTaskRunner(deps, 'collision-probe-default-runner');

    const createTaskBody = JSON.stringify({
      title: 'Collision Probe',
      workspace_mode: 'create_new',
      workspace_name: 'Collision Probe Workspace',
    });

    const ownerTaskRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      'test-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: createTaskBody,
      },
    );
    expect(ownerTaskRes.status).toBe(201);
    const ownerTask = await ownerTaskRes.json() as {
      id: string;
      workspace_file_library_id: string;
      workspace_file_library_name: string;
    };

    const otherTaskRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      'owner-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: createTaskBody,
      },
    );
    expect(otherTaskRes.status).toBe(201);
    const otherTask = await otherTaskRes.json() as {
      id: string;
      workspace_file_library_id: string;
      workspace_file_library_name: string;
    };

    expect(ownerTask.workspace_file_library_id).not.toBe(otherTask.workspace_file_library_id);
    expect(ownerTask.workspace_file_library_name).toBe('Collision Probe Workspace');
    expect(otherTask.workspace_file_library_name).toBe('Collision Probe Workspace');

    const ownerAccessRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${ownerTask.id}/workspace-access`,
      'test-token',
      { method: 'POST' },
    );
    expect(ownerAccessRes.status).toBe(200);
    const ownerAccess = await ownerAccessRes.json() as {
      file_library_id: string;
      workspace_dir_name: string;
      metadata_url: string;
      storage_bucket_url?: string;
    };

    const otherAccessRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${otherTask.id}/workspace-access`,
      'owner-token',
      { method: 'POST' },
    );
    expect(otherAccessRes.status).toBe(200);
    const otherAccess = await otherAccessRes.json() as {
      file_library_id: string;
      workspace_dir_name: string;
      metadata_url: string;
      storage_bucket_url?: string;
    };

    expect(ownerAccess.file_library_id).toBe(ownerTask.workspace_file_library_id);
    expect(otherAccess.file_library_id).toBe(otherTask.workspace_file_library_id);
    expect(ownerAccess.workspace_dir_name).not.toBe(otherAccess.workspace_dir_name);
    expect(ownerAccess.metadata_url).not.toBe(otherAccess.metadata_url);
    expect(ownerAccess.storage_bucket_url).not.toBe(otherAccess.storage_bucket_url);
  });

  it('rewrites task workspace mount access for developer Agent Task runner containers', async () => {
    const previousExternalExecutionBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
    process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = 'http://172.18.0.1:20000';
    try {
      const { baseUrl, deps } = await startServer();
      await createDefaultManagedTaskRunner(deps, 'developer-runner-workspace-access-default-runner');
      const workspaceLibrary = await createFileLibrary(baseUrl, 'Developer Runner Workspace Access Library');

      const createTaskRes = await apiFetch(
        baseUrl,
        '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Developer Runner Workspace Access Task',
            workspace_file_library_id: workspaceLibrary.id,
          }),
        },
      );
      expect(createTaskRes.status).toBe(201);
      const task = (await createTaskRes.json()) as { id: string };

      const workspaceAccessRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/workspace-access`,
        { method: 'POST' },
      );
      expect(workspaceAccessRes.status).toBe(200);
      await expect(workspaceAccessRes.json()).resolves.toMatchObject({
        task_id: task.id,
        metadata_url: expect.stringMatching(/@(localhost|172\.18\.0\.1):15432\//),
        storage_bucket_url: expect.stringMatching(/http:\/\/(localhost|172\.18\.0\.1):19000\//),
      });
    } finally {
      if (previousExternalExecutionBase === undefined) {
        delete process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
      } else {
        process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = previousExternalExecutionBase;
      }
    }
  });

  it('rejects creating a second active task against an occupied workspace file library', async () => {
    const { baseUrl, deps } = await startServer();
    await createDefaultManagedTaskRunner(deps, 'occupied-workspace-default-runner');
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Occupied Workspace');

    const firstTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'First Task',
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(firstTaskRes.status).toBe(201);

    const secondTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Second Task',
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(secondTaskRes.status).toBe(409);
    await expect(secondTaskRes.json()).resolves.toMatchObject({
      error_code: 'RESOURCE_CONFLICT',
      message: 'workspace_file_library_in_use',
    });
  });

  it('keeps task workspace access available after api restart', async () => {
    const deps = createDefaultNodeApiDeps();
    const firstServer = await startServerWithDeps(deps);
    await createDefaultManagedTaskRunner(deps, 'restart-workspace-default-runner');
    const workspaceLibrary = await createFileLibrary(firstServer.baseUrl, 'Restart Task Workspace');

    const createTaskRes = await apiFetch(
      firstServer.baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Restart Workspace Access Task',
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    firstServer.server.closeAllConnections?.();
    firstServer.server.closeIdleConnections?.();
    await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));

    const secondServer = await startServerWithDeps(deps);
    const workspaceAccessRes = await apiFetch(
      secondServer.baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/workspace-access`,
      { method: 'POST' },
    );
    expect(workspaceAccessRes.status).toBe(200);
    await expect(workspaceAccessRes.json()).resolves.toMatchObject({
      task_id: task.id,
      file_library_id: workspaceLibrary.id,
      file_library_name: workspaceLibrary.name,
      metadata_url: expect.stringContaining('sslmode=disable'),
    });
  });

  it('keeps notebook run_state visible after restart and stores shared stop intent in the run control record', async () => {
    const deps = createDefaultNodeApiDeps();
    const firstServer = await startServerWithDeps(deps);
    const workspaceLibrary = await createFileLibrary(firstServer.baseUrl, 'Restart Run Coordination Library');
    const { runnerId } = await createDefaultManagedTaskRunner(deps, 'restartable-run-coordination-runner');

    const createTaskRes = await apiFetch(
      firstServer.baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Restart Run Coordination Task',
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const activeStartedAt = new Date().toISOString();
    const active = buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_restart_shared',
      runnerId,
      resolvedRunnerId: runnerId,
      startedAt: activeStartedAt,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, active)).resolves.toBe(true);

    firstServer.server.closeAllConnections?.();
    firstServer.server.closeIdleConnections?.();
    await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));

    const secondServer = await startServerWithDeps(deps);
    const listRes = await apiFetch(
      secondServer.baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
    );
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: task.id,
          run_state: 'running',
          active_run: expect.objectContaining({
            runner_id: runnerId,
          }),
          active_run_started_at: activeStartedAt,
        }),
      ]),
    });

    const detailRes = await apiFetch(
      secondServer.baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
    );
    expect(detailRes.status).toBe(200);
    await expect(detailRes.json()).resolves.toMatchObject({
      id: task.id,
      run_state: 'running',
      active_run: expect.objectContaining({
        runner_id: runnerId,
      }),
      active_run_started_at: activeStartedAt,
    });

    const cancelRes = await apiFetch(
      secondServer.baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/cancel`,
      { method: 'POST' },
    );
    expect(cancelRes.status, JSON.stringify(await cancelRes.clone().json())).toBe(202);
    await expect(cancelRes.json()).resolves.toMatchObject({
      status: 'cancelling',
      task_id: task.id,
      run_id: 'run_restart_shared',
      stop_mode: 'cancel',
      can_escalate: expect.any(Boolean),
    });
    await expect(getNotebookTaskRunStopRequestForRun(deps.cache, {
      taskId: task.id,
      runId: 'run_restart_shared',
    })).resolves.toMatchObject({
      mode: 'cancel',
      actor_user_id: 'user_test',
    });
  });

  it('auto-upgrades stale internal run ownership to terminating truth and requests hard teardown', async () => {
    const deps = createDefaultNodeApiDeps();
    const requestHardTeardown = vi.fn(async () => undefined);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    const { baseUrl } = await startServerWithDeps(deps);
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Stale Internal Run Coordination Workspace');
    const { runnerId } = await createDefaultManagedTaskRunner(deps, 'stale-internal-run-agent');

    const task = await createNotebookTaskForAgent(deps, baseUrl, {
      title: 'Stale internal run control task',
      agentId: runnerId,
      workspaceFileLibraryId: workspaceLibrary.id,
    });

    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_internal_stale_owner',
      runnerId,
      resolvedRunnerId: runnerId,
      startedAt: '2026-03-18T08:00:00.000Z',
      heartbeatAt: '2026-03-18T08:00:00.000Z',
      ownerInstanceId: 'api-stale-owner',
    }))).resolves.toBe(true);

    const cancelRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/cancel`,
      'test-token',
      { method: 'POST' },
    );
    expect(cancelRes.status, JSON.stringify(await cancelRes.clone().json())).toBe(202);
    await expect(cancelRes.json()).resolves.toMatchObject({
      status: 'terminating',
      task_id: task.id,
      run_id: 'run_internal_stale_owner',
      stop_mode: 'terminate',
      can_escalate: false,
      escalation_reason: 'already_terminating',
    });

    const retryTerminateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/cancel`,
      'test-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'terminate' }),
      },
    );
    expect(retryTerminateRes.status).toBe(409);
    await expect(retryTerminateRes.json()).resolves.toMatchObject({
      error_code: 'TASK_RUN_NOT_ACTIVE',
      message: 'task_run_not_active',
    });

    const listRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      'test-token',
    );
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: task.id,
          run_state: 'idle',
        }),
      ]),
    });

    const detailRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
      'test-token',
    );
    expect(detailRes.status).toBe(200);
    await expect(detailRes.json()).resolves.toMatchObject({
      id: task.id,
      run_state: 'idle',
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    expect(requestHardTeardown).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: sanitizeWorkloadId(task.id),
      epoch: 'run_internal_stale_owner',
    });
  });

  it('rejects unsupported external terminate without mutating shared run truth', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = await startServerWithDeps(deps);
    const { taskId, agentId, projectId } = await createDedicatedExternalNotebookTaskForAgent(
      deps,
      baseUrl,
      'External terminate unavailable task',
    );

    const now = new Date().toISOString();
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId,
      runId: 'run_external_terminate_unavailable',
      runnerId: agentId,
      resolvedRunnerId: agentId,
      requestId: 'req_external_terminate_unavailable',
      startedAt: now,
      heartbeatAt: now,
    }))).resolves.toBe(true);

    const terminateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/cancel`,
      'test-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'terminate' }),
      },
    );
    expect(terminateRes.status).toBe(409);
    await expect(terminateRes.json()).resolves.toMatchObject({
      error_code: 'STOP_ESCALATION_UNAVAILABLE',
      message: 'stop_escalation_unavailable',
      task_id: taskId,
      run_id: 'run_external_terminate_unavailable',
      request_id: 'req_external_terminate_unavailable',
      can_escalate: false,
      escalation_reason: 'unsupported_runner',
    });
    const runStateAfterTerminate = await getNotebookTaskRunState(deps.cache, taskId);
    expect(runStateAfterTerminate).toMatchObject({
      run_id: 'run_external_terminate_unavailable',
      phase: 'running',
    });
    expect(runStateAfterTerminate?.stop).toBeUndefined();

    const listRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks`,
      'test-token',
    );
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: taskId,
          run_state: 'running',
        }),
      ]),
    });
  });

  it('rejects stale external run ownership instead of returning happy cancelling', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = await startServerWithDeps(deps);
    const { taskId, agentId, projectId } = await createDedicatedExternalNotebookTaskForAgent(
      deps,
      baseUrl,
      'Stale external run control task',
    );

    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId,
      runId: 'run_external_stale_owner',
      runnerId: agentId,
      resolvedRunnerId: agentId,
      startedAt: '2026-03-18T09:00:00.000Z',
      heartbeatAt: '2026-03-18T09:00:00.000Z',
      ownerInstanceId: 'api-stale-owner',
    }))).resolves.toBe(true);

    const cancelRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/cancel`,
      'test-token',
      { method: 'POST' },
    );
    expect(cancelRes.status).toBe(409);
    await expect(cancelRes.json()).resolves.toMatchObject({
      error_code: 'TASK_RUN_OWNER_UNAVAILABLE',
      message: 'task_run_owner_unavailable',
    });

    const listRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks`,
      'test-token',
    );
    expect(listRes.status).toBe(200);
    await expect(listRes.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: taskId,
          run_state: 'running',
        }),
      ]),
    });
  });

  it('rejects starting a second notebook run when a shared active run already exists', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = await startServerWithDeps(deps);
    await createDefaultManagedTaskRunner(deps, 'shared-conflict-default-runner');
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Shared Conflict Library');

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Shared Conflict Task',
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_conflict_shared',
      resolvedRunnerId: 'runner_conflict_shared',
      startedAt: new Date().toISOString(),
    }))).resolves.toBe(true);

    const messageRes = await apiFetch(
      baseUrl,
      taskRunsPath('ws_default', 'proj_1', task.id),
      taskRunInit('hello shared state'),
    );
    expect(messageRes.status).toBe(409);
    await expect(messageRes.json()).resolves.toMatchObject({
      error_code: 'TASK_STREAM_CONFLICT',
      message: 'task_stream_conflict',
    });
  });

  it('clears shared run coordination when assistant message persistence fails before dispatch', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    const originalUpsert = deps.docStore.upsert.bind(deps.docStore);
    let assistantPersistFailed = false;
    deps.docStore.upsert = async (collection, id, doc) => {
      if (
        !assistantPersistFailed
        && collection === notebookTaskMessagesCollection('ws_default')
        && typeof doc === 'object'
        && doc !== null
        && !Array.isArray(doc)
        && (doc as { role?: unknown }).role === 'agent'
        && (doc as { content?: unknown }).content === ''
      ) {
        assistantPersistFailed = true;
        throw new Error('assistant_message_persist_failed');
      }
      return originalUpsert(collection, id, doc);
    };
    let dispatchCalled = false;
    deps.agentExecutionService.dispatchStreamingRequest = async () => {
      dispatchCalled = true;
      throw new Error('dispatch_should_not_start');
    };

    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const { taskId, projectId } = await createDedicatedExternalNotebookTaskForAgent(
        deps,
        baseUrl,
        'Pre-dispatch cleanup task',
      );

      const postMessageRes = await apiFetchWithToken(
        baseUrl,
        taskRunsPath('ws_default', projectId, taskId),
        'test-token',
        taskRunInit('run with failing assistant persist'),
      );
      expect(postMessageRes.status).toBeGreaterThanOrEqual(400);
      expect(dispatchCalled).toBe(false);
      await expect(getNotebookTaskRunState(deps.cache, taskId)).resolves.toBeNull();

      const cancelRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/cancel`,
        'test-token',
        { method: 'POST' },
      );
      expect(cancelRes.status).toBe(409);
      await expect(cancelRes.json()).resolves.toMatchObject({
        error_code: 'TASK_RUN_NOT_ACTIVE',
        message: 'task_run_not_active',
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('honors shared cancel requests before dispatch starts and never opens the execution stream', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    const executionTicketGate = createExecutionTicketGate(deps);
    let dispatchCalls = 0;
    deps.agentExecutionService.dispatchStreamingRequest = async () => {
      dispatchCalls += 1;
      return {
        requestId: 'req_unexpected_dispatch',
        cancel: () => undefined,
        stream: (async function* stream() {
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      };
    };

    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const { taskId, projectId } = await createDedicatedExternalNotebookTaskForAgent(
        deps,
        baseUrl,
        'Cancel before dispatch task',
      );

      const postMessageRes = await apiFetchWithToken(
        baseUrl,
        taskRunsPath('ws_default', projectId, taskId),
        'test-token',
        taskRunInit('cancel before dispatch starts'),
      );
      expect(postMessageRes.status).toBe(200);
      await executionTicketGate.gateReached;

      const cancelRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/cancel`,
        'test-token',
        { method: 'POST' },
      );
      expect(cancelRes.status).toBe(202);
      await expect(cancelRes.json()).resolves.toMatchObject({
        status: 'cancelling',
        task_id: taskId,
      });

      executionTicketGate.releaseGate();

      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await getNotebookTaskRunState(deps.cache, taskId)) === null) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(dispatchCalls).toBe(0);
      await expect(getNotebookTaskRunState(deps.cache, taskId)).resolves.toBeNull();

      let tracesBody: { items: Array<{ name?: string; status?: string }> } | null = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const tracesRes = await apiFetchWithToken(
          baseUrl,
          `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/traces`,
          'test-token',
        );
        expect(tracesRes.status).toBe(200);
        tracesBody = (await tracesRes.json()) as { items: Array<{ name?: string; status?: string }> };
        if (tracesBody.items.some((item) => item.name === 'run.user_cancel' && item.status === 'cancelled')) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(tracesBody?.items.some((item) => item.name === 'run.user_cancel' && item.status === 'cancelled')).toBe(true);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('treats shared cancel markers as authoritative before dispatch even without a local cancel handle', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    const executionTicketGate = createExecutionTicketGate(deps);
    let dispatchCalls = 0;
    deps.agentExecutionService.dispatchStreamingRequest = async () => {
      dispatchCalls += 1;
      return {
        requestId: 'req_shared_marker_should_not_dispatch',
        cancel: () => undefined,
        stream: (async function* stream() {
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      };
    };

    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const { taskId, projectId } = await createDedicatedExternalNotebookTaskForAgent(
        deps,
        baseUrl,
        'Shared marker before dispatch task',
      );

      const postMessageRes = await apiFetchWithToken(
        baseUrl,
        taskRunsPath('ws_default', projectId, taskId),
        'test-token',
        taskRunInit('shared marker should cancel pre-dispatch'),
      );
      expect(postMessageRes.status).toBe(200);
      await executionTicketGate.gateReached;

      const activeRun = await getNotebookTaskRunState(deps.cache, taskId);
      expect(activeRun?.run_id).toBeTruthy();
      await requestNotebookTaskRunStop(deps.cache, {
        taskId,
        runId: activeRun?.run_id ?? 'missing_run_id',
        mode: 'cancel',
        requestedAt: new Date().toISOString(),
        actorUserId: 'user_test',
        delivery: 'shared_owner',
      });
      await expect(getNotebookTaskRunStopRequestForRun(deps.cache, {
        taskId,
        runId: activeRun?.run_id ?? 'missing_run_id',
      })).resolves.toMatchObject({
        mode: 'cancel',
        actor_user_id: 'user_test',
        delivery: 'shared_owner',
      });

      executionTicketGate.releaseGate();

      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await getNotebookTaskRunState(deps.cache, taskId)) === null) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(dispatchCalls).toBe(0);
      await expect(getNotebookTaskRunState(deps.cache, taskId)).resolves.toBeNull();

      let tracesBody: { items: Array<{ name?: string; status?: string }> } | null = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const tracesRes = await apiFetchWithToken(
          baseUrl,
          `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/traces`,
          'test-token',
        );
        expect(tracesRes.status).toBe(200);
        tracesBody = (await tracesRes.json()) as { items: Array<{ name?: string; status?: string }> };
        if (tracesBody.items.some((item) => item.name === 'run.user_cancel' && item.status === 'cancelled')) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(tracesBody?.items.some((item) => item.name === 'run.user_cancel' && item.status === 'cancelled')).toBe(true);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('dispatches a second internal run after terminate aborts a pre-dispatch startup lock from the first run', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    const firstStartupObserved = createDeferred<void>();
    const activeEnsureLocks = new Map<string, Promise<void>>();
    let firstStartupSignal: AbortSignal | undefined;
    let ensureCallCount = 0;
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async (input: {
        workspaceId: string;
        projectId: string;
        workloadId: string;
        signal?: AbortSignal;
      }) => {
        const lockKey = `${input.workspaceId}/${input.projectId}/${input.workloadId}`;
        for (;;) {
          const existing = activeEnsureLocks.get(lockKey);
          if (!existing) break;
          await existing;
        }
        let releaseLock!: () => void;
        const lock = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        activeEnsureLocks.set(lockKey, lock);
        ensureCallCount += 1;
        try {
          if (ensureCallCount === 1) {
            firstStartupSignal = input.signal;
            firstStartupObserved.resolve();
            if (!input.signal) {
              await new Promise<void>(() => {});
              return;
            }
            await new Promise<never>((_resolve, reject) => {
              input.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('user_cancel_requested'), {
                  code: 'AGENT_CANCELLED',
                }));
              }, { once: true });
            });
          }
        } finally {
          if (activeEnsureLocks.get(lockKey) === lock) {
            activeEnsureLocks.delete(lockKey);
          }
          releaseLock();
        }
      }),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    } as never;
    deps.internalAgentWorkspaceBindingManager = {
      ensureWorkspaceBinding: vi.fn(async (input: {
        workspaceId: string;
        projectId: string;
        fileLibraryId: string;
        taskId: string;
      }) => ({
        binding: {
          id: 'bind_internal_pre_dispatch_recovery',
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          file_library_id: input.fileLibraryId,
          kind: 'juicefs_volume',
          status: 'ready',
          metadata_url: 'postgres://jfsu_user:secret@localhost:15432/jfs_internal?sslmode=disable',
          storage_bucket_url: 'http://localhost:19000/jfs-internal',
          created_at: '2026-04-05T00:00:00.000Z',
          updated_at: '2026-04-05T00:00:00.000Z',
        },
        workspaceMount: {
          bindingId: 'bind_internal_pre_dispatch_recovery',
          mountPath: `/workspace/${input.taskId}`,
          fileLibraryId: input.fileLibraryId,
        },
      })),
    } as never;

    const secondDispatchStarted = createDeferred<void>();
    deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => {
      secondDispatchStarted.resolve();
      return {
        requestId: 'req_second_internal_dispatch',
        cancel: () => undefined,
        stream: (async function* stream() {
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      };
    });

    const { runnerId } = await createDefaultManagedTaskRunner(deps, 'internal-pre-dispatch-recovery-agent');

    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const workspaceLibrary = await createFileLibrary(baseUrl, 'Internal Pre-dispatch Recovery Workspace');
      const task = await createNotebookTaskForAgent(deps, baseUrl, {
        title: 'Internal pre-dispatch recovery task',
        agentId: runnerId,
        workspaceFileLibraryId: workspaceLibrary.id,
      });

      const firstMessageRes = await apiFetchWithToken(
        baseUrl,
        taskRunsPath('ws_default', 'proj_1', task.id),
        'test-token',
        taskRunInit('first run should be terminated before dispatch'),
      );
      expect(firstMessageRes.status).toBe(200);
      await firstStartupObserved.promise;
      expect(firstStartupSignal).toBeInstanceOf(AbortSignal);
      expect((deps.agentExecutionService.dispatchStreamingRequest as typeof deps.agentExecutionService.dispatchStreamingRequest)).not.toHaveBeenCalled();

      const terminateRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/cancel`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'terminate' }),
        },
      );
      expect(terminateRes.status, JSON.stringify(await terminateRes.clone().json())).toBe(202);
      await expect(terminateRes.json()).resolves.toMatchObject({
        status: 'terminating',
        task_id: task.id,
        request_id: null,
        stop_mode: 'terminate',
      });

      await vi.waitFor(async () => {
        expect(await getNotebookTaskRunState(deps.cache, task.id)).toBeNull();
      });

      const secondMessageRes = await apiFetchWithToken(
        baseUrl,
        taskRunsPath('ws_default', 'proj_1', task.id),
        'test-token',
        taskRunInit('second run should dispatch after recovery'),
      );
      expect(secondMessageRes.status).toBe(200);

      await secondDispatchStarted.promise;
      expect(deps.agentExecutionService.dispatchStreamingRequest).toHaveBeenCalledTimes(1);

      const taskRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
        'test-token',
      );
      expect(taskRes.status).toBe(200);
      await expect(taskRes.json()).resolves.toMatchObject({
        id: task.id,
        run_state: 'idle',
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('releases shared run_state before slow post-run audit writes complete', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    const originalUpsert = deps.docStore.upsert.bind(deps.docStore);
    let releaseCompletedAudit: (() => void) | null = null;
    const completedAuditGate = new Promise<void>((resolve) => {
      releaseCompletedAudit = resolve;
    });
    let completedAuditObserved: (() => void) | null = null;
    const completedAuditStarted = new Promise<void>((resolve) => {
      completedAuditObserved = resolve;
    });
    deps.docStore.upsert = async (collection, id, doc) => {
      if (
        collection === 'ws_default_project_audit_events'
        && typeof doc === 'object'
        && doc !== null
        && !Array.isArray(doc)
        && (doc as { action?: unknown }).action === 'notebook.task.run.completed'
      ) {
        completedAuditObserved?.();
        await completedAuditGate;
      }
      return originalUpsert(collection, id, doc);
    };
    deps.agentExecutionService.dispatchStreamingRequest = async () => ({
      requestId: 'req_completed_before_audit',
      cancel: () => undefined,
      stream: (async function* stream() {
        yield { type: 'done', finish_reason: 'stop', usage_tokens: 3 } as const;
      })(),
    });

    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const { taskId, projectId } = await createDedicatedExternalNotebookTaskForAgent(
        deps,
        baseUrl,
        'Slow audit coordination task',
      );

      const postMessageRes = await apiFetchWithToken(
        baseUrl,
        taskRunsPath('ws_default', projectId, taskId),
        'test-token',
        taskRunInit('finish quickly but hold audit'),
      );
      expect(postMessageRes.status).toBe(200);
      await completedAuditStarted;

      const taskRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}`,
        'test-token',
      );
      expect(taskRes.status).toBe(200);
      await expect(taskRes.json()).resolves.toMatchObject({
        id: taskId,
        run_state: 'idle',
      });

      const cancelRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/cancel`,
        'test-token',
        { method: 'POST' },
      );
      expect(cancelRes.status).toBe(409);
      await expect(cancelRes.json()).resolves.toMatchObject({
        error_code: 'TASK_RUN_NOT_ACTIVE',
        message: 'task_run_not_active',
      });

      releaseCompletedAudit?.();
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('rejects deleting a notebook task while its run is still active and preserves task truth', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    let notifyDispatchStarted!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      notifyDispatchStarted = resolve;
    });
    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    deps.agentExecutionService.dispatchStreamingRequest = async () => ({
      requestId: 'req_delete_busy',
      cancel: () => undefined,
      stream: (async function* stream() {
        notifyDispatchStarted();
        await runGate;
        yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
      })(),
    });

    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const { taskId, projectId } = await createDedicatedExternalNotebookTaskForAgent(
        deps,
        baseUrl,
        'Delete busy task',
      );

      const postMessageRes = await apiFetchWithToken(
        baseUrl,
        taskRunsPath('ws_default', projectId, taskId),
        'test-token',
        taskRunInit('keep this run open'),
      );
      expect(postMessageRes.status).toBe(200);
      await dispatchStarted;

      const deleteRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteRes.status).toBe(409);
      await expect(deleteRes.json()).resolves.toMatchObject({
        error_code: 'RESOURCE_CONFLICT',
        message: 'task_run_in_progress',
      });

      releaseRun();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const activeRun = await getNotebookTaskRunState(deps.cache, taskId);
        if (!activeRun) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await expect(getNotebookTaskRunState(deps.cache, taskId)).resolves.toBeNull();
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('runs notebook task message through external execution service and enforces single active run per task', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    try {
      const { baseUrl, deps } = await startServer();
      configureManagedTaskRunnerRuntimeDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
      const upstream = await startUpstreamServer();
      const project = await deps.createProjectUseCase.execute({
        workspaceId: 'ws_default',
        actorId: 'user_test',
        input: {
          name: 'Notebook task runner project',
          visibility: 'private',
          join_policy: 'approval_required',
        },
      });
      const projectId = project.id;
      const workspaceLibrary = await createFileLibrary(baseUrl, 'Notebook Workspace', { projectId });

      const { runnerId: agentId, endpointId } = await createDeveloperTaskRunner(deps, 'task-runner', {
      workspaceId: 'ws_default',
      projectId,
    });

    const keyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners/${agentId}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(keyRes.status).toBe(201);
    const keyPayload = (await keyRes.json()) as { agent_runner_id: string; key: string };
    expect(keyPayload.agent_runner_id).toBe(agentId);

    const connInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners/${agentId}/connection-info`,
    );
    expect(connInfoRes.status).toBe(200);
    const connInfo = (await connInfoRes.json()) as { agent_runner_id: string; ws_url: string };
    expect(connInfo.agent_runner_id).toBe(agentId);
    const agentScopedWs = new WebSocket(
      connInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      {
        headers: { Authorization: `Bearer ${keyPayload.key}` },
      },
    );
    sockets.push(agentScopedWs);
    await new Promise<void>((resolve, reject) => {
      agentScopedWs.once('error', reject);
      agentScopedWs.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as { type?: string };
        if (msg.type !== 'server.hello') return;
        agentScopedWs.send(JSON.stringify({
          type: 'agent.ready',
          payload: {
            runner_spec: AGENT_TASK_RUNNER_SPEC,
            capabilities: { wire_api: 'chat' },
          },
        }));
        resolve();
      });
    });

    let releaseExecution: (() => void) | null = null;
    const holdExecution = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    let resolveExecutionReceived: ((value: {
      requestId: string;
      helloProxyBase: string;
      endpointProxyBase: string | null;
      apiBase: string;
      executionTicket: string;
      workspaceBindingMode: string | null;
      workspacePath: string | null;
      workspaceFileLibraryId: string | null;
      workspaceFileLibraryName: string | null;
      workspaceDirName: string | null;
      taskInputsCount: number | null;
      legacyUserBearerToken: string;
      close: () => void;
    }) => void) | null = null;
    const executionReceived = new Promise<{
      requestId: string;
      helloProxyBase: string;
      endpointProxyBase: string | null;
      apiBase: string;
      executionTicket: string;
      workspaceBindingMode: string | null;
      workspacePath: string | null;
      workspaceFileLibraryId: string | null;
      workspaceFileLibraryName: string | null;
      workspaceDirName: string | null;
      taskInputsCount: number | null;
      legacyUserBearerToken: string;
      close: () => void;
    }>((resolve) => {
      resolveExecutionReceived = resolve;
    });

    const attachRunnerWebSocket = async (taskId: string): Promise<void> => {
      const wsUrl = connInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://'))
        + `&runner_session_id=${encodeURIComponent(taskId)}`;
      let helloProxyBase = '';
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${keyPayload.key}` },
      });
      sockets.push(ws);

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          request_id?: string;
          payload?: {
            resource_proxy?: {
              base_url?: string;
            };
            execution_context?: {
              api_base?: string;
              execution_ticket?: string;
              user_bearer_token?: string;
              workspace_binding_mode?: string;
              workspace_path?: string;
              workspace_file_library_id?: string | null;
              workspace_file_library_name?: string | null;
              workspace_dir_name?: string | null;
              task_inputs?: unknown[];
            };
          };
        };
        if (msg.type === 'server.hello') {
          helloProxyBase = msg.payload?.resource_proxy?.base_url ?? '';
          return;
        }
        if (msg.type !== 'server.request.start' || !msg.request_id) return;
        resolveExecutionReceived?.({
          requestId: msg.request_id,
          helloProxyBase,
          endpointProxyBase: null,
          apiBase: msg.payload?.execution_context?.api_base ?? '',
          executionTicket: msg.payload?.execution_context?.execution_ticket ?? '',
          legacyUserBearerToken: msg.payload?.execution_context?.user_bearer_token ?? '',
          workspaceBindingMode: typeof msg.payload?.execution_context?.workspace_binding_mode === 'string'
            ? msg.payload.execution_context.workspace_binding_mode
            : null,
          workspacePath: typeof msg.payload?.execution_context?.workspace_path === 'string'
            ? msg.payload.execution_context.workspace_path
            : null,
          workspaceFileLibraryId: typeof msg.payload?.execution_context?.workspace_file_library_id === 'string'
            ? msg.payload.execution_context.workspace_file_library_id
            : null,
          workspaceFileLibraryName: typeof msg.payload?.execution_context?.workspace_file_library_name === 'string'
            ? msg.payload.execution_context.workspace_file_library_name
            : null,
          workspaceDirName: typeof msg.payload?.execution_context?.workspace_dir_name === 'string'
            ? msg.payload.execution_context.workspace_dir_name
            : null,
          taskInputsCount: Array.isArray(msg.payload?.execution_context?.task_inputs)
            ? msg.payload.execution_context.task_inputs.length
            : null,
          close: () => ws.close(),
        });
        void holdExecution.then(() => {
          ws.send(JSON.stringify({
            type: 'agent.response.event',
            request_id: msg.request_id,
            payload: {
              sequence: 1,
              at: new Date().toISOString(),
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
            },
          }));
          ws.send(JSON.stringify({
            type: 'agent.response.delta',
            request_id: msg.request_id,
            payload: { delta: 'task-output' },
          }));
          ws.send(JSON.stringify({
            type: 'agent.response.artifact',
            request_id: msg.request_id,
            payload: {
              filename: 'plot.png',
              task_relative_path: '.artifacts/plot.png',
              artifact_type: 'image',
              mime_type: 'image/png',
              file_size: 1234,
              title: 'plot.png',
              content: 'data:image/png;base64,AAAA',
              thumbnail_url: 'data:image/png;base64,AAAA',
            },
          }));
          ws.send(JSON.stringify({
            type: 'agent.response.done',
            request_id: msg.request_id,
            payload: { finish_reason: 'stop', usage_tokens: 8 },
          }));
        });
      });
      await new Promise<void>((resolve, reject) => {
        ws.once('error', reject);
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString('utf-8')) as { type?: string };
          if (msg.type !== 'server.hello') return;
          ws.send(JSON.stringify({
            type: 'agent.ready',
            payload: {
              runner_spec: AGENT_TASK_RUNNER_SPEC,
              capabilities: { wire_api: 'chat' },
            },
          }));
          resolve();
        });
      });
    };

    const createTaskRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Notebook task',
          workspace_file_library_id: workspaceLibrary.id,
          bound_runner_id: agentId,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };
    await attachRunnerWebSocket(task.id);

    const createExternalConnectionRes = await apiFetch(
      baseUrl,
      '/api/v1/me/external-connections',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'jira',
          kind: 'secret_bundle',
          display_name: 'execution-jira',
          note: 'execution sync test',
          fields: [
            { key: 'base_url', value: 'https://jira.example.com', secret: false },
            { key: 'api_token', value: 'jira-test-token', secret: true },
          ],
        }),
      },
    );
    expect(createExternalConnectionRes.status).toBe(201);

    const postMessageRes = await apiFetch(
      baseUrl,
      taskRunsPath('ws_default', projectId, task.id),
      taskRunInit('run this', {
        headers: {
          'Content-Type': 'application/json',
          Host: 'evil.example',
          'X-Forwarded-Host': 'evil.example',
          'X-Forwarded-Proto': 'https',
        },
      }),
    );
    expect(postMessageRes.status).toBe(200);

    const runningTaskRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${task.id}`,
    );
    expect(runningTaskRes.status).toBe(200);
    await expect(runningTaskRes.json()).resolves.toMatchObject({
      id: task.id,
      run_state: 'running',
      active_run: expect.objectContaining({
        runner_id: agentId,
      }),
    });
    const resolutionAuditRows = await deps.docStore.list<{
      action: string;
      resource_id?: string;
      metadata_json?: Record<string, unknown>;
    }>('ws_default_project_audit_events', { project_id: projectId });
    expect(resolutionAuditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'agent_runner.resolution.succeeded',
        resource_id: task.id,
        metadata_json: expect.objectContaining({
          runner_id: agentId,
          endpoint_id: endpointId,
        }),
      }),
    ]));

    const conflictRes = await apiFetch(
      baseUrl,
      taskRunsPath('ws_default', projectId, task.id),
      taskRunInit('second request'),
    );
    expect(conflictRes.status).toBe(409);
    releaseExecution?.();

    const execution = await executionReceived;
    expect(execution.requestId).toBeTruthy();
    expect(execution.executionTicket).toMatch(/^exec_/);
    expect(execution.legacyUserBearerToken).toBe('');
    expect(execution.apiBase).toBe(`${baseUrl}/api/v1`);
    expect(execution).not.toHaveProperty('interactionKind');
    expect(execution.workspaceBindingMode).toBe('file_library');
    expect(execution.workspacePath).toBeNull();
    expect(execution.workspaceFileLibraryId).toBe(workspaceLibrary.id);
    expect(execution.workspaceFileLibraryName).toBe(workspaceLibrary.name);
    expect(execution.workspaceDirName).toBe(workspaceLibrary.filesystem_name);
    expect(execution.taskInputsCount).toBe(0);
    expect(normalizeApiBasePath(execution.helloProxyBase)).toBe(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/${projectId}/endpoints/${endpointId}/proxy/openai`,
    );
    expect(execution.endpointProxyBase).toBeNull();

    let activityBody: TaskActivityItemForTest[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const activityRes = await apiFetch(
        baseUrl,
        taskActivityPath('ws_default', projectId, task.id),
      );
      expect(activityRes.status).toBe(200);
      activityBody = (await activityRes.json()) as TaskActivityItemForTest[];
      if (activityBody.some((item) => item.kind === 'runner_output' && item.content.includes('task-output'))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(activityBody.some((item) => item.kind === 'runner_output' && item.content.includes('task-output'))).toBe(true);
    expect(JSON.stringify(activityBody)).not.toContain('"role"');

    let tracesBody: {
      items: Array<{ message_id: string; category: string; summary: string }>;
      total: number;
      has_more?: boolean;
      next_after_id?: string | null;
    } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const tracesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${task.id}/traces`,
      );
      expect(tracesRes.status).toBe(200);
      tracesBody = (await tracesRes.json()) as {
        items: Array<{ message_id: string; category: string; summary: string }>;
        total: number;
        has_more?: boolean;
        next_after_id?: string | null;
      };
      if (tracesBody.items.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(tracesBody).not.toBeNull();
    expect(tracesBody!.items.length).toBeGreaterThan(0);
    expect(tracesBody!.items.some((item) => item.category === 'progress')).toBe(true);
    expect(typeof tracesBody!.has_more).toBe('boolean');
    if (tracesBody!.has_more) {
      expect(typeof tracesBody!.next_after_id === 'string' || tracesBody!.next_after_id === null).toBe(true);
    }

    let artifactsBody: Array<{ type: string; title?: string }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const artifactsRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${task.id}/artifacts`,
      );
      expect(artifactsRes.status).toBe(200);
      artifactsBody = (await artifactsRes.json()) as Array<{ type: string; title?: string }>;
      if (artifactsBody.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(artifactsBody.some((item) => item.type === 'image' && item.title === 'plot.png')).toBe(true);

    const taskAfterRunRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${task.id}`,
    );
    expect(taskAfterRunRes.status).toBe(200);
    const taskAfterRun = (await taskAfterRunRes.json()) as { status: string };
    expect(taskAfterRun.status).toBe('active');

    let secondTurnStatus = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const secondTurnRes = await apiFetch(
        baseUrl,
        taskRunsPath('ws_default', projectId, task.id),
        taskRunInit('follow-up request'),
      );
      secondTurnStatus = secondTurnRes.status;
      if (secondTurnStatus === 200) {
        break;
      }
      expect(secondTurnStatus).toBe(409);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(secondTurnStatus).toBe(200);
    execution.close();
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('synthesizes terminal trace and closes task when notebook execution dispatch fails', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    try {
      const { baseUrl, deps } = await startServer();
      configureManagedTaskRunnerRuntimeDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_test',
      input: {
        name: 'Offline execution project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const projectId = project.id;
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Offline Execution Workspace', { projectId });

      const { runnerId: agentId } = await createDeveloperTaskRunner(deps, 'task-runner-offline', {
      workspaceId: 'ws_default',
      projectId,
    });

    const keyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners/${agentId}/keys`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'runner-offline' }),
      },
    );
    expect(keyRes.status).toBe(201);
    const keyPayload = (await keyRes.json()) as { agent_runner_id: string; key: string };
    expect(keyPayload.agent_runner_id).toBe(agentId);
    const connInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners/${agentId}/connection-info`,
    );
    expect(connInfoRes.status).toBe(200);
    const connInfo = (await connInfoRes.json()) as { agent_runner_id: string; ws_url: string };
    expect(connInfo.agent_runner_id).toBe(agentId);
    const wsUrl = connInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://'));
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${keyPayload.key}` },
    });
    sockets.push(ws);
    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as { type?: string };
        if (msg.type !== 'server.hello') return;
        ws.send(JSON.stringify({
          type: 'agent.ready',
          payload: {
            runner_spec: AGENT_TASK_RUNNER_SPEC,
            capabilities: { wire_api: 'chat' },
          },
        }));
        resolve();
      });
    });

    const createTaskRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Notebook task offline execution',
          workspace_file_library_id: workspaceLibrary.id,
          bound_runner_id: agentId,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };
    ws.close();

    const postMessageRes = await apiFetch(
      baseUrl,
      taskRunsPath('ws_default', projectId, task.id),
      taskRunInit('run this despite offline execution'),
    );
    expect(postMessageRes.status).toBe(200);

    let tracesBody: { items: Array<{ status?: string; name?: string; summary?: string; details?: Record<string, unknown> }> } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const tracesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${task.id}/traces`,
      );
      expect(tracesRes.status).toBe(200);
      tracesBody = (await tracesRes.json()) as {
        items: Array<{ status?: string; name?: string; summary?: string; details?: Record<string, unknown> }>;
      };
      if (tracesBody.items.some((item) => item.name === 'execution.terminal' && item.status === 'error')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(tracesBody).not.toBeNull();
    const terminalTrace = tracesBody!.items.find((item) => item.name === 'execution.terminal');
    expect(terminalTrace?.status).toBe('error');
    expect(terminalTrace?.summary).toContain('Execution failed');
    const taskAfterRunRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${task.id}`,
    );
    expect(taskAfterRunRes.status).toBe(200);
    const taskAfterRun = (await taskAfterRunRes.json()) as { status: string };
    expect(taskAfterRun.status).toBe('active');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('exposes authenticated notebook task metrics snapshot', async () => {
    const { baseUrl } = await startServer();

    const metricsRes = await apiFetch(baseUrl, '/api/v1/internal/notebook-task-metrics');
    expect(metricsRes.status).toBe(200);
    const metrics = (await metricsRes.json()) as {
      active_runs: number;
      task_runs_started: number;
      task_runs_completed: number;
      task_runs_failed: number;
      trace_events_recorded: number;
      task_sse_clients: number;
      in_memory: { tasks: number; messages: number; traces: number };
      limits: { max_trace_events_per_task: number; max_trace_details_bytes: number };
    };
    expect(metrics.active_runs).toBe(0);
    expect(metrics.task_runs_started).toBeGreaterThanOrEqual(0);
    expect(metrics.task_runs_completed).toBeGreaterThanOrEqual(0);
    expect(metrics.task_runs_failed).toBeGreaterThanOrEqual(0);
    expect(metrics.trace_events_recorded).toBeGreaterThanOrEqual(0);
    expect(metrics.task_sse_clients).toBeGreaterThanOrEqual(0);
    expect(metrics.in_memory.tasks).toBeGreaterThanOrEqual(0);
    expect(metrics.in_memory.messages).toBeGreaterThanOrEqual(0);
    expect(metrics.in_memory.traces).toBeGreaterThanOrEqual(0);
    expect(metrics.limits.max_trace_events_per_task).toBeGreaterThan(0);
    expect(metrics.limits.max_trace_details_bytes).toBeGreaterThan(0);
  });

  it('exposes authenticated notebook task metrics in prometheus text format', async () => {
    const { baseUrl } = await startServer();

    const metricsRes = await apiFetch(baseUrl, '/api/v1/internal/notebook-task-metrics/prometheus');
    expect(metricsRes.status).toBe(200);
    const text = await metricsRes.text();
    expect(text).toContain('notebook_active_runs ');
    expect(text).toContain('notebook_task_runs_started_total ');
    expect(text).toContain('notebook_task_traces_query_duration_ms_count');
  });

  it('records task trace query metrics for message-scoped requests', async () => {
    const { baseUrl, deps } = await startServer();
    await createDefaultManagedTaskRunner(deps, 'trace-metrics-default-runner');
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Trace Metrics Workspace');

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Trace metrics task',
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const tracesRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces?message_id=msg_missing&page_size=50`,
    );
    expect(tracesRes.status).toBe(200);

    const metricsRes = await apiFetch(baseUrl, '/api/v1/internal/notebook-task-metrics');
    expect(metricsRes.status).toBe(200);
    const metrics = (await metricsRes.json()) as {
      task_traces_queries_total: number;
      task_traces_queries_message_scoped_total: number;
      trace_query_latency_by_scope?: Record<string, { count?: number }>;
    };
    expect(metrics.task_traces_queries_total).toBeGreaterThan(0);
    expect(metrics.task_traces_queries_message_scoped_total).toBeGreaterThan(0);
    expect(metrics.trace_query_latency_by_scope?.message?.count ?? 0).toBeGreaterThan(0);
  });

  it('builds runnerless terminal sessions with resolved default Agent Runner execution context', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    try {
    const deps = createDefaultNodeApiDeps();
    let capturedExecutionContext: Record<string, unknown> | null = null;
    deps.notebookTerminalService.createSession = async (input) => {
      capturedExecutionContext = input.executionContext ?? null;
      return {
        sessionId: 'term_external_capture',
        wsPath: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_external_terminal/terminal/ws?terminal_session_id=term_external_capture&ticket=term_ticket',
        wsTicket: 'term_ticket',
      };
    };
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    await createDefaultManagedTaskRunner(deps, 'terminal-default-runner');

    const { baseUrl } = await startServerWithDeps(deps);
    process.env.PUBLIC_API_BASE_URL = baseUrl;
    const workspaceLibrary = await createFileLibrary(baseUrl, 'External Terminal Workspace');
    const createTaskRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      'test-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'External terminal task',
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = await createTaskRes.json() as { id: string };

    const createTerminalRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/terminal/sessions`,
      'test-token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: 'evil.example',
          'X-Forwarded-Host': 'evil.example',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ cols: 120, rows: 40, shell: '/bin/zsh' }),
      },
    );
    expect(createTerminalRes.status).toBe(201);
    const createTerminalPayload = await createTerminalRes.json() as { ws_url?: string };
    expect(createTerminalPayload.ws_url).toBe(
      `${baseUrl.replace('http://', 'ws://')}/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_external_terminal/terminal/ws?terminal_session_id=term_external_capture&ticket=term_ticket`,
    );
    expect(capturedExecutionContext).toBeTruthy();
    expect(capturedExecutionContext?.task_id).toBe(task.id);
    expect(capturedExecutionContext?.workspace_binding_mode).toBe('pre_mounted');
    expect(capturedExecutionContext?.workspace_path).toBe(`/workspace/${task.id}`);
    expect(capturedExecutionContext?.workspace_file_library_id).toBe(workspaceLibrary.id);
    expect(capturedExecutionContext?.workspace_dir_name).toBe(workspaceLibrary.filesystem_name);
    expect(capturedExecutionContext).not.toHaveProperty('interaction_kind');
    expect(capturedExecutionContext?.api_base).toBe('http://127.0.0.1:20000/api/v1');
    expect(capturedExecutionContext?.credential_files).toBeUndefined();
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('builds internal terminal sessions with a task-root workspace path', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    try {
    const deps = createDefaultNodeApiDeps();
    let capturedExecutionContext: Record<string, unknown> | null = null;
    let capturedRuntimeDispatchContext: Record<string, unknown> | null = null;
    deps.notebookTerminalService.createSession = async (input) => {
      capturedExecutionContext = input.executionContext ?? null;
      capturedRuntimeDispatchContext = input.runtimeDispatchContext ?? null;
      return {
        sessionId: 'term_internal_capture',
        wsPath: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_internal_terminal/terminal/ws?terminal_session_id=term_internal_capture&ticket=term_ticket',
        wsTicket: 'term_ticket',
      };
    };
    deps.internalAgentWorkspaceBindingManager = {
      ensureWorkspaceBinding: async (input) => {
        return {
          binding: {
            id: 'bind_internal_terminal',
            workspace_id: input.workspaceId,
            project_id: input.projectId,
            file_library_id: input.fileLibraryId,
            kind: 'juicefs_volume',
            status: 'ready',
            metadata_url: 'postgres://jfsu_user:secret@localhost:15432/jfs_internal?sslmode=disable',
            storage_bucket_url: 'http://localhost:19000/jfs-internal',
            created_at: '2026-04-05T00:00:00.000Z',
            updated_at: '2026-04-05T00:00:00.000Z',
          },
          workspaceMount: {
            volumeName: 'juicefs-task',
            mountPath: `/workspace/${input.taskId}`,
            fileLibraryId: input.fileLibraryId,
          },
        };
      },
    };
    deps.internalAgentPodManager = {
      ensureAgentReady: async () => undefined,
      keepalive: async () => undefined,
      releasePod: async () => undefined,
    } as never;
    await createDefaultManagedTaskRunner(deps, 'internal-terminal-agent');

    const { baseUrl } = await startServerWithDeps(deps);
    process.env.PUBLIC_API_BASE_URL = `${baseUrl}/api/v1`;
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Internal Terminal Workspace');
    const createTaskRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      'test-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Internal terminal task',
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = await createTaskRes.json() as { id: string };

    const createTerminalRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/terminal/sessions`,
      'test-token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: 'evil.example',
          'X-Forwarded-Host': 'evil.example',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      },
    );
    expect(createTerminalRes.status).toBe(201);
    const createTerminalPayload = await createTerminalRes.json() as { ws_url?: string };
    expect(createTerminalPayload.ws_url).toBe(
      `${baseUrl.replace('http://', 'ws://')}/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_internal_terminal/terminal/ws?terminal_session_id=term_internal_capture&ticket=term_ticket`,
    );
    expect(capturedRuntimeDispatchContext).toEqual({
      managedInternalAgent: {
        workspaceFileLibraryId: workspaceLibrary.id,
      },
    });
    expect(capturedExecutionContext).toBeTruthy();
    expect(capturedExecutionContext?.task_id).toBe(task.id);
    expect(capturedExecutionContext?.workspace_binding_mode).toBe('pre_mounted');
    expect(capturedExecutionContext?.workspace_path).toBe(`/workspace/${task.id}`);
    expect(capturedExecutionContext?.workspace_file_library_id).toBe(workspaceLibrary.id);
    expect(capturedExecutionContext?.workspace_dir_name).toBe(workspaceLibrary.filesystem_name);
    expect(capturedExecutionContext).not.toHaveProperty('interaction_kind');
    expect(capturedExecutionContext?.api_base).toBe('http://127.0.0.1:20000/api/v1');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('lists task terminal sessions for the owner and deletes one session without touching others', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;
      const { taskId, projectId } = await createActiveExternalTaskForTerminal(
        deps,
        baseUrl,
        'List and delete terminals',
        { useDedicatedProject: true },
      );

    const firstRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
      'test-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      },
    );
    expect(firstRes.status).toBe(201);
    const first = await firstRes.json() as TerminalSessionResponseForTest;
    expect(first.terminal_session_id).toMatch(/^term_/);
    expect(first).not.toHaveProperty('session_id');

    const secondRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
      'test-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 90, rows: 28 }),
      },
    );
    expect(secondRes.status).toBe(201);
    const second = await secondRes.json() as TerminalSessionResponseForTest;
    expect(second.terminal_session_id).toMatch(/^term_/);
    expect(second).not.toHaveProperty('session_id');

    const listBeforeDelete = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
      'test-token',
    );
    expect(listBeforeDelete.status).toBe(200);
    const listBeforePayload = await listBeforeDelete.json() as {
      total: number;
      items: Array<TerminalSessionResponseForTest>;
    };
    expect(listBeforePayload.total).toBe(2);
    expect(listBeforePayload.items.map((item) => item.terminal_session_id)).toEqual([
      first.terminal_session_id,
      second.terminal_session_id,
    ]);
    expect(listBeforePayload.items[0]).not.toHaveProperty('id');

    const deleteFirst = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${first.terminal_session_id}`,
      'test-token',
      { method: 'DELETE' },
    );
    expect(deleteFirst.status).toBe(204);

    const listAfterDelete = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
      'test-token',
    );
    expect(listAfterDelete.status).toBe(200);
    const listAfterPayload = await listAfterDelete.json() as {
      total: number;
      items: Array<TerminalSessionResponseForTest>;
    };
    expect(listAfterPayload.total).toBe(1);
    expect(listAfterPayload.items.map((item) => item.terminal_session_id)).toEqual([second.terminal_session_id]);

      const deletedLookup = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${first.terminal_session_id}`,
        'test-token',
      );
      expect(deletedLookup.status).toBe(404);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('requires Agent task terminal permission for interactive terminal create/list/get/delete routes', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;
      const project = await deps.createProjectUseCase.execute({
        workspaceId: 'ws_default',
        actorId: 'user_owner',
        input: {
          name: 'Downgraded terminal owner project',
          visibility: 'private',
          join_policy: 'approval_required',
        },
      });
      await upsertProjectMembershipRecord(deps.docStore, 'ws_default', project.id, {
        project_id: project.id,
        user_id: 'user_test',
        user_email: 'test@example.com',
        user_name: 'Test User',
        status: 'active',
        joined_at: new Date().toISOString(),
      });
      const { taskId } = await createActiveExternalTaskForTerminal(
        deps,
        baseUrl,
        'Downgraded terminal owner',
        {
          projectId: project.id,
          createNewWorkspace: true,
        },
      );

      const createTerminalRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 80, rows: 24 }),
        },
      );
      expect(createTerminalRes.status).toBe(201);
      const createdTerminal = await createTerminalRes.json() as TerminalSessionResponseForTest;
      expect(createdTerminal).not.toHaveProperty('session_id');

      await deleteProjectMembershipRecord(deps.docStore, 'ws_default', project.id, 'user_test');
      const downgradedTemplate: ProjectPermissionTemplateRecord = {
        id: `tpl_task_use_only_${project.id}`,
        project_id: project.id,
        name: 'Task use only',
        description: 'Allows Agent task work without opening terminal sessions.',
        permissions: ['project:endpoint:use', 'project:agent_task:use'],
        built_in: false,
        editable: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await saveProjectPermissionTemplate(
        deps.docStore,
        'ws_default',
        project.id,
        downgradedTemplate,
      );
      const downgradedGroup: ProjectGroupRecord = {
        id: `grp_task_use_only_${project.id}`,
        project_id: project.id,
        name: 'Task use only',
        description: 'Carries task-use access after terminal permission is removed.',
        permission_template_id: downgradedTemplate.id,
        member_ids: ['user_test'],
        built_in: false,
        deletable: true,
        created_at: downgradedTemplate.created_at,
        updated_at: downgradedTemplate.updated_at,
      };
      await saveProjectGroup(
        deps.docStore,
        'ws_default',
        project.id,
        downgradedGroup,
      );

      const createAfterDowngrade = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 90, rows: 30 }),
        },
      );
      expect(createAfterDowngrade.status).toBe(403);
      await expect(createAfterDowngrade.json()).resolves.toMatchObject({
        error_code: 'FORBIDDEN',
        missing_permissions: ['project:agent_task:terminal'],
      });

      const listAfterDowngrade = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions`,
        'test-token',
      );
      expect(listAfterDowngrade.status).toBe(403);
      await expect(listAfterDowngrade.json()).resolves.toMatchObject({
        error_code: 'FORBIDDEN',
        missing_permissions: ['project:agent_task:terminal'],
      });

      const getAfterDowngrade = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions/${createdTerminal.terminal_session_id}`,
        'test-token',
      );
      expect(getAfterDowngrade.status).toBe(403);
      await expect(getAfterDowngrade.json()).resolves.toMatchObject({
        error_code: 'FORBIDDEN',
        missing_permissions: ['project:agent_task:terminal'],
      });

      const deleteAfterDowngrade = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions/${createdTerminal.terminal_session_id}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteAfterDowngrade.status).toBe(403);
      await expect(deleteAfterDowngrade.json()).resolves.toMatchObject({
        error_code: 'FORBIDDEN',
        missing_permissions: ['project:agent_task:terminal'],
      });

      await saveProjectPermissionTemplate(
        deps.docStore,
        'ws_default',
        project.id,
        {
          ...downgradedTemplate,
          description: 'Allows terminal access without Agent task work.',
          permissions: ['project:endpoint:use', 'project:agent_task:terminal'],
          updated_at: new Date().toISOString(),
        },
      );

      await upsertProjectMemberPermissionState(
        deps.docStore,
        'ws_default',
        project.id,
        'user_test',
        {
          mode: 'custom',
          template: null,
          permissions: ['project:agent_runner:manage'],
        },
      );

      const createWithTerminalOnly = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 90, rows: 30 }),
        },
      );
      expect(createWithTerminalOnly.status).toBe(403);
      await expect(createWithTerminalOnly.json()).resolves.toMatchObject({
        error_code: 'FORBIDDEN',
        missing_permissions: ['project:agent_task:use'],
      });

      const listWithTerminalOnly = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions`,
        'test-token',
      );
      expect(listWithTerminalOnly.status).toBe(403);
      await expect(listWithTerminalOnly.json()).resolves.toMatchObject({
        error_code: 'FORBIDDEN',
        missing_permissions: ['project:agent_task:use'],
      });

      const getWithTerminalOnly = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions/${createdTerminal.terminal_session_id}`,
        'test-token',
      );
      expect(getWithTerminalOnly.status).toBe(403);
      await expect(getWithTerminalOnly.json()).resolves.toMatchObject({
        error_code: 'FORBIDDEN',
        missing_permissions: ['project:agent_task:use'],
      });

      const deleteWithTerminalOnly = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions/${createdTerminal.terminal_session_id}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteWithTerminalOnly.status).toBe(403);
      await expect(deleteWithTerminalOnly.json()).resolves.toMatchObject({
        error_code: 'FORBIDDEN',
        missing_permissions: ['project:agent_task:use'],
      });

      await saveProjectPermissionTemplate(
        deps.docStore,
        'ws_default',
        project.id,
        {
          ...downgradedTemplate,
          description: 'Allows Agent task work and terminal session access after cleanup.',
          permissions: ['project:endpoint:use', 'project:agent_task:use', 'project:agent_task:terminal'],
          updated_at: new Date().toISOString(),
        },
      );

      const deleteAfterRestore = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions/${createdTerminal.terminal_session_id}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteAfterRestore.status).toBe(204);

      const listAfterDelete = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${project.id}/tasks/${taskId}/terminal/sessions`,
        'test-token',
      );
      expect(listAfterDelete.status).toBe(200);
      await expect(listAfterDelete.json()).resolves.toMatchObject({
        total: 0,
        items: [],
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('rejects a new notebook run while the task still has live terminal sessions', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;
      const { taskId, projectId } = await createActiveExternalTaskForTerminal(
        deps,
        baseUrl,
        'Terminal blocks notebook run',
        { useDedicatedProject: true },
      );

      const createTerminalRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 80, rows: 24 }),
        },
      );
      expect(createTerminalRes.status).toBe(201);

      const sendMessageRes = await apiFetchWithToken(
        baseUrl,
        taskRunsPath('ws_default', projectId, taskId),
        'test-token',
        taskRunInit('Please continue this notebook task.'),
      );
      expect(sendMessageRes.status).toBe(409);
      expect(await sendMessageRes.json()).toMatchObject({
        error_code: 'RESOURCE_CONFLICT',
        message: 'task_terminal_sessions_active',
      });

      const listActivityRes = await apiFetchWithToken(
        baseUrl,
        taskActivityPath('ws_default', projectId, taskId),
        'test-token',
      );
      expect(listActivityRes.status).toBe(200);
      expect(await listActivityRes.json()).toEqual([]);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('rejects deleting a task while live terminal sessions still exist and preserves the clean termination path', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;
      const { taskId, projectId } = await createActiveExternalTaskForTerminal(
        deps,
        baseUrl,
        'Delete after ending terminals',
        { useDedicatedProject: true },
      );

      const createTerminalRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 80, rows: 24 }),
        },
      );
      expect(createTerminalRes.status).toBe(201);
      const createdTerminal = await createTerminalRes.json() as TerminalSessionResponseForTest;
      expect(createdTerminal).not.toHaveProperty('session_id');

      const deleteTaskWhileTerminalActive = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteTaskWhileTerminalActive.status).toBe(409);
      await expect(deleteTaskWhileTerminalActive.json()).resolves.toMatchObject({
        error_code: 'RESOURCE_CONFLICT',
        message: 'task_terminal_sessions_active',
      });

      const listStillAvailable = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
      );
      expect(listStillAvailable.status).toBe(200);
      await expect(listStillAvailable.json()).resolves.toMatchObject({
        total: 1,
        items: [
          expect.objectContaining({
            terminal_session_id: createdTerminal.terminal_session_id,
          }),
        ],
      });

      const deleteTerminal = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${createdTerminal.terminal_session_id}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteTerminal.status).toBe(204);

      const deleteTaskAfterTerminalEnds = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteTaskAfterTerminalEnds.status).toBe(200);
      await expect(deleteTaskAfterTerminalEnds.json()).resolves.toEqual({ success: true });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('keeps notebook runs and task deletion blocked until the last live terminal session ends', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;
      const { taskId, projectId } = await createActiveExternalTaskForTerminal(
        deps,
        baseUrl,
        'Last terminal session releases task',
        { useDedicatedProject: true },
      );

      const createdSessionIds: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const createTerminalRes = await apiFetchWithToken(
          baseUrl,
          `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
          'test-token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cols: 80 + index, rows: 24 + index }),
          },
        );
        expect(createTerminalRes.status).toBe(201);
        const createdTerminal = await createTerminalRes.json() as TerminalSessionResponseForTest;
        expect(createdTerminal).not.toHaveProperty('session_id');
        createdSessionIds.push(createdTerminal.terminal_session_id);
      }

      const deleteFirst = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${createdSessionIds[0]}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteFirst.status).toBe(204);

      const blockedRun = await apiFetchWithToken(
        baseUrl,
        taskRunsPath('ws_default', projectId, taskId),
        'test-token',
        taskRunInit('Can the notebook continue now?'),
      );
      expect(blockedRun.status).toBe(409);
      await expect(blockedRun.json()).resolves.toMatchObject({
        error_code: 'RESOURCE_CONFLICT',
        message: 'task_terminal_sessions_active',
      });

      const blockedDelete = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(blockedDelete.status).toBe(409);
      await expect(blockedDelete.json()).resolves.toMatchObject({
        error_code: 'RESOURCE_CONFLICT',
        message: 'task_terminal_sessions_active',
      });

      const deleteSecond = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${createdSessionIds[1]}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteSecond.status).toBe(204);

      const deleteTaskAfterLastSessionEnds = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteTaskAfterLastSessionEnds.status).toBe(200);
      await expect(deleteTaskAfterLastSessionEnds.json()).resolves.toEqual({ success: true });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('marks a terminal session failed when runner never emits terminal start events', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.notebookTerminalService = new NotebookTerminalService(
      deps.cache,
      deps.agentExecutionService,
      { startupTimeoutMs: 50 },
    );
    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;
      const project = await deps.createProjectUseCase.execute({
        workspaceId: 'ws_default',
        actorId: 'user_test',
        input: {
          name: 'Terminal start timeout project',
          visibility: 'private',
          join_policy: 'approval_required',
        },
      });
      const projectId = project.id;
      const { taskId, agentId } = await createActiveExternalTaskForTerminal(deps, baseUrl, 'Terminal start timeout', { projectId });
      const agent = await deps.agentResourceService.getAgent('ws_default', projectId, agentId);
      expect(agent).toBeTruthy();

      const keyRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners/${agent!.id}/keys`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'terminal-timeout-runner' }),
        },
      );
      expect(keyRes.status).toBe(201);
      const keyPayload = await keyRes.json() as { agent_runner_id: string; key: string };
      expect(keyPayload.agent_runner_id).toBe(agent!.id);

      const connInfoRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners/${agent!.id}/connection-info`,
      );
      expect(connInfoRes.status).toBe(200);
      const connInfo = await connInfoRes.json() as { agent_runner_id: string; ws_url: string };
      expect(connInfo.agent_runner_id).toBe(agent!.id);

      const executionSocket = new WebSocket(
        `${connInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://'))}&runner_session_id=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${keyPayload.key}` } },
      );
      sockets.push(executionSocket);
      await new Promise<void>((resolve) => {
        executionSocket.on('message', (raw) => {
          const msg = JSON.parse(raw.toString('utf-8')) as { type?: string };
          if (msg.type !== 'server.hello') return;
          executionSocket.send(JSON.stringify({
            type: 'agent.ready',
            payload: {
              runner_spec: AGENT_TASK_RUNNER_SPEC,
              capabilities: { wire_api: 'responses' },
            },
          }));
          resolve();
        });
      });

      const createTerminalRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 80, rows: 24 }),
        },
      );
      expect(createTerminalRes.status).toBe(201);
      const created = await createTerminalRes.json() as TerminalSessionResponseForTest & { ws_url: string };
      expect(created).not.toHaveProperty('session_id');

      const browserSocket = new WebSocket(created.ws_url);
      sockets.push(browserSocket);
      await new Promise<void>((resolve) => browserSocket.on('open', () => resolve()));
      browserSocket.send(JSON.stringify({
        type: 'terminal.reconnect',
        terminal_session_id: created.terminal_session_id,
        view: 'agent_task.task_terminal',
        cols: 80,
        rows: 24,
        after_seq: null,
      }));

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const sessionRes = await apiFetchWithToken(
          baseUrl,
          `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${created.terminal_session_id}`,
          'test-token',
        );
        expect(sessionRes.status).toBe(200);
        const payload = await sessionRes.json() as { status: string; close_reason?: string | null; ws_url?: string | null };
        if (payload.status === 'failed') {
          expect(payload.close_reason).toBe('terminal_start_timeout');
          expect(payload.ws_url).toBeNull();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      throw new Error('terminal_start_timeout_not_observed');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('returns 409 when creating a fourth terminal session for the same task owner', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;
      const { taskId, projectId } = await createActiveExternalTaskForTerminal(
        deps,
        baseUrl,
        'Terminal session cap',
        { useDedicatedProject: true },
      );

    for (let index = 0; index < 3; index += 1) {
      const createRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 80 + index, rows: 24 + index }),
        },
      );
      expect(createRes.status).toBe(201);
    }

      const overflow = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 120, rows: 40 }),
        },
      );
      expect(overflow.status).toBe(409);
      expect(await overflow.json()).toMatchObject({
        error_code: 'RESOURCE_CONFLICT',
        message: 'task_terminal_session_limit_reached',
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('marks terminal truth reads as no-store so reload recovery hydrates fresh backend state', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    try {
      const { baseUrl } = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = baseUrl;
      const { taskId, projectId } = await createActiveExternalTaskForTerminal(
        deps,
        baseUrl,
        'Terminal no-store truth',
        { useDedicatedProject: true },
      );

      const createRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 120, rows: 40 }),
        },
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as TerminalSessionResponseForTest;
      expect(created).not.toHaveProperty('session_id');

      const listRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
      );
      expect(listRes.status).toBe(200);
      expect(listRes.headers.get('cache-control')).toBe('no-store');

      const sessionRes = await apiFetchWithToken(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${created.terminal_session_id}`,
        'test-token',
      );
      expect(sessionRes.status).toBe(200);
      expect(sessionRes.headers.get('cache-control')).toBe('no-store');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('reconciles terminal session truth to failed after api terminal-service reload and releases live quota', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    const firstServer = await startServerWithDeps(deps);
    try {
      process.env.PUBLIC_API_BASE_URL = firstServer.baseUrl;
      const { taskId, projectId } = await createActiveExternalTaskForTerminal(
        deps,
        firstServer.baseUrl,
        'Terminal identity survives reload',
        { useDedicatedProject: true },
      );

      const createdIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const createRes = await apiFetchWithToken(
          firstServer.baseUrl,
          `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
          'test-token',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cols: 80 + index, rows: 24 + index }),
          },
        );
        expect(createRes.status).toBe(201);
        const created = await createRes.json() as TerminalSessionResponseForTest;
        expect(created).not.toHaveProperty('session_id');
        createdIds.push(created.terminal_session_id);
      }

      firstServer.server.closeAllConnections?.();
      firstServer.server.closeIdleConnections?.();
      await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));

      deps.notebookTerminalService = new NotebookTerminalService(
        deps.cache,
        deps.agentExecutionService,
      );
      const secondServer = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = secondServer.baseUrl;

      const listAfterReload = await apiFetchWithToken(
        secondServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
      );
      expect(listAfterReload.status).toBe(200);
      await expect(listAfterReload.json()).resolves.toMatchObject({
        total: 3,
        items: createdIds.map((id) => expect.objectContaining({
          terminal_session_id: id,
          status: 'failed',
          close_reason: 'terminal_connection_failed_service_reload',
          ws_url: null,
        })),
      });

      const replacement = await apiFetchWithToken(
        secondServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 120, rows: 40 }),
        },
      );
      expect(replacement.status).toBe(201);
      const replacementBody = await replacement.json() as TerminalSessionResponseForTest;
      expect(replacementBody.terminal_session_id).toMatch(/^term_/);
      expect(replacementBody).not.toHaveProperty('session_id');

      const listAfterReplacement = await apiFetchWithToken(
        secondServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
      );
      expect(listAfterReplacement.status).toBe(200);
      await expect(listAfterReplacement.json()).resolves.toMatchObject({
        total: 4,
        items: [
          ...createdIds.map((id) => expect.objectContaining({
            terminal_session_id: id,
            status: 'failed',
            close_reason: 'terminal_connection_failed_service_reload',
            ws_url: null,
          })),
          expect.objectContaining({
            terminal_session_id: replacementBody.terminal_session_id,
            status: 'pending',
          }),
        ],
      });

      secondServer.server.closeAllConnections?.();
      secondServer.server.closeIdleConnections?.();
      await new Promise<void>((resolve) => secondServer.server.close(() => resolve()));
    } finally {
      if (firstServer.server.listening) {
        firstServer.server.closeAllConnections?.();
        firstServer.server.closeIdleConnections?.();
        await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));
      }
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('releases the internal task workload when api reload reconciles a persisted live terminal session to failed truth', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    const releasePod = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod,
    };
    deps.internalAgentWorkspaceBindingManager = {
      ensureWorkspaceBinding: vi.fn(async (input: {
        workspaceId: string;
        projectId: string;
        fileLibraryId: string;
        taskId: string;
      }) => ({
        binding: {
          id: 'bind_internal_terminal_reload',
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          file_library_id: input.fileLibraryId,
          kind: 'juicefs_volume',
          status: 'ready',
          metadata_url: 'postgres://jfsu_user:secret@localhost:15432/jfs_internal?sslmode=disable',
          storage_bucket_url: 'http://localhost:19000/jfs-internal',
          created_at: '2026-04-05T00:00:00.000Z',
          updated_at: '2026-04-05T00:00:00.000Z',
        },
        workspaceMount: {
          bindingId: 'bind_internal_terminal_reload',
          mountPath: `/workspace/${input.taskId}`,
          fileLibraryId: input.fileLibraryId,
        },
      })),
    } as never;
    const firstServer = await startServerWithDeps(deps);

    try {
      process.env.PUBLIC_API_BASE_URL = `${firstServer.baseUrl}/api/v1`;
      const { taskId } = await createActiveInternalTaskForTerminal(
        deps,
        firstServer.baseUrl,
        'Reloaded internal terminal holder',
      );

      const createTerminalRes = await apiFetchWithToken(
        firstServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 80, rows: 24 }),
        },
      );
      expect(createTerminalRes.status).toBe(201);

      firstServer.server.closeAllConnections?.();
      firstServer.server.closeIdleConnections?.();
      await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));

      deps.notebookTerminalService = new NotebookTerminalService(
        deps.cache,
        deps.agentExecutionService,
      );
      const secondServer = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = `${secondServer.baseUrl}/api/v1`;

      const listAfterReload = await apiFetchWithToken(
        secondServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/terminal/sessions`,
        'test-token',
      );
      expect(listAfterReload.status).toBe(200);
      await expect(listAfterReload.json()).resolves.toMatchObject({
        total: 1,
        items: [
          expect.objectContaining({
            status: 'failed',
            close_reason: 'terminal_connection_failed_service_reload',
            ws_url: null,
          }),
        ],
      });

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (releasePod.mock.calls.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(releasePod).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        sanitizeWorkloadId(taskId),
      );

      secondServer.server.closeAllConnections?.();
      secondServer.server.closeIdleConnections?.();
      await new Promise<void>((resolve) => secondServer.server.close(() => resolve()));
    } finally {
      if (firstServer.server.listening) {
        firstServer.server.closeAllConnections?.();
        firstServer.server.closeIdleConnections?.();
        await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));
      }
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('does not mutate a persisted terminal session when wrong-task terminal routes miss scope after api reload', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    const firstServer = await startServerWithDeps(deps);
    try {
      process.env.PUBLIC_API_BASE_URL = firstServer.baseUrl;
      const ownerTask = await createActiveExternalTaskForTerminal(
        deps,
        firstServer.baseUrl,
        'Scoped terminal owner task',
        { useDedicatedProject: true },
      );
      const otherTask = await createActiveExternalTaskForTerminal(
        deps,
        firstServer.baseUrl,
        'Scoped terminal other task',
        { useDedicatedProject: true },
      );

      const createRes = await apiFetchWithToken(
        firstServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${ownerTask.projectId}/tasks/${ownerTask.taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 80, rows: 24 }),
        },
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as TerminalSessionResponseForTest;
      expect(created).not.toHaveProperty('session_id');

      firstServer.server.closeAllConnections?.();
      firstServer.server.closeIdleConnections?.();
      await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));

      deps.notebookTerminalService = new NotebookTerminalService(
        deps.cache,
        deps.agentExecutionService,
      );
      const secondServer = await startServerWithDeps(deps);
      process.env.PUBLIC_API_BASE_URL = secondServer.baseUrl;

      const sessionCacheKey = `notebook_terminal_session:${created.terminal_session_id}`;
      const wrongTaskPath = `/api/v1/workspaces/ws_default/projects/${otherTask.projectId}/tasks/${otherTask.taskId}/terminal/sessions/${created.terminal_session_id}`;

      const wrongTaskGet = await apiFetchWithToken(
        secondServer.baseUrl,
        wrongTaskPath,
        'test-token',
      );
      expect(wrongTaskGet.status).toBe(404);
      await expect(deps.cache.get(sessionCacheKey)).resolves.toEqual(
        expect.stringContaining('"status":"pending"'),
      );

      const wrongTaskDelete = await apiFetchWithToken(
        secondServer.baseUrl,
        wrongTaskPath,
        'test-token',
        { method: 'DELETE' },
      );
      expect(wrongTaskDelete.status).toBe(404);
      await expect(deps.cache.get(sessionCacheKey)).resolves.toEqual(
        expect.stringContaining('"status":"pending"'),
      );

      const correctTaskGet = await apiFetchWithToken(
        secondServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${ownerTask.projectId}/tasks/${ownerTask.taskId}/terminal/sessions/${created.terminal_session_id}`,
        'test-token',
      );
      expect(correctTaskGet.status).toBe(200);
      await expect(correctTaskGet.json()).resolves.toMatchObject({
        terminal_session_id: created.terminal_session_id,
        status: 'failed',
        close_reason: 'terminal_connection_failed_service_reload',
        ws_url: null,
      });

      secondServer.server.closeAllConnections?.();
      secondServer.server.closeIdleConnections?.();
      await new Promise<void>((resolve) => secondServer.server.close(() => resolve()));
    } finally {
      if (firstServer.server.listening) {
        firstServer.server.closeAllConnections?.();
        firstServer.server.closeIdleConnections?.();
        await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));
      }
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('keeps failed terminal history visible without blocking notebook work, and still lets a reloaded api clear it', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.notebookTerminalService = new NotebookTerminalService(
      deps.cache,
      deps.agentExecutionService,
      { startupTimeoutMs: 50 },
    );
      const firstServer = await startServerWithDeps(deps);
      try {
        process.env.PUBLIC_API_BASE_URL = firstServer.baseUrl;
      const project = await deps.createProjectUseCase.execute({
        workspaceId: 'ws_default',
        actorId: 'user_test',
        input: {
          name: 'Reloaded failed terminal cleanup project',
          visibility: 'private',
          join_policy: 'approval_required',
        },
      });
      const projectId = project.id;
      const { taskId, agentId } = await createActiveExternalTaskForTerminal(deps, firstServer.baseUrl, 'Reloaded failed terminal cleanup', { projectId });
      const agent = await deps.agentResourceService.getAgent('ws_default', projectId, agentId);
      expect(agent).toBeTruthy();

      const keyRes = await apiFetch(
        firstServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners/${agent!.id}/keys`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'reloaded-failed-terminal-runner' }),
        },
      );
      expect(keyRes.status).toBe(201);
      const keyPayload = await keyRes.json() as { agent_runner_id: string; key: string };
      expect(keyPayload.agent_runner_id).toBe(agent!.id);

      const connInfoRes = await apiFetch(
        firstServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/agent-runners/${agent!.id}/connection-info`,
      );
      expect(connInfoRes.status).toBe(200);
      const connInfo = await connInfoRes.json() as { agent_runner_id: string; ws_url: string };
      expect(connInfo.agent_runner_id).toBe(agent!.id);

      const executionSocket = new WebSocket(
        `${connInfo.ws_url.replace('ws://localhost:20000', firstServer.baseUrl.replace('http://', 'ws://'))}&runner_session_id=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${keyPayload.key}` } },
      );
      sockets.push(executionSocket);
      await new Promise<void>((resolve) => {
        executionSocket.on('message', (raw) => {
          const msg = JSON.parse(raw.toString('utf-8')) as { type?: string };
          if (msg.type !== 'server.hello') return;
          executionSocket.send(JSON.stringify({
            type: 'agent.ready',
            payload: {
              runner_spec: AGENT_TASK_RUNNER_SPEC,
              capabilities: { wire_api: 'responses' },
            },
          }));
          resolve();
        });
      });

      const createTerminalRes = await apiFetchWithToken(
        firstServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions`,
        'test-token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: 80, rows: 24 }),
        },
      );
      expect(createTerminalRes.status).toBe(201);
      const created = await createTerminalRes.json() as TerminalSessionResponseForTest & { ws_url: string };
      expect(created).not.toHaveProperty('session_id');

      const browserSocket = new WebSocket(created.ws_url);
      sockets.push(browserSocket);
      await new Promise<void>((resolve) => browserSocket.on('open', () => resolve()));
      browserSocket.send(JSON.stringify({
        type: 'terminal.reconnect',
        terminal_session_id: created.terminal_session_id,
        view: 'agent_task.task_terminal',
        cols: 80,
        rows: 24,
        after_seq: null,
      }));

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const sessionRes = await apiFetchWithToken(
          firstServer.baseUrl,
          `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${created.terminal_session_id}`,
          'test-token',
        );
        expect(sessionRes.status).toBe(200);
        const payload = await sessionRes.json() as { status: string };
        if (payload.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      deps.notebookTerminalService = new NotebookTerminalService(
        deps.cache,
        deps.agentExecutionService,
        { startupTimeoutMs: 50 },
      );

      const failedSessionRes = await apiFetchWithToken(
        firstServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${created.terminal_session_id}`,
        'test-token',
      );
      expect(failedSessionRes.status).toBe(200);
      await expect(failedSessionRes.json()).resolves.toMatchObject({
        terminal_session_id: created.terminal_session_id,
        status: 'failed',
        close_reason: 'terminal_start_timeout',
        ws_url: null,
      });
      await createDefaultManagedTaskRunner(deps, 'failed-terminal-follow-up-runner', { projectId });
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_failed_terminal_follow_up',
        cancel: () => undefined,
        stream: (async function* stream() {
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      }));

      const sendMessageRes = await apiFetchWithToken(
        firstServer.baseUrl,
        taskRunsPath('ws_default', projectId, taskId),
        'test-token',
        taskRunInit('Please resume the notebook after terminal recovery.'),
      );
      expect(sendMessageRes.status).toBe(200);

      const deleteFailedSession = await apiFetchWithToken(
        firstServer.baseUrl,
        `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/terminal/sessions/${created.terminal_session_id}`,
        'test-token',
        { method: 'DELETE' },
      );
      expect(deleteFailedSession.status).toBe(204);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });
});
