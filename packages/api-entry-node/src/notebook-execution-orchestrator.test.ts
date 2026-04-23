import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import { upsertProjectResourcePolicy } from './project-resource-policy-store.js';
import { listAuditEvents } from './audit-usage-store.js';
import { runNotebookTaskWithExecutionAgent } from './notebook-execution-orchestrator.js';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import type { NodeApiDeps } from './node-api-deps.js';

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
          type: 'openai',
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
          type: 'openai',
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
    });
    expect(releaseHolder).toHaveBeenCalledWith({
      workspaceId: 'ws_internal',
      projectId: 'proj_internal',
      workloadId: 'task-internal',
      holderKind: 'notebook_run',
      holderId: 'run_internal',
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
          type: 'openai',
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
          type: 'openai',
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
          type: 'openai',
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
          type: 'openai',
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
          type: 'openai',
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
});
