import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import { assertTaskExecutionContext } from '@mbos/agent-runner';

import {
  __resetInternalTerminalWorkloadLifecycleForTests,
  handleTaskRoute,
  hasBlockingTerminalSessionsForTask,
  hasBlockingTaskRunForTerminal,
  resolveTerminalWebSocketBaseUrl,
  resolveTaskWorkspaceMountAccess,
} from './task-route-handler.js';
import { createDefaultNodeApiDeps } from './index.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import { NotebookTerminalService } from './notebook-terminal-service.js';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  getNotebookTaskRunState,
  getNotebookTaskRunHardTeardownDebt,
  markNotebookTaskRunHardTeardownFailed,
  refreshNotebookTaskRunLease,
} from './notebook-task/task-run-coordination.js';
import { buildTaskRealtimeView } from './notebook-task/task-realtime-view.js';
import { listAuditEvents } from './audit-usage-store.js';
import { clearNotebookTaskEventState, emitNotebookTaskEvent } from './notebook-task-sse-broker.js';
import {
  ACTIVE_RUNS_BY_TASK,
  ACTIVE_RUN_CANCEL_BY_TASK,
  ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK,
  ARTIFACTS_BY_TASK,
  getTaskMessages,
  getTasks,
  TASKS_BY_PROJECT,
} from './notebook-task/task-runtime-state.js';
import {
  notebookTaskArtifactsCollection,
  notebookTaskMessagesCollection,
  notebookTasksCollection,
} from './notebook-task/task-store.js';
import {
  storeTaskTraceEvent,
  type TaskTraceEventRecord,
} from './notebook-trace-store.js';
import { resolveInternalTicket } from './internal-ticket-store.js';
import {
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from './project-member-governance-persistence.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';
import { AgentTaskModelSettingService } from './agent-task-model-setting-service.js';

const { createFileLibraryGatewayClientMock } = vi.hoisted(() => ({
  createFileLibraryGatewayClientMock: vi.fn(),
}));

vi.mock('./file-library-gateway-client.js', async () => {
  const actual = await vi.importActual<typeof import('./file-library-gateway-client.js')>('./file-library-gateway-client.js');
  return {
    ...actual,
    createFileLibraryGatewayClient: createFileLibraryGatewayClientMock,
  };
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe('task-route-handler workspace access', () => {
  let previousManagedExecutionHttpBase: string | undefined;

  beforeEach(() => {
    previousManagedExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.AGENT_EXECUTION_HTTP_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    ACTIVE_RUNS_BY_TASK.clear();
    ACTIVE_RUN_CANCEL_BY_TASK.clear();
    ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.clear();
    ARTIFACTS_BY_TASK.clear();
    TASKS_BY_PROJECT.clear();
    createFileLibraryGatewayClientMock.mockReset();
    __resetInternalTerminalWorkloadLifecycleForTests();
  });

  afterEach(() => {
    if (previousManagedExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    else process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousManagedExecutionHttpBase;
  });

  function readContentDispositionHeader(
    setHeader: ReturnType<typeof vi.fn>,
  ): { raw: string; fallback: string | null } {
    const match = setHeader.mock.calls.find(([name]) => name === 'Content-Disposition');
    const raw = match ? String(match[1]) : '';
    const fallbackMatch = raw.match(/filename="([^"]+)"/);
    return {
      raw,
      fallback: fallbackMatch?.[1] ?? null,
    };
  }

  async function createRunnerBindingOptionsProject(
    permissions: string[],
  ): Promise<{
    deps: ReturnType<typeof createDefaultNodeApiDeps>;
    projectId: string;
    userId: string;
  }> {
    const deps = createDefaultNodeApiDeps();
    const userId = 'user_binding_options';
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'owner_binding_options',
      input: {
        name: `Runner binding options ${Math.random().toString(36).slice(2)}`,
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    await upsertProjectMembershipRecord(deps.docStore, 'ws_default', project.id, {
      project_id: project.id,
      user_id: userId,
      user_email: 'binding-options@example.com',
      user_name: 'Binding Options User',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await upsertProjectMemberPermissionState(deps.docStore, 'ws_default', project.id, userId, {
      mode: 'custom',
      template: null,
      permissions,
    });
    return { deps, projectId: project.id, userId };
  }

  async function createRunnerBindingEndpoint(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    projectId = 'proj_1',
  ) {
    const credential = await deps.endpointResourceService.createCredential('ws_default', projectId, {
      name: `runner-binding-${projectId}-key`,
      value: 'sk-runner-binding',
    });
    return deps.endpointResourceService.createEndpoint('ws_default', projectId, {
      name: 'runner binding options endpoint',
      model: 'gpt-5-codex',
      type: 'custom',
      base_url: 'https://example.com/v1',
      credential_ref: credential.id,
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
  }

  async function seedAgentTaskModelSetting(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    projectId: string,
    endpointId: string,
    actorUserId = 'project_owner_for_permissions_test',
  ): Promise<void> {
    const endpoint = await deps.endpointResourceService.getEndpoint('ws_default', projectId, endpointId);
    const credentialSecret = endpoint?.credential_ref
      ? await deps.endpointResourceService.getCredentialSecret('ws_default', projectId, endpoint.credential_ref)
      : null;
    if (endpoint && !credentialSecret) {
      const credential = await deps.endpointResourceService.createCredential('ws_default', projectId, {
        name: `agent-task-model-${projectId}-key`,
        value: 'sk-agent-task-model',
      });
      await deps.endpointResourceService.updateEndpoint('ws_default', projectId, endpointId, {
        credential_ref: credential.id,
      });
    }
    await new AgentTaskModelSettingService(deps).patchSetting({
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      expectedSettingRevision: null,
      actorUserId,
    });
  }

  async function seedDefaultManagedRunner(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    projectId = 'proj_1',
  ) {
    const endpoint = await createRunnerBindingEndpoint(deps, projectId);
    const runner = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner('ws_default', projectId, {
      name: 'Default managed task runner',
      endpointId: endpoint.id,
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: true,
        file_inputs: true,
      },
    } as never);
    await seedAgentTaskModelSetting(deps, projectId, endpoint.id);
    return { endpoint, runner };
  }

  async function grantProjectPermissionsForUser(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    userId: string,
    permissions: string[],
    projectId = 'proj_1',
  ): Promise<void> {
    const originalGetProject = deps.getProjectUseCase.execute.bind(deps.getProjectUseCase);
    deps.getProjectUseCase.execute = vi.fn(async (input: { workspaceId: string; projectId: string }) => {
      try {
        return await originalGetProject(input);
      } catch {
        if (input.workspaceId !== 'ws_default' || input.projectId !== projectId) throw new Error('project_not_found');
        return {
          id: projectId,
          workspace_id: 'ws_default',
          name: projectId,
          owner_id: 'project_owner_for_permissions_test',
          governance_json: null,
        } as never;
      }
    }) as never;
    await upsertProjectMembershipRecord(deps.docStore, 'ws_default', projectId, {
      project_id: projectId,
      user_id: userId,
      user_email: `${userId}@example.com`,
      user_name: userId,
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await upsertProjectMemberPermissionState(deps.docStore, 'ws_default', projectId, userId, {
      mode: 'custom',
      template: null,
      permissions,
    });
  }

  it('binds omitted runner selection to the deployment default managed projection, not project default rows', async () => {
    const deps = createDefaultNodeApiDeps();
    const endpoint = await createRunnerBindingEndpoint(deps);
    const staleEndpoint = await createRunnerBindingEndpoint(deps);
    const staleProjectDefault = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'Stale project default row',
      runner_provider: 'managed',
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      is_default: true,
      default_endpoint_id: staleEndpoint.id,
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: true,
        file_inputs: true,
      },
    } as never);
    const projection = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
      name: 'Deployment default managed projection',
      endpointId: endpoint.id,
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      is_default: false,
      default_endpoint_id: 'stale_project_field_must_not_drive_resolution',
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: true,
        file_inputs: true,
      },
    } as never);
    await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
    expect(projection.id).not.toBe(staleProjectDefault.id);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'tasks',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({
        title: 'Deployment projection bound task',
      })),
    })).resolves.toBe(true);

    expect(json.mock.calls[0]?.[1]).toBe(201);
    expect(json.mock.calls[0]?.[2]).toMatchObject({
      bound_runner_id: projection.id,
      bound_runner_kind: 'managed',
      runner_binding_source: 'default_managed',
    });
    expect(json.mock.calls[0]?.[2]).not.toMatchObject({
      bound_runner_id: staleProjectDefault.id,
    });
  });

  async function readRunnerBindingOptions(input: {
    deps: ReturnType<typeof createDefaultNodeApiDeps>;
    projectId: string;
    userId: string;
  }) {
    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskRunnerBindingOptions',
        workspaceId: 'ws_default',
        projectId: input.projectId,
      } as never,
      method: 'GET',
      req: {
        headers: {},
        url: `/api/v1/workspaces/ws_default/projects/${input.projectId}/tasks/runner-binding-options`,
      } as never,
      res: { setHeader: vi.fn() } as never,
      deps: input.deps,
      user: { id: input.userId, email: 'binding-options@example.com' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    expect(json.mock.calls[0]?.[1]).toBe(200);
    return json.mock.calls[0]?.[2] as {
      options: Array<Record<string, unknown>>;
    };
  }

  it('keeps local mount access untouched when no runner provider is selected', () => {
    const resolved = resolveTaskWorkspaceMountAccess({
      runnerProvider: null,
      metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
    });

    expect(resolved).toEqual({
      metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
      storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
    });
  });

  it('creates an agent task without requiring agent_id', async () => {
    const deps = createDefaultNodeApiDeps();
    const { runner } = await seedDefaultManagedRunner(deps);
    const json = vi.fn();

    await expect(handleTaskRoute({
      route: {
        kind: 'tasks',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({
        title: 'Runnerless task',
        prompt: 'Summarize the release notes',
      })),
    })).resolves.toBe(true);

    const body = json.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(json.mock.calls[0]?.[1]).toBe(201);
    expect(body).toMatchObject({
      title: 'Runnerless task',
      prompt: 'Summarize the release notes',
      lifecycle_status: 'active',
      bound_runner_id: runner.id,
      bound_runner_kind: 'managed',
      runner_binding_source: 'default_managed',
      bound_by_user_id: 'user_1',
    });
    expect(body).not.toHaveProperty('agent_id');
  });

  it('fails managed task run before accepting it when sandbox runtime or internal API base is unavailable', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const previousInternalApiBase = process.env.INTERNAL_API_BASE_URL;
    const previousExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    const previousExecutionWsBase = process.env.AGENT_EXECUTION_WS_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000/api/v1';
    delete process.env.INTERNAL_API_BASE_URL;
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    delete process.env.AGENT_EXECUTION_WS_BASE_URL;

    const deps = createDefaultNodeApiDeps();
    await seedDefaultManagedRunner(deps);
    deps.internalAgentPodManager = undefined;
    deps.internalAgentWorkspaceBindingManager = undefined;
    deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_should_not_dispatch_without_managed_runtime',
      cancel: vi.fn(),
      stream: (async function* () {})(),
    })) as never;

    try {
      const createJson = vi.fn();
      await expect(handleTaskRoute({
        route: { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: createJson,
        readBody: vi.fn(async () => ({
          title: 'Managed runtime preflight task',
          prompt: 'Do not accept this run without sandbox runtime',
        })),
      })).resolves.toBe(true);
      const createdTask = createJson.mock.calls[0]?.[2] as { id: string };

      const runJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskRuns',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: createdTask.id,
        } as never,
        method: 'POST',
        req: { headers: { 'x-request-id': 'req_managed_preflight' }, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: runJson,
        readBody: vi.fn(async () => ({
          intent: 'Start work',
        })),
      })).resolves.toBe(true);

      expect(runJson).toHaveBeenCalledWith(
        expect.anything(),
        409,
        {
          error_code: 'agent_runner_runtime_unavailable',
          message: 'agent_runner_runtime_unavailable',
        },
      );
      expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalled();
      expect(ACTIVE_RUNS_BY_TASK.has(createdTask.id)).toBe(false);
      expect(getTaskMessages(createdTask.id)).toHaveLength(0);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      if (previousInternalApiBase === undefined) delete process.env.INTERNAL_API_BASE_URL;
      else process.env.INTERNAL_API_BASE_URL = previousInternalApiBase;
      if (previousExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousExecutionHttpBase;
      if (previousExecutionWsBase === undefined) delete process.env.AGENT_EXECUTION_WS_BASE_URL;
      else process.env.AGENT_EXECUTION_WS_BASE_URL = previousExecutionWsBase;
    }
  });

  it.each(['agent_id', 'agent_name', 'runner_id', 'runner_selection', 'is_default', 'default_endpoint_id', 'config', 'capabilities', 'runner_provider'])(
    'rejects legacy selector field %s on task create',
    async (field) => {
      const deps = createDefaultNodeApiDeps();
      const json = vi.fn();

      await expect(handleTaskRoute({
        route: {
          kind: 'tasks',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json,
        readBody: vi.fn(async () => ({
          title: 'Legacy selector task',
          [field]: 'legacy-selector',
        })),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(
        expect.anything(),
        400,
        {
          error_code: 'unsupported_field',
          message: 'unsupported_field',
          fields: [field],
        },
      );
      expect(getTasks('ws_default', 'proj_1')).toHaveLength(0);
    },
  );

  it.each(['role', 'content', 'agent_id', 'agent_name', 'runner_id', 'runner_selection', 'bound_runner_id', 'agent_runner_id', 'is_default', 'default_endpoint_id', 'config'])(
    'rejects legacy selector field %s on task run dispatch payload',
    async (field) => {
      const deps = createDefaultNodeApiDeps();
      await seedDefaultManagedRunner(deps);
      const createJson = vi.fn();

      await expect(handleTaskRoute({
        route: { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json: createJson,
        readBody: vi.fn(async () => ({
          title: 'Runnerless task',
          prompt: 'Created without a runner selector',
        })),
      })).resolves.toBe(true);
      const createdTask = createJson.mock.calls[0]?.[2] as { id: string };

      const runJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskRuns',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: createdTask.id,
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: runJson,
        readBody: vi.fn(async () => ({
          intent: 'Run now',
          [field]: 'legacy-selector',
        })),
      })).resolves.toBe(true);

      expect(runJson).toHaveBeenCalledWith(
        expect.anything(),
        400,
        {
          error_code: 'unsupported_field',
          message: 'unsupported_field',
          fields: [field],
        },
      );
      expect(ACTIVE_RUNS_BY_TASK.has(createdTask.id)).toBe(false);
    },
  );

  it('dispatches the task bound Developer runner instead of the current default', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const deps = createDefaultNodeApiDeps();
    try {
      const project = await deps.createProjectUseCase.execute({
        workspaceId: 'ws_default',
        actorId: 'owner_1',
        input: {
          name: 'Explicit runner selection project',
          visibility: 'private',
          join_policy: 'approval_required',
        },
      });
      const projectId = project.id;
      await upsertProjectMembershipRecord(deps.docStore, 'ws_default', projectId, {
        project_id: projectId,
        user_id: 'user_1',
        user_email: 'user_1@example.com',
        user_name: 'User One',
        status: 'active',
        joined_at: new Date().toISOString(),
      });
      await upsertProjectMemberPermissionState(
        deps.docStore,
        'ws_default',
        projectId,
        'user_1',
        {
          mode: 'custom',
          template: null,
          permissions: ['project:agent_task:use', 'project:agent_runner:manage'],
        },
      );
      deps.internalAgentPodManager = {
        ensureAgentReady: vi.fn(async () => undefined),
        keepalive: vi.fn(async () => undefined),
        releasePod: vi.fn(async () => undefined),
      };
      deps.internalAgentWorkspaceBindingManager = {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            mountPath: '/workspace/task',
            metadataUrl: 'postgres://jfsu_user:secret@postgres:5432/jfs_lib_demo?sslmode=disable',
            storageBucketUrl: 'http://minio:9000/jfs-lib-demo',
          },
        })),
      } as never;
      const credential = await deps.endpointResourceService.createCredential('ws_default', projectId, {
        name: 'explicit-runner-key',
        value: 'sk-explicit-runner',
      });
      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', projectId, {
        name: 'explicit runner endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        credential_ref: credential.id,
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
      await seedAgentTaskModelSetting(deps, projectId, endpoint.id, 'user_1');
      const defaultRunner = await deps.agentResourceService.createAgent('ws_default', projectId, {
        name: 'Default task runner',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          terminal: true,
          artifacts: true,
        },
      } as never);
      const boundDeveloperRunner = await deps.agentResourceService.createAgent('ws_default', projectId, {
        name: 'Bound Developer task runner',
        runner_provider: 'developer',
        status: 'enabled',
        presence: 'online',
        runner_status: 'ready',
        is_default: false,
        default_endpoint_id: endpoint.id,
        capabilities: {
          terminal: true,
          artifacts: true,
        },
      } as never);
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_explicit_runner_dispatch',
        cancel: vi.fn(),
        stream: (async function* () {
          await new Promise<void>(() => undefined);
        })(),
      })) as never;

      const createJson = vi.fn();
      await expect(handleTaskRoute({
        route: { kind: 'tasks', workspaceId: 'ws_default', projectId } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json: createJson,
        readBody: vi.fn(async () => ({
          title: 'Dispatch through selected runner',
          prompt: 'Do the thing',
          bound_runner_id: boundDeveloperRunner.id,
        })),
      })).resolves.toBe(true);
      const createdTask = createJson.mock.calls[0]?.[2] as { id: string };
      expect(createdTask).toMatchObject({
        bound_runner_id: boundDeveloperRunner.id,
        bound_runner_kind: 'developer',
        runner_binding_source: 'explicit',
      });

      const runJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskRuns',
          workspaceId: 'ws_default',
          projectId,
          taskId: createdTask.id,
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: runJson,
        readBody: vi.fn(async () => ({
          intent: 'Run now',
        })),
      })).resolves.toBe(true);

      await vi.waitFor(() => {
        expect(deps.agentExecutionService.dispatchStreamingRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: boundDeveloperRunner.id,
          }),
        );
      });
      expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: defaultRunner.id,
        }),
      );
      await expect(buildTaskRealtimeView(
        deps,
        'ws_default',
        projectId,
        (await deps.docStore.get(notebookTasksCollection('ws_default'), createdTask.id)) as never,
      )).resolves.toMatchObject({
        id: createdTask.id,
        active_run: {
          runner_id: boundDeveloperRunner.id,
          status: 'running',
        },
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('fails closed when explicit bound_runner_id is stale and leaves no task selector pollution', async () => {
    const deps = createDefaultNodeApiDeps();
    await seedDefaultManagedRunner(deps);
    deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_should_not_dispatch',
      cancel: vi.fn(),
      stream: (async function* () {})(),
    })) as never;

    const createJson = vi.fn();
    await expect(handleTaskRoute({
      route: { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
      method: 'POST',
      req: { headers: { 'x-request-id': 'req_stale_binding' }, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: createJson,
      readBody: vi.fn(async () => ({
        title: 'Stale selection task',
        prompt: 'Should not fall back to default',
        bound_runner_id: 'runner_missing_stale',
      })),
    })).resolves.toBe(true);

    expect(createJson).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'agent_runner_unavailable',
        message: 'agent_runner_unavailable',
      },
    );
    expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalled();
    expect(getTasks('ws_default', 'proj_1')).toHaveLength(0);
  });

  it('rejects explicit managed runner ids instead of treating them as Developer bindings', async () => {
    const deps = createDefaultNodeApiDeps();
    const { runner } = await seedDefaultManagedRunner(deps);
    const json = vi.fn();

    await expect(handleTaskRoute({
      route: { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
      method: 'POST',
      req: { headers: { 'x-request-id': 'req_explicit_managed_binding' }, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({
        title: 'Explicit managed selection is invalid',
        bound_runner_id: runner.id,
      })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'invalid_binding_target',
        message: 'invalid_binding_target',
      },
    );
    expect(getTasks('ws_default', 'proj_1')).toHaveLength(0);
  });

  it('requires Agent task use and Agent Runner manage authority for explicit Developer runner binding', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'owner_binding_auth',
      input: {
        name: 'Explicit Developer binding auth project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    await upsertProjectMembershipRecord(deps.docStore, 'ws_default', project.id, {
      project_id: project.id,
      user_id: 'user_task_only',
      user_email: 'task-only@example.com',
      user_name: 'Task Only',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await upsertProjectMemberPermissionState(deps.docStore, 'ws_default', project.id, 'user_task_only', {
      mode: 'custom',
      template: null,
      permissions: ['project:agent_task:use'],
    });
    const endpoint = await createRunnerBindingEndpoint(deps, project.id);
    await seedAgentTaskModelSetting(deps, project.id, endpoint.id, 'user_task_only');
    await deps.agentResourceService.createAgent('ws_default', project.id, {
      name: 'Default managed runner',
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      is_default: true,
      default_endpoint_id: endpoint.id,
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: true,
      },
    } as never);
    const developerRunner = await deps.agentResourceService.createAgent('ws_default', project.id, {
      name: 'Explicit Developer runner',
      runner_provider: 'developer',
      status: 'enabled',
      presence: 'online',
      runner_status: 'ready',
      is_default: false,
      default_endpoint_id: endpoint.id,
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: true,
      },
    } as never);

    const deniedJson = vi.fn();
    await expect(handleTaskRoute({
      route: { kind: 'tasks', workspaceId: 'ws_default', projectId: project.id } as never,
      method: 'POST',
      req: { headers: { 'x-request-id': 'req_binding_auth_denied' }, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_task_only', email: 'task-only@example.com' } as never,
      json: deniedJson,
      readBody: vi.fn(async () => ({
        title: 'Denied Developer binding task',
        bound_runner_id: developerRunner.id,
      })),
    })).resolves.toBe(true);

    expect(deniedJson).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'agent_runner_forbidden',
        message: 'agent_runner_forbidden',
      },
    );

    await upsertProjectMemberPermissionState(deps.docStore, 'ws_default', project.id, 'user_task_only', {
      mode: 'custom',
      template: null,
      permissions: ['project:agent_task:use', 'project:agent_runner:manage'],
    });
    const allowedJson = vi.fn();
    await expect(handleTaskRoute({
      route: { kind: 'tasks', workspaceId: 'ws_default', projectId: project.id } as never,
      method: 'POST',
      req: { headers: { 'x-request-id': 'req_binding_auth_allowed' }, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_task_only', email: 'task-only@example.com' } as never,
      json: allowedJson,
      readBody: vi.fn(async () => ({
        title: 'Allowed Developer binding task',
        bound_runner_id: developerRunner.id,
      })),
    })).resolves.toBe(true);

    expect(allowedJson.mock.calls[0]?.[1]).toBe(201);
    expect(allowedJson.mock.calls[0]?.[2]).toMatchObject({
      title: 'Allowed Developer binding task',
      bound_runner_id: developerRunner.id,
      bound_runner_kind: 'developer',
      runner_binding_source: 'explicit',
      bound_by_user_id: 'user_task_only',
    });
  });

  it('returns only the display-safe default managed binding option to task-use-only callers', async () => {
    const { deps, projectId, userId } = await createRunnerBindingOptionsProject([
      'project:agent_task:use',
    ]);
    const endpoint = await createRunnerBindingEndpoint(deps, projectId);
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1234);
    try {
      vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
      const defaultRunner = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner('ws_default', projectId, {
        name: 'Confidential default runner name',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        endpointId: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
      } as never);
      const hiddenDeveloperRunner = await deps.agentResourceService.createAgent('ws_default', projectId, {
        name: 'Hidden Developer runner name',
        runner_provider: 'developer',
        status: 'enabled',
        presence: 'online',
        runner_status: 'ready',
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
      } as never);

      const options = await readRunnerBindingOptions({ deps, projectId, userId });

      expect(options).toMatchObject({
        options: [
          {
            option_id: 'default_managed',
            label: 'Default managed runner',
            bound_runner_kind: 'managed',
            runner_binding_source: 'default_managed',
            readiness: {
              state: 'ready',
              summary: 'ready',
            },
            capability: {
              state: 'compatible',
              summary: 'compatible',
            },
            actions: {
              bind_to_task: {
                operation: 'bind_to_task',
                visible: true,
                allowed: true,
                required_permissions: ['project:agent_task:use'],
                danger_level: 'none',
              },
            },
          },
        ],
      });
      expect(options.options[0]).not.toHaveProperty('agent_runner_id');
      const serialized = JSON.stringify(options);
      expect(serialized).not.toContain(defaultRunner.id);
      expect(serialized).not.toContain(defaultRunner.name);
      expect(serialized).not.toContain(hiddenDeveloperRunner.id);
      expect(serialized).not.toContain(hiddenDeveloperRunner.name);
      expect(serialized).not.toContain('default_endpoint_id');
      expect(serialized).not.toContain('diagnostics');
      expect(serialized).not.toContain('config');
      expect(serialized).not.toContain('_internal_raw_key');
      expect(serialized).not.toContain('select_for_task');
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('returns expert Developer binding rows from backend row-level validation without full Agent Runner records', async () => {
    const { deps, projectId, userId } = await createRunnerBindingOptionsProject([
      'project:agent_task:use',
      'project:agent_runner:manage',
    ]);
    const endpoint = await createRunnerBindingEndpoint(deps, projectId);
    await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner('ws_default', projectId, {
      name: 'Default safe runner',
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      endpointId: endpoint.id,
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: true,
      },
    } as never);
    await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Managed non-default runner that must not be a binding option',
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      is_default: false,
      default_endpoint_id: endpoint.id,
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: true,
      },
    } as never);
    const incompatibleDeveloperRunner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Developer disabled runner',
      runner_provider: 'developer',
      status: 'enabled',
      presence: 'online',
      runner_status: 'ready',
      default_endpoint_id: endpoint.id,
      capabilities: {
        task_execution: false,
        terminal: true,
        artifacts: true,
      },
    } as never);
    const developerRunner = await deps.agentResourceService.createAgent('ws_default', projectId, {
      name: 'Developer selectable runner',
      runner_provider: 'developer',
      status: 'enabled',
      presence: 'online',
      runner_status: 'ready',
      default_endpoint_id: endpoint.id,
      capabilities: {
        task_execution: true,
        terminal: true,
        artifacts: true,
      },
    } as never);
    await deps.agentResourceService.registerAgentConnection({
      agentId: developerRunner.id,
      workspaceId: 'ws_default',
      projectId,
      connectionId: `conn_${developerRunner.id}`,
      socketKey: developerRunner.id,
      apiInstanceId: 'api_test',
      protocolVersion: '1.0',
      lastPongAt: '2026-05-05T00:00:00.000Z',
    });

    const options = await readRunnerBindingOptions({ deps, projectId, userId });

    expect(options.options).toHaveLength(3);
    expect(options.options.find((item) => item.option_id === 'default_managed')).toMatchObject({
      option_id: 'default_managed',
      label: 'Default managed runner',
      bound_runner_kind: 'managed',
      runner_binding_source: 'default_managed',
      actions: {
        bind_to_task: {
          allowed: true,
          required_permissions: ['project:agent_task:use'],
        },
      },
    });
    expect(options.options.find((item) => item.option_id === incompatibleDeveloperRunner.id)).toMatchObject({
      option_id: incompatibleDeveloperRunner.id,
      agent_runner_id: incompatibleDeveloperRunner.id,
      label: 'Developer disabled runner',
      bound_runner_kind: 'developer',
      runner_binding_source: 'explicit',
      disabled_reason_code: 'agent_runner_capability_mismatch',
      actions: {
        bind_to_task: {
          allowed: false,
          reason_code: 'agent_runner_capability_mismatch',
          required_permissions: ['project:agent_task:use', 'project:agent_runner:manage'],
        },
      },
    });
    expect(options.options.find((item) => item.option_id === developerRunner.id)).toMatchObject({
      option_id: developerRunner.id,
      agent_runner_id: developerRunner.id,
      label: 'Developer selectable runner',
      bound_runner_kind: 'developer',
      runner_binding_source: 'explicit',
      freshness: {
        state: 'fresh',
        summary: 'fresh',
      },
      actions: {
        bind_to_task: {
          allowed: true,
          required_permissions: ['project:agent_task:use', 'project:agent_runner:manage'],
        },
      },
    });
    const serialized = JSON.stringify(options);
    expect(serialized).not.toContain('Managed non-default runner that must not be a binding option');
    expect(serialized).not.toContain('default_endpoint_id');
    expect(serialized).not.toContain('diagnostics');
    expect(serialized).not.toContain('config');
    expect(serialized).not.toContain('_internal_raw_key');
    expect(serialized).not.toContain('select_for_task');
  });

  it('returns task activity without exposing message roles or agent actor vocabulary', async () => {
    const deps = createDefaultNodeApiDeps();
    const now = '2026-03-06T04:00:00.000Z';
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_public_activity', {
      id: 'task_public_activity',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Public activity task',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await deps.docStore.upsert(notebookTaskMessagesCollection('ws_default'), 'msg_public_user', {
      id: 'msg_public_user',
      task_id: 'task_public_activity',
      role: 'user',
      content: 'Please inspect the report',
      created_at: now,
    });
    await deps.docStore.upsert(notebookTaskMessagesCollection('ws_default'), 'msg_public_runner', {
      id: 'msg_public_runner',
      task_id: 'task_public_activity',
      role: 'agent',
      content: 'The report is complete',
      created_at: '2026-03-06T04:00:01.000Z',
      turn_id: 'run_public_activity',
    });

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskActivity',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_public_activity',
      } as never,
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      200,
      [
        {
          id: 'msg_public_user',
          task_id: 'task_public_activity',
          kind: 'user_intent',
          actor: 'user',
          content: 'Please inspect the report',
          created_at: now,
        },
        {
          id: 'msg_public_runner',
          task_id: 'task_public_activity',
          kind: 'runner_output',
          actor: 'runner',
          content: 'The report is complete',
          created_at: '2026-03-06T04:00:01.000Z',
          run_id: 'run_public_activity',
        },
      ],
    );
    const responseBody = json.mock.calls[0]?.[2] as unknown;
    expect(JSON.stringify(responseBody)).not.toContain('"role"');
    expect(JSON.stringify(responseBody)).not.toContain('"agent"');
  });

  it.each(['role', 'content', 'agent_id', 'agent_name', 'runner_id'])(
    'rejects unsupported public run field %s on task run dispatch',
    async (field) => {
      const deps = createDefaultNodeApiDeps();
      const now = new Date().toISOString();
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_public_run_reject', {
        id: 'task_public_run_reject',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Public run reject task',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      });

      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskRuns',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_public_run_reject',
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json,
        readBody: vi.fn(async () => ({
          intent: 'Run the task',
          [field]: 'legacy-message-shape',
        })),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(
        expect.anything(),
        400,
        {
          error_code: 'unsupported_field',
          message: 'unsupported_field',
          fields: [field],
        },
      );
      expect(ACTIVE_RUNS_BY_TASK.has('task_public_run_reject')).toBe(false);
    },
  );

  it.each(['agent_id', 'agent_name', 'runner_id'])(
    'rejects legacy selector field %s on task patch',
    async (field) => {
      const deps = createDefaultNodeApiDeps();
      const now = new Date().toISOString();
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_patch_legacy_selector', {
        id: 'task_patch_legacy_selector',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Patch legacy selector task',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      });
      const json = vi.fn();

      await expect(handleTaskRoute({
        route: {
          kind: 'taskItem',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_patch_legacy_selector',
        } as never,
        method: 'PATCH',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json,
        readBody: vi.fn(async () => ({
          title: 'Patched title',
          [field]: 'legacy-selector',
        })),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(
        expect.anything(),
        400,
        {
          error_code: 'unsupported_field',
          message: 'unsupported_field',
          fields: [field],
        },
      );
      await expect(deps.docStore.get(notebookTasksCollection('ws_default'), 'task_patch_legacy_selector'))
        .resolves.toMatchObject({ title: 'Patch legacy selector task' });
    },
  );

  it('does not expose legacy agent fields on task detail or list responses', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = vi.fn(async () => {
      throw new Error('legacy task agent field must not be used');
    });
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_public_legacy_fields', {
      id: 'task_public_legacy_fields',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Public legacy fields task',
      agent_id: 'agent_legacy_public',
      agent_name: 'Legacy Public Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    const detailJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskItem',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_public_legacy_fields',
      } as never,
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: detailJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    const detailBody = detailJson.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(detailBody).not.toHaveProperty('agent_id');
    expect(detailBody).not.toHaveProperty('agent_name');

    const listJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'tasks',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
      } as never,
      method: 'GET',
      req: { headers: {}, url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: listJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);
    const listBody = listJson.mock.calls[0]?.[2] as { items?: Array<Record<string, unknown>> };
    expect(listBody.items?.[0]).not.toHaveProperty('agent_id');
    expect(listBody.items?.[0]).not.toHaveProperty('agent_name');
    expect(deps.agentResourceService.getAgent).not.toHaveBeenCalled();
  });

  it('resolves the default ready Agent Runner at run dispatch and records resolved_runner_id on active_run', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const deps = createDefaultNodeApiDeps();
    try {
      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'task runner endpoint',
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
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      deps.internalAgentPodManager = {
        ensureAgentReady: vi.fn(async () => undefined),
        keepalive: vi.fn(async () => undefined),
        releasePod: vi.fn(async () => undefined),
      };
      deps.internalAgentWorkspaceBindingManager = {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            mountPath: '/workspace/task',
            metadataUrl: 'postgres://jfsu_user:secret@postgres:5432/jfs_lib_demo?sslmode=disable',
            storageBucketUrl: 'http://minio:9000/jfs-lib-demo',
          },
        })),
      } as never;
      const runner = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
      name: 'Default task runner',
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      endpointId: endpoint.id,
      capabilities: {
        terminal: true,
        artifacts: true,
      },
      execution_preferences_json: {
        task: {
          endpoint_id: endpoint.id,
        },
      },
      } as never);
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_runner_dispatch',
      cancel: vi.fn(),
      stream: (async function* () {
        await new Promise<void>(() => undefined);
      })(),
      })) as never;

      const createJson = vi.fn();
      await expect(handleTaskRoute({
      route: { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: createJson,
      readBody: vi.fn(async () => ({
        title: 'Dispatch through default runner',
        prompt: 'Do the thing',
      })),
      })).resolves.toBe(true);
      const createdTask = createJson.mock.calls[0]?.[2] as { id: string };

      const runJson = vi.fn();
      await expect(handleTaskRoute({
      route: {
        kind: 'taskRuns',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: createdTask.id,
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1', email: 'user_1@example.com' } as never,
      json: runJson,
      readBody: vi.fn(async () => ({ intent: 'Run now' })),
      })).resolves.toBe(true);

      await vi.waitFor(() => {
        expect(deps.agentExecutionService.dispatchStreamingRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: runner.id,
            executionContext: expect.objectContaining({
              endpoint_id: endpoint.id,
              wire_api: 'openai_chat_completions',
              agent_task_model: expect.objectContaining({
                endpoint_id: endpoint.id,
                resolved_model: 'gpt-5-codex',
                upstream_protocol: 'openai_chat_completions',
              }),
            }),
          }),
        );
      });
      const dispatchArg = (deps.agentExecutionService.dispatchStreamingRequest as unknown as ReturnType<typeof vi.fn>)
        .mock.calls[0]?.[0] as { executionContext?: Record<string, unknown> } | undefined;
      expect(dispatchArg?.executionContext).not.toHaveProperty('interaction_kind');
      await expect(getNotebookTaskRunState(deps.cache, createdTask.id)).resolves.toMatchObject({
        runner_id: runner.id,
        resolved_runner_id: runner.id,
      });
      await expect(buildTaskRealtimeView(
      deps,
      'ws_default',
      'proj_1',
      (await deps.docStore.get(notebookTasksCollection('ws_default'), createdTask.id)) as never,
      )).resolves.toMatchObject({
      id: createdTask.id,
      active_run: {
        runner_id: runner.id,
        status: 'running',
      },
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('ignores Developer runners polluted as Project default on the ordinary task path', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000';
    const deps = createDefaultNodeApiDeps();
    try {
      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'system managed default endpoint',
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
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      deps.internalAgentPodManager = {
        ensureAgentReady: vi.fn(async () => undefined),
        keepalive: vi.fn(async () => undefined),
        releasePod: vi.fn(async () => undefined),
      };
      deps.internalAgentWorkspaceBindingManager = {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            mountPath: '/workspace/task',
            metadataUrl: 'postgres://jfsu_user:secret@postgres:5432/jfs_lib_demo?sslmode=disable',
            storageBucketUrl: 'http://minio:9000/jfs-lib-demo',
          },
        })),
      } as never;
      const systemManagedRunner = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
        name: 'System managed deployment default',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        endpointId: endpoint.id,
        capabilities: {
          terminal: true,
          artifacts: true,
        },
      } as never);
      await deps.docStore.upsert(resolveWorkspaceScopedCollection('agents', 'ws_default'), 'ag_polluted_developer_default', {
        id: 'ag_polluted_developer_default',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Polluted Developer default',
        runner_provider: 'developer',
        status: 'enabled',
        presence: 'online',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          terminal: true,
          artifacts: true,
        },
        created_at: '2026-05-05T00:00:00.000Z',
        updated_at: '2026-05-05T00:00:00.000Z',
      });
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_system_default_only',
        cancel: vi.fn(),
        stream: (async function* () {
          await new Promise<void>(() => undefined);
        })(),
      })) as never;

      const createJson = vi.fn();
      await expect(handleTaskRoute({
        route: { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json: createJson,
        readBody: vi.fn(async () => ({
          title: 'Dispatch through System managed default',
          prompt: 'Do the thing',
        })),
      })).resolves.toBe(true);
      const createdTask = createJson.mock.calls[0]?.[2] as { id: string };

      const runJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskRuns',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: createdTask.id,
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: runJson,
        readBody: vi.fn(async () => ({ intent: 'Run now' })),
      })).resolves.toBe(true);

      await vi.waitFor(() => {
        expect(deps.agentExecutionService.dispatchStreamingRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: systemManagedRunner.id,
          }),
        );
      });
      expect(runJson.mock.calls[0]?.[1]).toBe(200);
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('ignores legacy project default conflicts when no deployment default projection is present', async () => {
    const deps = createDefaultNodeApiDeps();
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'conflict endpoint',
      model: 'gpt-5-codex',
      type: 'custom',
      base_url: 'https://example.com/v1',
      status: 'active',
      upstream_protocol: 'openai_chat_completions',
      model_profile: {
        max_context_tokens: 128000,
      },
    });
    for (const name of ['Runner A', 'Runner B']) {
      await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name,
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          artifacts: true,
          terminal: true,
        },
      } as never);
    }
    const createJson = vi.fn();
    await expect(handleTaskRoute({
      route: { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: createJson,
      readBody: vi.fn(async () => ({
        title: 'Conflict task',
        prompt: 'Should fail closed',
      })),
    })).resolves.toBe(true);
    expect(createJson).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'agent_runner_unavailable',
        message: 'agent_runner_unavailable',
      },
    );
    await expect(listAuditEvents(deps.docStore, {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2027-01-01T00:00:00.000Z',
      page: 1,
      pageSize: 20,
      sortOrder: 'asc',
      action: 'agent_runner.binding.failed',
    })).resolves.toMatchObject({
      total: 1,
      items: [
        {
          result: 'error',
          error_code: 'agent_runner_unavailable',
          metadata_json: expect.objectContaining({
            failure_code: 'agent_runner_unavailable',
          }),
        },
      ],
    });
  });

  it('fails closed when exactly one eligible Agent Runner exists but no default is configured', async () => {
    const deps = createDefaultNodeApiDeps();
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'non-default endpoint',
      model: 'gpt-5-codex',
      type: 'custom',
      base_url: 'https://example.com/v1',
      status: 'active',
      upstream_protocol: 'openai_chat_completions',
      model_profile: {
        max_context_tokens: 128000,
      },
    });
    await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'Only non-default runner',
      status: 'enabled',
      presence: 'managed',
      runner_status: 'ready',
      is_default: false,
      default_endpoint_id: endpoint.id,
      capabilities: {
        artifacts: true,
        terminal: true,
      },
    } as never);
    deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_should_not_dispatch',
      cancel: vi.fn(),
      stream: (async function* () {})(),
    })) as never;

    const createJson = vi.fn();
    await expect(handleTaskRoute({
      route: { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: createJson,
      readBody: vi.fn(async () => ({
        title: 'No default task',
        prompt: 'Should require explicit admin default',
      })),
    })).resolves.toBe(true);
    expect(createJson).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'agent_runner_unavailable',
        message: 'agent_runner_unavailable',
      },
    );
    expect(deps.agentExecutionService.dispatchStreamingRequest).not.toHaveBeenCalled();
    await expect(listAuditEvents(deps.docStore, {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2027-01-01T00:00:00.000Z',
      page: 1,
      pageSize: 20,
      sortOrder: 'asc',
      action: 'agent_runner.binding.failed',
    })).resolves.toMatchObject({
      total: 1,
      items: [
        {
          result: 'error',
          error_code: 'agent_runner_unavailable',
          metadata_json: expect.objectContaining({
            failure_code: 'agent_runner_unavailable',
          }),
        },
      ],
    });
  });

  it('clears stale in-memory active runs before terminal creation checks', async () => {
    const cache = new InMemoryCache();
    ACTIVE_RUNS_BY_TASK.add('task_terminal');

    await expect(hasBlockingTaskRunForTerminal(cache, 'task_terminal')).resolves.toBe(false);
    expect(ACTIVE_RUNS_BY_TASK.has('task_terminal')).toBe(false);
  });

  it('keeps blocking terminal creation when shared run state still exists', async () => {
    const cache = new InMemoryCache();
    ACTIVE_RUNS_BY_TASK.add('task_terminal_busy');
    const state = buildNotebookTaskRunState({
      taskId: 'task_terminal_busy',
      runId: 'run_1',
      startedAt: '2026-04-02T08:00:00.000Z',
    });
    await expect(acquireNotebookTaskRunLease(cache, state)).resolves.toBe(true);
    await expect(refreshNotebookTaskRunLease(cache, state)).resolves.toBe(true);

    await expect(hasBlockingTaskRunForTerminal(cache, 'task_terminal_busy')).resolves.toBe(true);
    expect(ACTIVE_RUNS_BY_TASK.has('task_terminal_busy')).toBe(true);
  });

  it('treats failed terminal history as visible but non-blocking live task truth', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_terminal_failed',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_terminal_failed',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    (service as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => void;
    }).finishSession(created.sessionId, 'failed', 'terminal_start_timeout');

    await expect(
      service.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_terminal_failed',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject([
      { id: created.sessionId, status: 'failed', closeReason: 'terminal_start_timeout' },
    ]);
    await expect(hasBlockingTerminalSessionsForTask({
      terminalService: service,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_terminal_failed',
      userId: 'user_1',
    })).resolves.toBe(false);
  });

  it('rejects deleting a task while shared notebook run truth is still active', async () => {
    const deps = createDefaultNodeApiDeps();
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_delete_busy', {
      id: 'task_delete_busy',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Busy task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      status: 'active' as const,
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_delete_busy',
      runId: 'run_delete_busy',
      startedAt: now,
    }))).resolves.toBe(true);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskItem',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_delete_busy',
      } as never,
      method: 'DELETE',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      { error_code: 'RESOURCE_CONFLICT', message: 'task_run_in_progress' },
    );
    await expect(
      deps.docStore.get(notebookTasksCollection('ws_default'), 'task_delete_busy'),
    ).resolves.toMatchObject({
      id: 'task_delete_busy',
    });
  });

  it('fails closed on cancel when shared active run truth has no runner evidence', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_legacy_cancel',
      name: 'Legacy Cancel Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_cancel_missing_runner_evidence', {
      id: 'task_cancel_missing_runner_evidence',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Cancel missing runner evidence task',
      agent_id: 'agent_legacy_cancel',
      agent_name: 'Legacy Cancel Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_cancel_missing_runner_evidence',
      runId: 'run_cancel_missing_runner_evidence',
      startedAt: now,
    }))).resolves.toBe(true);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_cancel_missing_runner_evidence',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ mode: 'terminate' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'TASK_RUNNER_EVIDENCE_MISSING',
        message: 'task_runner_evidence_missing',
        task_id: 'task_cancel_missing_runner_evidence',
        run_id: 'run_cancel_missing_runner_evidence',
      },
    );
    expect(deps.agentResourceService.getAgent).not.toHaveBeenCalled();
  });

  it('fails closed on archive when active run truth has no runner evidence', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = vi.fn(async () => {
      throw new Error('legacy task agent field must not be used');
    });
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_archive_missing_runner_evidence', {
      id: 'task_archive_missing_runner_evidence',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Archive missing runner evidence task',
      agent_id: 'agent_legacy_archive',
      agent_name: 'Legacy Archive Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_archive_missing_runner_evidence',
      runId: 'run_archive_missing_runner_evidence',
      startedAt: now,
    }))).resolves.toBe(true);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskItem',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_archive_missing_runner_evidence',
      } as never,
      method: 'PATCH',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ status: 'archived' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'TASK_RUNNER_EVIDENCE_MISSING',
        message: 'task_runner_evidence_missing',
        task_id: 'task_archive_missing_runner_evidence',
        run_id: 'run_archive_missing_runner_evidence',
      },
    );
    await expect(deps.docStore.get(notebookTasksCollection('ws_default'), 'task_archive_missing_runner_evidence'))
      .resolves.toMatchObject({ status: 'active' });
    expect(deps.agentResourceService.getAgent).not.toHaveBeenCalled();
  });

  it('upgrades stale internal run ownership to terminate and requests hard teardown', async () => {
    const deps = createDefaultNodeApiDeps();
    const requestHardTeardown = vi.fn(async () => undefined);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal',
      name: 'Internal Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    const task = {
      id: 'task_stale_internal',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Stale internal task',
      agent_id: 'agent_internal',
      agent_name: 'Internal Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    };
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_stale_internal', task);
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_stale_internal',
      runId: 'run_stale_internal',
      runnerId: 'agent_internal',
      resolvedRunnerId: 'agent_internal',
      startedAt: '2026-03-18T06:00:00.000Z',
      heartbeatAt: '2026-03-18T06:00:00.000Z',
      ownerInstanceId: 'api-stale-owner',
    }))).resolves.toBe(true);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_stale_internal',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ mode: 'cancel' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      202,
      expect.objectContaining({
        status: 'terminating',
        task_id: 'task_stale_internal',
        run_id: 'run_stale_internal',
        stop_mode: 'terminate',
        can_escalate: false,
        escalation_reason: 'already_terminating',
      }),
    );
    await expect(getNotebookTaskRunState(deps.cache, 'task_stale_internal')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_stale_internal')).resolves.toBeNull();
    await expect(buildTaskRealtimeView(deps, 'ws_default', 'proj_1', task)).resolves.toMatchObject({
      id: 'task_stale_internal',
      run_state: 'idle',
    });
    expect(requestHardTeardown).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: sanitizeWorkloadId('task_stale_internal'),
      epoch: 'run_stale_internal',
    });
  });

  it('returns authoritative cancellable truth for internal active runs without duplicating local cancel delivery', async () => {
    const deps = createDefaultNodeApiDeps();
    const requestHardTeardown = vi.fn(async () => undefined);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal_active',
      name: 'Internal Active Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_active_cancel', {
      id: 'task_internal_active_cancel',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal active cancel task',
      agent_id: 'agent_internal_active',
      agent_name: 'Internal Active Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_internal_active_cancel',
      runId: 'run_internal_active_cancel',
      runnerId: 'agent_internal_active',
      resolvedRunnerId: 'agent_internal_active',
      requestId: 'req_internal_active_cancel',
      startedAt: now,
      heartbeatAt: now,
    }))).resolves.toBe(true);

    const cancel = vi.fn();
    const requestCancel = vi.fn();
    ACTIVE_RUN_CANCEL_BY_TASK.set('task_internal_active_cancel', {
      runId: 'run_internal_active_cancel',
      requestId: 'req_internal_active_cancel',
      cancel,
      requestCancel,
    });

    const firstJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_active_cancel',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: firstJson,
      readBody: vi.fn(async () => ({ mode: 'cancel' })),
    })).resolves.toBe(true);

    expect(firstJson).toHaveBeenCalledWith(
      expect.anything(),
      202,
      expect.objectContaining({
        status: 'cancelling',
        task_id: 'task_internal_active_cancel',
        run_id: 'run_internal_active_cancel',
        request_id: 'req_internal_active_cancel',
        stop_mode: 'cancel',
        can_escalate: true,
      }),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(requestCancel).not.toHaveBeenCalled();

    const detailJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskItem',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_active_cancel',
      } as never,
      method: 'GET',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: detailJson,
      readBody: vi.fn(async () => ({})),
    })).resolves.toBe(true);
    expect(detailJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'task_internal_active_cancel',
        run_state: 'cancelling',
        stop_mode: 'cancel',
        can_escalate: true,
      }),
    );
    expect(detailJson.mock.calls[0]?.[2]).not.toHaveProperty('escalation_reason');

    const listJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'tasks',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
      } as never,
      method: 'GET',
      req: { headers: {}, url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: listJson,
      readBody: vi.fn(async () => ({})),
    })).resolves.toBe(true);
    expect(listJson).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: 'task_internal_active_cancel',
            run_state: 'cancelling',
            stop_mode: 'cancel',
            can_escalate: true,
          }),
        ]),
      }),
    );

    const secondJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_active_cancel',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: secondJson,
      readBody: vi.fn(async () => ({ mode: 'cancel' })),
    })).resolves.toBe(true);

    expect(secondJson).toHaveBeenCalledWith(
      expect.anything(),
      202,
      expect.objectContaining({
        status: 'cancelling',
        task_id: 'task_internal_active_cancel',
        run_id: 'run_internal_active_cancel',
        request_id: 'req_internal_active_cancel',
        stop_mode: 'cancel',
        can_escalate: true,
      }),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(requestCancel).not.toHaveBeenCalled();
    expect(requestHardTeardown).not.toHaveBeenCalled();
  });

  it('upgrades internal cancel to terminate and clears coordination after successful hard teardown', async () => {
    const deps = createDefaultNodeApiDeps();
    const requestHardTeardown = vi.fn(async () => undefined);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal_upgrade',
      name: 'Internal Upgrade Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_upgrade', {
      id: 'task_internal_upgrade',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal upgrade task',
      agent_id: 'agent_internal_upgrade',
      agent_name: 'Internal Upgrade Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_internal_upgrade',
      runId: 'run_internal_upgrade',
      runnerId: 'agent_internal_upgrade',
      resolvedRunnerId: 'agent_internal_upgrade',
      requestId: 'req_internal_upgrade',
      startedAt: now,
      heartbeatAt: now,
    }))).resolves.toBe(true);
    ACTIVE_RUN_CANCEL_BY_TASK.set('task_internal_upgrade', {
      runId: 'run_internal_upgrade',
      requestId: 'req_internal_upgrade',
      cancel: vi.fn(),
      requestCancel: vi.fn(),
    });

    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_upgrade',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(async () => ({ mode: 'cancel' })),
    })).resolves.toBe(true);

    const terminateJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_upgrade',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: terminateJson,
      readBody: vi.fn(async () => ({ mode: 'terminate' })),
    })).resolves.toBe(true);

    expect(terminateJson).toHaveBeenCalledWith(
      expect.anything(),
      202,
      expect.objectContaining({
        status: 'terminating',
        task_id: 'task_internal_upgrade',
        run_id: 'run_internal_upgrade',
        request_id: 'req_internal_upgrade',
        stop_mode: 'terminate',
        can_escalate: false,
        escalation_reason: 'already_terminating',
      }),
    );

    const retryJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_upgrade',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: retryJson,
      readBody: vi.fn(async () => ({ mode: 'terminate' })),
    })).resolves.toBe(true);

    expect(retryJson).toHaveBeenCalledWith(
      expect.anything(),
      409,
      { error_code: 'TASK_RUN_NOT_ACTIVE', message: 'task_run_not_active' },
    );
    expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_upgrade')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_internal_upgrade')).resolves.toBeNull();
  });

  it('retries internal terminate hard teardown after failed side effect without losing terminating truth', async () => {
    const deps = createDefaultNodeApiDeps();
    const requestHardTeardown = vi.fn()
      .mockRejectedValueOnce(new Error('pod teardown unavailable'))
      .mockResolvedValueOnce(undefined);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal_retry',
      name: 'Internal Retry Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_retry', {
      id: 'task_internal_retry',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal retry task',
      agent_id: 'agent_internal_retry',
      agent_name: 'Internal Retry Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_internal_retry',
      runId: 'run_internal_retry',
      runnerId: 'agent_internal_retry',
      resolvedRunnerId: 'agent_internal_retry',
      requestId: 'req_internal_retry',
      startedAt: now,
      heartbeatAt: now,
    }))).resolves.toBe(true);
    ACTIVE_RUN_CANCEL_BY_TASK.set('task_internal_retry', {
      runId: 'run_internal_retry',
      requestId: 'req_internal_retry',
      cancel: vi.fn(),
      requestCancel: vi.fn(),
    });

    const callTerminate = async () => {
      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskCancelRun',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_internal_retry',
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json,
        readBody: vi.fn(async () => ({ mode: 'terminate' })),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    await expect(callTerminate()).resolves.toMatchObject({
      status: 'terminating',
      task_id: 'task_internal_retry',
      run_id: 'run_internal_retry',
      stop_mode: 'terminate',
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_retry')).resolves.toMatchObject({
      phase: 'terminating',
      stop: {
        mode: 'terminate',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'failed',
          last_error: 'pod teardown unavailable',
        },
      },
    });

    await expect(callTerminate()).resolves.toMatchObject({
      status: 'terminating',
      task_id: 'task_internal_retry',
      run_id: 'run_internal_retry',
      stop_mode: 'terminate',
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(2);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_retry')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_internal_retry')).resolves.toBeNull();
  });

  it('retries existing pending internal terminate hard teardown debt from cancel and keeps it retryable on failure', async () => {
    const deps = createDefaultNodeApiDeps();
    const requestHardTeardown = vi.fn()
      .mockRejectedValueOnce(new Error('pending notebook teardown dispatch failed'))
      .mockResolvedValueOnce(undefined);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal_pending_retry',
      name: 'Internal Pending Retry Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_pending_retry', {
      id: 'task_internal_pending_retry',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal pending retry task',
      agent_id: 'agent_internal_pending_retry',
      agent_name: 'Internal Pending Retry Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_internal_pending_retry',
      runId: 'run_internal_pending_retry',
      runnerId: 'agent_internal_pending_retry',
      resolvedRunnerId: 'agent_internal_pending_retry',
      requestId: 'req_internal_pending_retry',
      phase: 'terminating',
      startedAt: now,
      heartbeatAt: now,
      stop: {
        mode: 'terminate',
        requested_at: now,
        actor_user_id: 'user_1',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'pending',
        },
      },
    }))).resolves.toBe(true);

    const callStop = async (mode: 'cancel' | 'terminate') => {
      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskCancelRun',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_internal_pending_retry',
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json,
        readBody: vi.fn(async () => ({ mode })),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    await expect(callStop('cancel')).resolves.toMatchObject({
      status: 'terminating',
      task_id: 'task_internal_pending_retry',
      run_id: 'run_internal_pending_retry',
      request_id: 'req_internal_pending_retry',
      stop_mode: 'terminate',
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_pending_retry')).resolves.toMatchObject({
      phase: 'terminating',
      stop: {
        mode: 'terminate',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'failed',
          last_error: 'pending notebook teardown dispatch failed',
        },
      },
    });
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_internal_pending_retry')).resolves.toMatchObject({
      run_id: 'run_internal_pending_retry',
      status: 'failed',
      last_error: 'pending notebook teardown dispatch failed',
    });

    await expect(callStop('terminate')).resolves.toMatchObject({
      status: 'terminating',
      task_id: 'task_internal_pending_retry',
      run_id: 'run_internal_pending_retry',
      request_id: 'req_internal_pending_retry',
      stop_mode: 'terminate',
    });
    expect(requestHardTeardown).toHaveBeenCalledTimes(2);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_pending_retry')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_internal_pending_retry')).resolves.toBeNull();
  });

  it('keeps internal terminate retryable when real releasePod fails in the coordinator', async () => {
    const deps = createDefaultNodeApiDeps();
    const releasePod = vi.fn()
      .mockRejectedValueOnce(new Error('real pod teardown unavailable'))
      .mockResolvedValueOnce(undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    deps.internalWorkloadCoordinator = internalWorkloadCoordinator as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal_real_retry',
      name: 'Internal Real Retry Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_real_retry', {
      id: 'task_internal_real_retry',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal real retry task',
      agent_id: 'agent_internal_real_retry',
      agent_name: 'Internal Real Retry Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_internal_real_retry',
      runId: 'run_internal_real_retry',
      runnerId: 'agent_internal_real_retry',
      resolvedRunnerId: 'agent_internal_real_retry',
      requestId: 'req_internal_real_retry',
      startedAt: now,
      heartbeatAt: now,
    }))).resolves.toBe(true);
    ACTIVE_RUN_CANCEL_BY_TASK.set('task_internal_real_retry', {
      runId: 'run_internal_real_retry',
      requestId: 'req_internal_real_retry',
      cancel: vi.fn(),
      requestCancel: vi.fn(),
    });

    const callTerminate = async () => {
      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskCancelRun',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_internal_real_retry',
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json,
        readBody: vi.fn(async () => ({ mode: 'terminate' })),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    await expect(callTerminate()).resolves.toMatchObject({
      status: 'terminating',
      task_id: 'task_internal_real_retry',
      run_id: 'run_internal_real_retry',
      stop_mode: 'terminate',
    });
    expect(releasePod).toHaveBeenCalledTimes(1);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_real_retry')).resolves.toMatchObject({
      phase: 'terminating',
      stop: {
        mode: 'terminate',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'failed',
          last_error: 'real pod teardown unavailable',
        },
      },
    });
    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([
      {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        workloadId: sanitizeWorkloadId('task_internal_real_retry'),
        holders: [],
        hardTeardownRequested: true,
      },
    ]);

    await expect(callTerminate()).resolves.toMatchObject({
      status: 'terminating',
      task_id: 'task_internal_real_retry',
      run_id: 'run_internal_real_retry',
      stop_mode: 'terminate',
    });
    expect(releasePod).toHaveBeenCalledTimes(2);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_real_retry')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_internal_real_retry')).resolves.toBeNull();
    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);

    await internalWorkloadCoordinator.shutdown();
  });

  it('rejects a late notebook holder after active run truth was terminated before holder registration', async () => {
    const deps = createDefaultNodeApiDeps();
    const releasePod = vi.fn(async () => undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    deps.internalWorkloadCoordinator = internalWorkloadCoordinator as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal_late_holder',
      name: 'Internal Late Holder Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_late_holder', {
      id: 'task_internal_late_holder',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal late holder task',
      agent_id: 'agent_internal_late_holder',
      agent_name: 'Internal Late Holder Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_internal_late_holder',
      runId: 'run_internal_late_holder',
      runnerId: 'agent_internal_late_holder',
      resolvedRunnerId: 'agent_internal_late_holder',
      requestId: 'req_internal_late_holder',
      startedAt: now,
      heartbeatAt: now,
    }))).resolves.toBe(true);
    ACTIVE_RUN_CANCEL_BY_TASK.set('task_internal_late_holder', {
      runId: 'run_internal_late_holder',
      requestId: 'req_internal_late_holder',
      cancel: vi.fn(),
      requestCancel: vi.fn(),
    });

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_late_holder',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ mode: 'terminate' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(expect.anything(), 202, expect.objectContaining({
      status: 'terminating',
      run_id: 'run_internal_late_holder',
      stop_mode: 'terminate',
    }));
    expect(releasePod).toHaveBeenCalledTimes(1);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_late_holder')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(
      deps.cache,
      'task_internal_late_holder',
    )).resolves.toBeNull();

    await expect(internalWorkloadCoordinator.acquireHolder({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: sanitizeWorkloadId('task_internal_late_holder'),
      holderKind: 'notebook_run',
      holderId: 'run_internal_late_holder',
      epoch: 'run_internal_late_holder',
    })).rejects.toMatchObject({
      code: 'INTERNAL_WORKLOAD_HARD_TEARDOWN_PENDING',
    });
    await expect(internalWorkloadCoordinator.acquireHolder({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: sanitizeWorkloadId('task_internal_late_holder'),
      holderKind: 'notebook_run',
      holderId: 'run_internal_late_holder_next',
      epoch: 'run_internal_late_holder_next',
    })).resolves.toBeUndefined();
    await internalWorkloadCoordinator.releaseHolder({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: sanitizeWorkloadId('task_internal_late_holder'),
      holderKind: 'notebook_run',
      holderId: 'run_internal_late_holder_next',
      epoch: 'run_internal_late_holder_next',
    });
    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);

    await internalWorkloadCoordinator.shutdown();
  });

  it('keeps live-holder internal terminate pending until real release completes and retries after releasePod failure', async () => {
    const deps = createDefaultNodeApiDeps();
    const firstRelease = createDeferred<void>();
    const secondRelease = createDeferred<void>();
    const releaseAttempts = [firstRelease, secondRelease];
    let releaseAttemptIndex = 0;
    const releasePod = vi.fn(async () => {
      const release = releaseAttempts[releaseAttemptIndex];
      releaseAttemptIndex += 1;
      if (release) {
        await release.promise;
      }
    });
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    deps.internalWorkloadCoordinator = internalWorkloadCoordinator as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal_live_retry',
      name: 'Internal Live Retry Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_live_retry', {
      id: 'task_internal_live_retry',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal live retry task',
      agent_id: 'agent_internal_live_retry',
      agent_name: 'Internal Live Retry Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_internal_live_retry',
      runId: 'run_internal_live_retry',
      runnerId: 'agent_internal_live_retry',
      resolvedRunnerId: 'agent_internal_live_retry',
      requestId: 'req_internal_live_retry',
      startedAt: now,
      heartbeatAt: now,
    }))).resolves.toBe(true);
    const holder = {
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      workloadId: sanitizeWorkloadId('task_internal_live_retry'),
      holderKind: 'notebook_run' as const,
      holderId: 'run_internal_live_retry',
    };
    await internalWorkloadCoordinator.acquireHolder(holder);
    const holderReleaseErrors: unknown[] = [];
    ACTIVE_RUN_CANCEL_BY_TASK.set('task_internal_live_retry', {
      runId: 'run_internal_live_retry',
      requestId: 'req_internal_live_retry',
      cancel: vi.fn(),
      requestCancel: vi.fn(),
    });

    const callTerminate = async () => {
      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskCancelRun',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_internal_live_retry',
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json,
        readBody: vi.fn(async () => ({ mode: 'terminate' })),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    const firstTerminate = callTerminate();
    await vi.waitFor(() => {
      expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([
        {
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          workloadId: sanitizeWorkloadId('task_internal_live_retry'),
          holders: ['notebook_run:run_internal_live_retry'],
          hardTeardownRequested: true,
        },
      ]);
    });
    expect(releasePod).not.toHaveBeenCalled();
    void internalWorkloadCoordinator.releaseHolder(holder).catch((error: unknown) => {
      holderReleaseErrors.push(error);
    });
    await vi.waitFor(() => {
      expect(releasePod).toHaveBeenCalledTimes(1);
    });
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_live_retry')).resolves.toMatchObject({
      phase: 'terminating',
      stop: {
        mode: 'terminate',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'requested',
        },
      },
    });

    firstRelease.reject(new Error('live notebook pod release failed'));
    await expect(firstTerminate).resolves.toMatchObject({
      status: 'terminating',
      task_id: 'task_internal_live_retry',
      run_id: 'run_internal_live_retry',
      stop_mode: 'terminate',
    });
    await vi.waitFor(() => {
      expect(holderReleaseErrors).toHaveLength(1);
    });
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_live_retry')).resolves.toMatchObject({
      phase: 'terminating',
      stop: {
        mode: 'terminate',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'failed',
          last_error: 'live notebook pod release failed',
        },
      },
    });

    const secondTerminate = callTerminate();
    await vi.waitFor(() => {
      expect(releasePod).toHaveBeenCalledTimes(2);
    });
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_live_retry')).resolves.toMatchObject({
      phase: 'terminating',
      stop: {
        mode: 'terminate',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'requested',
        },
      },
    });

    secondRelease.resolve();
    await expect(secondTerminate).resolves.toMatchObject({
      status: 'terminating',
      task_id: 'task_internal_live_retry',
      run_id: 'run_internal_live_retry',
      stop_mode: 'terminate',
    });
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_live_retry')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_internal_live_retry')).resolves.toBeNull();
    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);

    await internalWorkloadCoordinator.shutdown();
  });

  it('retries finalizing internal terminate debt instead of rejecting TASK_RUN_FINALIZING', async () => {
    const deps = createDefaultNodeApiDeps();
    const requestHardTeardown = vi.fn(async () => undefined);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal_finalizing_debt',
      name: 'Internal Finalizing Debt Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_finalizing_debt', {
      id: 'task_internal_finalizing_debt',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal finalizing debt task',
      agent_id: 'agent_internal_finalizing_debt',
      agent_name: 'Internal Finalizing Debt Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_internal_finalizing_debt',
      runId: 'run_internal_finalizing_debt',
      runnerId: 'agent_internal_finalizing_debt',
      resolvedRunnerId: 'agent_internal_finalizing_debt',
      requestId: 'req_internal_finalizing_debt',
      phase: 'finalizing',
      startedAt: now,
      heartbeatAt: now,
      stop: {
        mode: 'terminate',
        requested_at: now,
        actor_user_id: 'user_1',
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'failed',
          last_attempt_at: now,
          last_error: 'finalizing release failed',
          attempt_count: 1,
        },
      },
      finalization: {
        status: 'pending',
        updated_at: now,
      },
    }))).resolves.toBe(true);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_finalizing_debt',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ mode: 'terminate' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      202,
      expect.objectContaining({
        status: 'terminating',
        task_id: 'task_internal_finalizing_debt',
        run_id: 'run_internal_finalizing_debt',
        request_id: 'req_internal_finalizing_debt',
        stop_mode: 'terminate',
      }),
    );
    expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_finalizing_debt')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_internal_finalizing_debt')).resolves.toBeNull();
  });

  it('fails closed for terminal hard teardown debt after active run state was cleared without runner evidence', async () => {
    const deps = createDefaultNodeApiDeps();
    const requestHardTeardown = vi.fn(async () => undefined);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    deps.agentResourceService.getAgent = vi.fn();

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_terminal_debt', {
      id: 'task_internal_terminal_debt',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal terminal debt task',
      agent_id: 'agent_internal_terminal_debt',
      agent_name: 'Internal Terminal Debt Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(markNotebookTaskRunHardTeardownFailed(deps.cache, {
      taskId: 'task_internal_terminal_debt',
      runId: 'run_internal_terminal_debt',
      attemptedAt: now,
      errorMessage: 'release failed after active run cleared',
    })).resolves.toBeNull();

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_terminal_debt',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ mode: 'cancel' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'TASK_RUNNER_EVIDENCE_MISSING',
        message: 'task_runner_evidence_missing',
        task_id: 'task_internal_terminal_debt',
        run_id: 'run_internal_terminal_debt',
      },
    );
    expect(requestHardTeardown).not.toHaveBeenCalled();
    expect(deps.agentResourceService.getAgent).not.toHaveBeenCalled();
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_terminal_debt')).resolves.toBeNull();
  });

  it('rejects a new user run while terminal hard teardown debt exists without masking the debt', async () => {
    const deps = createDefaultNodeApiDeps();
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_terminal_debt_new_run', {
      id: 'task_terminal_debt_new_run',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Terminal debt new run task',
      agent_id: 'agent_terminal_debt_new_run',
      agent_name: 'Terminal Debt Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(markNotebookTaskRunHardTeardownFailed(deps.cache, {
      taskId: 'task_terminal_debt_new_run',
      runId: 'run_terminal_debt_new_run',
      attemptedAt: now,
      errorMessage: 'terminal release failed before new run',
    })).resolves.toBeNull();

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskRuns',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_terminal_debt_new_run',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ intent: 'Run now' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      expect.objectContaining({
        error_code: 'TASK_STREAM_CONFLICT',
        message: 'task_stream_conflict',
        reason: 'hard_teardown_pending',
        hard_teardown_status: 'failed',
      }),
    );
    await expect(getNotebookTaskRunState(deps.cache, 'task_terminal_debt_new_run')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_terminal_debt_new_run')).resolves.toMatchObject({
      run_id: 'run_terminal_debt_new_run',
      status: 'failed',
      last_error: 'terminal release failed before new run',
    });
  });

  it('rejects a new user run while finalizing hard teardown debt exists without overwriting old run truth', async () => {
    const deps = createDefaultNodeApiDeps();
    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_finalizing_debt_new_run', {
      id: 'task_finalizing_debt_new_run',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Finalizing debt new run task',
      agent_id: 'agent_finalizing_debt_new_run',
      agent_name: 'Finalizing Debt Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_finalizing_debt_new_run',
      runId: 'run_finalizing_debt_new_run',
      runnerId: 'agent_finalizing_debt_new_run',
      resolvedRunnerId: 'agent_finalizing_debt_new_run',
      phase: 'finalizing',
      startedAt: now,
      heartbeatAt: now,
      stop: {
        mode: 'terminate',
        requested_at: now,
        delivery: 'internal_teardown_requested',
        hard_teardown: {
          status: 'failed',
          last_error: 'finalizing release failed before new run',
        },
      },
      finalization: {
        status: 'pending',
        updated_at: now,
      },
    }))).resolves.toBe(true);
    await deps.cache.del('notebook:task:task_finalizing_debt_new_run:run:lock');

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskRuns',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_finalizing_debt_new_run',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ intent: 'Run now' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      expect.objectContaining({
        error_code: 'TASK_STREAM_CONFLICT',
        message: 'task_stream_conflict',
        reason: 'hard_teardown_pending',
        hard_teardown_status: 'failed',
      }),
    );
    await expect(getNotebookTaskRunState(deps.cache, 'task_finalizing_debt_new_run')).resolves.toMatchObject({
      run_id: 'run_finalizing_debt_new_run',
      phase: 'finalizing',
      stop: {
        mode: 'terminate',
        hard_teardown: {
          status: 'failed',
          last_error: 'finalizing release failed before new run',
        },
      },
    });
  });

  it('registers a pre-dispatch internal cancel handle and finalizes terminate as cancelled instead of leaving an empty assistant message', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';

    try {
      const deps = createDefaultNodeApiDeps();
      const startupObserved = createDeferred<void>();
      let startupSignal: AbortSignal | undefined;
      const dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_should_not_dispatch',
        cancel: () => undefined,
        stream: (async function* stream() {
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      }));
      deps.agentExecutionService.dispatchStreamingRequest = dispatchStreamingRequest as never;
      deps.internalAgentPodManager = {
        ensureAgentReady: vi.fn(async (input: { signal?: AbortSignal }) => {
          startupSignal = input.signal;
          startupObserved.resolve();
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
            id: 'bind_internal_pre_dispatch_cancel',
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
            bindingId: 'bind_internal_pre_dispatch_cancel',
            mountPath: `/workspace/${input.taskId}`,
            fileLibraryId: input.fileLibraryId,
          },
        })),
      } as never;

      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'internal pre-dispatch endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        credential_ref: 'cred_internal_pre_dispatch',
        upstream_protocol: 'openai_chat_completions',
      model_profile: {
        max_context_tokens: 128000,
      },
      });
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'internal-pre-dispatch-agent',
        mode: 'internal',
        interaction_kind: 'notebook',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
        config: {
          image: 'runner:v1',
          _internal_raw_key: 'ask_test',
        } as never,
        owner_id: 'user_test',
        visibility: 'private',
        execution_preferences_json: {
          task: {
            endpoint_id: endpoint.id,
          },
        },
      });

      const now = new Date().toISOString();
      const task = {
        id: 'task_internal_pre_dispatch_cancel',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Internal pre-dispatch cancel task',
        bound_runner_id: agent.id,
        bound_runner_kind: 'managed',
        runner_binding_source: 'default_managed',
        bound_at: now,
        bound_by_user_id: 'user_1',
        workspace_file_library_id: 'lib_internal_pre_dispatch_cancel',
        workspace_file_library_name: 'Internal Pre-dispatch Workspace',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      };
      await deps.docStore.upsert('project_file_libraries', 'lib_internal_pre_dispatch_cancel', {
        id: 'lib_internal_pre_dispatch_cancel',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Internal Pre-dispatch Workspace',
        status: 'ready',
        filesystem_name: 'flib-internal-pre-dispatch',
        created_by_user_id: 'user_1',
        created_at: now,
        updated_at: now,
      });
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), task.id, task);

      const postJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskRuns',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: task.id,
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: postJson,
        readBody: vi.fn(async () => ({ intent: 'Run now' })),
      })).resolves.toBe(true);

      const assistantMessage = postJson.mock.calls[0]?.[2] as { id: string; content: string };
      expect(assistantMessage.content).toBe('');

      await startupObserved.promise;
      expect(startupSignal).toBeInstanceOf(AbortSignal);
      expect(ACTIVE_RUN_CANCEL_BY_TASK.get(task.id)).toMatchObject({
        runId: expect.any(String),
        requestId: null,
      });

      const terminateJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskCancelRun',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: task.id,
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json: terminateJson,
        readBody: vi.fn(async () => ({ mode: 'terminate' })),
      })).resolves.toBe(true);

      expect(terminateJson).toHaveBeenCalledWith(
        expect.anything(),
        202,
        expect.objectContaining({
          status: 'terminating',
          task_id: task.id,
          request_id: null,
          stop_mode: 'terminate',
        }),
      );

      await vi.waitFor(async () => {
        expect(dispatchStreamingRequest).not.toHaveBeenCalled();
        expect(await getNotebookTaskRunState(deps.cache, task.id)).toBeNull();
        const persistedAssistant = await deps.docStore.get<{
          id: string;
          role: string;
          content: string;
        }>(notebookTaskMessagesCollection('ws_default'), assistantMessage.id);
        expect(persistedAssistant).toMatchObject({
          id: assistantMessage.id,
          role: 'agent',
        });
        expect(persistedAssistant?.content).toContain('AGENT_CANCELLED');
      });

      await expect(buildTaskRealtimeView(deps, 'ws_default', 'proj_1', task as never)).resolves.toMatchObject({
        id: task.id,
        run_state: 'idle',
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('keeps shared run truth in finalizing persist_failed when pre-dispatch terminate cannot persist the terminal assistant message', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';

    try {
      const deps = createDefaultNodeApiDeps();
      const originalUpsert = deps.docStore.upsert.bind(deps.docStore);
      const startupObserved = createDeferred<void>();
      let startupSignal: AbortSignal | undefined;
      deps.docStore.upsert = async (collection, id, doc) => {
        if (
          collection === notebookTaskMessagesCollection('ws_default')
          && typeof doc === 'object'
          && doc !== null
          && !Array.isArray(doc)
          && (doc as { role?: unknown }).role === 'agent'
          && typeof (doc as { content?: unknown }).content === 'string'
          && ((doc as { content: string }).content.length > 0)
        ) {
          throw new Error('final_terminal_truth_persist_failed');
        }
        return originalUpsert(collection, id, doc);
      };
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn(async () => ({
        requestId: 'req_should_not_dispatch',
        cancel: () => undefined,
        stream: (async function* stream() {
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      })) as never;
      deps.internalAgentPodManager = {
        ensureAgentReady: vi.fn(async (input: { signal?: AbortSignal }) => {
          startupSignal = input.signal;
          startupObserved.resolve();
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
            id: 'bind_internal_pre_dispatch_cancel_persist_failed',
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
            bindingId: 'bind_internal_pre_dispatch_cancel_persist_failed',
            mountPath: `/workspace/${input.taskId}`,
            fileLibraryId: input.fileLibraryId,
          },
        })),
      } as never;

      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'internal pre-dispatch persist-failed endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        credential_ref: 'cred_internal_pre_dispatch_persist_failed',
        upstream_protocol: 'openai_chat_completions',
      model_profile: {
        max_context_tokens: 128000,
      },
      });
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'internal-pre-dispatch-persist-failed-agent',
        mode: 'internal',
        interaction_kind: 'notebook',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
        config: {
          image: 'runner:v1',
          _internal_raw_key: 'ask_test',
        } as never,
        owner_id: 'user_test',
        visibility: 'private',
        execution_preferences_json: {
          task: {
            endpoint_id: endpoint.id,
          },
        },
      });

      const now = new Date().toISOString();
      const task = {
        id: 'task_internal_pre_dispatch_cancel_persist_failed',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Internal pre-dispatch cancel persist-failed task',
        bound_runner_id: agent.id,
        bound_runner_kind: 'managed',
        runner_binding_source: 'default_managed',
        bound_at: now,
        bound_by_user_id: 'user_1',
        workspace_file_library_id: 'lib_internal_pre_dispatch_cancel_persist_failed',
        workspace_file_library_name: 'Internal Pre-dispatch Persist Failed Workspace',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      };
      await deps.docStore.upsert('project_file_libraries', 'lib_internal_pre_dispatch_cancel_persist_failed', {
        id: 'lib_internal_pre_dispatch_cancel_persist_failed',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Internal Pre-dispatch Persist Failed Workspace',
        status: 'ready',
        filesystem_name: 'flib-internal-pre-dispatch-persist-failed',
        created_by_user_id: 'user_1',
        created_at: now,
        updated_at: now,
      });
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), task.id, task);

      await expect(handleTaskRoute({
        route: {
          kind: 'taskRuns',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: task.id,
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: vi.fn(),
        readBody: vi.fn(async () => ({ intent: 'Run now' })),
      })).resolves.toBe(true);

      await startupObserved.promise;
      expect(startupSignal).toBeInstanceOf(AbortSignal);

      await expect(handleTaskRoute({
        route: {
          kind: 'taskCancelRun',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: task.id,
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json: vi.fn(),
        readBody: vi.fn(async () => ({ mode: 'terminate' })),
      })).resolves.toBe(true);

      await vi.waitFor(async () => {
        expect(await getNotebookTaskRunState(deps.cache, task.id)).toMatchObject({
          run_id: expect.any(String),
          phase: 'finalizing',
          stop: {
            mode: 'terminate',
          },
          finalization: {
            status: 'persist_failed',
            error_code: 'AGENT_FINALIZE_PERSIST_FAILED',
          },
        });
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('keeps the second run local handle authoritative when a terminated first run dispatch resolves late', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';

    try {
      const deps = createDefaultNodeApiDeps();
      const firstDispatch = createDeferred<{
        requestId: string;
        cancel: () => void;
        stream: AsyncIterable<
          | { type: 'delta'; delta: string }
          | { type: 'done'; finish_reason: 'stop'; usage_tokens: number }
        >;
      }>();
      deps.agentExecutionService.dispatchStreamingRequest = vi.fn()
        .mockImplementationOnce(async () => firstDispatch.promise) as never;
      deps.internalWorkloadCoordinator = {
        acquireHolder: vi.fn(async () => undefined),
        releaseHolder: vi.fn(async () => undefined),
        requestHardTeardown: vi.fn(async () => undefined),
      } as never;
      deps.internalAgentPodManager = {
        ensureAgentReady: vi.fn(async () => undefined),
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
            id: 'bind_internal_late_on_dispatched',
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
            bindingId: 'bind_internal_late_on_dispatched',
            mountPath: `/workspace/${input.taskId}`,
            fileLibraryId: input.fileLibraryId,
          },
        })),
      } as never;

      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'internal late-on-dispatched endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        credential_ref: 'cred_internal_late_on_dispatched',
        upstream_protocol: 'openai_chat_completions',
      model_profile: {
        max_context_tokens: 128000,
      },
      });
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'internal-late-on-dispatched-agent',
        mode: 'internal',
        interaction_kind: 'notebook',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
        config: {
          image: 'runner:v1',
          _internal_raw_key: 'ask_test',
        } as never,
        owner_id: 'user_test',
        visibility: 'private',
        execution_preferences_json: {
          task: {
            endpoint_id: endpoint.id,
          },
        },
      });

      const now = new Date().toISOString();
      const task = {
        id: 'task_internal_late_on_dispatched',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Internal late onDispatched task',
        bound_runner_id: agent.id,
        bound_runner_kind: 'managed',
        runner_binding_source: 'default_managed',
        bound_at: now,
        bound_by_user_id: 'user_1',
        workspace_file_library_id: 'lib_internal_late_on_dispatched',
        workspace_file_library_name: 'Internal Late onDispatched Workspace',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      };
      await deps.docStore.upsert('project_file_libraries', 'lib_internal_late_on_dispatched', {
        id: 'lib_internal_late_on_dispatched',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Internal Late onDispatched Workspace',
        status: 'ready',
        filesystem_name: 'flib-internal-late-on-dispatched',
        created_by_user_id: 'user_1',
        created_at: now,
        updated_at: now,
      });
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), task.id, task);

      const firstMessageJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskRuns',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: task.id,
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: firstMessageJson,
        readBody: vi.fn(async () => ({ intent: 'Run now' })),
      })).resolves.toBe(true);
      const firstAssistantMessage = firstMessageJson.mock.calls[0]?.[2] as { id: string; content: string };
      expect(firstAssistantMessage).toMatchObject({
        id: expect.any(String),
        content: '',
      });

      const firstRunId = ACTIVE_RUN_CANCEL_BY_TASK.get(task.id)?.runId;
      expect(firstRunId).toBeTruthy();

      await expect(handleTaskRoute({
        route: {
          kind: 'taskCancelRun',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: task.id,
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json: vi.fn(),
        readBody: vi.fn(async () => ({ mode: 'terminate' })),
      })).resolves.toBe(true);

      await vi.waitFor(async () => {
        expect(await getNotebookTaskRunState(deps.cache, task.id)).toBeNull();
      });

      const secondRunId = 'run_manual_second';
      await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
        taskId: task.id,
        runId: secondRunId,
        runnerId: agent.id,
        resolvedRunnerId: agent.id,
        requestId: 'req_second_dispatch',
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      }))).resolves.toBe(true);
      ACTIVE_RUN_CANCEL_BY_TASK.set(task.id, {
        runId: secondRunId,
        requestId: 'req_second_dispatch',
        cancel: vi.fn(),
        requestCancel: vi.fn(),
      });

      await vi.waitFor(async () => {
        expect(ACTIVE_RUN_CANCEL_BY_TASK.get(task.id)).toMatchObject({
          runId: secondRunId,
          requestId: 'req_second_dispatch',
        });
        expect(await getNotebookTaskRunState(deps.cache, task.id)).toMatchObject({
          run_id: secondRunId,
          request_id: 'req_second_dispatch',
        });
      });

      expect(secondRunId).not.toBe(firstRunId);

      firstDispatch.resolve({
        requestId: 'req_first_late',
        cancel: () => undefined,
        stream: (async function* stream() {
          yield { type: 'delta', delta: 'stale success content' } as const;
          yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
        })(),
      });

      await vi.waitFor(async () => {
        expect(ACTIVE_RUN_CANCEL_BY_TASK.get(task.id)).toMatchObject({
          runId: secondRunId,
          requestId: 'req_second_dispatch',
        });
        expect(await getNotebookTaskRunState(deps.cache, task.id)).toMatchObject({
          run_id: secondRunId,
          request_id: 'req_second_dispatch',
        });
        const persistedAssistant = await deps.docStore.get<{
          id: string;
          role: string;
          content: string;
        }>(notebookTaskMessagesCollection('ws_default'), firstAssistantMessage.id);
        expect(persistedAssistant).toMatchObject({
          id: firstAssistantMessage.id,
          role: 'agent',
        });
        expect(persistedAssistant?.content).toContain('AGENT_CANCELLED');
        expect(persistedAssistant?.content).not.toContain('stale success content');
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('deduplicates concurrent internal terminate hard teardown requests', async () => {
    const deps = createDefaultNodeApiDeps();
    const teardown = createDeferred<void>();
    const requestHardTeardown = vi.fn(async () => teardown.promise);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_internal_concurrent',
      name: 'Internal Concurrent Agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_concurrent', {
      id: 'task_internal_concurrent',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal concurrent task',
      agent_id: 'agent_internal_concurrent',
      agent_name: 'Internal Concurrent Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_internal_concurrent',
      runId: 'run_internal_concurrent',
      runnerId: 'agent_internal_concurrent',
      resolvedRunnerId: 'agent_internal_concurrent',
      requestId: 'req_internal_concurrent',
      startedAt: now,
      heartbeatAt: now,
    }))).resolves.toBe(true);
    ACTIVE_RUN_CANCEL_BY_TASK.set('task_internal_concurrent', {
      runId: 'run_internal_concurrent',
      requestId: 'req_internal_concurrent',
      cancel: vi.fn(),
      requestCancel: vi.fn(),
    });

    const callTerminate = async () => {
      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskCancelRun',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_internal_concurrent',
        } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1' } as never,
        json,
        readBody: vi.fn(async () => ({ mode: 'terminate' })),
      })).resolves.toBe(true);
      return json.mock.calls[0]?.[2];
    };

    const responsesPromise = Promise.all([callTerminate(), callTerminate()]);
    await vi.waitFor(() => {
      expect(requestHardTeardown).toHaveBeenCalledTimes(1);
    });
    teardown.resolve();
    await expect(responsesPromise).resolves.toEqual([
      expect.objectContaining({
        status: 'terminating',
        stop_mode: 'terminate',
      }),
      expect.objectContaining({
        status: 'terminating',
        stop_mode: 'terminate',
      }),
    ]);
    await expect(getNotebookTaskRunState(deps.cache, 'task_internal_concurrent')).resolves.toBeNull();
    await expect(getNotebookTaskRunHardTeardownDebt(deps.cache, 'task_internal_concurrent')).resolves.toBeNull();
  });

  it('rejects unsupported external terminate without creating terminating truth', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_external_terminate',
      name: 'External Terminate Agent',
      runner_provider: 'developer',
      status: 'enabled',
      presence: 'online',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_external_terminate', {
      id: 'task_external_terminate',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'External terminate task',
      agent_id: 'agent_external_terminate',
      agent_name: 'External Terminate Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_external_terminate',
      runId: 'run_external_terminate',
      runnerId: 'agent_external_terminate',
      resolvedRunnerId: 'agent_external_terminate',
      requestId: 'req_external_terminate',
      startedAt: now,
      heartbeatAt: now,
    }))).resolves.toBe(true);
    ACTIVE_RUN_CANCEL_BY_TASK.set('task_external_terminate', {
      runId: 'run_external_terminate',
      requestId: 'req_external_terminate',
      cancel: vi.fn(),
      requestCancel: vi.fn(),
    });

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_external_terminate',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ mode: 'terminate' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      expect.objectContaining({
        error_code: 'STOP_ESCALATION_UNAVAILABLE',
        message: 'stop_escalation_unavailable',
        task_id: 'task_external_terminate',
        run_id: 'run_external_terminate',
        request_id: 'req_external_terminate',
        can_escalate: false,
        escalation_reason: 'unsupported_runner',
      }),
    );
    const runStateAfterTerminate = await getNotebookTaskRunState(deps.cache, 'task_external_terminate');
    expect(runStateAfterTerminate).toMatchObject({
      phase: 'running',
    });
    expect(runStateAfterTerminate?.stop).toBeUndefined();
  });

  it('rejects stale external run ownership instead of pretending cancel succeeded', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.agentResourceService.getAgent = vi.fn(async () => ({
      id: 'agent_external',
      name: 'External Agent',
      runner_provider: 'developer',
      status: 'enabled',
      presence: 'online',
    }) as never);

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_stale_external', {
      id: 'task_stale_external',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Stale external task',
      agent_id: 'agent_external',
      agent_name: 'External Agent',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: 'task_stale_external',
      runId: 'run_stale_external',
      runnerId: 'agent_external',
      resolvedRunnerId: 'agent_external',
      startedAt: '2026-03-18T07:00:00.000Z',
      heartbeatAt: '2026-03-18T07:00:00.000Z',
      ownerInstanceId: 'api-stale-owner',
    }))).resolves.toBe(true);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskCancelRun',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_stale_external',
      } as never,
      method: 'POST',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(async () => ({ mode: 'cancel' })),
    })).resolves.toBe(true);

    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      { error_code: 'TASK_RUN_OWNER_UNAVAILABLE', message: 'task_run_owner_unavailable' },
    );
    await expect(getNotebookTaskRunState(deps.cache, 'task_stale_external')).resolves.toMatchObject({
      run_id: 'run_stale_external',
      phase: 'running',
    });
  });

  async function seedTraceProjectionTask(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    taskId: string,
  ): Promise<TaskTraceEventRecord> {
    const now = '2026-05-05T12:00:00.000Z';
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), taskId, {
      id: taskId,
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Trace projection task',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    return {
      id: `${taskId}_trace_malicious`,
      task_id: taskId,
      message_id: `${taskId}_message`,
      run_id: `${taskId}_run`,
      seq: 1,
      at: now,
      category: 'tool',
      phase: 'end',
      status: 'success',
      name: 'codex.command',
      summary: 'raw event TOKEN=abc secret required_permissions reason_code raw diagnostics /internal/diagnostic_entrypoint',
      details: {
        command: 'TOKEN=abc secret /internal/diagnostic_entrypoint',
        tool_name: 'diagnostic_entrypoint',
        required_permissions: ['project:agent_runner:read'],
        reason_code: 'agent_runner_unavailable',
        diagnostics: 'raw diagnostics',
        diagnostic_entrypoint: '/internal/agent-task/diag',
        authorization: 'Bearer TOKEN=abc',
        api_key: 'secret-key',
      },
    };
  }

  function expectDisplaySafeTraceProjection(serialized: string): void {
    expect(serialized).toContain('codex.command');
    expect(serialized).toContain('Command completed');
    for (const denied of [
      'TOKEN=abc',
      'secret',
      'required_permissions',
      'reason_code',
      'raw event',
      'raw diagnostics',
      '/internal/',
      'diagnostic_entrypoint',
    ]) {
      expect(serialized).not.toContain(denied);
    }
  }

  async function openProjectedTaskEvents(
    deps: ReturnType<typeof createDefaultNodeApiDeps>,
    taskId: string,
    url: string,
  ): Promise<{
    req: EventEmitter & http.IncomingMessage;
    text: () => string;
  }> {
    const req = new EventEmitter() as EventEmitter & http.IncomingMessage;
    req.headers = {};
    req.url = url;
    const writes: string[] = [];
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      writableEnded: false,
      destroyed: false,
      write: vi.fn((chunk: string) => {
        writes.push(String(chunk));
        return true;
      }),
    } as unknown as http.ServerResponse;
    await expect(handleTaskRoute({
      route: {
        kind: 'taskEvents',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId,
      } as never,
      method: 'GET',
      req: req as never,
      res,
      deps,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);
    return {
      req,
      text: () => writes.join(''),
    };
  }

  function expectNoRawProjectionLeak(serialized: string): void {
    for (const denied of [
      'TOKEN=abc',
      'secret',
      'required_permissions',
      'reason_code',
      'raw failure message',
      'raw event',
      'raw diagnostics',
      '/internal/',
      'diagnostic_entrypoint',
      'runner.embedded_secret_trace',
      'AGENT_UPSTREAM_ERROR_TOKEN_SECRET',
      'error_message',
    ]) {
      expect(serialized).not.toContain(denied);
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function expectIsoDateTime(value: unknown): asserts value is string {
    expect(typeof value).toBe('string');
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(Date.parse(value))).toBe(false);
  }

  function readTraceEventAtsFromSse(serialized: string): unknown[] {
    const ats: unknown[] = [];
    for (const line of serialized.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = JSON.parse(line.slice('data: '.length)) as unknown;
      if (!isRecord(payload) || payload.type !== 'trace_event' || !isRecord(payload.data)) continue;
      ats.push(payload.data.at);
    }
    return ats;
  }

  function expectProjectedTraceAtsSafe(serialized: string, unsafeAt: string): void {
    expect(serialized).not.toContain(unsafeAt);
    const ats = readTraceEventAtsFromSse(serialized);
    expect(ats.length).toBeGreaterThan(0);
    for (const at of ats) {
      expectIsoDateTime(at);
    }
  }

  it('projects ordinary task trace REST responses into display-safe activity records', async () => {
    const deps = createDefaultNodeApiDeps();
    const taskId = 'task_trace_projection_rest';
    const trace = await seedTraceProjectionTask(deps, taskId);
    await storeTaskTraceEvent(deps, 'ws_default', taskId, trace);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskTraces',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId,
      } as never,
      method: 'GET',
      req: {
        headers: {},
        url: `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/traces`,
      } as never,
      res: { setHeader: vi.fn() } as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json.mock.calls[0]?.[1]).toBe(200);
    expectDisplaySafeTraceProjection(JSON.stringify(json.mock.calls[0]?.[2]));
  });

  it('projects malicious trace names before REST and ordinary task event SSE output', async () => {
    const deps = createDefaultNodeApiDeps();
    const taskId = 'task_trace_projection_name';
    const trace = await seedTraceProjectionTask(deps, taskId);
    const maliciousTrace: TaskTraceEventRecord = {
      ...trace,
      id: `${taskId}_trace_name_malicious`,
      category: 'error',
      status: 'error',
      name: 'runner.embedded_secret_trace TOKEN=abc /internal/diagnostic_entrypoint required_permissions',
      summary: 'raw event TOKEN=abc secret required_permissions reason_code raw diagnostics /internal/diagnostic_entrypoint',
      details: {
        command: 'TOKEN=abc secret /internal/diagnostic_entrypoint',
        required_permissions: ['project:agent_runner:read'],
        reason_code: 'agent_runner_unavailable',
        diagnostics: 'raw diagnostics',
        diagnostic_entrypoint: '/internal/agent-task/diag',
      },
    };
    await storeTaskTraceEvent(deps, 'ws_default', taskId, maliciousTrace);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskTraces',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId,
      } as never,
      method: 'GET',
      req: {
        headers: {},
        url: `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/traces`,
      } as never,
      res: { setHeader: vi.fn() } as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const restPayload = JSON.stringify(json.mock.calls[0]?.[2]);
    expect(restPayload).toContain('"name":"run.event"');
    expect(restPayload).toContain('Step failed');
    expectNoRawProjectionLeak(restPayload);

    clearNotebookTaskEventState(taskId);
    const snapshot = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events`,
    );
    expect(snapshot.text()).toContain('"name":"run.event"');
    expect(snapshot.text()).toContain('Step failed');
    expectNoRawProjectionLeak(snapshot.text());
    snapshot.req.emit('close');

    clearNotebookTaskEventState(taskId);
    emitNotebookTaskEvent(taskId, { type: 'ping', data: { ok: true } });
    emitNotebookTaskEvent(taskId, { type: 'trace_event', data: maliciousTrace });
    const replay = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:1`,
    );
    expect(replay.text()).toContain('"name":"run.event"');
    expect(replay.text()).toContain('Step failed');
    expectNoRawProjectionLeak(replay.text());
    replay.req.emit('close');

    clearNotebookTaskEventState(taskId);
    const live = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:0`,
    );
    emitNotebookTaskEvent(taskId, { type: 'trace_event', data: maliciousTrace });
    expect(live.text()).toContain('"name":"run.event"');
    expect(live.text()).toContain('Step failed');
    expectNoRawProjectionLeak(live.text());
    live.req.emit('close');
    clearNotebookTaskEventState(taskId);
  });

  it('guards malformed trace at before REST and task event SSE output', async () => {
    const deps = createDefaultNodeApiDeps();
    const taskId = 'task_trace_projection_at';
    const trace = await seedTraceProjectionTask(deps, taskId);
    const unsafeAt = 'TOKEN=abc /internal/raw diagnostics';
    const maliciousTrace: TaskTraceEventRecord = {
      ...trace,
      id: `${taskId}_trace_at_malicious`,
      at: unsafeAt,
    };
    await storeTaskTraceEvent(deps, 'ws_default', taskId, maliciousTrace);

    const json = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskTraces',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId,
      } as never,
      method: 'GET',
      req: {
        headers: {},
        url: `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/traces`,
      } as never,
      res: { setHeader: vi.fn() } as never,
      deps,
      user: { id: 'user_1' } as never,
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json.mock.calls[0]?.[1]).toBe(200);
    const restBody = json.mock.calls[0]?.[2] as { items: Array<{ at?: unknown }> };
    expect(restBody.items).toHaveLength(1);
    expect(restBody.items[0]?.at).not.toBe(unsafeAt);
    expectIsoDateTime(restBody.items[0]?.at);
    const restPayload = JSON.stringify(restBody);
    expect(restPayload).not.toContain(unsafeAt);
    expectNoRawProjectionLeak(restPayload);

    clearNotebookTaskEventState(taskId);
    const snapshot = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events`,
    );
    expectProjectedTraceAtsSafe(snapshot.text(), unsafeAt);
    expectNoRawProjectionLeak(snapshot.text());
    snapshot.req.emit('close');

    clearNotebookTaskEventState(taskId);
    emitNotebookTaskEvent(taskId, { type: 'ping', data: { ok: true } });
    emitNotebookTaskEvent(taskId, { type: 'trace_event', data: maliciousTrace });
    const replay = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:1`,
    );
    expectProjectedTraceAtsSafe(replay.text(), unsafeAt);
    expectNoRawProjectionLeak(replay.text());
    replay.req.emit('close');

    clearNotebookTaskEventState(taskId);
    const live = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:0`,
    );
    emitNotebookTaskEvent(taskId, { type: 'trace_event', data: maliciousTrace });
    expectProjectedTraceAtsSafe(live.text(), unsafeAt);
    expectNoRawProjectionLeak(live.text());
    live.req.emit('close');
    clearNotebookTaskEventState(taskId);
  });

  it('projects non-trace error and unknown task event payloads before SSE replay and live output', async () => {
    const deps = createDefaultNodeApiDeps();
    const taskId = 'task_event_projection_error_payload';
    await seedTraceProjectionTask(deps, taskId);
    const unsafeErrorPayload = {
      type: 'error',
      message: 'raw failure message TOKEN=abc secret /internal/top-level',
      error_message: 'raw diagnostics TOKEN=abc secret',
      data: {
        message: 'raw failure message TOKEN=abc secret required_permissions reason_code raw diagnostics /internal/diagnostic_entrypoint',
        error_message: 'raw diagnostics TOKEN=abc secret',
        code: 'AGENT_UPSTREAM_ERROR_TOKEN_SECRET',
        required_permissions: ['project:agent_runner:read'],
      },
    };
    const unsafeUnknownPayload = {
      type: 'runner.embedded_secret_trace TOKEN=abc',
      message: 'raw event TOKEN=abc secret',
      error_message: 'raw diagnostics TOKEN=abc secret',
      data: {
        required_permissions: ['project:agent_runner:read'],
        diagnostic_entrypoint: '/internal/agent-task/diag',
      },
    };

    clearNotebookTaskEventState(taskId);
    emitNotebookTaskEvent(taskId, { type: 'ping', data: { ok: true } });
    emitNotebookTaskEvent(taskId, unsafeErrorPayload);
    emitNotebookTaskEvent(taskId, unsafeUnknownPayload);
    const replay = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:1`,
    );
    expect(replay.text()).toContain('"type":"error"');
    expect(replay.text()).toContain('Task run failed');
    expect(replay.text()).toContain('TASK_RUN_ERROR');
    expect(replay.text()).toContain('"type":"run.event"');
    expect(replay.text()).toContain('Task event updated');
    expectNoRawProjectionLeak(replay.text());
    replay.req.emit('close');

    clearNotebookTaskEventState(taskId);
    const live = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:0`,
    );
    emitNotebookTaskEvent(taskId, unsafeErrorPayload);
    emitNotebookTaskEvent(taskId, unsafeUnknownPayload);
    expect(live.text()).toContain('"type":"error"');
    expect(live.text()).toContain('Task run failed');
    expect(live.text()).toContain('TASK_RUN_ERROR');
    expect(live.text()).toContain('"type":"run.event"');
    expect(live.text()).toContain('Task event updated');
    expectNoRawProjectionLeak(live.text());
    live.req.emit('close');
    clearNotebookTaskEventState(taskId);
  });

  it('projects malformed trace event payloads as generic task event SSE output', async () => {
    const deps = createDefaultNodeApiDeps();
    const taskId = 'task_event_projection_malformed_trace';
    await seedTraceProjectionTask(deps, taskId);
    const malformedTracePayload = {
      type: 'trace_event',
      data: {
        id: `${taskId}_TOKEN=abc`,
        task_id: taskId,
        name: 'codex.command',
        summary: 'raw event TOKEN=abc secret required_permissions reason_code raw diagnostics /internal/diagnostic_entrypoint',
        details: {
          command: 'TOKEN=abc secret /internal/diagnostic_entrypoint',
          required_permissions: ['project:agent_runner:read'],
          reason_code: 'agent_runner_unavailable',
          diagnostics: 'raw diagnostics',
          diagnostic_entrypoint: '/internal/agent-task/diag',
        },
      },
    };

    clearNotebookTaskEventState(taskId);
    emitNotebookTaskEvent(taskId, { type: 'ping', data: { ok: true } });
    emitNotebookTaskEvent(taskId, malformedTracePayload);
    const replay = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:1`,
    );
    expect(replay.text()).toContain('"type":"run.event"');
    expect(replay.text()).toContain('Task event updated');
    expect(replay.text()).not.toContain('"type":"trace_event"');
    expectNoRawProjectionLeak(replay.text());
    replay.req.emit('close');

    clearNotebookTaskEventState(taskId);
    const live = await openProjectedTaskEvents(
      deps,
      taskId,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:0`,
    );
    emitNotebookTaskEvent(taskId, malformedTracePayload);
    expect(live.text()).toContain('"type":"run.event"');
    expect(live.text()).toContain('Task event updated');
    expect(live.text()).not.toContain('"type":"trace_event"');
    expectNoRawProjectionLeak(live.text());
    live.req.emit('close');
    clearNotebookTaskEventState(taskId);
  });

  it('projects ordinary task event SSE snapshot, replay, and live trace responses', async () => {
    const deps = createDefaultNodeApiDeps();
    const taskId = 'task_trace_projection_events';
    const trace = await seedTraceProjectionTask(deps, taskId);
    await storeTaskTraceEvent(deps, 'ws_default', taskId, trace);
    clearNotebookTaskEventState(taskId);

    const openEvents = async (url: string) => {
      const req = new EventEmitter() as EventEmitter & http.IncomingMessage;
      req.headers = {};
      req.url = url;
      const writes: string[] = [];
      const res = {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        writableEnded: false,
        destroyed: false,
        write: vi.fn((chunk: string) => {
          writes.push(String(chunk));
          return true;
        }),
      } as unknown as http.ServerResponse;
      await expect(handleTaskRoute({
        route: {
          kind: 'taskEvents',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId,
        } as never,
        method: 'GET',
        req: req as never,
        res,
        deps,
        user: { id: 'user_1' } as never,
        json: vi.fn(),
        readBody: vi.fn(),
      })).resolves.toBe(true);
      return {
        req,
        res,
        text: () => writes.join(''),
      };
    };

    const snapshot = await openEvents(
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events`,
    );
    expectDisplaySafeTraceProjection(snapshot.text());
    snapshot.req.emit('close');

    clearNotebookTaskEventState(taskId);
    emitNotebookTaskEvent(taskId, { type: 'ping', data: { ok: true } });
    emitNotebookTaskEvent(taskId, { type: 'trace_event', data: trace });
    const replay = await openEvents(
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:1`,
    );
    expectDisplaySafeTraceProjection(replay.text());
    replay.req.emit('close');

    clearNotebookTaskEventState(taskId);
    const live = await openEvents(
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events?last_event_id=${taskId}:0`,
    );
    emitNotebookTaskEvent(taskId, { type: 'trace_event', data: trace });
    expectDisplaySafeTraceProjection(live.text());
    live.req.emit('close');
    clearNotebookTaskEventState(taskId);
  });

  it('sends the initial notebook task snapshot before flushing live events on fresh SSE subscribe', async () => {
    const deps = createDefaultNodeApiDeps();
    const now = new Date().toISOString();
    const taskId = 'task_events_snapshot_first';
    clearNotebookTaskEventState(taskId);
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), taskId, {
      id: taskId,
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Fresh SSE snapshot ordering',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId,
      runId: 'run_events_snapshot_first',
      runnerId: 'runner_events_snapshot_first',
      resolvedRunnerId: 'runner_events_snapshot_first',
      startedAt: now,
    }))).resolves.toBe(true);

    let releaseAgentLookup!: () => void;
    let notifyAgentLookupStarted!: () => void;
    const agentLookupStarted = new Promise<void>((resolve) => {
      notifyAgentLookupStarted = resolve;
    });
    const agentLookupGate = new Promise<void>((resolve) => {
      releaseAgentLookup = resolve;
    });
    deps.agentResourceService.getAgent = vi.fn(async (_workspaceId, _projectId, agentId) => {
      expect(agentId).toBe('runner_events_snapshot_first');
      notifyAgentLookupStarted();
      await agentLookupGate;
      return {
        id: 'runner_events_snapshot_first',
        name: 'Runner One',
        status: 'enabled',
        runner_provider: 'developer',
        presence: 'online',
      } as never;
    });

    const req = new EventEmitter() as EventEmitter & http.IncomingMessage;
    req.headers = {};
    req.url = `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${taskId}/events`;
    const writes: string[] = [];
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      writableEnded: false,
      destroyed: false,
      write: vi.fn((chunk: string) => {
        writes.push(chunk);
        return true;
      }),
    } as unknown as http.ServerResponse;

    const routePromise = handleTaskRoute({
      route: {
        kind: 'taskEvents',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId,
      } as never,
      method: 'GET',
      req: req as never,
      res,
      deps,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    });

    await agentLookupStarted;
    emitNotebookTaskEvent(taskId, {
      type: 'activity_item',
      data: {
        id: 'msg_live_after_subscribe',
        task_id: taskId,
        kind: 'runner_output',
        actor: 'runner',
        content: 'live update',
        created_at: now,
      },
    });
    releaseAgentLookup();
    await expect(routePromise).resolves.toBe(true);

    const payload = writes.join('');
    const snapshotIndex = payload.indexOf('"type":"task_update"');
    const liveIndex = payload.indexOf('msg_live_after_subscribe');
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(liveIndex).toBeGreaterThan(snapshotIndex);
    expect(payload).toContain('"runner_id":"runner_events_snapshot_first"');
    expect(payload).not.toContain('"agent_id"');
    expect(payload).not.toContain('"agent_name"');

    req.emit('close');
    clearNotebookTaskEventState(taskId);
  });

  it('prefers the configured public api base for terminal websocket urls', () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:21000/';
    try {
      const resolved = resolveTerminalWebSocketBaseUrl({
        headers: {
          host: 'localhost:3101',
          'x-forwarded-host': 'localhost:3101',
          'x-forwarded-proto': 'http',
        },
      } as never);

      expect(resolved).toBe('ws://localhost:21000');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('rewrites client-visible mount access for internal agents when internal overrides are configured', () => {
    const previousMetaHost = process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousMetaPort = process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
    const previousStorageEndpoint = process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT;
    process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = 'postgres-external.agentsmith-sandbox.svc.cluster.local';
    process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = '5432';
    process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT = 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        runnerProvider: 'managed',
        metadataUrl: 'postgres://jfsu_user:secret@files.example.com:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'https://files.example.com:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/jfs-lib-demo',
      });
    } finally {
      if (previousMetaHost === undefined) delete process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
      else process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = previousMetaHost;
      if (previousMetaPort === undefined) delete process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
      else process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = previousMetaPort;
      if (previousStorageEndpoint === undefined) delete process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT;
      else process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT = previousStorageEndpoint;
    }
  });

  it('rewrites loopback mount access for developer runner execution', () => {
    const previousExternalExecutionBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
    process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = 'http://172.18.0.1:20000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        runnerProvider: 'developer',
        metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@172.18.0.1:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://172.18.0.1:19000/jfs-lib-demo',
      });
    } finally {
      if (previousExternalExecutionBase === undefined) {
        delete process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
      } else {
        process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = previousExternalExecutionBase;
      }
    }
  });

  it('rewrites non-loopback mount access to the docker-manual runner host', () => {
    const previousExternalExecutionBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
    process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = 'http://host.docker.internal:20000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        runnerProvider: 'developer',
        metadataUrl: 'postgres://jfsu_user:secret@mbos.imotion.ai:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://mbos.imotion.ai:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@host.docker.internal:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://host.docker.internal:19000/jfs-lib-demo',
      });
    } finally {
      if (previousExternalExecutionBase === undefined) {
        delete process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
      } else {
        process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = previousExternalExecutionBase;
      }
    }
  });

  it('prefers explicit developer runner JuiceFS overrides when configured', () => {
    const previousExternalExecutionBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
    const previousExternalMetaHost = process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_HOST_OVERRIDE;
    const previousExternalMetaPort = process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_PORT_OVERRIDE;
    const previousExternalStorageEndpoint = process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
    process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = 'http://host.docker.internal:20000';
    process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_HOST_OVERRIDE = '192.168.0.220';
    process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_PORT_OVERRIDE = '15432';
    process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = 'http://192.168.0.220:19000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        runnerProvider: 'developer',
        metadataUrl: 'postgres://jfsu_user:secret@files.example.com:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://files.example.com:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://192.168.0.220:19000/jfs-lib-demo',
      });
    } finally {
      if (previousExternalExecutionBase === undefined) delete process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = previousExternalExecutionBase;
      if (previousExternalMetaHost === undefined) delete process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_HOST_OVERRIDE;
      else process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_HOST_OVERRIDE = previousExternalMetaHost;
      if (previousExternalMetaPort === undefined) delete process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_PORT_OVERRIDE;
      else process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_META_PORT_OVERRIDE = previousExternalMetaPort;
      if (previousExternalStorageEndpoint === undefined) delete process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
      else process.env.AGENT_RUNNER_DEVELOPER_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = previousExternalStorageEndpoint;
    }
  });

  it('leaves developer runner mount access to the provider adapter instead of selecting compose runtime in the route', () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousManagedExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    const previousMinioEndpoint = process.env.MINIO_ENDPOINT;
    const previousMinioPort = process.env.MINIO_PORT;
    const previousMinioUseSsl = process.env.MINIO_USE_SSL;
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.DATABASE_URL = 'postgresql://mbos:secret@postgres:5432/mbos';
    process.env.MINIO_ENDPOINT = 'minio';
    process.env.MINIO_PORT = '9000';
    process.env.MINIO_USE_SSL = 'false';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        runnerProvider: 'developer',
        metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      });
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousManagedExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousManagedExecutionHttpBase;
      if (previousMinioEndpoint === undefined) delete process.env.MINIO_ENDPOINT;
      else process.env.MINIO_ENDPOINT = previousMinioEndpoint;
      if (previousMinioPort === undefined) delete process.env.MINIO_PORT;
      else process.env.MINIO_PORT = previousMinioPort;
      if (previousMinioUseSsl === undefined) delete process.env.MINIO_USE_SSL;
      else process.env.MINIO_USE_SSL = previousMinioUseSsl;
    }
  });

  it('ignores docker-manual runtime selectors in task route mount resolution', () => {
    const previousManagedExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    const previousDockerManualHost = process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousDockerManualPort = process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
    const previousDockerManualEndpoint = process.env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
    const previousClientPgPort = process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT;
    const previousMinioApiPort = process.env.MINIO_API_PORT;
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE = 'host.docker.internal';
    process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE = '15432';
    process.env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = 'http://host.docker.internal:19000';
    process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT = '15432';
    process.env.MINIO_API_PORT = '19000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        runnerProvider: 'developer',
        metadataUrl: 'postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://192.168.0.220:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@192.168.0.220:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://192.168.0.220:19000/jfs-lib-demo',
      });
    } finally {
      if (previousManagedExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousManagedExecutionHttpBase;
      if (previousDockerManualHost === undefined) delete process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
      else process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE = previousDockerManualHost;
      if (previousDockerManualPort === undefined) delete process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
      else process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE = previousDockerManualPort;
      if (previousDockerManualEndpoint === undefined) delete process.env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
      else process.env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE = previousDockerManualEndpoint;
      if (previousClientPgPort === undefined) delete process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT;
      else process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT = previousClientPgPort;
      if (previousMinioApiPort === undefined) delete process.env.MINIO_API_PORT;
      else process.env.MINIO_API_PORT = previousMinioApiPort;
    }
  });

  it('rewrites loopback mount access for internal agent execution', () => {
    const previousMetaHost = process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousMetaPort = process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
    const previousStorageEndpoint = process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT;
    process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = 'postgres-external.agentsmith-sandbox.svc.cluster.local';
    process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = '5432';
    process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT = 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000';
    try {
      const resolved = resolveTaskWorkspaceMountAccess({
        runnerProvider: 'managed',
        metadataUrl: 'postgres://jfsu_user:secret@localhost:15432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://localhost:19000/jfs-lib-demo',
      });

      expect(resolved).toEqual({
        metadataUrl: 'postgres://jfsu_user:secret@postgres-external.agentsmith-sandbox.svc.cluster.local:5432/jfs_lib_demo?sslmode=disable',
        storageBucketUrl: 'http://minio-external.agentsmith-sandbox.svc.cluster.local:9000/jfs-lib-demo',
      });
    } finally {
      if (previousMetaHost === undefined) {
        delete process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
      } else {
        process.env.INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE = previousMetaHost;
      }
      if (previousMetaPort === undefined) {
        delete process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
      } else {
        process.env.INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE = previousMetaPort;
      }
      if (previousStorageEndpoint === undefined) {
        delete process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT;
      } else {
        process.env.JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT = previousStorageEndpoint;
      }
    }
  });

  it('cancels workspace-library artifact fallback downloads when the client disconnects', async () => {
    const docStore = new InMemoryJsonDocStore();
    const now = new Date().toISOString();

    await docStore.upsert('project_file_libraries', 'lib_1', {
      id: 'lib_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Workspace Library',
      status: 'ready',
      filesystem_name: 'flib-workspace-library',
      created_by_user_id: 'user_1',
      created_at: now,
      updated_at: now,
    });
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_1', {
      id: 'task_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Artifact Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      workspace_file_library_id: 'lib_1',
      workspace_file_library_name: 'Workspace Library',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_1', {
      id: 'artifact_1',
      task_id: 'task_1',
      type: 'file',
      title: 'result.txt',
      task_relative_path: '.artifacts/result.txt',
      mime_type: 'text/plain',
      file_size: 12,
      created_at: now,
    });

    const objectStream = new PassThrough();
    const destroySpy = vi.spyOn(objectStream, 'destroy');
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 12,
        metaData: { 'content-type': 'text/plain' },
      }),
      getObject: vi.fn().mockResolvedValue(objectStream),
    });

    const req = new EventEmitter() as http.IncomingMessage;
    req.headers = {};
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/artifacts/artifact_1/download';
    const res = new PassThrough() as PassThrough & http.ServerResponse;
    res.statusCode = 200;
    res.setHeader = vi.fn();

    await expect(handleTaskRoute({
      route: {
        kind: 'taskArtifactDownload',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        artifactId: 'artifact_1',
      } as never,
      method: 'GET',
      req,
      res: res as unknown as http.ServerResponse,
      deps: {
        docStore,
      } as never,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    res.emit('close');

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('cancels artifact fallback downloads when the client already aborted before the bridge attaches listeners', async () => {
    const docStore = new InMemoryJsonDocStore();
    const now = new Date().toISOString();
    await docStore.upsert('project_file_libraries', 'lib_1', {
      id: 'lib_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Workspace Library',
      status: 'ready',
      filesystem_name: 'flib-workspace-library',
      created_by_user_id: 'user_1',
      created_at: now,
      updated_at: now,
    });
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_1', {
      id: 'task_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Artifact Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      workspace_file_library_id: 'lib_1',
      workspace_file_library_name: 'Workspace Library',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_1', {
      id: 'artifact_1',
      task_id: 'task_1',
      type: 'file',
      title: 'result.txt',
      task_relative_path: '.artifacts/result.txt',
      mime_type: 'text/plain',
      file_size: 12,
      created_at: now,
    });

    const objectStream = new PassThrough();
    const destroySpy = vi.spyOn(objectStream, 'destroy');
    let resolveGetObject: ((stream: PassThrough) => void) | null = null;
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 12,
        metaData: { 'content-type': 'text/plain' },
      }),
      getObject: vi.fn().mockImplementation(() => new Promise<PassThrough>((resolve) => {
        resolveGetObject = resolve;
      })),
    });

    const req = new EventEmitter() as http.IncomingMessage & { aborted: boolean };
    req.headers = {};
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/artifacts/artifact_1/download';
    req.aborted = false;
    const res = new PassThrough() as PassThrough & http.ServerResponse;
    res.statusCode = 200;
    res.setHeader = vi.fn();

    const routePromise = handleTaskRoute({
      route: {
        kind: 'taskArtifactDownload',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        artifactId: 'artifact_1',
      } as never,
      method: 'GET',
      req,
      res: res as unknown as http.ServerResponse,
      deps: {
        docStore,
      } as never,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    });

    await new Promise((resolve) => setImmediate(resolve));
    req.aborted = true;
    req.emit('aborted');
    resolveGetObject?.(objectStream);

    await expect(routePromise).resolves.toBe(true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('cancels artifact fallback downloads before statObject resolves and does not continue to getObject', async () => {
    const docStore = new InMemoryJsonDocStore();
    const now = new Date().toISOString();
    await docStore.upsert('project_file_libraries', 'lib_1', {
      id: 'lib_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Workspace Library',
      status: 'ready',
      filesystem_name: 'flib-workspace-library',
      created_by_user_id: 'user_1',
      created_at: now,
      updated_at: now,
    });
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_1', {
      id: 'task_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Artifact Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      workspace_file_library_id: 'lib_1',
      workspace_file_library_name: 'Workspace Library',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_1', {
      id: 'artifact_1',
      task_id: 'task_1',
      type: 'file',
      title: 'result.txt',
      task_relative_path: '.artifacts/result.txt',
      mime_type: 'text/plain',
      file_size: 12,
      created_at: now,
    });

    let resolveStatObject: ((value: { size: number; metaData?: Record<string, string> }) => void) | null = null;
    const getObject = vi.fn();
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockImplementation(() => new Promise((resolve) => {
        resolveStatObject = resolve;
      })),
      getObject,
    });

    const req = new EventEmitter() as http.IncomingMessage & { aborted: boolean };
    req.headers = {};
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/artifacts/artifact_1/download';
    req.aborted = false;
    const res = new PassThrough() as PassThrough & http.ServerResponse;
    res.statusCode = 200;
    res.setHeader = vi.fn();
    res.end = vi.fn();

    const routePromise = handleTaskRoute({
      route: {
        kind: 'taskArtifactDownload',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        artifactId: 'artifact_1',
      } as never,
      method: 'GET',
      req,
      res: res as unknown as http.ServerResponse,
      deps: {
        docStore,
      } as never,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    });

    await new Promise((resolve) => setImmediate(resolve));
    req.aborted = true;
    req.emit('aborted');
    resolveStatObject?.({
      size: 12,
      metaData: { 'content-type': 'text/plain' },
    });

    await expect(routePromise).resolves.toBe(true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(getObject).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('passes the http operation signal into gateway client creation for artifact fallback downloads', async () => {
    const docStore = new InMemoryJsonDocStore();
    const now = new Date().toISOString();
    await docStore.upsert('project_file_libraries', 'lib_1', {
      id: 'lib_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Workspace Library',
      status: 'ready',
      filesystem_name: 'flib-workspace-library',
      created_by_user_id: 'user_1',
      created_at: now,
      updated_at: now,
    });
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_1', {
      id: 'task_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Artifact Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      workspace_file_library_id: 'lib_1',
      workspace_file_library_name: 'Workspace Library',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_1', {
      id: 'artifact_1',
      task_id: 'task_1',
      type: 'file',
      title: 'result.txt',
      task_relative_path: '.artifacts/result.txt',
      mime_type: 'text/plain',
      file_size: 12,
      created_at: now,
    });

    let receivedSignal: AbortSignal | undefined;
    createFileLibraryGatewayClientMock.mockImplementation(async (args: { signal?: AbortSignal }) => {
      receivedSignal = args.signal;
      return await new Promise<never>(() => {});
    });

    const req = new EventEmitter() as http.IncomingMessage & { aborted: boolean };
    req.headers = {};
    req.url = '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/artifacts/artifact_1/download';
    req.aborted = false;
    const res = new EventEmitter() as EventEmitter & http.ServerResponse & {
      setHeader: ReturnType<typeof vi.fn>;
      writableEnded: boolean;
      destroyed: boolean;
      writableDestroyed?: boolean;
    };
    res.statusCode = 200;
    res.setHeader = vi.fn();
    res.writableEnded = false;
    res.destroyed = false;

    const routePromise = handleTaskRoute({
      route: {
        kind: 'taskArtifactDownload',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        artifactId: 'artifact_1',
      } as never,
      method: 'GET',
      req,
      res: res as unknown as http.ServerResponse,
      deps: {
        docStore,
      } as never,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(receivedSignal).toBeInstanceOf(AbortSignal);

    req.aborted = true;
    req.emit('aborted');

    await expect(routePromise).resolves.toBe(true);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('sets a UTF-8 aware attachment header for inline task artifact downloads', async () => {
    const docStore = new InMemoryJsonDocStore();
    const now = new Date().toISOString();
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_inline_1', {
      id: 'task_inline_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Inline Artifact Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_inline_1', {
      id: 'artifact_inline_1',
      task_id: 'task_inline_1',
      type: 'file',
      title: '中文结果.txt',
      mime_type: 'text/plain',
      content: 'hello inline artifact',
      created_at: now,
    });

    const setHeader = vi.fn();
    const end = vi.fn();

    await expect(handleTaskRoute({
      route: {
        kind: 'taskArtifactDownload',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_inline_1',
        artifactId: 'artifact_inline_1',
      } as never,
      method: 'GET',
      req: {
        headers: {},
        url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_inline_1/artifacts/artifact_inline_1/download',
      } as never,
      res: {
        statusCode: 200,
        setHeader,
        end,
      } as never,
      deps: {
        docStore,
      } as never,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    const contentDisposition = readContentDispositionHeader(setHeader);
    expect(contentDisposition.raw).toContain('attachment;');
    expect(contentDisposition.raw).toContain(
      "filename*=UTF-8''%E4%B8%AD%E6%96%87%E7%BB%93%E6%9E%9C.txt",
    );
    expect(contentDisposition.fallback).not.toBeNull();
    expect(contentDisposition.fallback).toMatch(/^[\x20-\x7E]+$/);
    expect(contentDisposition.fallback).toMatch(/\.txt$/);
    expect(end).toHaveBeenCalledWith('hello inline artifact');
  });

  it('sets the same UTF-8 aware attachment header for workspace-library-backed task artifact downloads', async () => {
    const docStore = new InMemoryJsonDocStore();
    const now = new Date().toISOString();
    await docStore.upsert('project_file_libraries', 'lib_utf8_1', {
      id: 'lib_utf8_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'Workspace Library',
      status: 'ready',
      filesystem_name: 'flib-workspace-library',
      created_by_user_id: 'user_1',
      created_at: now,
      updated_at: now,
    });
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_stream_1', {
      id: 'task_stream_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Stream Artifact Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      workspace_file_library_id: 'lib_utf8_1',
      workspace_file_library_name: 'Workspace Library',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await docStore.upsert(notebookTaskArtifactsCollection('ws_default'), 'artifact_stream_1', {
      id: 'artifact_stream_1',
      task_id: 'task_stream_1',
      type: 'file',
      title: '中文图表.png',
      task_relative_path: '.artifacts/中文图表.png',
      mime_type: 'image/png',
      file_size: 12,
      created_at: now,
    });

    const objectStream = new PassThrough();
    createFileLibraryGatewayClientMock.mockResolvedValue({
      statObject: vi.fn().mockResolvedValue({
        size: 12,
        metaData: { 'content-type': 'image/png' },
      }),
      getObject: vi.fn().mockResolvedValue(objectStream),
    });

    const setHeader = vi.fn();
    const res = new PassThrough() as PassThrough & http.ServerResponse;
    res.statusCode = 200;
    res.setHeader = setHeader as never;

    await expect(handleTaskRoute({
      route: {
        kind: 'taskArtifactDownload',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_stream_1',
        artifactId: 'artifact_stream_1',
      } as never,
      method: 'GET',
      req: {
        headers: {},
        url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_stream_1/artifacts/artifact_stream_1/download',
      } as never,
      res: res as unknown as http.ServerResponse,
      deps: {
        docStore,
      } as never,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    objectStream.end(Buffer.from([1, 2, 3]));
    const contentDisposition = readContentDispositionHeader(setHeader);
    expect(contentDisposition.raw).toContain('attachment;');
    expect(contentDisposition.raw).toContain(
      "filename*=UTF-8''%E4%B8%AD%E6%96%87%E5%9B%BE%E8%A1%A8.png",
    );
    expect(contentDisposition.fallback).not.toBeNull();
    expect(contentDisposition.fallback).toMatch(/^[\x20-\x7E]+$/);
    expect(contentDisposition.fallback).toMatch(/\.png$/);
  });

  it('does not use legacy task agent_id for terminal creation when no default runner is available', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const now = new Date().toISOString();
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_1', {
      id: 'task_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Terminal Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    const json = vi.fn();
    const createSession = vi.fn().mockResolvedValue({
      sessionId: 'term_1',
      wsPath: '/terminal/ws/term_1',
    });
    const getAgentSessionDispatchAuthority = vi
      .fn()
      .mockResolvedValue('remote_owned_not_local_dispatchable');

    try {
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
        } as never,
        method: 'POST',
        req: {
          headers: {},
          url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/terminal-sessions',
        } as never,
        res: {
          setHeader: vi.fn(),
        } as never,
        deps: {
          docStore,
          cache,
          notebookTerminalService: {
            createSession,
          },
          agentResourceService: {
            listAgents: vi.fn().mockResolvedValue([]),
          },
          agentExecutionService: {
            getAgentSessionOnlineState: vi.fn().mockReturnValue(true),
            getAgentOnlineState: vi.fn().mockReturnValue(true),
            getAgentSessionDispatchAuthority,
          },
        } as never,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json,
        readBody: vi.fn().mockResolvedValue({}),
      })).resolves.toBe(true);
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
    }

    expect(getAgentSessionDispatchAuthority).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      { error_code: 'agent_runner_unavailable', message: 'agent_runner_unavailable' },
    );
  });

  it('does not use legacy task agent_id for terminal creation when local runner truth has not materialized', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const previousExternalApiBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = 'http://127.0.0.1:20000';
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const now = new Date().toISOString();
    await docStore.upsert(notebookTasksCollection('ws_default'), 'task_1', {
      id: 'task_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Terminal Task',
      agent_id: 'agent_1',
      agent_name: 'Agent One',
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    const json = vi.fn();
    const createSession = vi.fn().mockResolvedValue({
      sessionId: 'term_1',
      wsPath: '/terminal/ws/term_1',
    });

    try {
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
        } as never,
        method: 'POST',
        req: {
          headers: {},
          url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_1/terminal-sessions',
        } as never,
        res: {
          setHeader: vi.fn(),
        } as never,
        deps: {
          docStore,
          cache,
          notebookTerminalService: {
            createSession,
          },
          agentResourceService: {
            listAgents: vi.fn().mockResolvedValue([]),
          },
          agentExecutionService: {
            getAgentSessionOnlineState: vi.fn().mockReturnValue(true),
            getAgentOnlineState: vi.fn().mockReturnValue(true),
            getAgentSessionDispatchAuthority: vi.fn().mockResolvedValue('offline'),
          },
        } as never,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json,
        readBody: vi.fn().mockResolvedValue({}),
      })).resolves.toBe(true);
    } finally {
      if (previousPublicApiBase === undefined) {
        delete process.env.PUBLIC_API_BASE_URL;
      } else {
        process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      }
      if (previousExternalApiBase === undefined) {
        delete process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
      } else {
        process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = previousExternalApiBase;
      }
    }

    expect(createSession).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.anything(),
      409,
      { error_code: 'agent_runner_unavailable', message: 'agent_runner_unavailable' },
    );
  });

  it('inherits the active run resolved runner when creating a terminal session', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const previousExternalApiBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = 'http://127.0.0.1:20000';
    const deps = createDefaultNodeApiDeps();
    try {
      await grantProjectPermissionsForUser(deps, 'user_1', [
        'project:agent_task:use',
        'project:agent_task:terminal',
        'project:agent_runner:manage',
      ]);
      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'active terminal endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        upstream_protocol: 'openai_responses',
      });
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Default runner that must not be re-resolved',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
      } as never);
      const activeRunner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Active run developer runner',
        status: 'enabled',
        runner_provider: 'developer',
        presence: 'online',
        runner_status: 'ready',
        is_default: false,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
      } as never);
      const now = new Date().toISOString();
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_active_terminal_inherit', {
        id: 'task_active_terminal_inherit',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Active run terminal inherit task',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      });
      await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
        taskId: 'task_active_terminal_inherit',
        runId: 'run_active_terminal_inherit',
        resolvedRunnerId: activeRunner.id,
        startedAt: now,
      }))).resolves.toBe(true);
      await expect(getNotebookTaskRunState(deps.cache, 'task_active_terminal_inherit')).resolves.not.toHaveProperty('runner_id');
      deps.agentExecutionService.getAgentSessionDispatchAuthority = vi.fn().mockResolvedValue('local_dispatchable');
      deps.agentExecutionService.getAgentSessionOnlineState = vi.fn().mockReturnValue(true);
      deps.agentExecutionService.getAgentOnlineState = vi.fn().mockReturnValue(true);
      const listAgents = vi.spyOn(deps.agentResourceService, 'listAgents');
      listAgents.mockRejectedValue(new Error('terminal_create_should_inherit_active_run_runner'));
      const createSession = vi.spyOn(deps.notebookTerminalService, 'createSession');

      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_active_terminal_inherit',
        } as never,
        method: 'POST',
        req: {
          headers: { 'x-request-id': 'req_active_terminal_inherit' },
          url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_active_terminal_inherit/terminal/sessions',
        } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json,
        readBody: vi.fn(async () => ({ cols: 100, rows: 32 })),
      })).resolves.toBe(true);

      expect(json.mock.calls[0]?.[1]).toBe(201);
      expect(json.mock.calls[0]?.[2]).toMatchObject({
        runner_id: activeRunner.id,
        runner_session_id: 'task_active_terminal_inherit',
      });
      expect(listAgents).not.toHaveBeenCalled();
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
        agentId: activeRunner.id,
        resolvedRunnerId: activeRunner.id,
        runnerSessionId: 'task_active_terminal_inherit',
        executionContext: expect.objectContaining({
          endpoint_id: endpoint.id,
          model: 'gpt-5-codex',
          wire_api: 'openai_responses',
          agent_task_model: expect.objectContaining({
            endpoint_id: endpoint.id,
            resolved_model: 'gpt-5-codex',
            upstream_protocol: 'openai_responses',
          }),
        }),
      }));
      expect(deps.agentExecutionService.getAgentSessionDispatchAuthority).toHaveBeenCalledWith(
        activeRunner.id,
        'task_active_terminal_inherit',
      );
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      if (previousExternalApiBase === undefined) delete process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = previousExternalApiBase;
    }
  });

  it('returns typed recovery instead of default fallback when active run runner evidence is missing', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    const deps = createDefaultNodeApiDeps();
    try {
      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'missing active runner endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        upstream_protocol: 'openai_responses',
      });
      await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Fallback default that must not be used',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
      } as never);
      const legacyRunnerField = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Legacy active runner field that must not be resolver truth',
        status: 'enabled',
        runner_provider: 'developer',
        presence: 'online',
        runner_status: 'ready',
        is_default: false,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
      } as never);
      const now = new Date().toISOString();
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_active_terminal_missing_runner', {
        id: 'task_active_terminal_missing_runner',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Active run missing runner evidence task',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      });
      await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
        taskId: 'task_active_terminal_missing_runner',
        runId: 'run_active_terminal_missing_runner',
        runnerId: legacyRunnerField.id,
        startedAt: now,
      }))).resolves.toBe(true);
      deps.agentExecutionService.getAgentSessionDispatchAuthority = vi.fn().mockResolvedValue('local_dispatchable');
      deps.agentExecutionService.getAgentSessionOnlineState = vi.fn().mockReturnValue(true);
      deps.agentExecutionService.getAgentOnlineState = vi.fn().mockReturnValue(true);
      const listAgents = vi.spyOn(deps.agentResourceService, 'listAgents');
      listAgents.mockRejectedValue(new Error('terminal_create_should_not_fallback_to_default'));
      const createSession = vi.spyOn(deps.notebookTerminalService, 'createSession');

      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_active_terminal_missing_runner',
        } as never,
        method: 'POST',
        req: {
          headers: { 'x-request-id': 'req_active_terminal_missing_runner' },
          url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_active_terminal_missing_runner/terminal/sessions',
        } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json,
        readBody: vi.fn(async () => ({ cols: 100, rows: 32 })),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(
        expect.anything(),
        409,
        {
          error_code: 'agent_runner_not_resolved',
          message: 'agent_runner_not_resolved',
        },
      );
      expect(listAgents).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('returns typed recovery when an existing terminal session has no resolved runner evidence', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    const deps = createDefaultNodeApiDeps();
    try {
      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'terminal unresolved recovery endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        upstream_protocol: 'openai_responses',
      });
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      const runner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Terminal unresolved recovery default',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
      } as never);
      deps.internalAgentPodManager = {
        ensureAgentReady: vi.fn(async () => undefined),
        keepalive: vi.fn(async () => undefined),
        releasePod: vi.fn(async () => undefined),
      };
      deps.internalAgentWorkspaceBindingManager = {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            mountPath: '/workspace/task',
            metadataUrl: 'postgres://jfsu_user:secret@postgres:5432/jfs_terminal_unresolved?sslmode=disable',
            storageBucketUrl: 'http://localhost:19000/jfs-terminal-unresolved',
          },
        })),
      } as never;
      const now = new Date().toISOString();
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_terminal_unresolved_session', {
        id: 'task_terminal_unresolved_session',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Terminal unresolved session task',
        bound_runner_id: runner.id,
        bound_runner_kind: 'managed',
        runner_binding_source: 'default_managed',
        bound_at: now,
        bound_by_user_id: 'user_1',
        workspace_file_library_id: 'lib_terminal_unresolved',
        workspace_file_library_name: 'Terminal Unresolved Workspace',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      });

      const createJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_terminal_unresolved_session',
        } as never,
        method: 'POST',
        req: {
          headers: {},
          url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_terminal_unresolved_session/terminal/sessions',
        } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: createJson,
        readBody: vi.fn(async () => ({ cols: 80, rows: 24 })),
      })).resolves.toBe(true);
      const createdSession = createJson.mock.calls[0]?.[2] as { terminal_session_id: string };
      const session = await deps.notebookTerminalService.getSession(createdSession.terminal_session_id);
      delete (session as { resolvedRunnerId?: string }).resolvedRunnerId;
      const listAgents = vi.spyOn(deps.agentResourceService, 'listAgents');
      listAgents.mockRejectedValue(new Error('terminal_reconnect_should_not_resolve_default'));

      const getJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSession',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_terminal_unresolved_session',
          terminalSessionId: createdSession.terminal_session_id,
        } as never,
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: getJson,
        readBody: vi.fn(),
      })).resolves.toBe(true);

      expect(getJson).toHaveBeenCalledWith(
        expect.anything(),
        409,
        { error_code: 'terminal_runner_unavailable', message: 'terminal_runner_unavailable' },
      );
      expect(listAgents).not.toHaveBeenCalled();
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('exposes terminal session runner evidence without mutating task active_run', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    const deps = createDefaultNodeApiDeps();
    const ensureAgentReady = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady,
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };
    deps.internalAgentWorkspaceBindingManager = {
      ensureWorkspaceBinding: vi.fn(async (input: {
        workspaceId: string;
        projectId: string;
        fileLibraryId: string;
        taskId: string;
      }) => ({
        binding: {
          id: 'bind_terminal_evidence',
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          file_library_id: input.fileLibraryId,
          kind: 'juicefs_volume',
          status: 'ready',
          metadata_url: 'postgres://jfsu_user:secret@localhost:15432/jfs_terminal_evidence?sslmode=disable',
          storage_bucket_url: 'http://localhost:19000/jfs-terminal-evidence',
          created_at: '2026-04-05T00:00:00.000Z',
          updated_at: '2026-04-05T00:00:00.000Z',
        },
        workspaceMount: {
          bindingId: 'bind_terminal_evidence',
          mountPath: `/workspace/${input.taskId}`,
          fileLibraryId: input.fileLibraryId,
        },
      })),
    } as never;

    try {
      await grantProjectPermissionsForUser(deps, 'user_1', [
        'project:agent_task:use',
        'project:agent_task:terminal',
      ]);
      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'terminal evidence endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        upstream_protocol: 'openai_responses',
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
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      const runner = await deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
        name: 'Default terminal evidence runner',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        endpointId: endpoint.id,
        capabilities: {
          terminal: true,
          artifacts: true,
        },
      } as never);

      const taskCreateJson = vi.fn();
      await expect(handleTaskRoute({
        route: { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
        method: 'POST',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: taskCreateJson,
        readBody: vi.fn(async () => ({
          title: 'Runnerless terminal evidence task',
          prompt: 'Open a terminal only',
          workspace_name: 'Runnerless Terminal Evidence Workspace',
        })),
      })).resolves.toBe(true);
      const createdTask = taskCreateJson.mock.calls[0]?.[2] as {
        id: string;
        active_run?: unknown;
        agent_id?: string;
      };
      expect(createdTask.agent_id).toBeUndefined();
      expect(createdTask.active_run).toBeUndefined();

      const terminalCreateJson = vi.fn();
      const createSession = vi.spyOn(deps.notebookTerminalService, 'createSession');
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: createdTask.id,
        } as never,
        method: 'POST',
        req: {
          headers: { 'x-request-id': 'req_terminal_runner_evidence' },
          url: `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${createdTask.id}/terminal/sessions`,
        } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: terminalCreateJson,
        readBody: vi.fn(async () => ({ cols: 100, rows: 32 })),
      })).resolves.toBe(true);
      const createdSession = terminalCreateJson.mock.calls[0]?.[2] as {
        terminal_session_id: string;
        runner_id?: string;
        runner_session_id?: string;
        ws_url?: string;
      };
      expect(terminalCreateJson.mock.calls[0]?.[1]).toBe(201);
      expect(createdSession).toMatchObject({
        runner_id: runner.id,
        runner_session_id: createdTask.id,
      });
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
        agentId: runner.id,
        resolvedRunnerId: runner.id,
      }));
      expect(createdSession.terminal_session_id).toMatch(/^term_/);
      expect(createdSession).not.toHaveProperty('session_id');
      const terminalWsUrl = new URL(createdSession.ws_url ?? '', 'http://localhost');
      expect(terminalWsUrl.searchParams.get('terminal_session_id')).toBe(createdSession.terminal_session_id);
      expect(terminalWsUrl.searchParams.has('session_id')).toBe(false);
      const listAgentsAfterCreate = vi.spyOn(deps.agentResourceService, 'listAgents');

      const taskGetJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskItem',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: createdTask.id,
        } as never,
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: {} as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: taskGetJson,
        readBody: vi.fn(),
      })).resolves.toBe(true);
      const taskAfterTerminalOpen = taskGetJson.mock.calls[0]?.[2] as {
        active_run?: unknown;
        active_run_started_at?: string;
      };
      expect(taskAfterTerminalOpen.active_run).toBeUndefined();
      expect(taskAfterTerminalOpen.active_run_started_at).toBeUndefined();
      await expect(getNotebookTaskRunState(deps.cache, createdTask.id)).resolves.toBeNull();

      const listJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: createdTask.id,
        } as never,
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: listJson,
        readBody: vi.fn(),
      })).resolves.toBe(true);
      const listBody = listJson.mock.calls[0]?.[2] as { items?: Array<Record<string, unknown>>; total?: number };
      expect(listBody).toMatchObject({
        total: 1,
        items: [
          {
            terminal_session_id: createdSession.terminal_session_id,
            runner_id: runner.id,
            runner_session_id: createdTask.id,
          },
        ],
      });
      expect(listBody.items?.[0]).not.toHaveProperty('id');

      const getJson = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSession',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: createdTask.id,
          terminalSessionId: createdSession.terminal_session_id,
        } as never,
        method: 'GET',
        req: { headers: {}, url: '' } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: getJson,
        readBody: vi.fn(),
      })).resolves.toBe(true);
      const getBody = getJson.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(getBody).toMatchObject({
        terminal_session_id: createdSession.terminal_session_id,
        runner_id: runner.id,
        runner_session_id: createdTask.id,
      });
      expect(getBody).not.toHaveProperty('id');

      const deleteRes = { statusCode: 0, end: vi.fn() };
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSession',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: createdTask.id,
          terminalSessionId: createdSession.terminal_session_id,
        } as never,
        method: 'DELETE',
        req: { headers: {}, url: '' } as never,
        res: deleteRes as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json: vi.fn(),
        readBody: vi.fn(),
      })).resolves.toBe(true);
      expect(deleteRes.statusCode).toBe(204);
      expect(listAgentsAfterCreate).not.toHaveBeenCalled();

      await expect(listAuditEvents(deps.docStore, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2027-01-01T00:00:00.000Z',
        page: 1,
        pageSize: 20,
        sortOrder: 'asc',
        action: 'notebook.task.terminal.opened',
      })).resolves.toMatchObject({
        total: 1,
        items: [
          {
            resource_id: createdSession.terminal_session_id,
            metadata_json: expect.objectContaining({
              task_id: createdTask.id,
              runner_id: runner.id,
              runner_session_id: createdTask.id,
            }),
          },
        ],
      });
      const openedAudit = (await listAuditEvents(deps.docStore, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2027-01-01T00:00:00.000Z',
        page: 1,
        pageSize: 20,
        sortOrder: 'asc',
        action: 'notebook.task.terminal.opened',
      })).items[0];
      expect(openedAudit.metadata_json).not.toHaveProperty('agent_id');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('passes canonical task terminal execution context to terminal session creation', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    const deps = createDefaultNodeApiDeps();
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };
    deps.internalAgentWorkspaceBindingManager = {
      ensureWorkspaceBinding: vi.fn(async (input: {
        workspaceId: string;
        projectId: string;
        fileLibraryId: string;
        taskId: string;
      }) => ({
        binding: {
          id: 'bind_terminal_context',
          workspace_id: input.workspaceId,
          project_id: input.projectId,
          file_library_id: input.fileLibraryId,
          kind: 'juicefs_volume',
          status: 'ready',
          metadata_url: 'postgres://jfsu_user:secret@localhost:15432/jfs_terminal_context?sslmode=disable',
          storage_bucket_url: 'http://localhost:19000/jfs-terminal-context',
          created_at: '2026-04-05T00:00:00.000Z',
          updated_at: '2026-04-05T00:00:00.000Z',
        },
        workspaceMount: {
          bindingId: 'bind_terminal_context',
          mountPath: `/workspace/${input.taskId}`,
          fileLibraryId: input.fileLibraryId,
        },
      })),
    } as never;

    try {
      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'terminal context endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        upstream_protocol: 'openai_responses',
      });
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      const runner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Terminal context runner',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
      } as never);

      const now = new Date().toISOString();
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_terminal_context', {
        id: 'task_terminal_context',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Terminal context task',
        bound_runner_id: runner.id,
        bound_runner_kind: 'managed',
        runner_binding_source: 'default_managed',
        bound_at: now,
        bound_by_user_id: 'user_1',
        workspace_file_library_id: 'lib_terminal_context',
        workspace_file_library_name: 'Terminal Context Workspace',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      });
      const createSession = vi.spyOn(deps.notebookTerminalService, 'createSession');

      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_terminal_context',
        } as never,
        method: 'POST',
        req: {
          headers: {},
          url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_terminal_context/terminal/sessions',
        } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json,
        readBody: vi.fn(async () => ({ cols: 96, rows: 28 })),
      })).resolves.toBe(true);

      expect(json.mock.calls[0]?.[1]).toBe(201);
      expect(createSession).toHaveBeenCalledTimes(1);
      const executionContext = createSession.mock.calls[0]?.[0].executionContext;
      expect(() => assertTaskExecutionContext(executionContext)).not.toThrow();
      expect(executionContext).toMatchObject({
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        task_id: 'task_terminal_context',
        runner_id: runner.id,
        runner_session_scope: 'task_execution',
      });
      expect(executionContext).not.toHaveProperty('session_id');
      expect(executionContext).not.toHaveProperty('agent_id');
      expect(executionContext).not.toHaveProperty('interaction_kind');
      const executionTicket = String(executionContext?.execution_ticket ?? '');
      await expect(resolveInternalTicket(deps.cache, executionTicket, 'agent_execution')).resolves.toMatchObject({
        payload: {
          endpoint_id: endpoint.id,
          task_id: 'task_terminal_context',
          runner_session_id: 'task_terminal_context',
          agent_runner_id: runner.id,
        },
      });
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('creates managed terminal sessions without synchronously waiting for internal pod readiness', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    const deps = createDefaultNodeApiDeps();
    const ensureWorkspaceBinding = vi.fn(async () => {
      throw new Error('workspace_binding_should_wait_for_terminal_runtime_dispatch');
    });
    const ensureAgentReady = vi.fn(async () => {
      throw new Error('agent_ready_should_wait_for_terminal_runtime_dispatch');
    });
    deps.internalAgentPodManager = {
      ensureAgentReady,
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };
    deps.internalAgentWorkspaceBindingManager = {
      ensureWorkspaceBinding,
    } as never;

    try {
      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'terminal async create endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        upstream_protocol: 'openai_responses',
      });
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      const runner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Terminal async create runner',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
      } as never);

      const now = new Date().toISOString();
      await deps.docStore.upsert('project_file_libraries', 'lib_terminal_async_create', {
        id: 'lib_terminal_async_create',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Terminal Async Create Workspace',
        status: 'ready',
        filesystem_name: 'flib-terminal-async-create',
        created_by_user_id: 'user_1',
        created_at: now,
        updated_at: now,
      });
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_terminal_async_create', {
        id: 'task_terminal_async_create',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Terminal async create task',
        bound_runner_id: runner.id,
        bound_runner_kind: 'managed',
        runner_binding_source: 'default_managed',
        bound_at: now,
        bound_by_user_id: 'user_1',
        workspace_file_library_id: 'lib_terminal_async_create',
        workspace_file_library_name: 'Terminal Async Create Workspace',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      });

      const createSession = vi.spyOn(deps.notebookTerminalService, 'createSession');
      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_terminal_async_create',
        } as never,
        method: 'POST',
        req: {
          headers: {},
          url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_terminal_async_create/terminal/sessions',
        } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json,
        readBody: vi.fn(async () => ({ cols: 96, rows: 28 })),
      })).resolves.toBe(true);

      expect(ensureWorkspaceBinding).not.toHaveBeenCalled();
      expect(ensureAgentReady).not.toHaveBeenCalled();
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
        agentId: runner.id,
        runnerSessionId: 'task_terminal_async_create',
        runtimeDispatchContext: {
          managedInternalAgent: {
            workspaceFileLibraryId: 'lib_terminal_async_create',
          },
        },
      }));
      const createdSession = json.mock.calls[0]?.[2] as {
        terminal_session_id: string;
        status: string;
        ws_url: string;
      };
      expect(json.mock.calls[0]?.[1]).toBe(201);
      expect(createdSession).toMatchObject({
        status: 'pending',
      });
      expect(createdSession.terminal_session_id).toMatch(/^term_/);
      expect(createdSession.ws_url).toContain('terminal_session_id=');
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('fails managed terminal session creation before visible session truth when internal API base is missing', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    const previousInternalApiBase = process.env.INTERNAL_API_BASE_URL;
    const previousExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    const previousExecutionWsBase = process.env.AGENT_EXECUTION_WS_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://127.0.0.1:20000/api/v1';
    delete process.env.INTERNAL_API_BASE_URL;
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    delete process.env.AGENT_EXECUTION_WS_BASE_URL;
    const deps = createDefaultNodeApiDeps();
    deps.internalAgentPodManager = {
      checkReady: vi.fn(async () => undefined),
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    } as never;
    deps.internalAgentWorkspaceBindingManager = {
      ensureWorkspaceBinding: vi.fn(async () => ({
        workspaceMount: {
          mountPath: '/workspace/task',
        },
      })),
    } as never;

    try {
      const { runner } = await seedDefaultManagedRunner(deps);
      const now = new Date().toISOString();
      await deps.docStore.upsert('project_file_libraries', 'lib_terminal_missing_api_base', {
        id: 'lib_terminal_missing_api_base',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Terminal Missing Api Base Workspace',
        status: 'ready',
        filesystem_name: 'flib-terminal-missing-api-base',
        created_by_user_id: 'user_1',
        created_at: now,
        updated_at: now,
      });
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_terminal_missing_api_base', {
        id: 'task_terminal_missing_api_base',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Terminal missing api base task',
        bound_runner_id: runner.id,
        bound_runner_kind: 'managed',
        runner_binding_source: 'default_managed',
        bound_at: now,
        bound_by_user_id: 'user_1',
        workspace_file_library_id: 'lib_terminal_missing_api_base',
        workspace_file_library_name: 'Terminal Missing Api Base Workspace',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      });
      const createSession = vi.spyOn(deps.notebookTerminalService, 'createSession');

      const json = vi.fn();
      await expect(handleTaskRoute({
        route: {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_terminal_missing_api_base',
        } as never,
        method: 'POST',
        req: {
          headers: {},
          url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_terminal_missing_api_base/terminal/sessions',
        } as never,
        res: { setHeader: vi.fn() } as never,
        deps,
        user: { id: 'user_1', email: 'user_1@example.com' } as never,
        json,
        readBody: vi.fn(async () => ({ cols: 96, rows: 28 })),
      })).resolves.toBe(true);

      expect(json).toHaveBeenCalledWith(
        expect.anything(),
        409,
        {
          error_code: 'agent_runner_runtime_unavailable',
          message: 'agent_runner_runtime_unavailable',
        },
      );
      expect(createSession).not.toHaveBeenCalled();
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
      if (previousInternalApiBase === undefined) delete process.env.INTERNAL_API_BASE_URL;
      else process.env.INTERNAL_API_BASE_URL = previousInternalApiBase;
      if (previousExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousExecutionHttpBase;
      if (previousExecutionWsBase === undefined) delete process.env.AGENT_EXECUTION_WS_BASE_URL;
      else process.env.AGENT_EXECUTION_WS_BASE_URL = previousExecutionWsBase;
    }
  });

  it('releases the internal task workload when the last live internal terminal session ends without any active run', async () => {
    const previousPublicApiBase = process.env.PUBLIC_API_BASE_URL;
    process.env.PUBLIC_API_BASE_URL = 'http://localhost:20000/api/v1';

    try {
      const deps = createDefaultNodeApiDeps();
      const ensureAgentReady = vi.fn(async () => undefined);
      const releasePod = vi.fn(async () => undefined);
      deps.internalAgentPodManager = {
        ensureAgentReady,
        keepalive: vi.fn(async () => undefined),
        releasePod,
      };
      deps.notebookTerminalService = new NotebookTerminalService(
        deps.cache,
        deps.agentExecutionService,
      );
      deps.internalAgentWorkspaceBindingManager = {
        ensureWorkspaceBinding: vi.fn(async (input: {
          workspaceId: string;
          projectId: string;
          fileLibraryId: string;
          taskId: string;
        }) => ({
          binding: {
            id: 'bind_terminal_internal',
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
            bindingId: 'bind_terminal_internal',
            mountPath: `/workspace/${input.taskId}`,
            fileLibraryId: input.fileLibraryId,
          },
        })),
      } as never;

      const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
        name: 'internal terminal endpoint',
        model: 'gpt-5-codex',
        type: 'custom',
        base_url: 'https://example.com/v1',
        status: 'active',
        upstream_protocol: 'openai_responses',
        model_profile: {
          max_context_tokens: 128000,
        },
      });
      await seedAgentTaskModelSetting(deps, 'proj_1', endpoint.id, 'user_1');
      const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'internal-terminal-agent',
        mode: 'internal',
        interaction_kind: 'notebook',
        status: 'enabled',
        presence: 'managed',
        runner_status: 'ready',
        is_default: true,
        default_endpoint_id: endpoint.id,
        capabilities: {
          task_execution: true,
          terminal: true,
          artifacts: true,
        },
        config: {
          image: 'runner:v1',
          _internal_raw_key: 'ask_test',
        } as never,
        owner_id: 'user_test',
        visibility: 'private',
        execution_preferences_json: {
          task: {
            endpoint_id: endpoint.id,
          },
        },
      });

      const now = new Date().toISOString();
      await deps.docStore.upsert('project_file_libraries', 'lib_internal_terminal', {
        id: 'lib_internal_terminal',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        name: 'Internal Terminal Workspace',
        status: 'ready',
        filesystem_name: 'flib-internal-terminal',
        created_by_user_id: 'user_1',
        created_at: now,
        updated_at: now,
      });
      await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_terminal', {
        id: 'task_internal_terminal',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        owner_user_id: 'user_1',
        title: 'Internal terminal task',
        bound_runner_id: agent.id,
        bound_runner_kind: 'managed',
        runner_binding_source: 'default_managed',
        bound_at: now,
        bound_by_user_id: 'user_1',
        workspace_file_library_id: 'lib_internal_terminal',
        workspace_file_library_name: 'Internal Terminal Workspace',
        status: 'active',
        attached_inputs: [],
        created_at: now,
        updated_at: now,
        last_activity_at: now,
      });

      const createdSessionIds: string[] = [];
      const user = { id: 'user_1', email: 'user_1@example.com' } as never;
      for (let index = 0; index < 2; index += 1) {
        const json = vi.fn();
        await expect(handleTaskRoute({
          route: {
            kind: 'taskTerminalSessions',
            workspaceId: 'ws_default',
            projectId: 'proj_1',
            taskId: 'task_internal_terminal',
          } as never,
          method: 'POST',
          req: {
            headers: {},
            url: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_internal_terminal/terminal/sessions',
          } as never,
          res: { setHeader: vi.fn() } as never,
          deps,
          user,
          json,
          readBody: vi.fn().mockResolvedValue({ cols: 80 + index, rows: 24 + index }),
        })).resolves.toBe(true);
        const createdSession = json.mock.calls[0]?.[2] as {
          terminal_session_id: string;
          session_id?: string;
        };
        expect(createdSession).not.toHaveProperty('session_id');
        createdSessionIds.push(createdSession.terminal_session_id);
      }

      expect(ensureAgentReady).not.toHaveBeenCalled();
      expect(releasePod).not.toHaveBeenCalled();

      for (const [index, sessionId] of createdSessionIds.entries()) {
        const res = { statusCode: 0, end: vi.fn() } as never;
        await expect(handleTaskRoute({
          route: {
            kind: 'taskTerminalSession',
            workspaceId: 'ws_default',
            projectId: 'proj_1',
            taskId: 'task_internal_terminal',
            terminalSessionId: sessionId,
          } as never,
          method: 'DELETE',
          req: { headers: {}, url: '' } as never,
          res,
          deps,
          user,
          json: vi.fn(),
          readBody: vi.fn(),
      })).resolves.toBe(true);
        expect(res.statusCode).toBe(204);
        if (index === 0) {
          expect(releasePod).not.toHaveBeenCalled();
        }
      }

      await vi.waitFor(() => {
        expect(releasePod).toHaveBeenCalledTimes(1);
      });
      expect(releasePod).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        sanitizeWorkloadId('task_internal_terminal'),
      );
    } finally {
      if (previousPublicApiBase === undefined) delete process.env.PUBLIC_API_BASE_URL;
      else process.env.PUBLIC_API_BASE_URL = previousPublicApiBase;
    }
  });

  it('does not route archive or delete hard teardown from legacy task agent fields', async () => {
    const deps = createDefaultNodeApiDeps();
    const requestHardTeardown = vi.fn(async () => undefined);
    const releasePod = vi.fn(async () => undefined);
    deps.internalWorkloadCoordinator = {
      requestHardTeardown,
    } as never;
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod,
    };

    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-archive-delete-agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
      config: {
        image: 'runner:v1',
        _internal_raw_key: 'ask_test',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_internal',
        },
      },
    });

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_archive', {
      id: 'task_internal_archive',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal archive task',
      agent_id: agent.id,
      agent_name: agent.name,
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_delete', {
      id: 'task_internal_delete',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal delete task',
      agent_id: agent.id,
      agent_name: agent.name,
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    const archiveJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskItem',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_archive',
      } as never,
      method: 'PATCH',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: archiveJson,
      readBody: vi.fn(async () => ({ status: 'archived' })),
    })).resolves.toBe(true);

    const deleteJson = vi.fn();
    await expect(handleTaskRoute({
      route: {
        kind: 'taskItem',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_delete',
      } as never,
      method: 'DELETE',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: deleteJson,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(archiveJson.mock.calls[0]?.[2]).not.toHaveProperty('agent_id');
    expect(archiveJson.mock.calls[0]?.[2]).not.toHaveProperty('agent_name');
    expect(requestHardTeardown).not.toHaveBeenCalled();
    expect(releasePod).not.toHaveBeenCalled();
  });

  it('does not fall back to direct releasePod from legacy task agent fields', async () => {
    const deps = createDefaultNodeApiDeps();
    const releasePod = vi.fn(async () => undefined);
    deps.internalWorkloadCoordinator = undefined;
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod,
    };

    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-archive-delete-fallback-agent',
      mode: 'internal',
      interaction_kind: 'notebook',
      status: 'enabled',
      config: {
        image: 'runner:v1',
        _internal_raw_key: 'ask_test',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_internal',
        },
      },
    });

    const now = new Date().toISOString();
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_archive_fallback', {
      id: 'task_internal_archive_fallback',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal archive fallback task',
      agent_id: agent.id,
      agent_name: agent.name,
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });
    await deps.docStore.upsert(notebookTasksCollection('ws_default'), 'task_internal_delete_fallback', {
      id: 'task_internal_delete_fallback',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_1',
      title: 'Internal delete fallback task',
      agent_id: agent.id,
      agent_name: agent.name,
      status: 'active',
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
    });

    await expect(handleTaskRoute({
      route: {
        kind: 'taskItem',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_archive_fallback',
      } as never,
      method: 'PATCH',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(async () => ({ status: 'archived' })),
    })).resolves.toBe(true);

    await expect(handleTaskRoute({
      route: {
        kind: 'taskItem',
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_internal_delete_fallback',
      } as never,
      method: 'DELETE',
      req: { headers: {}, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1' } as never,
      json: vi.fn(),
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(releasePod).not.toHaveBeenCalled();
  });

  it('maps remote-owned runner authority to a distinct route error instead of task_runner_offline', async () => {
    const taskRouteHandlerModule = await import('./task-route-handler.js') as typeof import('./task-route-handler.js') & {
      mapRunnerSessionAuthorityToTaskRouteError?: (authority: string) => string | null;
    };

    expect(
      taskRouteHandlerModule.mapRunnerSessionAuthorityToTaskRouteError?.('remote_owned_not_local_dispatchable'),
    ).toBe('task_runner_remote_owned');
  });
});
