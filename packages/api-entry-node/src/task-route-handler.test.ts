import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  getTasks,
  TASKS_BY_PROJECT,
} from './notebook-task/task-runtime-state.js';
import {
  notebookTaskArtifactsCollection,
  notebookTaskMessagesCollection,
  notebookTasksCollection,
} from './notebook-task/task-store.js';
import { resolveInternalTicket } from './internal-ticket-store.js';

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
  beforeEach(() => {
    ACTIVE_RUNS_BY_TASK.clear();
    ACTIVE_RUN_CANCEL_BY_TASK.clear();
    ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.clear();
    ARTIFACTS_BY_TASK.clear();
    TASKS_BY_PROJECT.clear();
    createFileLibraryGatewayClientMock.mockReset();
    __resetInternalTerminalWorkloadLifecycleForTests();
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
    });
    expect(body).not.toHaveProperty('agent_id');
  });

  it.each(['agent_id', 'agent_name', 'runner_id'])(
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

  it.each(['agent_id', 'agent_name', 'runner_id'])(
    'rejects legacy selector field %s on task run dispatch payload',
    async (field) => {
      const deps = createDefaultNodeApiDeps();
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

  it('resolves the default ready Agent Runner at run dispatch and records runner_id on active_run', async () => {
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
      const runner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
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
              wire_api: 'openai_responses',
            }),
          }),
        );
      });
      const dispatchArg = (deps.agentExecutionService.dispatchStreamingRequest as unknown as ReturnType<typeof vi.fn>)
        .mock.calls[0]?.[0] as { executionContext?: Record<string, unknown> } | undefined;
      expect(dispatchArg?.executionContext).not.toHaveProperty('interaction_kind');
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

  it('fails closed and audits when multiple default Agent Runners are present', async () => {
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
      req: { headers: { 'x-request-id': 'req_conflict' }, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1', email: 'user_1@example.com' } as never,
      json: runJson,
      readBody: vi.fn(async () => ({ intent: 'Run now' })),
    })).resolves.toBe(true);

    expect(runJson).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'agent_runner_default_conflict',
        message: 'agent_runner_default_conflict',
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
      action: 'agent_runner.resolution.failed',
    })).resolves.toMatchObject({
      total: 1,
      items: [
        {
          result: 'error',
          error_code: 'agent_runner_default_conflict',
          metadata_json: expect.objectContaining({
            failure_code: 'agent_runner_default_conflict',
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
      req: { headers: { 'x-request-id': 'req_selection_required' }, url: '' } as never,
      res: {} as never,
      deps,
      user: { id: 'user_1', email: 'user_1@example.com' } as never,
      json: runJson,
      readBody: vi.fn(async () => ({ intent: 'Run now' })),
    })).resolves.toBe(true);

    expect(runJson).toHaveBeenCalledWith(
      expect.anything(),
      409,
      {
        error_code: 'agent_runner_selection_required',
        message: 'agent_runner_selection_required',
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
      action: 'agent_runner.resolution.failed',
    })).resolves.toMatchObject({
      total: 1,
      items: [
        {
          result: 'error',
          error_code: 'agent_runner_selection_required',
          metadata_json: expect.objectContaining({
            failure_code: 'agent_runner_selection_required',
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
        agent_id: agent.id,
        agent_name: agent.name,
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
        agent_id: agent.id,
        agent_name: agent.name,
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
        agent_id: agent.id,
        agent_name: agent.name,
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
    const previousMinioEndpoint = process.env.MINIO_ENDPOINT;
    const previousMinioPort = process.env.MINIO_PORT;
    const previousMinioUseSsl = process.env.MINIO_USE_SSL;
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
      if (previousMinioEndpoint === undefined) delete process.env.MINIO_ENDPOINT;
      else process.env.MINIO_ENDPOINT = previousMinioEndpoint;
      if (previousMinioPort === undefined) delete process.env.MINIO_PORT;
      else process.env.MINIO_PORT = previousMinioPort;
      if (previousMinioUseSsl === undefined) delete process.env.MINIO_USE_SSL;
      else process.env.MINIO_USE_SSL = previousMinioUseSsl;
    }
  });

  it('ignores docker-manual runtime selectors in task route mount resolution', () => {
    const previousDockerManualHost = process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE;
    const previousDockerManualPort = process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE;
    const previousDockerManualEndpoint = process.env.DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE;
    const previousClientPgPort = process.env.FILE_LIBRARY_CLIENT_POSTGRES_PORT;
    const previousMinioApiPort = process.env.MINIO_API_PORT;
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
      const runner = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'Default terminal evidence runner',
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
      expect(createdSession.terminal_session_id).toMatch(/^term_/);
      expect(createdSession).not.toHaveProperty('session_id');
      const terminalWsUrl = new URL(createdSession.ws_url ?? '', 'http://localhost');
      expect(terminalWsUrl.searchParams.get('terminal_session_id')).toBe(createdSession.terminal_session_id);
      expect(terminalWsUrl.searchParams.has('session_id')).toBe(false);

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
          endpoint_id: 'terminal',
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
        agent_id: agent.id,
        agent_name: agent.name,
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
