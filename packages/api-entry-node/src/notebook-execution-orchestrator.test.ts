import { describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { upsertProjectResourcePolicy } from './project-resource-policy-store.js';
import { listAuditEvents } from './audit-usage-store.js';
import { runNotebookTaskWithExecutionAgent } from './notebook-execution-orchestrator.js';
import type { NodeApiDeps } from './node-api-deps.js';

describe('notebook-execution-orchestrator governance preflight', () => {
  it('emits RESOURCE_POLICY_DENIED and does not dispatch runtime when endpoint access is denied', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const endpointId = 'ep_denied';
    upsertProjectResourcePolicy(workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: endpointId,
      access_mode: 'allow_list',
      allowed_subjects: [],
    });

    const dispatchStreamingRequest = vi.fn();
    const deps = {
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
          model: 'glm-5',
          credential_ref: 'cred_1',
          name: 'endpoint-1',
          type: 'openai',
          base_url: 'https://example.com',
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
      rawBearerToken: 'token',
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
});
