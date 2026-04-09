import { describe, expect, it } from 'vitest';
import { issueInternalTicket } from '../internal-ticket-store.js';
import { createUserExternalConnection } from '../user-external-connections-store.js';
import type { TaskRecord } from '../notebook-task/task-models.js';
import { getTasks } from '../notebook-task/task-runtime-state.js';
import { notebookTasksCollection } from '../notebook-task/task-store.js';
import { apiFetchWithToken, startServer } from './test-support.js';

describe('api-entry-node context store integration', () => {
  it('stores member context and reads it back over the authenticated API', async () => {
    const { baseUrl } = startServer();

    const saveRes = await apiFetchWithToken(baseUrl, '/api/v1/context', 'test-token', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'member',
        key: 'prefs.editor',
        workspace_id: 'ws_default',
        content: 'vim',
        content_type: 'text',
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/context?scope=member&key=prefs.editor&workspace_id=ws_default',
      'test-token',
    );
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toMatchObject({
      scope: 'member',
      key: 'prefs.editor',
      content: 'vim',
      workspace_id: 'ws_default',
      user_id: 'user_test',
    });
  });

  it('lets an agent execution ticket read task context written by the task owner', async () => {
    const { baseUrl, deps } = startServer();
    const createdTask: TaskRecord = {
      id: 'task_ctx_owner',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_test',
      title: 'Context task',
      agent_id: 'agent_1',
      agent_name: 'Context Agent',
      workspace_file_library_id: 'lib_ctx',
      workspace_file_library_name: 'Context Library',
      status: 'active',
      attached_inputs: [],
      created_at: '2026-04-08T00:00:00.000Z',
      updated_at: '2026-04-08T00:00:00.000Z',
      last_activity_at: '2026-04-08T00:00:00.000Z',
    };
    getTasks('ws_default', 'proj_1').unshift(createdTask);
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection('ws_default'), createdTask.id, createdTask);

    const putRes = await apiFetchWithToken(baseUrl, '/api/v1/context', 'test-token', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'task',
        key: 'notes.current',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        task_id: createdTask.id,
        content: 'remember this task note',
        content_type: 'text',
      }),
    });
    expect(putRes.status).toBe(200);

    const executionTicket = await issueInternalTicket(deps.cache, {
      purpose: 'agent_execution',
      userId: 'user_test',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      maxUses: 5,
      payload: {
        endpoint_id: 'ep_1',
        task_id: createdTask.id,
        session_id: createdTask.id,
        agent_id: 'agent_1',
        mode: 'notebook',
      },
    });

    const getRes = await fetch(
      `${baseUrl}/api/v1/context?scope=task&key=notes.current&workspace_id=ws_default&project_id=proj_1&task_id=${createdTask.id}`,
      {
        headers: {
          Authorization: `Bearer ${executionTicket.ticket}`,
        },
      },
    );
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toMatchObject({
      scope: 'task',
      key: 'notes.current',
      content: 'remember this task note',
      user_id: 'user_test',
      task_id: createdTask.id,
    });
  });

  it('returns the workspace-scoped managed credential projection and blocks cross-workspace refresh for tickets', async () => {
    const { baseUrl, deps } = startServer();

    await createUserExternalConnection(deps.docStore, {
      user_id: 'user_test',
      workspace_id: 'ws_default',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'Workspace Feishu',
      status: 'reauth_required',
      fields: [{ key: 'access_token', value: 'workspace_token', secret: true }],
      scopes: ['search:docs:read'],
      reauth_reason: 'missing_scopes',
    });
    await createUserExternalConnection(deps.docStore, {
      user_id: 'user_test',
      workspace_id: 'ws_other',
      provider: 'feishu',
      kind: 'oauth_account',
      display_name: 'Other Workspace Feishu',
      status: 'active',
      fields: [{ key: 'access_token', value: 'other_token', secret: true }],
      scopes: ['search:docs:read'],
    });

    const projectionRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/context?scope=member&key=managed_credentials.feishu&workspace_id=ws_default',
      'test-token',
    );
    expect(projectionRes.status).toBe(200);
    const projectionPayload = await projectionRes.json() as { content: string };
    const projectionContent = JSON.parse(projectionPayload.content) as { display_name: string; status: string };
    expect(projectionContent.display_name).toBe('Workspace Feishu');
    expect(projectionContent.status).toBe('reauth_required');

    const executionTicket = await issueInternalTicket(deps.cache, {
      purpose: 'agent_execution',
      userId: 'user_test',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      maxUses: 5,
      payload: {
        endpoint_id: 'ep_1',
        task_id: 'task_1',
        session_id: 'task_1',
        agent_id: 'agent_1',
        mode: 'chat',
      },
    });

    const refreshRes = await fetch(
      `${baseUrl}/api/v1/context/managed-credentials/feishu/refresh?workspace_id=ws_other`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${executionTicket.ticket}`,
        },
      },
    );
    expect(refreshRes.status).toBe(403);
    await expect(refreshRes.json()).resolves.toMatchObject({
      error_code: 'FORBIDDEN',
      message: 'context_workspace_scope_mismatch',
    });
  });
});
