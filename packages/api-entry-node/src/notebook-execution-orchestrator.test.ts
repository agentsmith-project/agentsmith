import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import { upsertProjectResourcePolicy } from './project-resource-policy-store.js';
import { listAuditEvents } from './audit-usage-store.js';
import {
  resolveExecutionApiBase,
  runNotebookTaskWithExecutionAgent,
} from './notebook-execution-orchestrator.js';
import type { AgentTaskModelResolvedTarget } from './agent-task-model-setting-service.js';
import { InternalWorkloadCoordinator } from './internal-workload-coordinator.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  getNotebookTaskRunState,
} from './notebook-task/task-run-coordination.js';
import { JsonDocTaskFileLibraryBindingRepo } from './notebook-task/task-file-library-bindings.js';
import { resolveInternalTicket } from './internal-ticket-store.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';
import {
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
} from './developer-runner-workspace-blocker.js';
import { putContextEntry } from './context-store.js';
import { createUserExternalConnection } from './user-external-connections-store.js';

const NOTEBOOK_EXECUTION_MANAGED_RUNNER_IMAGE = `kind-registry:5000/mbos/agentsmith-managed-runner@sha256:${'f'.repeat(64)}`;

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

async function seedAgentTaskModelSetting(
  docStore: InMemoryJsonDocStore,
  input: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    defaultModel?: string;
  },
): Promise<void> {
  await docStore.upsert(
    resolveWorkspaceScopedCollection('agent_task_model_settings', input.workspaceId),
    `project:${input.projectId}`,
    {
      id: `project:${input.projectId}`,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      endpoint_id: input.endpointId,
      default_model_id: input.defaultModel ?? 'placeholder-model',
      setting_revision: `set_${input.endpointId}`,
      updated_at: '2026-05-07T00:00:00.000Z',
      updated_by_user_id: 'test_admin',
    },
  );
}

async function seedReadyTaskWorkspaceLibrary(
  docStore: InMemoryJsonDocStore,
  input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    ownerUserId: string;
    name?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await docStore.upsert('project_file_libraries', input.libraryId, {
    id: input.libraryId,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    name: input.name ?? input.libraryId,
    status: 'ready',
    version: 1,
    file_library_home_segment: `flibhome_${input.libraryId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}`,
    source: 'agent_task_files',
    created_by_user_id: input.ownerUserId,
    created_at: now,
    updated_at: now,
  });
}

function attachManagedExecutionDeps<T extends Record<string, unknown>>(deps: T): T {
  Object.assign(deps, {
    internalAgentPodManager: {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
    },
    internalAgentWorkspaceBindingManager: {
      ensureWorkspaceBinding: vi.fn(async (input: {
        fileLibraryId: string;
        taskHomeSegment: string;
      }) => {
        const taskHomePath = `/home/${input.taskHomeSegment}`;
        const workspacePath = `${taskHomePath}/workspace`;
        return {
          workspaceMount: {
            bindingId: `wmb_${input.fileLibraryId}`,
            mountPath: taskHomePath,
            taskHomePath,
            workspacePath,
            artifactsPath: `${workspacePath}/.artifacts`,
          },
          binding: {
            file_library_id: input.fileLibraryId,
            task_home_binding_id: `wmb_${input.fileLibraryId}`,
            afscp_mount_binding_id: `wmb_${input.fileLibraryId}`,
            mount_binding_status: 'issued',
          },
        };
      }),
    },
    internalWorkloadCoordinator: {
      acquireHolder: vi.fn(async () => undefined),
      releaseHolder: vi.fn(async () => undefined),
    },
  });
  return deps;
}

async function seedReadyTaskWorkspaceLibraryForTask(
  docStore: InMemoryJsonDocStore,
  task: {
    workspace_id: string;
    project_id: string;
    owner_user_id: string;
    workspace_file_library_id?: string;
    workspace_file_library_name?: string;
  },
): Promise<void> {
  const libraryId = task.workspace_file_library_id?.trim();
  if (!libraryId) throw new Error('workspace_file_library_id_required_for_managed_test_task');
  await seedReadyTaskWorkspaceLibrary(docStore, {
    workspaceId: task.workspace_id,
    projectId: task.project_id,
    libraryId,
    ownerUserId: task.owner_user_id,
    name: task.workspace_file_library_name,
  });
}

function setManagedExecutionApiBaseForTest(value = 'http://api:20000'): () => void {
  const previousInternalApiBase = process.env.INTERNAL_API_BASE_URL;
  process.env.INTERNAL_API_BASE_URL = value;
  return () => {
    if (previousInternalApiBase === undefined) delete process.env.INTERNAL_API_BASE_URL;
    else process.env.INTERNAL_API_BASE_URL = previousInternalApiBase;
  };
}

function buildResolvedTargetForTest(input: {
  workspaceId: string;
  projectId: string;
  endpointId: string;
  model?: string;
}): AgentTaskModelResolvedTarget {
  const model = input.model ?? 'placeholder-model';
  return {
    endpoint: {
      id: input.endpointId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      status: 'active',
      model,
      credential_ref: `cred_${input.endpointId}`,
      name: `endpoint-${input.endpointId}`,
      type: 'custom',
      upstream_protocol: 'openai_chat_completions',
      base_url: 'https://example.com',
      model_profile: {
        max_context_tokens: 128000,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    resolvedModel: model,
    upstreamProtocol: 'openai_chat_completions',
    setting: {
      id: `project:${input.projectId}`,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      endpoint_id: input.endpointId,
      default_model_id: model,
      setting_revision: `set_${input.endpointId}`,
      updated_at: '2026-05-07T00:00:00.000Z',
      updated_by_user_id: 'test_admin',
    },
    snapshot: {
      endpoint_id: input.endpointId,
      endpoint_display_name: `endpoint-${input.endpointId}`,
      resolved_model: model,
      upstream_protocol: 'openai_chat_completions',
      setting_revision: `set_${input.endpointId}`,
      policy_decision_id: `policy_${input.endpointId}`,
      resolved_at: '2026-05-07T00:00:00.000Z',
    },
  };
}

async function runManagedProjectionDispatchForTest(input: {
  caseId: string;
  contextEntries: Array<{
    scope: 'member' | 'task';
    key: string;
    content: string;
  }>;
  externalConnections?: Array<{
    customDomain: string;
    status?: 'active' | 'expired' | 'reauth_required' | 'error';
    fields: Array<{ key: string; value: string; secret: boolean }>;
  }>;
}): Promise<Record<string, unknown>> {
  const restoreInternalApiBase = setManagedExecutionApiBaseForTest('http://api:20000');
  const docStore = new InMemoryJsonDocStore();
  const dispatchStreamingRequest = vi.fn(async () => ({
    requestId: `req_${input.caseId}`,
    cancel: () => undefined,
    stream: (async function* stream() {})(),
  }));
  const deps = attachManagedExecutionDeps({
    cache: new InMemoryCache(),
    docStore,
    agentResourceService: {
      getAgent: vi.fn(async () => ({
        id: `agent_${input.caseId}`,
        status: 'enabled',
        runner_provider: 'managed',
        mode: 'internal',
        execution_preferences_json: {
          notebook: {
            endpoint_id: `ep_${input.caseId}`,
          },
        },
      })),
    },
    agentExecutionService: {
      dispatchStreamingRequest,
    },
  }) as unknown as NodeApiDeps;
  const task = {
    id: `task_${input.caseId}`,
    workspace_id: `ws_${input.caseId}`,
    project_id: `proj_${input.caseId}`,
    owner_user_id: `user_${input.caseId}`,
    title: `projected dependency ${input.caseId}`,
    agent_name: 'internal agent',
    task_home_segment: `task_${input.caseId}`,
    status: 'active' as const,
    attached_inputs: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    agent_id: `agent_${input.caseId}`,
    workspace_file_library_id: `flib_${input.caseId}`,
    workspace_file_library_name: `Projected Dependency ${input.caseId}`,
  };
  await seedReadyTaskWorkspaceLibraryForTask(docStore, task);
  for (const entry of input.contextEntries) {
    const common = {
      scope: entry.scope,
      key: entry.key,
      user_id: task.owner_user_id,
      workspace_id: task.workspace_id,
      content: entry.content,
      content_type: 'text' as const,
      updated_by: task.owner_user_id,
    };
    if (entry.scope === 'task') {
      await putContextEntry(docStore, {
        ...common,
        scope: 'task',
        project_id: task.project_id,
        task_id: task.id,
      });
    } else {
      await putContextEntry(docStore, {
        ...common,
        scope: 'member',
      });
    }
  }
  for (const connection of input.externalConnections ?? []) {
    await createUserExternalConnection(docStore, {
      user_id: task.owner_user_id,
      provider: 'custom',
      custom_domain: connection.customDomain,
      kind: 'secret_bundle',
      display_name: `custom bundle ${input.caseId}`,
      status: connection.status ?? 'active',
      fields: connection.fields,
    });
  }

  try {
    await runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage: {
        id: `msg_${input.caseId}`,
        task_id: task.id,
        role: 'agent',
        content: '',
        created_at: new Date().toISOString(),
      },
      agentId: `agent_${input.caseId}`,
      agentTaskModelTarget: buildResolvedTargetForTest({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        endpointId: `ep_${input.caseId}`,
      }),
      user: { id: task.owner_user_id, name: 'Projected User', email: 'projected@example.com' },
      publicBaseUrl: 'http://localhost:20000',
      buildRunId: () => `run_${input.caseId}`,
      buildProxyUsername: () => 'projected_user',
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
        id: `artifact_${input.caseId}`,
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });
  } finally {
    restoreInternalApiBase();
  }

  const dispatchArg = dispatchStreamingRequest.mock.calls[0]?.[0] as { executionContext?: Record<string, unknown> } | undefined;
  if (!dispatchArg?.executionContext) {
    throw new Error('execution_context_not_dispatched');
  }
  return dispatchArg.executionContext;
}

describe('notebook-execution-orchestrator governance preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not fall back to browser-host localhost for managed execution API base', () => {
    const previousInternalApiBase = process.env.INTERNAL_API_BASE_URL;
    const previousExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    const previousExecutionWsBase = process.env.AGENT_EXECUTION_WS_BASE_URL;
    delete process.env.INTERNAL_API_BASE_URL;
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    delete process.env.AGENT_EXECUTION_WS_BASE_URL;

    try {
      expect(() => resolveExecutionApiBase('http://localhost:20000', {
        runner_provider: 'managed',
      })).toThrowError('managed_runner_internal_api_base_not_configured');
    } finally {
      if (previousInternalApiBase === undefined) delete process.env.INTERNAL_API_BASE_URL;
      else process.env.INTERNAL_API_BASE_URL = previousInternalApiBase;
      if (previousExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousExecutionHttpBase;
      if (previousExecutionWsBase === undefined) delete process.env.AGENT_EXECUTION_WS_BASE_URL;
      else process.env.AGENT_EXECUTION_WS_BASE_URL = previousExecutionWsBase;
    }
  });

  it('emits RESOURCE_POLICY_DENIED and does not dispatch execution when endpoint access is denied', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const endpointId = 'ep_denied';
    await seedAgentTaskModelSetting(docStore, { workspaceId, projectId, endpointId });
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
          runner_provider: 'managed',
          mode: 'internal',
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
    await seedAgentTaskModelSetting(docStore, {
      workspaceId: 'ws_final_order',
      projectId: 'proj_final_order',
      endpointId: 'ep_final_order',
    });

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
    expect(errorEvent?.data?.code).toBe('agent_task_model_policy_denied');
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
    expect(audit.items.some((item) => item.error_code === 'agent_task_model_policy_denied')).toBe(true);
  });

  it('persists final notebook task truth before finalizing the run and emitting terminal SSE updates', async () => {
    const restoreManagedExecutionApiBase = setManagedExecutionApiBaseForTest();
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

    const deps = attachManagedExecutionDeps({
      cache: new InMemoryCache(),
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_final_order',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
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
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(docStore, {
      workspaceId: 'ws_finalizing_failure',
      projectId: 'proj_finalizing_failure',
      endpointId: 'ep_finalizing_failure',
    });

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
      workspace_file_library_id: 'flib_final_order',
      workspace_file_library_name: 'Final Order Workspace',
    };
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
    const assistantMessage = {
      id: 'msg_final_order',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };
    const activityItems: unknown[] = [];

    try {
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
          if (payload.type === 'activity_item') {
            steps.push('emit_activity_item');
            activityItems.push(payload.data);
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
    } finally {
      restoreManagedExecutionApiBase();
    }

    expect(steps).toEqual([
      'persist_message',
      'persist_task',
      'finalize',
      'emit_activity_item',
      'emit_task_update',
    ]);
    expect(activityItems).toEqual([
      expect.objectContaining({
        id: 'msg_final_order',
        task_id: 'task_final_order',
        kind: 'runner_output',
        actor: 'runner',
      }),
    ]);
    expect(JSON.stringify(activityItems)).not.toContain('"role"');
  });

  it('marks the shared run as finalizing instead of clearing it to idle when terminal truth persistence fails', async () => {
    const restoreManagedExecutionApiBase = setManagedExecutionApiBaseForTest();
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
    const deps = attachManagedExecutionDeps({
      cache,
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_finalizing_failure',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
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
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_internal',
      projectId: 'proj_internal',
      endpointId: 'ep_internal',
    });
    await seedReadyTaskWorkspaceLibrary(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_internal',
      projectId: 'proj_internal',
      libraryId: 'flib_internal',
      ownerUserId: 'user_internal',
      name: 'Internal Workspace',
    });

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
      workspace_file_library_id: 'flib_finalizing_failure',
      workspace_file_library_name: 'Finalizing Failure Workspace',
    };
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
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
    try {
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
    } finally {
      restoreManagedExecutionApiBase();
    }

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

  it('does not synthesize provider-specific projected dependencies from simple Context Store credentials', async () => {
    const executionContext = await runManagedProjectionDispatchForTest({
      caseId: 'projected_simple_credentials_omitted',
      contextEntries: [
        { scope: 'member', key: 'credentials.sample_base_url', content: 'https://member-service.example.com/' },
        { scope: 'member', key: 'credentials.sample_token', content: 'member-token' },
        { scope: 'task', key: 'credentials.sample_base_url', content: 'https://task-service.example.com/' },
        { scope: 'task', key: 'credentials.sample_token', content: 'task-token' },
      ],
    });

    expect(executionContext).not.toHaveProperty('projected_dependencies');
    expect(JSON.stringify(executionContext)).not.toMatch(
      /context_store|writable_scopes|managed_credential_refresh|credential_files|user_bearer_token|member-token|task-token/,
    );
  });

  it('does not synthesize projected dependencies from ordinary task notes context', async () => {
    const noteValue = 'LOCKED_PROJECTION_CTX_UNIT_TEST_VALUE';
    const executionContext = await runManagedProjectionDispatchForTest({
      caseId: 'projected_task_notes_omitted',
      contextEntries: [
        { scope: 'task', key: 'notes.locked_projection_smoke_unit', content: noteValue },
      ],
    });

    expect(executionContext).not.toHaveProperty('projected_dependencies');
    expect(JSON.stringify(executionContext)).not.toContain(noteValue);
  });

  it('does not synthesize provider-specific projected dependencies from managed external connections', async () => {
    const executionContext = await runManagedProjectionDispatchForTest({
      caseId: 'projected_managed_connection_omitted',
      contextEntries: [],
      externalConnections: [{
        customDomain: 'runtime-dependency.example.test',
        fields: [
          { key: 'access_token', value: 'sample-access-token', secret: true },
          { key: 'endpoint', value: 'https://runtime-dependency.example.test/mcp', secret: false },
          { key: 'refresh_token', value: 'sample-refresh-token', secret: true },
        ],
      }],
    });

    expect(executionContext).not.toHaveProperty('projected_dependencies');
    expect(JSON.stringify(executionContext)).not.toMatch(
      /sample-access-token|sample-refresh-token|runtime-dependency\.example\.test|credential_files|user_bearer_token/,
    );
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
    const ensureAgentReady = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('asbcp status timeout'), {
        code: 'AGENT_SANDBOX_UNAVAILABLE',
        operation: 'get_pod_status',
        retryable: true,
        networkErrorName: 'TimeoutError',
      }))
      .mockResolvedValueOnce(undefined);
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
        ensureAgentReady,
      },
      internalWorkloadCoordinator: {
        acquireHolder,
        releaseHolder,
      },
      internalAgentWorkspaceBindingManager: {
        ensureWorkspaceBinding: vi.fn(async () => ({
          workspaceMount: {
            bindingId: 'wmb_internal',
            mountPath: '/home/task_internal',
            taskHomePath: '/home/task_internal',
            workspacePath: '/home/task_internal/workspace',
            artifactsPath: '/home/task_internal/workspace/.artifacts',
          },
          binding: {
            file_library_id: 'flib_internal',
            task_home_binding_id: 'wmb_internal',
            afscp_mount_binding_id: 'wmb_internal',
            mount_binding_status: 'issued',
          },
        })),
      },
    } as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_internal',
      projectId: 'proj_internal',
      endpointId: 'ep_internal',
    });
    await seedReadyTaskWorkspaceLibrary(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_internal',
      projectId: 'proj_internal',
      libraryId: 'flib_internal',
      ownerUserId: 'user_internal',
      name: 'Internal Workspace',
    });

    const task = {
      id: 'task_internal',
      workspace_id: 'ws_internal',
      project_id: 'proj_internal',
      owner_user_id: 'user_internal',
      title: 'internal task',
      agent_name: 'internal agent',
      task_home_segment: 'task_internal',
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
          runner_id: 'agent_internal',
          model_context_window: 256000,
          model_auto_compact_token_limit: 230400,
          model_catalog: {
            input_modalities: ['text'],
            supports_search_tool: false,
            supports_parallel_tool_calls: false,
            apply_patch_tool_type: 'function',
          },
          workspace_binding_mode: 'pre_mounted',
          runtime_profile: 'managed',
          task_home_segment: 'task_internal',
          task_home_path: '/home/task_internal',
          workspace_path: '/home/task_internal/workspace',
          artifacts_path: '/home/task_internal/workspace/.artifacts',
          library_root_path: '.',
          workspace_file_library_id: 'flib_internal',
        }),
      }),
    );
    expect(deps.internalAgentWorkspaceBindingManager?.ensureWorkspaceBinding).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_internal',
      projectId: 'proj_internal',
      fileLibraryId: 'flib_internal',
      taskId: 'task_internal',
      taskHomeSegment: 'task_internal',
      actorUserId: 'user_internal',
      requestId: 'run_internal',
    }));
    expect(deps.internalAgentPodManager?.ensureAgentReady).toHaveBeenCalledWith(expect.objectContaining({
      workspaceMount: expect.objectContaining({
        bindingId: 'wmb_internal',
        taskHomePath: '/home/task_internal',
        workspacePath: '/home/task_internal/workspace',
      }),
    }));
    expect(JSON.stringify((deps.internalAgentPodManager?.ensureAgentReady as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).not.toMatch(
      /metadata_url|storage_endpoint|storage_bucket_url|filesystem_name|juicefs|secret|access_key/i,
    );
    const ensureWorkspaceBinding = deps.internalAgentWorkspaceBindingManager?.ensureWorkspaceBinding as ReturnType<typeof vi.fn>;
    const ensureAgentReadyMock = deps.internalAgentPodManager?.ensureAgentReady as ReturnType<typeof vi.fn>;
    expect(acquireHolder.mock.invocationCallOrder[0]!).toBeLessThan(
      ensureWorkspaceBinding.mock.invocationCallOrder[0]!,
    );
    expect(acquireHolder.mock.invocationCallOrder[0]!).toBeLessThan(
      ensureAgentReadyMock.mock.invocationCallOrder[0]!,
    );
    expect(ensureAgentReadyMock).toHaveBeenCalledTimes(2);
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
    expect(dispatchArg?.executionContext).not.toHaveProperty('container_workspace_path');
    const executionTicket = String(dispatchArg?.executionContext?.execution_ticket ?? '');
    await expect(resolveInternalTicket(deps.cache, executionTicket, 'agent_execution')).resolves.toMatchObject({
      payload: {
        endpoint_id: 'ep_internal',
        task_id: 'task_internal',
        runner_session_id: 'task_internal',
        agent_runner_id: 'agent_internal',
      },
    });
  });

  it('uses function apply_patch catalog truth for OpenAI-chat-compatible compose agents', async () => {
    const previousInternalApiBase = process.env.INTERNAL_API_BASE_URL;
    const previousExternalApiBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
    process.env.INTERNAL_API_BASE_URL = 'http://api:20000';
    process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = 'http://host.docker.internal:20000';

    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_external_compose',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const deps = attachManagedExecutionDeps({
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_external_compose',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
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
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_external',
      projectId: 'proj_external',
      endpointId: 'ep_external_dev_direct',
    });

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
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
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
      if (previousExternalApiBase === undefined) delete process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = previousExternalApiBase;
    }

    expect(dispatchStreamingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          api_base: 'http://api:20000/api/v1',
          execution_ticket: expect.stringMatching(/^exec_/),
          runner_id: 'agent_external_compose',
          model_catalog: {
            input_modalities: ['text', 'image'],
            supports_search_tool: false,
            supports_parallel_tool_calls: false,
            apply_patch_tool_type: 'function',
          },
          runner_session_scope: 'task_execution',
          workspace_binding_mode: 'pre_mounted',
          runtime_profile: 'managed',
          task_home_segment: 'task_external_compose',
          library_root_path: '.',
          workspace_file_library_id: 'flib_external',
        }),
      }),
    );
    const dispatchArg = dispatchStreamingRequest.mock.calls[0]?.[0] as { executionContext?: Record<string, unknown> } | undefined;
    expect(dispatchArg?.executionContext).not.toHaveProperty('user_bearer_token');
  });

  it('fails closed for configless dev-direct external notebook agents before local task HOME binding', async () => {
    const previousInternalApiBase = process.env.INTERNAL_API_BASE_URL;
    const previousExternalApiBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
    const previousDeveloperWorkspaceRoot = process.env.MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT;
    process.env.INTERNAL_API_BASE_URL = 'http://api:20000';
    process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = 'http://localhost:21000';
    process.env.MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT = '/tmp/agentsmith-dev-workspaces';

    const emitted: Array<{ type: string; data: unknown }> = [];
    const finalizeCalls: Array<{ durableTerminalTruth: boolean }> = [];
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_external_dev_direct',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const ensureWorkspaceBinding = vi.fn(async () => ({
      workspaceMount: {
        bindingId: 'wmb_external_dev_direct',
        mountPath: '/should-not-bind',
      },
      binding: {
        file_library_id: 'flib_external',
      },
    }));
    const acquireHolder = vi.fn(async () => undefined);
    const deps = {
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_external_dev_direct',
          status: 'enabled',
          runner_provider: 'developer',
          mode: 'external',
          config: null,
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_external_dev_direct',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_external_dev_direct',
          workspace_id: 'ws_external',
          project_id: 'proj_external',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_1',
          name: 'endpoint-external-dev-direct',
          type: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: 'https://example.com',
          capabilities: [
            { type: 'chat_completion', enabled: true },
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
      internalAgentWorkspaceBindingManager: {
        ensureWorkspaceBinding,
      },
      internalWorkloadCoordinator: {
        acquireHolder,
        releaseHolder: vi.fn(async () => undefined),
      },
    } as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_external',
      projectId: 'proj_external',
      endpointId: 'ep_anthropic',
    });

    const task = {
      id: 'task_external_dev_direct',
      workspace_id: 'ws_external',
      project_id: 'proj_external',
      owner_user_id: 'user_external',
      title: 'external dev direct task',
      agent_name: 'external agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_external_dev_direct',
      workspace_file_library_id: 'flib_external',
      workspace_file_library_name: 'External Workspace',
    };
    const assistantMessage = {
      id: 'msg_external_dev_direct',
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
        agentId: 'agent_external_dev_direct',
        user: { id: 'user_external', name: 'External User', email: 'external@example.com' },
        publicBaseUrl: 'http://localhost:20000',
        buildRunId: () => 'run_external_dev_direct',
        buildProxyUsername: () => 'external_user',
        mapTaskMessagesForExecution: () => [],
        updateTaskActivity: () => undefined,
        emitTaskEvent: (_taskId, payload) => {
          emitted.push(payload as { type: string; data: unknown });
        },
        onFinalize: (_taskId, _runId, summary) => {
          finalizeCalls.push(summary);
        },
        debugLog: () => undefined,
        taskCollections: {
          tasks: 'project_tasks',
          messages: 'project_task_messages',
        },
        createTaskArtifact: async () => ({
          id: 'artifact_external_dev_direct',
          task_id: task.id,
          type: 'file',
          created_at: new Date().toISOString(),
        }),
      });
    } finally {
      if (previousInternalApiBase === undefined) delete process.env.INTERNAL_API_BASE_URL;
      else process.env.INTERNAL_API_BASE_URL = previousInternalApiBase;
      if (previousExternalApiBase === undefined) delete process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = previousExternalApiBase;
      if (previousDeveloperWorkspaceRoot === undefined) delete process.env.MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT;
      else process.env.MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT = previousDeveloperWorkspaceRoot;
    }

    expect(dispatchStreamingRequest).not.toHaveBeenCalled();
    expect(deps.endpointResourceService.getEndpoint).not.toHaveBeenCalled();
    expect(ensureWorkspaceBinding).not.toHaveBeenCalled();
    expect(acquireHolder).not.toHaveBeenCalled();
    expect(finalizeCalls).toEqual([
      expect.objectContaining({ durableTerminalTruth: true }),
    ]);
    expect(assistantMessage.content).toContain(DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE);
    expect(emitted.find((item) => item.type === 'error')).toMatchObject({
      type: 'error',
      data: {
        code: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
        message: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
      },
    });
    const observableJson = JSON.stringify({ emitted, assistantMessage });
    expect(observableJson).not.toMatch(
      /\/tmp\/agentsmith-dev-workspaces|task_home_path|workspace_path|artifacts_path|developer_workspace_root|workspace_binding_mode/i,
    );
  });

  it('uses project setting endpoint protocol for external task dispatch regardless of runner preferences', async () => {
    const previousInternalApiBase = process.env.INTERNAL_API_BASE_URL;
    const previousDeveloperApiBase = process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
    process.env.INTERNAL_API_BASE_URL = 'http://api:20000';
    process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = 'http://api:20000';

    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_external_responses',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const deps = attachManagedExecutionDeps({
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_external_responses',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
          default_endpoint_id: 'ep_runner_default_stale',
          config: {
            runner_runtime: 'compose_managed',
          },
          execution_preferences_json: {
            agent_task: {
              endpoint_id: 'ep_anthropic',
              wire_api: 'openai_responses',
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
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_external',
      projectId: 'proj_external',
      endpointId: 'ep_anthropic',
    });

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
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
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
      if (previousDeveloperApiBase === undefined) delete process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL = previousDeveloperApiBase;
    }

    expect(dispatchStreamingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'placeholder-model',
        messages: [{ role: 'user', content: 'reply exactly OK' }],
        executionContext: expect.objectContaining({
          endpoint_id: 'ep_anthropic',
          runner_id: 'agent_external_responses',
          wire_api: 'anthropic_messages',
          model: 'placeholder-model',
          api_base: 'http://api:20000/api/v1',
          agent_task_model: expect.objectContaining({
            endpoint_id: 'ep_anthropic',
            resolved_model: 'placeholder-model',
            upstream_protocol: 'anthropic_messages',
            setting_revision: 'set_ep_anthropic',
          }),
          resource_proxy: {
            base_url: 'http://api:20000/api/v1/workspaces/ws_external/projects/proj_external/endpoints/ep_anthropic/proxy/openai',
          },
        }),
      }),
    );
    expect(deps.endpointResourceService.getEndpoint).toHaveBeenCalledWith(
      'ws_external',
      'proj_external',
      'ep_anthropic',
    );
    expect(deps.endpointResourceService.getEndpoint).not.toHaveBeenCalledWith(
      'ws_external',
      'proj_external',
      'ep_runner_default_stale',
    );
  });

  it('dispatches freeform apply_patch catalog truth for native OpenAI responses endpoints', async () => {
    const restoreManagedExecutionApiBase = setManagedExecutionApiBaseForTest();
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_native_responses',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const deps = attachManagedExecutionDeps({
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_native_responses',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_native_responses',
              model: 'gpt-native-responses',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_native_responses',
          workspace_id: 'ws_native',
          project_id: 'proj_native',
          status: 'active',
          model: 'gpt-native-responses',
          credential_ref: 'cred_1',
          name: 'endpoint-native-responses',
          type: 'catalog',
          provider_family: 'openai',
          upstream_protocol: 'openai_responses',
          base_url: 'https://api.openai.com/v1',
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
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_native',
      projectId: 'proj_native',
      endpointId: 'ep_native_responses',
      defaultModel: 'gpt-native-responses',
    });

    const task = {
      id: 'task_native_responses',
      workspace_id: 'ws_native',
      project_id: 'proj_native',
      owner_user_id: 'user_native',
      title: 'native responses task',
      agent_name: 'native responses agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_native_responses',
      workspace_file_library_id: 'flib_native',
      workspace_file_library_name: 'Native Workspace',
    };
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
    const assistantMessage = {
      id: 'msg_native_responses',
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
        agentId: 'agent_native_responses',
        user: { id: 'user_native', name: 'Native User', email: 'native@example.com' },
        publicBaseUrl: 'http://localhost:20000',
        buildRunId: () => 'run_native_responses',
        buildProxyUsername: () => 'native_user',
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
          id: 'artifact_native_responses',
          task_id: task.id,
          type: 'file',
          created_at: new Date().toISOString(),
        }),
      });
    } finally {
      restoreManagedExecutionApiBase();
    }

    expect(dispatchStreamingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          model_catalog: {
            input_modalities: ['text'],
            supports_search_tool: false,
            supports_parallel_tool_calls: false,
            apply_patch_tool_type: 'freeform',
          },
        }),
      }),
    );
  });

  it('dispatches freeform apply_patch catalog truth from upstream_protocol for custom Responses endpoints', async () => {
    const restoreManagedExecutionApiBase = setManagedExecutionApiBaseForTest();
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_custom_responses',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const deps = attachManagedExecutionDeps({
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_custom_responses',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_custom_responses',
              model: 'custom-responses-model',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_custom_responses',
          workspace_id: 'ws_custom_responses',
          project_id: 'proj_custom_responses',
          status: 'active',
          model: 'custom-responses-model',
          credential_ref: 'cred_custom_responses',
          name: 'endpoint-custom-responses',
          type: 'custom',
          provider_family: 'custom',
          upstream_protocol: 'openai_responses',
          base_url: 'https://custom.example.test/v1',
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
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_custom_responses',
      projectId: 'proj_custom_responses',
      endpointId: 'ep_custom_responses',
      defaultModel: 'custom-responses-model',
    });

    const task = {
      id: 'task_custom_responses',
      workspace_id: 'ws_custom_responses',
      project_id: 'proj_custom_responses',
      owner_user_id: 'user_custom_responses',
      title: 'custom responses task',
      agent_name: 'custom responses agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_custom_responses',
      workspace_file_library_id: 'flib_custom_responses',
      workspace_file_library_name: 'Custom Responses Workspace',
    };
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
    const assistantMessage = {
      id: 'msg_custom_responses',
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
        agentId: 'agent_custom_responses',
        user: { id: 'user_custom_responses', name: 'Custom User', email: 'custom@example.com' },
        publicBaseUrl: 'http://localhost:20000',
        buildRunId: () => 'run_custom_responses',
        buildProxyUsername: () => 'custom_user',
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
          id: 'artifact_custom_responses',
          task_id: task.id,
          type: 'file',
          created_at: new Date().toISOString(),
        }),
      });
    } finally {
      restoreManagedExecutionApiBase();
    }

    expect(dispatchStreamingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          model_catalog: expect.objectContaining({
            apply_patch_tool_type: 'freeform',
          }),
        }),
      }),
    );
  });

  it('persists a fallback assistant message when execution fails before any visible output', async () => {
    const restoreManagedExecutionApiBase = setManagedExecutionApiBaseForTest();
    const docStore = new InMemoryJsonDocStore();
    const deps = attachManagedExecutionDeps({
      cache: new InMemoryCache(),
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_empty_error',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
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
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(docStore, {
      workspaceId: 'ws_empty_error',
      projectId: 'proj_empty_error',
      endpointId: 'ep_empty_error',
    });

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
      workspace_file_library_id: 'flib_empty_error',
      workspace_file_library_name: 'Empty Error Workspace',
    };
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
    const assistantMessage = {
      id: 'msg_empty_error',
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
    } finally {
      restoreManagedExecutionApiBase();
    }

    expect(assistantMessage.content).toContain('Execution failed before any visible output was produced.');
    expect(assistantMessage.content).toContain('AGENT_EMPTY_OUTPUT');
  });

  it('derives model context window and compact token limit from endpoint profile for external notebook runs', async () => {
    const restoreManagedExecutionApiBase = setManagedExecutionApiBaseForTest();
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_external',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const deps = attachManagedExecutionDeps({
      cache: new InMemoryCache(),
      docStore: new InMemoryJsonDocStore(),
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_external',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
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
            max_output_tokens: 32000,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_external',
      projectId: 'proj_external',
      endpointId: 'ep_external',
    });

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
      workspace_file_library_id: 'flib_external',
      workspace_file_library_name: 'External Workspace',
    };
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
    const assistantMessage = {
      id: 'msg_external',
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
    } finally {
      restoreManagedExecutionApiBase();
    }

    expect(dispatchStreamingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        executionContext: expect.objectContaining({
          model_context_window: 200000,
          model_auto_compact_token_limit: 168000,
          model_limits: {
            context_window: 200000,
            max_output_tokens: 32000,
          },
          model_catalog: {
            input_modalities: ['text'],
            supports_search_tool: false,
            supports_parallel_tool_calls: false,
            apply_patch_tool_type: 'function',
          },
        }),
      }),
    );
  });

  it('sanitizes sensitive runner trace details before emitting and persisting notebook traces', async () => {
    const restoreManagedExecutionApiBase = setManagedExecutionApiBaseForTest();
    const docStore = new InMemoryJsonDocStore();
    const emitted: Array<{ type: string; data: unknown }> = [];
    const sharedAuthorizationSecret = 'same-summary-command-secret-123';
    const embeddedJsonApiKey = 'sk-embedded-json-root-key';
    const embeddedJsonClientSecret = 'embedded-json-client-secret';
    const quotedFallbackApiKey = 'quoted-fallback-api-key';
    const quotedFallbackClientSecret = 'quoted-fallback-client-secret';
    const assignedFallbackPassword = 'assigned-fallback-password';
    const embeddedJsonSummary = `Command failed: {"api_key":"${embeddedJsonApiKey}","client_secret":"${embeddedJsonClientSecret}"}`;
    const quotedFallbackText = `larger string has "api_key":"${quotedFallbackApiKey}", 'client_secret':'${quotedFallbackClientSecret}', password = "${assignedFallbackPassword}"`;
    const deps = attachManagedExecutionDeps({
      cache: new InMemoryCache(),
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_trace_sanitize',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_trace_sanitize',
              model: 'placeholder-model',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_trace_sanitize',
          workspace_id: 'ws_trace_sanitize',
          project_id: 'proj_trace_sanitize',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_trace_sanitize',
          name: 'endpoint-trace-sanitize',
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
          requestId: 'req_trace_sanitize',
          cancel: () => undefined,
          stream: (async function* stream() {
            yield {
              type: 'event',
              event: {
                sequence: 1,
                at: new Date().toISOString(),
                category: 'tool',
                phase: 'update',
                status: 'running',
                name: 'runner.tool_call',
                summary: `Command failed: curl -H "Authorization: Basic ${sharedAuthorizationSecret}" while preserving summary context`,
                details: {
                  tool_name: 'apply_patch',
                  direct_header: 'Authorization: Basic runner-basic-secret',
                  quoted_header: 'Authorization: "ApiKey runner-quoted-api-key"',
                  single_quoted_header: "Authorization='Token runner-single-quoted-token'",
                  json_header: '{"Authorization":"Basic runner-json-basic-secret"}',
                  nested_headers: {
                    headers: {
                      Authorization: 'ApiKey runner-nested-api-key',
                    },
                    visible_label: 'nested header object kept',
                  },
                  safe_label: 'Authorization: ApiKey runner-safe-label-key while preserving label text',
                  command: `curl -H "Authorization: Basic ${sharedAuthorizationSecret}" https://api.example.test/v1/tasks`,
                  curl_header: 'curl -H "Authorization: Basic runner-curl-basic-secret" https://api.example.test/v1/tasks',
                  message: 'runner failed with Authorization: Digest username="runner", nonce="runner-digest-nonce" but task id task_trace_sanitize is safe',
                  safe_message: 'Authorization: Bearer runner-safe-message-token while preserving visible context',
                  exit_code: 0,
                  arguments: 'partial arguments: *** Begin Patch\napi_key=sk-real-root-key',
                  nested: {
                    tool_name: 'shell',
                    safe_note: 'inner kept',
                    arguments: {
                      command: 'partial arguments include *** Begin Patch',
                    },
                    request: {
                      safe_request_id: 'req_public',
                      api_key: 'sk-real-nested-key',
                      token: 'real-runner-token',
                      secret: 'real-runner-secret',
                      password: 'real-runner-password',
                      client_secret: 'real-client-secret',
                    },
                  },
                  calls: [
                    {
                      tool_name: 'shell',
                      status: 'success',
                      arguments: 'partial arguments: *** Begin Patch',
                      api_key: 'sk-real-array-key',
                    },
                  ],
                },
              },
            } as const;
            yield {
              type: 'event',
              event: {
                sequence: 2,
                at: new Date().toISOString(),
                category: 'debug',
                phase: 'update',
                status: 'running',
                name: 'runner.embedded_secret_trace',
                summary: embeddedJsonSummary,
                raw: `${embeddedJsonSummary}; raw ${quotedFallbackText}`,
                details: {
                  summary_copy: embeddedJsonSummary,
                  quoted_key_fragments: quotedFallbackText,
                  nested_larger_string: {
                    command_output: `prefix ${embeddedJsonSummary}; suffix ${quotedFallbackText}`,
                  },
                },
              },
            } as const;
            yield { type: 'done', finish_reason: 'stop', usage_tokens: 1 } as const;
          })(),
        })),
      },
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(docStore, {
      workspaceId: 'ws_trace_sanitize',
      projectId: 'proj_trace_sanitize',
      endpointId: 'ep_trace_sanitize',
    });

    const task = {
      id: 'task_trace_sanitize',
      workspace_id: 'ws_trace_sanitize',
      project_id: 'proj_trace_sanitize',
      owner_user_id: 'user_trace_sanitize',
      title: 'trace sanitize task',
      agent_name: 'trace sanitize agent',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_trace_sanitize',
      workspace_file_library_id: 'flib_trace_sanitize',
      workspace_file_library_name: 'Trace Sanitize Workspace',
    };
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
    const assistantMessage = {
      id: 'msg_trace_sanitize',
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
        agentId: 'agent_trace_sanitize',
        user: { id: 'user_trace_sanitize', name: 'Trace User', email: 'trace@example.com' },
        publicBaseUrl: 'http://localhost:20000',
        buildRunId: () => 'run_trace_sanitize',
        buildProxyUsername: () => 'trace_user',
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
          id: 'artifact_trace_sanitize',
          task_id: task.id,
          type: 'file',
          created_at: new Date().toISOString(),
        }),
      });
    } finally {
      restoreManagedExecutionApiBase();
    }

    const observableTrace = emitted.find((item) => (
      item.type === 'trace_event'
      && typeof item.data === 'object'
      && item.data !== null
      && !Array.isArray(item.data)
      && (item.data as { name?: unknown }).name === 'runner.tool_call'
    ))?.data as { summary?: string; details?: Record<string, unknown> } | undefined;
    const persistedTraces = await docStore.list<{
      name: string;
      summary: string;
      details?: Record<string, unknown>;
    }>('ws_trace_sanitize_agent_task_trace_events', { task_id: task.id });
    const persistedTrace = persistedTraces.find((item) => item.name === 'runner.tool_call');
    const observableEmbeddedTrace = emitted.find((item) => (
      item.type === 'trace_event'
      && typeof item.data === 'object'
      && item.data !== null
      && !Array.isArray(item.data)
      && (item.data as { name?: unknown }).name === 'runner.embedded_secret_trace'
    ))?.data as { summary?: string; details?: Record<string, unknown> } | undefined;
    const persistedEmbeddedTrace = persistedTraces.find((item) => item.name === 'runner.embedded_secret_trace');

    expect(observableTrace?.summary).toBe('Command failed: curl -H "Authorization: Basic [redacted]" while preserving summary context');
    expect(observableTrace?.details).toMatchObject({
      tool_name: 'apply_patch',
      direct_header: 'Authorization: Basic [redacted]',
      quoted_header: 'Authorization: "ApiKey [redacted]"',
      single_quoted_header: "Authorization='Token [redacted]'",
      json_header: '{}',
      nested_headers: {
        headers: {},
        visible_label: 'nested header object kept',
      },
      safe_label: 'Authorization: ApiKey [redacted] while preserving label text',
      command: 'curl -H "Authorization: Basic [redacted]" https://api.example.test/v1/tasks',
      curl_header: 'curl -H "Authorization: Basic [redacted]" https://api.example.test/v1/tasks',
      message: 'runner failed with Authorization: Digest [redacted] but task id task_trace_sanitize is safe',
      safe_message: 'Authorization: Bearer [redacted] while preserving visible context',
      exit_code: 0,
      nested: {
        tool_name: 'shell',
        safe_note: 'inner kept',
        request: {
          safe_request_id: 'req_public',
        },
      },
      calls: [
        {
          tool_name: 'shell',
          status: 'success',
        },
      ],
    });
    expect(persistedTrace?.summary).toEqual(observableTrace?.summary);
    expect(persistedTrace?.details).toEqual(observableTrace?.details);
    expect(observableEmbeddedTrace?.summary).toBe('Command failed: {"api_key":"[redacted]","client_secret":"[redacted]"}');
    expect(observableEmbeddedTrace?.details).toEqual({
      summary_copy: 'Command failed: {"api_key":"[redacted]","client_secret":"[redacted]"}',
      quoted_key_fragments: 'larger string has "api_key":"[redacted]", \'client_secret\':\'[redacted]\', password = "[redacted]"',
      nested_larger_string: {
        command_output: 'prefix Command failed: {"api_key":"[redacted]","client_secret":"[redacted]"}; suffix larger string has "api_key":"[redacted]", \'client_secret\':\'[redacted]\', password = "[redacted]"',
      },
    });
    expect(persistedEmbeddedTrace?.summary).toEqual(observableEmbeddedTrace?.summary);
    expect(persistedEmbeddedTrace?.details).toEqual(observableEmbeddedTrace?.details);

    const traceJson = JSON.stringify({
      observable: observableTrace,
      persisted: persistedTrace,
      observableEmbedded: observableEmbeddedTrace,
      persistedEmbedded: persistedEmbeddedTrace,
    });
    expect(traceJson).not.toContain('*** Begin Patch');
    expect(traceJson).not.toContain('partial arguments');
    expect(traceJson).not.toContain('sk-real-root-key');
    expect(traceJson).not.toContain('sk-real-nested-key');
    expect(traceJson).not.toContain('sk-real-array-key');
    expect(traceJson).not.toContain('runner-command-token');
    expect(traceJson).not.toContain('sk-runner-message-key');
    expect(traceJson).not.toContain(sharedAuthorizationSecret);
    expect(traceJson).not.toContain('runner-basic-secret');
    expect(traceJson).not.toContain('runner-quoted-api-key');
    expect(traceJson).not.toContain('runner-single-quoted-token');
    expect(traceJson).not.toContain('runner-json-basic-secret');
    expect(traceJson).not.toContain('runner-nested-api-key');
    expect(traceJson).not.toContain('runner-curl-basic-secret');
    expect(traceJson).not.toContain('runner-safe-label-key');
    expect(traceJson).not.toContain('cnVubmVyLWNvbW1hbmQtc2VjcmV0');
    expect(traceJson).not.toContain('runner-digest-nonce');
    expect(traceJson).not.toContain('runner-safe-message-token');
    expect(traceJson).not.toContain('real-runner-token');
    expect(traceJson).not.toContain('real-runner-secret');
    expect(traceJson).not.toContain('real-runner-password');
    expect(traceJson).not.toContain('real-client-secret');
    expect(traceJson).not.toContain(embeddedJsonApiKey);
    expect(traceJson).not.toContain(embeddedJsonClientSecret);
    expect(traceJson).not.toContain(quotedFallbackApiKey);
    expect(traceJson).not.toContain(quotedFallbackClientSecret);
    expect(traceJson).not.toContain(assignedFallbackPassword);
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
          runner_provider: 'managed',
          mode: 'internal',
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
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_invalid',
      projectId: 'proj_invalid',
      endpointId: 'ep_invalid',
    });

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
    const previousExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.AGENT_EXECUTION_HTTP_BASE_URL = 'http://10.88.0.1:20000/api/v1';
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
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_internal_hold',
      projectId: 'proj_internal_hold',
      endpointId: 'ep_internal_hold',
    });
    await seedReadyTaskWorkspaceLibrary(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_internal_hold',
      projectId: 'proj_internal_hold',
      libraryId: 'flib_internal_hold',
      ownerUserId: 'user_internal_hold',
      name: 'Internal Hold Workspace',
    });

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

    try {
      await vi.waitFor(() => {
        expect(dispatchStreamingRequest).toHaveBeenCalledTimes(1);
        expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([
          {
            workspaceId: 'ws_internal_hold',
            projectId: 'proj_internal_hold',
            workloadId: 'task-internal-hold',
            holders: ['notebook_run:run_internal_hold@run_internal_hold'],
            hardTeardownRequested: false,
          },
        ]);
      });

      streamGate.resolve();
      await runPromise;

      expect(internalWorkloadCoordinator.readSnapshotForTests()).toEqual([]);
      expect(releasePod).not.toHaveBeenCalled();
    } finally {
      if (previousExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousExecutionHttpBase;
      await internalWorkloadCoordinator.shutdown();
    }
  });

  it('releases an acquired internal workload holder when ensureAgentReady fails before dispatch', async () => {
    const docStore = new InMemoryJsonDocStore();
    const callOrder: string[] = [];
    const holderRef = {
      workspaceId: 'ws_holder_ready_fail',
      projectId: 'proj_holder_ready_fail',
      workloadId: 'task-holder-ready-fail',
      holderKind: 'notebook_run',
      holderId: 'run_holder_ready_fail',
      epoch: 'run_holder_ready_fail',
    };
    const acquireHolder = vi.fn(async () => {
      callOrder.push('acquire');
    });
    const releaseHolder = vi.fn(async () => {
      callOrder.push('release');
    });
    const ensureWorkspaceBinding = vi.fn(async () => {
      callOrder.push('bind');
      return {
        workspaceMount: {
          bindingId: 'wmb_holder_ready_fail',
          mountPath: '/home/task_holder_ready_fail',
          taskHomePath: '/home/task_holder_ready_fail',
          workspacePath: '/home/task_holder_ready_fail/workspace',
          artifactsPath: '/home/task_holder_ready_fail/workspace/.artifacts',
        },
        binding: {
          file_library_id: 'flib_holder_ready_fail',
          task_home_binding_id: 'wmb_holder_ready_fail',
          afscp_mount_binding_id: 'wmb_holder_ready_fail',
          mount_binding_status: 'issued',
        },
      };
    });
    const ensureAgentReady = vi.fn(async () => {
      callOrder.push('ensure');
      throw Object.assign(new Error('agent_sandbox_unavailable: pod missing'), {
        code: 'AGENT_SANDBOX_UNAVAILABLE',
        retryable: false,
      });
    });
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_holder_ready_fail',
      cancel: () => undefined,
      stream: (async function* stream() {})(),
    }));
    const deps = {
      cache: new InMemoryCache(),
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_holder_ready_fail',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
          config: {
            image: NOTEBOOK_EXECUTION_MANAGED_RUNNER_IMAGE,
          },
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_holder_ready_fail',
            },
          },
        })),
      },
      agentExecutionService: {
        dispatchStreamingRequest,
      },
      internalAgentPodManager: {
        ensureAgentReady,
        keepalive: vi.fn(async () => undefined),
      },
      internalAgentWorkspaceBindingManager: {
        ensureWorkspaceBinding,
      },
      internalWorkloadCoordinator: {
        acquireHolder,
        releaseHolder,
      },
    } as unknown as NodeApiDeps;
    const task = {
      id: 'task_holder_ready_fail',
      workspace_id: 'ws_holder_ready_fail',
      project_id: 'proj_holder_ready_fail',
      owner_user_id: 'user_holder_ready_fail',
      title: 'holder ready failure task',
      agent_name: 'internal agent',
      task_home_segment: 'task_holder_ready_fail',
      status: 'active' as const,
      attached_inputs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      agent_id: 'agent_holder_ready_fail',
      workspace_file_library_id: 'flib_holder_ready_fail',
      workspace_file_library_name: 'Holder Ready Failure Workspace',
    };
    const assistantMessage = {
      id: 'msg_holder_ready_fail',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: new Date().toISOString(),
    };
    const emitted: Array<{ type: string; data: { code?: string } }> = [];
    await seedReadyTaskWorkspaceLibraryForTask(docStore, task);

    await runNotebookTaskWithExecutionAgent({
      deps,
      task,
      assistantMessage,
      agentId: 'agent_holder_ready_fail',
      agentTaskModelTarget: buildResolvedTargetForTest({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        endpointId: 'ep_holder_ready_fail',
      }),
      user: { id: 'user_holder_ready_fail', name: 'Holder Ready User', email: 'holder-ready@example.com' },
      publicBaseUrl: 'http://localhost:20072',
      buildRunId: () => 'run_holder_ready_fail',
      buildProxyUsername: () => 'holder_ready_user',
      mapTaskMessagesForExecution: () => [],
      updateTaskActivity: () => undefined,
      emitTaskEvent: (_taskId, payload) => {
        emitted.push(payload as { type: string; data: { code?: string } });
      },
      onFinalize: () => undefined,
      debugLog: () => undefined,
      taskCollections: {
        tasks: 'project_tasks',
        messages: 'project_task_messages',
      },
      createTaskArtifact: async () => ({
        id: 'artifact_holder_ready_fail',
        task_id: task.id,
        type: 'file',
        created_at: new Date().toISOString(),
      }),
    });

    expect(callOrder).toEqual(['acquire', 'bind', 'ensure', 'release']);
    expect(acquireHolder).toHaveBeenCalledWith(holderRef);
    expect(ensureAgentReady).toHaveBeenCalledWith(expect.objectContaining({
      workloadId: holderRef.workloadId,
      sessionId: task.id,
      workspaceMount: expect.objectContaining({
        bindingId: 'wmb_holder_ready_fail',
      }),
    }));
    expect(releaseHolder).toHaveBeenCalledWith(holderRef);
    expect(dispatchStreamingRequest).not.toHaveBeenCalled();
    expect(emitted.find((item) => item.type === 'error')?.data.code).toBe('AGENT_SANDBOX_UNAVAILABLE');
    const traces = await docStore.list<{
      task_id: string;
      name: string;
      details?: {
        error_diagnostic?: Record<string, unknown>;
      };
    }>('ws_holder_ready_fail_agent_task_trace_events', { task_id: task.id });
    const terminalTrace = traces.find((item) => item.name === 'execution.terminal');
    expect(terminalTrace?.details?.error_diagnostic).toMatchObject({
      code: 'AGENT_SANDBOX_UNAVAILABLE',
      retryable: false,
      message: 'agent_sandbox_unavailable: pod missing',
    });
  });

  it('refuses managed workspace binding when the task file library is not ready', async () => {
    const previousExecutionHttpBase = process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.AGENT_EXECUTION_HTTP_BASE_URL = 'http://10.88.0.1:20000/api/v1';
    const ensureWorkspaceBinding = vi.fn(async () => ({
      workspaceMount: {
        bindingId: 'flib_internal_deleting',
        mountPath: '/home/task_internal_deleting',
      },
      binding: {
        file_library_id: 'flib_internal_deleting',
      },
    }));
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_must_not_dispatch',
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
          id: 'agent_internal_deleting',
          status: 'enabled',
          mode: 'internal',
          execution_preferences_json: {
            notebook: {
              endpoint_id: 'ep_internal_deleting',
            },
          },
        })),
      },
      endpointResourceService: {
        getEndpoint: vi.fn(async () => ({
          id: 'ep_internal_deleting',
          workspace_id: 'ws_internal_deleting',
          project_id: 'proj_internal_deleting',
          status: 'active',
          model: 'placeholder-model',
          credential_ref: 'cred_internal_deleting',
          name: 'endpoint-internal-deleting',
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
      internalAgentWorkspaceBindingManager: {
        ensureWorkspaceBinding,
      },
      internalWorkloadCoordinator: {
        acquireHolder,
        releaseHolder,
      },
    } as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_internal_deleting',
      projectId: 'proj_internal_deleting',
      endpointId: 'ep_internal_deleting',
    });
    const now = new Date().toISOString();
    await deps.docStore.upsert('project_file_libraries', 'flib_internal_deleting', {
      id: 'flib_internal_deleting',
      workspace_id: 'ws_internal_deleting',
      project_id: 'proj_internal_deleting',
      name: 'Internal Deleting Workspace',
      status: 'deleting',
      version: 2,
      file_library_home_segment: 'flibhome_internal_deleting',
      source: 'agent_task_files',
      created_by_user_id: 'user_internal_deleting',
      created_at: now,
      updated_at: now,
    });
    const acquired = await new JsonDocTaskFileLibraryBindingRepo(deps.docStore).acquire({
      workspaceId: 'ws_internal_deleting',
      projectId: 'proj_internal_deleting',
      fileLibraryId: 'flib_internal_deleting',
      taskId: 'task_internal_deleting',
      taskTitle: 'internal deleting task',
      taskStatus: 'active',
      ownerUserId: 'user_internal_deleting',
      runtimeWritableAffordance: 'task_internal_home',
      correlationId: 'req_internal_deleting_binding',
      now,
    });
    if (!acquired.ok) throw new Error('expected binding acquire to succeed');
    const task = {
      id: 'task_internal_deleting',
      workspace_id: 'ws_internal_deleting',
      project_id: 'proj_internal_deleting',
      owner_user_id: 'user_internal_deleting',
      title: 'internal deleting task',
      task_home_segment: 'task_internal_deleting',
      status: 'active' as const,
      attached_inputs: [],
      created_at: now,
      updated_at: now,
      last_activity_at: now,
      agent_id: 'agent_internal_deleting',
      workspace_file_library_id: 'flib_internal_deleting',
      workspace_file_library_name: 'Internal Deleting Workspace',
      file_library_binding_generation: acquired.binding.bindingGeneration,
      runtime_writable_affordance: 'task_internal_home' as const,
    };
    const assistantMessage = {
      id: 'msg_internal_deleting',
      task_id: task.id,
      role: 'agent' as const,
      content: '',
      created_at: now,
    };
    const emitted: Array<{ type: string; data: { code?: string } }> = [];

    try {
      await runNotebookTaskWithExecutionAgent({
        deps,
        task,
        assistantMessage,
        agentId: 'agent_internal_deleting',
        user: { id: 'user_internal_deleting', name: 'Internal Deleting User', email: 'internal-deleting@example.com' },
        publicBaseUrl: 'http://localhost:20072',
        buildRunId: () => 'run_internal_deleting',
        buildProxyUsername: () => 'internal_deleting_user',
        mapTaskMessagesForExecution: () => [],
        updateTaskActivity: () => undefined,
        emitTaskEvent: (_taskId, payload) => {
          emitted.push(payload as { type: string; data: { code?: string } });
        },
        onFinalize: () => undefined,
        debugLog: () => undefined,
        taskCollections: {
          tasks: 'project_tasks',
          messages: 'project_task_messages',
        },
        createTaskArtifact: async () => ({
          id: 'artifact_internal_deleting',
          task_id: task.id,
          type: 'file',
          created_at: now,
        }),
      });
    } finally {
      if (previousExecutionHttpBase === undefined) delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
      else process.env.AGENT_EXECUTION_HTTP_BASE_URL = previousExecutionHttpBase;
    }

    expect(ensureWorkspaceBinding).not.toHaveBeenCalled();
    expect(acquireHolder).not.toHaveBeenCalled();
    expect(releaseHolder).not.toHaveBeenCalled();
    expect(dispatchStreamingRequest).not.toHaveBeenCalled();
    expect(emitted.find((item) => item.type === 'error')?.data.code).toBe('FILE_LIBRARY_DELETING');
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
            image: NOTEBOOK_EXECUTION_MANAGED_RUNNER_IMAGE,
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
    await seedAgentTaskModelSetting(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_internal_abort',
      projectId: 'proj_internal_abort',
      endpointId: 'ep_internal_abort',
    });
    await seedReadyTaskWorkspaceLibrary(deps.docStore as InMemoryJsonDocStore, {
      workspaceId: 'ws_internal_abort',
      projectId: 'proj_internal_abort',
      libraryId: 'flib_internal_abort',
      ownerUserId: 'user_internal_abort',
      name: 'Internal Abort Workspace',
    });

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
    const restoreManagedExecutionApiBase = setManagedExecutionApiBaseForTest();
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    let streamConsumed = false;
    const deps = attachManagedExecutionDeps({
      cache,
      docStore,
      agentResourceService: {
        getAgent: vi.fn(async () => ({
          id: 'agent_late_dispatch_cancelled',
          status: 'enabled',
          runner_provider: 'managed',
          mode: 'internal',
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
    }) as unknown as NodeApiDeps;
    await seedAgentTaskModelSetting(docStore, {
      workspaceId: 'ws_late_dispatch_cancelled',
      projectId: 'proj_late_dispatch_cancelled',
      endpointId: 'ep_late_dispatch_cancelled',
    });

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
      workspace_file_library_id: 'flib_late_dispatch_cancelled',
      workspace_file_library_name: 'Late Dispatch Cancelled Workspace',
    };
    await seedReadyTaskWorkspaceLibraryForTask(deps.docStore as InMemoryJsonDocStore, task);
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

    try {
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
    } finally {
      restoreManagedExecutionApiBase();
    }

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
