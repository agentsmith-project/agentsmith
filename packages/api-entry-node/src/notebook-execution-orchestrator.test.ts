import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import { upsertProjectResourcePolicy } from './project-resource-policy-store.js';
import { listAuditEvents } from './audit-usage-store.js';
import { runNotebookTaskWithExecutionAgent } from './notebook-execution-orchestrator.js';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  getNotebookTaskRunState,
} from './notebook-task/task-run-coordination.js';

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('notebook-execution-orchestrator governance preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('emits RESOURCE_POLICY_DENIED and does not dispatch execution when endpoint access is denied', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const endpointId = 'ep_denied';
    await upsertProjectResourcePolicy(docStore, workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: endpointId,
      access_mode: 'allow_list',
      allowed_subjects: [],
    });

    const dispatchStreamingRequest = vi.fn();
    const deps = {
      cache: new InMemoryCache(),
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_1',
          status: 'enabled',
          mode: 'external',
          execution_preferences_json: {
            notebook: {
              endpoint_id: endpointId,
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: endpointId,
          workspace_id: workspaceId,
          project_id: projectId,
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_1',
          name: 'endpoint-1',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 128000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_1',
      workspace_id: workspaceId,
      project_id: projectId,
      owner_user_id: 'user_1',
      title: 'task',
      agent_name: 'agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_1',
    };
    const assistantMessage = {
      id: 'msg_assistant',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    const emitted: Array<{ type: string; data: unknown }> = [];
    let finalized = false;
    await runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_1',
      user: { id: 'user_1', name: 'User 1', email: 'user1@example.com' },
      publicBaseUrl: 'http://localhost:20000',
      buildRunId: () => 'run_1',
      buildProxyUsername: () => 'user_1',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: (_taskId, payload) => {
        emitted.push(payload as { type: string; data: unknown });
      },
      onFinalize: () => {
        finalized = true;
      },
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_1',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });

    expect(dispatchStreamingRequest).not.toHaveBeenCalled();
    const errorEvent = emitted.find((item) => item.type === 'error') as
      | { type: 'error'; data: { code?: string } }
      | undefined;
    expect(errorEvent?.data?.code).toBe('RESOURCE_POLICY_DENIED');
    expect(finalized).toBe(true);

    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 60_000).toISOString();
    const audit = await listAuditEvents(docStore, {
      workspaceId,
      projectId,
      startTime: start,
      endTime: end,
      action: 'notebook.task.run.failed',
      actorType: null,
      actorId: null,
      endUserId: null,
      resourceType: 'notebook_task',
      resourceId: task.id,
      result: 'error',
      sortOrder: 'desc',
      page: 1,
      pageSize: 10,
    });
    expect(audit.items.some((item) => item.error_code === 'RESOURCE_POLICY_DENIED')).toBe(true);
  });

  it('persists final notebook task truth before finalizing the run and emitting terminal SSE updates', async () => {
    const docStore = new InMemoryJsonDocStore();
    const originalUpsert = docStore.upsert.bind(docStore);
    const steps: string[] = [];
    docStore.upsert = async (collection, id, doc) => {
      if (collection === 'project_task_messages' && id === 'msg_final_order') {
        steps.push('persist_message');
      }
      if (collection === 'project_tasks' && id === 'task_final_order') {
        steps.push('persist_task');
      }
      return originalUpsert(collection, id, doc);
    };

    const deps = {
      cache: new InMemoryCache(),
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_final_order',
          status: 'enabled',
          mode: 'external',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_final_order',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_final_order',
          workspace_id: 'ws_final_order',
          project_id: 'proj_final_order',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_final_order',
          name: 'endpoint-final-order',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 128000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest: vi.fn(async () => ({
          requestId: 'req_final_order',
          cancel: () => undefined,
          stream: (async function* stream() {
            yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
          })(),
        })),
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_final_order',
      workspace_id: 'ws_final_order',
      project_id: 'proj_final_order',
      owner_user_id: 'user_final_order',
      title: 'final order task',
      agent_name: 'external agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_final_order',
    };
    const assistantMessage = {
      id: 'msg_final_order',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    await runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_final_order',
      user: { id: 'user_final_order', name: 'Final Order User', email: 'final@example.com' },
      publicBaseUrl: 'http://localhost:20000',
      buildRunId: () => 'run_final_order',
      buildProxyUsername: () => 'final_order_user',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: (_taskId, payload) => {
        if (payload.type === 'message') {
          steps.push('emit_message');
        }
        if (payload.type === 'task_update') {
          steps.push('emit_task_update');
        }
      },
      onFinalize: () => {
        steps.push('finalize');
      },
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_final_order',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });

    expect(steps).toEqual([
      'persist_message',
      'persist_task',
      'finalize',
      'emit_message',
      'emit_task_update',
    ]);
  });

  it('marks the shared run as finalizing instead of clearing it to idle when terminal truth persistence fails', async () => {
    const docStore = new InMemoryJsonDocStore();
    const originalUpsert = docStore.upsert.bind(docStore);
    docStore.upsert = async (collection, id, doc) => {
      if (
        collection === 'project_task_messages'
        && id === 'msg_finalizing_failure'
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

    const cache = new InMemoryCache();
    const deps = {
      cache,
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_finalizing_failure',
          status: 'enabled',
          mode: 'external',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_finalizing_failure',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_finalizing_failure',
          workspace_id: 'ws_finalizing_failure',
          project_id: 'proj_finalizing_failure',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_finalizing_failure',
          name: 'endpoint-finalizing-failure',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 128000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest: vi.fn(async () => ({
          requestId: 'req_finalizing_failure',
          cancel: () => undefined,
          stream: (async function* stream() {
            yield { type: 'delta', delta: 'final answer' } as const;
            yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
          })(),
        })),
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_finalizing_failure',
      workspace_id: 'ws_finalizing_failure',
      project_id: 'proj_finalizing_failure',
      owner_user_id: 'user_finalizing_failure',
      title: 'finalizing failure task',
      agent_name: 'external agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_finalizing_failure',
    };
    const assistantMessage = {
      id: 'msg_finalizing_failure',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_finalizing_failure',
      startedAt: '2026-03-18T06:30:00.000Z',
    }))).resolves.toBe(true);

    const finalizeCalls: Array<{ durableTerminalTruth: boolean }> = [];
    await runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_finalizing_failure',
      user: { id: 'user_finalizing_failure', name: 'Finalizing Failure User', email: 'failure@example.com' },
      publicBaseUrl: 'http://localhost:20000',
      buildRunId: () => 'run_finalizing_failure',
      buildProxyUsername: () => 'finalizing_failure_user',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: () => undefined,
      onFinalize: (_taskId, _runId, summary) => {
        finalizeCalls.push(summary);
      },
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_finalizing_failure',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });

    expect(finalizeCalls).toEqual([
      expect.objectContaining({ durableTerminalTruth: false }),
    ]);
    await expect(getNotebookTaskRunState(cache, task.id)).resolves.toMatchObject({
      run_id: 'run_finalizing_failure',
      phase: 'finalizing',
      finalization: {
        status: 'persist_failed',
        error_code: 'AGENT_FINALIZE_PERSIST_FAILED',
      },
    });
  });

  it('uses internal execution api base derived from agent execution websocket base', async () => {
    const previousWsBase = process.env.AGENT_EXECUTION_WS_BASE_URL;
    const previousHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.AGENT_EXECUTION_WS_BASE_URL = 'ws://172.19.0.1:20072';
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;

    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_internal',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const acquireHolder = vi.fn(async () => undefined);
    const releaseHolder = vi.fn(async () => undefined);
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_internal',
          status: 'enabled',
          mode: 'internal',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_internal',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_internal',
          workspace_id: 'ws_internal',
          project_id: 'proj_internal',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_internal',
          name: 'endpoint-internal',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 256000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
      internalAgentPodManager: {
        ensureAgentReady: vi.fn(async () => undefined),
      },
      internalWorkloadCoordinator: {
        acquireHolder,
        releaseHolder,
      },
      internalAgentWorkspaceBindingManager: {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            bindingId: 'flib_internal',
            mountPath: '/workspace/task_internal',
          },
          binding: {
            file_library_id: 'flib_internal',
          },
        })),
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_internal',
      workspace_id: 'ws_internal',
      project_id: 'proj_internal',
      owner_user_id: 'user_internal',
      title: 'internal task',
      agent_name: 'internal agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_internal',
      workspace_file_library_id: 'flib_internal',
      workspace_file_library_name: 'Internal Workspace',
    };
    const assistantMessage = {
      id: 'msg_internal',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    try {
      await runNotebookTaskWithExecutionAgent({
        deps,
        task,
        assistantMessage,
        agentId: 'agent_internal',
        user: { id: 'user_internal', name: 'Internal User', email: 'internal@example.com' },
        publicBaseUrl: 'http://localhost:20072',
        buildRunId: () => 'run_internal',
        buildProxyUsername: () => 'internal_user',
        mapTaskMessagesForExecution: () => [],
        updateTaskActivity: () => undefined,
        emitTaskEvent: () => undefined,
        onFinalize: () => undefined,
        debugLog: () => undefined,
        taskCollections: {
          tasks: 'project_tasks',
          messages: 'project_task_messages',
        },
        createTaskArtifact: async () => ({
          id: 'artifact_internal',
          task_id: task.id,
          type: 'file',
          created_at: new Date().toISOString(),
        }),
      });
    } finally {
      if (previousWsBase === undefined) {
        delete process.env.AGENT_EXECUTION_WS_BASE_URL;
      } else {
        process.env.AGENT_EXECUTION_WS_BASE_URL = previousWsBase;
      }
      if (previousHttpBase === undefined) {
        delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
      } else {
        process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousHttpBase;
      }
    }

    expect(dispatchStreamingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          api_base: 'http://172.19.0.1:20072/api/v1',
          execution_ticket: expect.stringMatching(/^exec_/),
          model_context_window: 256000,
          model_auto_compact_token_limit: 230400,
          model_catalog: {
            input_modalities: ['text'],
            supports_search_tool: false,
            supports_parallel_tool_calls: false,
          },
          workspace_binding_mode: 'pre_mounted',
          workspace_path: '/workspace/task_internal',
          workspace_file_library_id: 'flib_internal',
        }),
      }),
    );
    expect(acquireHolder).toHaveBeenCalledWith({
      workspaceId: 'ws_internal',
      projectId: 'proj_internal',
      workloadId: 'task-internal',
      holderKind: 'notebook_run',
      holderId: 'run_internal',
      epoch: 'run_internal',
    });
    expect(releaseHolder).toHaveBeenCalledWith({
      workspaceId: 'ws_internal',
      projectId: 'proj_internal',
      workloadId: 'task-internal',
      holderKind: 'notebook_run',
      holderId: 'run_internal',
      epoch: 'run_internal',
    });
    const dispatchArg = dispatchStreamingRequest.mock.calls[0]?.[0] as { executionContext?: Record<string, unknown> } | undefined;
    expect(dispatchArg?.executionContext).not.toHaveProperty('user_bearer_token');
  });

  it('uses compose-internal api base for compose-managed external agents', async () => {
    const previousInternalApiBase = process.env.INTERNAL_API_BASE_URL;
    const previousExternalApiBase = process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.INTERNAL_API_BASE_URL = 'http://api:20000';
    process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = 'http://host.docker.internal:20000';

    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_external_compose',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_external_compose',
          status: 'enabled',
          mode: 'external',
          config: {
            runner_runtime: 'compose_managed',
          },
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_external',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_external',
          workspace_id: 'ws_external',
          project_id: 'proj_external',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_1',
          name: 'endpoint-external',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          capabilities: [
            { type: 'chat_completion', enabled: true },
            { type: 'multimodal_completion', enabled: true },
          ],
          model_profile: {
            max_context_tokens: 128000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_external_compose',
      workspace_id: 'ws_external',
      project_id: 'proj_external',
      owner_user_id: 'user_external',
      title: 'external compose task',
      agent_name: 'external agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_external_compose',
      workspace_file_library_id: 'flib_external',
      workspace_file_library_name: 'External Workspace',
    };
    const assistantMessage = {
      id: 'msg_external_compose',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    try {
      await runNotebookTaskWithExecutionAgent({
        deps,
        task,
        assistantMessage,
        agentId: 'agent_external_compose',
        user: { id: 'user_external', name: 'External User', email: 'external@example.com' },
        publicBaseUrl: 'http://localhost:20000',
        buildRunId: () => 'run_external_compose',
        buildProxyUsername: () => 'external_user',
        mapTaskMessagesForExecution: () => [],
        updateTaskActivity: () => undefined,
        emitTaskEvent: () => undefined,
        onFinalize: () => undefined,
        debugLog: () => undefined,
        taskCollections: {
          tasks: 'project_tasks',
          messages: 'project_task_messages',
        },
        createTaskArtifact: async () => ({
          id: 'artifact_external',
          task_id: task.id,
          type: 'file',
          created_at: new Date().toISOString(),
        }),
      });
    } finally {
      if (previousInternalApiBase === undefined) delete process.env.INTERNAL_API_BASE_URL;
      else process.env.INTERNAL_API_BASE_URL = previousInternalApiBase;
      if (previousExternalApiBase === undefined) delete process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
      else process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = previousExternalApiBase;
    }

    expect(dispatchStreamingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          api_base: 'http://api:20000/api/v1',
          execution_ticket: expect.stringMatching(/^exec_/),
          model_catalog: {
            input_modalities: ['text', 'image'],
            supports_search_tool: false,
            supports_parallel_tool_calls: false,
          },
          runner_session_scope: 'agent_presence',
          workspace_binding_mode: 'file_library',
          workspace_file_library_id: 'flib_external',
        }),
      }),
    );
    const dispatchArg = dispatchStreamingRequest.mock.calls[0]?.[0] as { executionContext?: Record<string, unknown> } | undefined;
    expect(dispatchArg?.executionContext).not.toHaveProperty('user_bearer_token');
  });

  it('keeps responses wire_api stable for external notebook dispatch regardless of endpoint protocol', async () => {
    const previousInternalApiBase = process.env.INTERNAL_API_BASE_URL;
    process.env.INTERNAL_API_BASE_URL = 'http://api:20000';

    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_external_responses',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_external_responses',
          status: 'enabled',
          mode: 'external',
          config: {
            runner_runtime: 'compose_managed',
          },
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_anthropic',
              wire_api: 'responses',
              model: 'placeholder-model',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_anthropic',
          workspace_id: 'ws_external',
          project_id: 'proj_external',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_1',
          name: 'endpoint-anthropic',
          type: 'catalog',
          provider_family: 'anthropic',
          upstream_protocol: 'anthropic_messages',
          base_url: 'https://anthropic.example.com/v1',
          model_profile: {
            max_context_tokens: 128000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_external_responses',
      workspace_id: 'ws_external',
      project_id: 'proj_external',
      owner_user_id: 'user_external',
      title: 'external responses task',
      agent_name: 'external agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_external_responses',
      workspace_file_library_id: 'flib_external',
      workspace_file_library_name: 'External Workspace',
    };
    const assistantMessage = {
      id: 'msg_external_responses',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    try {
      await runNotebookTaskWithExecutionAgent({
        deps,
        task,
        assistantMessage,
        agentId: 'agent_external_responses',
        user: { id: 'user_external', name: 'External User', email: 'external@example.com' },
        publicBaseUrl: 'http://localhost:20000',
        buildRunId: () => 'run_external_responses',
        buildProxyUsername: () => 'external_user',
        mapTaskMessagesForExecution: () => [{ role: 'user', content: 'reply exactly OK' }],
        updateTaskActivity: () => undefined,
        emitTaskEvent: () => undefined,
        onFinalize: () => undefined,
        debugLog: () => undefined,
        taskCollections: {
          tasks: 'project_tasks',
          messages: 'project_task_messages',
        },
        createTaskArtifact: async () => ({
          id: 'artifact_external_responses',
          task_id: task.id,
          type: 'file',
          created_at: new Date().toISOString(),
        }),
      });
    } finally {
      if (previousInternalApiBase === undefined) delete process.env.INTERNAL_API_BASE_URL;
      else process.env.INTERNAL_API_BASE_URL = previousInternalApiBase;
    }

    expect(dispatchStreamingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'placeholder-model',
        messages: [{ role: 'user', content: 'reply exactly OK' }],
        executionContext: expect.objectContaining({
          endpoint_id: 'ep_anthropic',
          wire_api: 'responses',
          model: 'placeholder-model',
          api_base: 'http://api:20000/api/v1',
        }),
      }),
    );
  });

  it('persists a fallback assistant message when execution fails before any visible output', async () => {
    const docStore = new InMemoryJsonDocStore();
    const deps = {
      cache: new InMemoryCache(),
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_empty_error',
          status: 'enabled',
          mode: 'external',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_empty_error',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_empty_error',
          workspace_id: 'ws_empty_error',
          project_id: 'proj_empty_error',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_1',
          name: 'endpoint-empty-error',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 128000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest: vi.fn(async () => ({
          requestId: 'req_empty_error',
          cancel: () => undefined,
          stream: (async function* stream() {
            yield {
              type: 'error',
              error_code: 'AGENT_EMPTY_OUTPUT',
              error_message: 'agent_completed_without_visible_output',
            };
          })(),
        })),
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_empty_error',
      workspace_id: 'ws_empty_error',
      project_id: 'proj_empty_error',
      owner_user_id: 'user_empty_error',
      title: 'empty error task',
      agent_name: 'external agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_empty_error',
    };
    const assistantMessage = {
      id: 'msg_empty_error',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    await runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_empty_error',
      user: { id: 'user_empty_error', name: 'Empty Error User', email: 'empty@example.com' },
      publicBaseUrl: 'http://localhost:20000',
      buildRunId: () => 'run_empty_error',
      buildProxyUsername: () => 'empty_error_user',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: () => undefined,
      onFinalize: () => undefined,
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_empty_error',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });

    expect(assistantMessage.content).toContain('Execution failed before any visible output was produced.');
    expect(assistantMessage.content).toContain('AGENT_EMPTY_OUTPUT');
  });

  it('derives model context window and compact token limit from endpoint profile for external notebook runs', async () => {
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_external',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_external',
          status: 'enabled',
          mode: 'external',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_external',
              model: 'placeholder-model',
              wire_api: 'responses',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_external',
          workspace_id: 'ws_external',
          project_id: 'proj_external',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_external',
          name: 'endpoint-external',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 200000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_external',
      workspace_id: 'ws_external',
      project_id: 'proj_external',
      owner_user_id: 'user_external',
      title: 'external task',
      agent_name: 'external agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_external',
    };
    const assistantMessage = {
      id: 'msg_external',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    await runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_external',
      user: { id: 'user_external', name: 'External User', email: 'external@example.com' },
      publicBaseUrl: 'http://localhost:20000',
      buildRunId: () => 'run_external',
      buildProxyUsername: () => 'external_user',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: () => undefined,
      onFinalize: () => undefined,
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_external',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });

    expect(dispatchStreamingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          model_context_window: 200000,
          model_auto_compact_token_limit: 180000,
          model_catalog: {
            input_modalities: ['text'],
            supports_search_tool: false,
            supports_parallel_tool_calls: false,
          },
        }),
      }),
    );
  });

  it('fails fast when endpoint model profile is missing a valid max context window', async () => {
    const dispatchStreamingRequest = vi.fn();
    const emitted: Array<{ type: string; data: unknown }> = [];
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_invalid_window',
          status: 'enabled',
          mode: 'external',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_invalid',
              model: 'placeholder-model',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_invalid',
          workspace_id: 'ws_invalid',
          project_id: 'proj_invalid',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_invalid',
          name: 'endpoint-invalid',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 0,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_invalid',
      workspace_id: 'ws_invalid',
      project_id: 'proj_invalid',
      owner_user_id: 'user_invalid',
      title: 'invalid task',
      agent_name: 'invalid agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_invalid_window',
    };
    const assistantMessage = {
      id: 'msg_invalid',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    await runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_invalid_window',
      user: { id: 'user_invalid', name: 'Invalid User', email: 'invalid@example.com' },
      publicBaseUrl: 'http://localhost:20000',
      buildRunId: () => 'run_invalid',
      buildProxyUsername: () => 'invalid_user',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: (_taskId, payload) => {
        emitted.push(payload as { type: string; data: unknown });
      },
      onFinalize: () => undefined,
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_invalid',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });

    expect(dispatchStreamingRequest).not.toHaveBeenCalled();
    const errorEvent = emitted.find((item) => item.type === 'error') as
      | { type: 'error'; data: { code?: string } }
      | undefined;
    expect(errorEvent?.data?.code).toBe('ENDPOINT_MODEL_CONTEXT_WINDOW_INVALID');
  });

  it('registers and releases an internal notebook workload holder around the active run', async () => {
    const streamGate = createDeferred<void>();
    const releasePod = vi.fn(async () => undefined);
    const internalWorkloadCoordinator = new InternalWorkloadCoordinator({
      keepalive: vi.fn(async () => undefined),
      releasePod,
    });
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_internal_hold',
      cancel: () => undefined,
      stream: (async function* stream() {
        await streamGate.promise;
        yield { type: 'done', finish_reason: 'stop', usage_tokens: 5 };
      })(),
    }));
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_internal_hold',
          status: 'enabled',
          mode: 'internal',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_internal_hold',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_internal_hold',
          workspace_id: 'ws_internal_hold',
          project_id: 'proj_internal_hold',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_internal_hold',
          name: 'endpoint-internal-hold',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 256000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
      internalWorkloadCoordinator,
      internalAgentPodManager: {
        ensureAgentReady: vi.fn(async () => undefined),
        keepalive: vi.fn(async () => undefined),
      },
      internalAgentWorkspaceBindingManager: {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            bindingId: 'flib_internal_hold',
            mountPath: '/workspace/task_internal_hold',
          },
          binding: {
            file_library_id: 'flib_internal_hold',
          },
        })),
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_internal_hold',
      workspace_id: 'ws_internal_hold',
      project_id: 'proj_internal_hold',
      owner_user_id: 'user_internal_hold',
      title: 'internal hold task',
      agent_name: 'internal agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_internal_hold',
      workspace_file_library_id: 'flib_internal_hold',
      workspace_file_library_name: 'Internal Hold Workspace',
    };
    const assistantMessage = {
      id: 'msg_internal_hold',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    const runPromise = runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_internal_hold',
      user: { id: 'user_internal_hold', name: 'Internal Hold User', email: 'internal-hold@example.com' },
      publicBaseUrl: 'http://localhost:20072',
      buildRunId: () => 'run_internal_hold',
      buildProxyUsername: () => 'internal_hold_user',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: () => undefined,
      onFinalize: () => undefined,
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_internal_hold',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });

    await vi.waitFor(() => {
      expect(dispatchStreamingRequest).toHaveBeenCalledTimes(1);
      expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([
        {
          workspaceId: 'ws_internal_hold',
          projectId: 'proj_internal_hold',
          workloadId: 'task-internal-hold',
          holders: ['notebook_run:run_internal_hold'],
          hardTeardownRequested: false,
        },
      ]);
    });

    streamGate.resolve();
    await runPromise;

    expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);
    expect(releasePod).not.toHaveBeenCalled();
    await internalWorkloadCoordinator.shutdown();
  });

  it('passes startup abort to internal ensureAgentReady and persists cancelled terminal truth before dispatch', async () => {
    const dispatchStreamingRequest = vi.fn();
    const ensureAgentReady = vi.fn(async (input: { signal?: AbortSignal }) => {
      if (!input.signal) {
        throw new Error('missing_startup_signal');
      }
      await new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('user_cancel_requested'), {
            code: 'AGENT_CANCELLED',
          }));
        }, { once: true });
      });
    });
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_internal_abort',
          status: 'enabled',
          mode: 'internal',
          config: {
            image: 'runner:v1',
            _internal_raw_key: 'ask_test',
          },
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_internal_abort',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_internal_abort',
          workspace_id: 'ws_internal_abort',
          project_id: 'proj_internal_abort',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_internal_abort',
          name: 'endpoint-internal-abort',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 256000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
      internalAgentPodManager: {
        ensureAgentReady,
      },
      internalAgentWorkspaceBindingManager: {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            bindingId: 'flib_internal_abort',
            mountPath: '/workspace/task_internal_abort',
          },
          binding: {
            file_library_id: 'flib_internal_abort',
          },
        })),
      },
      internalWorkloadCoordinator: {
        acquireHolder: vi.fn(async () => undefined),
        releaseHolder: vi.fn(async () => undefined),
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_internal_abort',
      workspace_id: 'ws_internal_abort',
      project_id: 'proj_internal_abort',
      owner_user_id: 'user_internal_abort',
      title: 'internal abort task',
      agent_name: 'internal agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_internal_abort',
      workspace_file_library_id: 'flib_internal_abort',
      workspace_file_library_name: 'Internal Abort Workspace',
    };
    const assistantMessage = {
      id: 'msg_internal_abort',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };
    const emitted: Array<{ type: string; data: unknown }> = [];
    const finalizeCalls: Array<{ durableTerminalTruth: boolean }> = [];
    const controller = new AbortController();

    const runPromise = runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_internal_abort',
      user: { id: 'user_internal_abort', name: 'Internal Abort User', email: 'internal-abort@example.com' },
      publicBaseUrl: 'http://localhost:20072',
      buildRunId: () => 'run_internal_abort',
      buildProxyUsername: () => 'internal_abort_user',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: (_taskId, payload) => {
        emitted.push(payload as { type: string; data: unknown });
      },
      onFinalize: (_taskId, _runId, summary) => {
        finalizeCalls.push(summary);
      },
      isCancellationRequested: async () => controller.signal.aborted,
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_internal_abort',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
      startupSignal: controller.signal,
    } as never);

    await vi.waitFor(() => {
      expect(ensureAgentReady).toHaveBeenCalledTimes(1);
    });
    controller.abort('user_cancel_requested');
    await runPromise;

    expect(ensureAgentReady).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: task.id,
      signal: controller.signal,
    }));
    expect(dispatchStreamingRequest).not.toHaveBeenCalled();
    expect(assistantMessage.content).toContain('AGENT_CANCELLED');
    expect(assistantMessage.content.length).toBeGreaterThan(0);
    expect(finalizeCalls).toEqual([
      expect.objectContaining({ durableTerminalTruth: true }),
    ]);
    expect(emitted.find((item) => item.type === 'error')).toMatchObject({
      type: 'error',
      data: expect.objectContaining({
        code: 'AGENT_CANCELLED',
      }),
    });
    expect(emitted.find((item) => (
      item.type === 'trace_event'
      && typeof item.data === 'object'
      && item.data !== null
      && !Array.isArray(item.data)
      && (item.data as { name?: unknown }).name === 'run.user_cancel'
    ))).toBeTruthy();
  });

  it('treats a rejected late dispatch fence as terminal cancel and never consumes the old stream', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    let streamConsumed = false;
    const deps = {
      cache,
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_late_dispatch_cancelled',
          status: 'enabled',
          mode: 'external',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_late_dispatch_cancelled',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_late_dispatch_cancelled',
          workspace_id: 'ws_late_dispatch_cancelled',
          project_id: 'proj_late_dispatch_cancelled',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_late_dispatch_cancelled',
          name: 'endpoint-late-dispatch-cancelled',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          model_profile: {
            max_context_tokens: 128000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest: vi.fn(async () => ({
          requestId: 'req_late_dispatch_cancelled',
          cancel: () => undefined,
          stream: (async function* stream() {
            streamConsumed = true;
            yield { type: 'delta', delta: 'stale success content' } as const;
            yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
          })(),
        })),
      },
    } as unknown as NodeApiDeps;

    const task = {
      id: 'task_late_dispatch_cancelled',
      workspace_id: 'ws_late_dispatch_cancelled',
      project_id: 'proj_late_dispatch_cancelled',
      owner_user_id: 'user_late_dispatch_cancelled',
      title: 'late dispatch cancelled task',
      agent_name: 'external agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_late_dispatch_cancelled',
    };
    const assistantMessage = {
      id: 'msg_late_dispatch_cancelled',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };

    await expect(acquireNotebookTaskRunLease(cache, buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_replacement_dispatch',
      requestId: 'req_existing_second_run',
      startedAt: new Date().toISOString(),
    }))).resolves.toBe(true);

    const emitted: Array<{ type: string; data: unknown }> = [];
    const finalizeCalls: Array<{ durableTerminalTruth: boolean }> = [];

    await runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_late_dispatch_cancelled',
      user: {
        id: 'user_late_dispatch_cancelled',
        name: 'Late Dispatch Cancelled User',
        email: 'late-dispatch-cancelled@example.com',
      },
      publicBaseUrl: 'http://localhost:20000',
      buildRunId: () => 'run_late_dispatch_cancelled',
      buildProxyUsername: () => 'late_dispatch_cancelled_user',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: (_taskId, payload) => {
        emitted.push(payload as { type: string; data: unknown });
      },
      onDispatched: () => false,
      onFinalize: (_taskId, _runId, summary) => {
        finalizeCalls.push(summary);
      },
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_late_dispatch_cancelled',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });

    expect(streamConsumed).toBe(false);
    expect(assistantMessage.content).toContain('AGENT_CANCELLED');
    expect(assistantMessage.content).not.toContain('stale success content');
    expect(finalizeCalls).toEqual([
      expect.objectContaining({ durableTerminalTruth: true }),
    ]);
    expect(emitted.find((item) => item.type === 'error')).toMatchObject({
      type: 'error',
      data: expect.objectContaining({
        code: 'AGENT_CANCELLED',
      }),
    });
    await expect(docStore.get('project_task_messages', assistantMessage.id)).resolves.toMatchObject({
      id: assistantMessage.id,
      content: expect.stringContaining('AGENT_CANCELLED'),
    });
    await expect(getNotebookTaskRunState(cache, task.id)).resolves.toMatchObject({
      run_id: 'run_replacement_dispatch',
      request_id: 'req_existing_second_run',
    });
  });
});
