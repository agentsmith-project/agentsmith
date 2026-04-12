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

  it('isolates member context between different authenticated users in the same workspace', async () => {
    const { baseUrl } = startServer();

    const saveRes = await apiFetchWithToken(baseUrl, '/api/v1/context', 'test-token', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'member',
        key: 'prefs.hidden',
        workspace_id: 'ws_default',
        content: 'only-user-test',
        content_type: 'text',
      }),
    });
    expect(saveRes.status).toBe(200);

    const otherUserGetRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/context?scope=member&key=prefs.hidden&workspace_id=ws_default',
      'alt-token',
    );
    expect(otherUserGetRes.status).toBe(404);
    await expect(otherUserGetRes.json()).resolves.toMatchObject({
      error_code: 'NOT_FOUND',
      message: 'context_not_found',
    });
  });

  it('stores project_member context and reads it back over the authenticated API', async () => {
    const { baseUrl, deps } = startServer();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_test',
      input: {
        name: 'Project Member Context',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });

    const saveRes = await apiFetchWithToken(baseUrl, '/api/v1/context', 'test-token', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project_member',
        key: 'bindings.feishu.connection_id',
        workspace_id: 'ws_default',
        project_id: project.id,
        content: 'uec_project_1',
        content_type: 'text',
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=${project.id}`,
      'test-token',
    );
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toMatchObject({
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      content: 'uec_project_1',
      workspace_id: 'ws_default',
      project_id: project.id,
      user_id: 'user_test',
    });
  });

  it('isolates project_member context between different authenticated users in the same project', async () => {
    const { baseUrl, deps } = startServer();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_test',
      input: {
        name: 'Project Member Isolation',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });

    const saveRes = await apiFetchWithToken(baseUrl, '/api/v1/context', 'test-token', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project_member',
        key: 'bindings.feishu.connection_id',
        workspace_id: 'ws_default',
        project_id: project.id,
        content: 'uec_project_1',
        content_type: 'text',
      }),
    });
    expect(saveRes.status).toBe(200);

    const otherUserGetRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=${project.id}`,
      'alt-token',
    );
    expect(otherUserGetRes.status).toBe(404);
    await expect(otherUserGetRes.json()).resolves.toMatchObject({
      error_code: 'NOT_FOUND',
      message: 'context_not_found',
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

  it('lets an agent execution ticket read project_member context but not write it', async () => {
    const { baseUrl, deps } = startServer();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_test',
      input: {
        name: 'Project Member Agent Access',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });

    const saveRes = await apiFetchWithToken(baseUrl, '/api/v1/context', 'test-token', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project_member',
        key: 'bindings.feishu.connection_id',
        workspace_id: 'ws_default',
        project_id: project.id,
        content: 'uec_project_1',
        content_type: 'text',
      }),
    });
    expect(saveRes.status).toBe(200);

    const executionTicket = await issueInternalTicket(deps.cache, {
      purpose: 'agent_execution',
      userId: 'user_test',
      workspaceId: 'ws_default',
      projectId: project.id,
      prefix: 'exec',
      maxUses: 5,
      payload: {
        endpoint_id: 'ep_1',
        task_id: 'task_1',
        session_id: 'task_1',
        agent_id: 'agent_1',
        mode: 'notebook',
      },
    });

    const getRes = await fetch(
      `${baseUrl}/api/v1/context?scope=project_member&key=bindings.feishu.connection_id&workspace_id=ws_default&project_id=${project.id}`,
      {
        headers: {
          Authorization: `Bearer ${executionTicket.ticket}`,
        },
      },
    );
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toMatchObject({
      scope: 'project_member',
      key: 'bindings.feishu.connection_id',
      content: 'uec_project_1',
      user_id: 'user_test',
    });

    const writeRes = await fetch(
      `${baseUrl}/api/v1/context`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${executionTicket.ticket}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scope: 'project_member',
          key: 'bindings.feishu.connection_id',
          workspace_id: 'ws_default',
          project_id: project.id,
          content: 'uec_project_2',
          content_type: 'text',
        }),
      },
    );
    expect(writeRes.status).toBe(403);
    await expect(writeRes.json()).resolves.toMatchObject({
      error_code: 'FORBIDDEN',
      message: 'context_scope_read_only_for_agent',
    });
  });

  it('isolates task context from other users and mismatched task tickets', async () => {
    const { baseUrl, deps } = startServer();
    const createdTask: TaskRecord = {
      id: 'task_ctx_isolated',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      owner_user_id: 'user_test',
      title: 'Context isolation task',
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
    const otherTask: TaskRecord = {
      ...createdTask,
      id: 'task_ctx_other',
      title: 'Other task',
    };
    getTasks('ws_default', 'proj_1').unshift(otherTask);
    getTasks('ws_default', 'proj_1').unshift(createdTask);
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection('ws_default'), createdTask.id, createdTask);
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection('ws_default'), otherTask.id, otherTask);

    const putRes = await apiFetchWithToken(baseUrl, '/api/v1/context', 'test-token', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'task',
        key: 'notes.isolated',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        task_id: createdTask.id,
        content: 'owner-only-task-note',
        content_type: 'text',
      }),
    });
    expect(putRes.status).toBe(200);

    const otherUserGetRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/context?scope=task&key=notes.isolated&workspace_id=ws_default&project_id=proj_1&task_id=${createdTask.id}`,
      'alt-token',
    );
    expect(otherUserGetRes.status).toBe(404);
    await expect(otherUserGetRes.json()).resolves.toMatchObject({
      message: 'context_task_not_found',
    });

    const wrongTaskTicket = await issueInternalTicket(deps.cache, {
      purpose: 'agent_execution',
      userId: 'user_test',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      prefix: 'exec',
      maxUses: 5,
      payload: {
        endpoint_id: 'ep_1',
        task_id: otherTask.id,
        session_id: otherTask.id,
        agent_id: 'agent_1',
        mode: 'notebook',
      },
    });

    const wrongTaskRes = await fetch(
      `${baseUrl}/api/v1/context?scope=task&key=notes.isolated&workspace_id=ws_default&project_id=proj_1&task_id=${createdTask.id}`,
      {
        headers: {
          Authorization: `Bearer ${wrongTaskTicket.ticket}`,
        },
      },
    );
    expect(wrongTaskRes.status).toBe(403);
    await expect(wrongTaskRes.json()).resolves.toMatchObject({
      error_code: 'FORBIDDEN',
      message: 'context_task_scope_mismatch',
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
