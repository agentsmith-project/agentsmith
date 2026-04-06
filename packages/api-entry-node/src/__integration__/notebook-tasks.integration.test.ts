import { execFileSync } from 'node:child_process';
import http, { type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDefaultNodeApiDeps } from '../index.js';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  getNotebookTaskRunCancellationRequest,
} from '../notebook-task/task-run-coordination.js';
import type { TaskRecord } from '../notebook-task/task-models.js';
import { getTasks } from '../notebook-task/task-runtime-state.js';
import { notebookTasksCollection } from '../notebook-task/task-store.js';
import { issueInternalTicket } from '../internal-ticket-store.js';
import { apiFetch, apiFetchWithToken, startServer, startServerWithDeps } from './test-support.js';

const upstreamServers: Server[] = [];
const sockets: WebSocket[] = [];

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
});

function startUpstreamServer(): {
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
  lastPath: () => string;
} {
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
  const raw = execFileSync('python3', ['-c', 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'], {
    encoding: 'utf8',
  }).trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid_notebook_upstream_port:${raw}`);
  }
  server.listen(port, '127.0.0.1');
  upstreamServers.push(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    lastBody: () => body,
    lastPath: () => path,
  };
}

async function createFileLibrary(baseUrl: string, name = 'Notebook Workspace'): Promise<{ id: string; name: string }> {
  const createLibraryRes = await apiFetch(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description: 'task workspace library' }),
    },
  );
  expect(createLibraryRes.status).toBe(201);
  return (await createLibraryRes.json()) as { id: string; name: string };
}

describe('api-entry-node notebook task routes', () => {
  it('isolates notebook tasks by owner for both external and internal agents', async () => {
    const { baseUrl, deps } = startServer();
    const internalWorkspaceLibrary = await createFileLibrary(baseUrl, 'Internal Isolation Workspace');
    const externalWorkspaceLibrary = await createFileLibrary(baseUrl, 'External Isolation Workspace');
    const internalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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
    const externalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'external-notebook-agent',
      mode: 'external',
      interaction_mode: 'notebook',
      status: 'enabled',
      presence: 'online',
      config: {
        _external_key_source: 'generated',
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

    const createInternalTask = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      'test-token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Internal owner task',
          agent_id: internalAgent.id,
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
      agent_id: externalAgent.id,
      agent_name: externalAgent.name,
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

    const otherMessages = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${internalTask.id}/messages`,
      'owner-token',
    );
    expect(otherMessages.status).toBe(404);

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

  it('requires workspace file library when creating a notebook task without create-new mode', async () => {
    const { baseUrl, deps } = startServer();
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Notebook task missing workspace',
          agent_id: agent.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(422);
    await expect(createTaskRes.json()).resolves.toMatchObject({
      error_code: 'VALIDATION_ERROR',
      message: 'workspace_file_library_id_required',
    });
  });

  it('auto-initializes a workspace file library when create-new mode is requested', async () => {
    const { baseUrl, deps } = startServer();
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Notebook task with auto workspace',
          agent_id: agent.id,
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

  it('rejects creating notebook task for offline external agents', async () => {
    const { baseUrl, deps } = startServer();
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Offline Agent Workspace');
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'offline-external-notebook-agent',
      mode: 'external',
      interaction_mode: 'notebook',
      status: 'enabled',
      config: {
        _external_key_source: 'generated',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_offline',
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
          title: 'Notebook task offline external agent',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(409);
    await expect(createTaskRes.json()).resolves.toMatchObject({
      error_code: 'AGENT_OFFLINE',
      message: 'agent_offline',
    });
  });

  it('returns task-bound workspace access for notebook task file libraries', async () => {
    const { baseUrl, deps } = startServer();
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Workspace Access Library');
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Workspace Access Task',
          agent_id: agent.id,
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
      container_workspace_path: `/workspace/${task.id}`,
      library_root_path: '.',
      task_root_path: '.',
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
    const { baseUrl, deps } = startServer();
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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
          agent_id: agent.id,
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
        session_id: task.id,
        agent_id: agent.id,
        mode: 'notebook',
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
        session_id: 'task_other',
        agent_id: agent.id,
        mode: 'notebook',
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

  it('rewrites task workspace mount access for external runner containers', async () => {
    const previousExternalExecutionBase = process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
    process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = 'http://172.18.0.1:20000';
    try {
      const { baseUrl, deps } = startServer();
      const workspaceLibrary = await createFileLibrary(baseUrl, 'External Runner Workspace Access Library');
      const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
        name: 'external-notebook-agent',
        mode: 'external',
        interaction_mode: 'notebook',
        status: 'enabled',
        config: {
          _external_key_source: 'generated',
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
      await deps.agentResourceService.markAgentConnected(agent.id, {
        remote_ip: '127.0.0.1',
        protocol_version: '1.0',
        last_pong_at: new Date().toISOString(),
      });

      const createTaskRes = await apiFetch(
        baseUrl,
        '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'External Runner Workspace Access Task',
            agent_id: agent.id,
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
        delete process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
      } else {
        process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = previousExternalExecutionBase;
      }
    }
  });

  it('rejects creating a second active task against an occupied workspace file library', async () => {
    const { baseUrl, deps } = startServer();
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Occupied Workspace');
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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

    const firstTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'First Task',
          agent_id: agent.id,
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
          agent_id: agent.id,
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
    const firstServer = startServerWithDeps(deps);
    const workspaceLibrary = await createFileLibrary(firstServer.baseUrl, 'Restart Task Workspace');
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'restartable-internal-notebook-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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

    const createTaskRes = await apiFetch(
      firstServer.baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Restart Workspace Access Task',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    firstServer.server.closeAllConnections?.();
    firstServer.server.closeIdleConnections?.();
    await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));

    const secondServer = startServerWithDeps(deps);
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

  it('keeps notebook run_state visible after restart and accepts shared cancel requests', async () => {
    const deps = createDefaultNodeApiDeps();
    const firstServer = startServerWithDeps(deps);
    const workspaceLibrary = await createFileLibrary(firstServer.baseUrl, 'Restart Run Coordination Library');
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'restartable-run-coordination-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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

    const createTaskRes = await apiFetch(
      firstServer.baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Restart Run Coordination Task',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const active = buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_restart_shared',
      startedAt: new Date().toISOString(),
    });
    await expect(acquireNotebookTaskRunLease(deps.cache, active)).resolves.toBe(true);

    firstServer.server.closeAllConnections?.();
    firstServer.server.closeIdleConnections?.();
    await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));

    const secondServer = startServerWithDeps(deps);
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
        }),
      ]),
    });

    const cancelRes = await apiFetch(
      secondServer.baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/cancel`,
      { method: 'POST' },
    );
    expect(cancelRes.status).toBe(202);
    await expect(cancelRes.json()).resolves.toMatchObject({
      status: 'cancelling',
      task_id: task.id,
      run_id: 'run_restart_shared',
    });
    await expect(getNotebookTaskRunCancellationRequest(deps.cache, task.id)).resolves.toMatchObject({
      task_id: task.id,
      run_id: 'run_restart_shared',
      actor_user_id: 'user_test',
    });
  });

  it('rejects starting a second notebook run when a shared active run already exists', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Shared Conflict Library');
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'shared-conflict-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Shared Conflict Task',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    await expect(acquireNotebookTaskRunLease(deps.cache, buildNotebookTaskRunState({
      taskId: task.id,
      runId: 'run_conflict_shared',
      startedAt: new Date().toISOString(),
    }))).resolves.toBe(true);

    const messageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'hello shared state',
        }),
      },
    );
    expect(messageRes.status).toBe(409);
    await expect(messageRes.json()).resolves.toMatchObject({
      error_code: 'TASK_STREAM_CONFLICT',
      message: 'task_stream_conflict',
    });
  });

  it('runs notebook task message through external execution service and enforces single active run per task', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();
    const workspaceLibrary = await createFileLibrary(baseUrl);

    const createCredentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'task-runner-key',
          type: 'api_key',
          value: 'sk-task',
        }),
      },
    );
    expect(createCredentialRes.status).toBe(201);
    const credential = (await createCredentialRes.json()) as { id: string };

    const createEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'task-endpoint',
          model: 'gpt-5-codex',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
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
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpointRes.status).toBe(201);
    const endpoint = (await createEndpointRes.json()) as { id: string };

    const createAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'notebook-runner',
          mode: 'external',
          interaction_mode: 'notebook',
          execution_preferences: {
            notebook: {
              endpoint_id: endpoint.id,
              wire_api: 'chat',
              model: 'gpt-5-codex',
            },
          },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgentRes.status).toBe(201);
    const agent = (await createAgentRes.json()) as { id: string };

    const keyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(keyRes.status).toBe(201);
    const keyPayload = (await keyRes.json()) as { key: string };

    const connInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connInfoRes.status).toBe(200);
    const connInfo = (await connInfoRes.json()) as { ws_url: string };
    const wsUrl = connInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://'));

    let releaseExecution: (() => void) | null = null;
    const holdExecution = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const executionReceived = new Promise<{
      requestId: string;
      helloProxyBase: string;
      endpointProxyBase: string | null;
      apiBase: string;
      executionTicket: string;
      notebookMode: boolean | null;
      workspaceBindingMode: string | null;
      workspacePath: string | null;
      workspaceFileLibraryId: string | null;
      workspaceFileLibraryName: string | null;
      workspaceDirName: string | null;
      taskInputsCount: number | null;
      credentialFilesCount: number | null;
      hasCredentialIndexFile: boolean;
      legacyUserBearerToken: string;
      close: () => void;
    }>((resolve) => {
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
              notebook_mode?: boolean;
              workspace_binding_mode?: string;
              workspace_path?: string;
              workspace_file_library_id?: string | null;
              workspace_file_library_name?: string | null;
              workspace_dir_name?: string | null;
              task_inputs?: unknown[];
              credential_files?: Array<{ relative_path?: string }>;
            };
          };
        };
        if (msg.type === 'server.hello') {
          helloProxyBase = msg.payload?.resource_proxy?.base_url ?? '';
          return;
        }
        if (msg.type !== 'server.request.start' || !msg.request_id) return;
        resolve({
          requestId: msg.request_id,
          helloProxyBase,
          endpointProxyBase: null,
          apiBase: msg.payload?.execution_context?.api_base ?? '',
          executionTicket: msg.payload?.execution_context?.execution_ticket ?? '',
          legacyUserBearerToken: msg.payload?.execution_context?.user_bearer_token ?? '',
          notebookMode: typeof msg.payload?.execution_context?.notebook_mode === 'boolean'
            ? msg.payload.execution_context.notebook_mode
            : null,
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
          credentialFilesCount: Array.isArray(msg.payload?.execution_context?.credential_files)
            ? msg.payload.execution_context.credential_files.length
            : null,
          hasCredentialIndexFile: Array.isArray(msg.payload?.execution_context?.credential_files)
            ? msg.payload.execution_context.credential_files.some((item) => {
              const relativePath = typeof item?.relative_path === 'string' ? item.relative_path : '';
              return relativePath === '.codex/credential/index.json';
            })
            : false,
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
    });
    const runnerReady = new Promise<void>((resolve, reject) => {
      const ws = sockets[sockets.length - 1];
      if (!ws) {
        reject(new Error('execution socket not initialized'));
        return;
      }
      ws.once('error', reject);
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as { type?: string };
        if (msg.type !== 'server.hello') return;
        ws.send(JSON.stringify({
          type: 'agent.ready',
          payload: { capabilities: { wire_api: 'chat' } },
        }));
        resolve();
      });
    });
    await runnerReady;

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Notebook task',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

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
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'run this',
        }),
      },
    );
    expect(postMessageRes.status).toBe(200);

    const conflictRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'second request',
        }),
      },
    );
    expect(conflictRes.status).toBe(409);
    releaseExecution?.();

    const execution = await executionReceived;
    expect(execution.requestId).toBeTruthy();
    expect(execution.executionTicket).toMatch(/^exec_/);
    expect(execution.legacyUserBearerToken).toBe('');
    expect(execution.apiBase).toBe(baseUrl);
    expect(execution.notebookMode).toBe(true);
    expect(execution.workspaceBindingMode).toBe('file_library');
    expect(execution.workspacePath).toBeNull();
    expect(execution.workspaceFileLibraryId).toBe(workspaceLibrary.id);
    expect(execution.workspaceFileLibraryName).toBe(workspaceLibrary.name);
    expect(execution.workspaceDirName).toBe(workspaceLibrary.filesystem_name);
    expect(execution.taskInputsCount).toBe(0);
    expect(execution.credentialFilesCount).toBeGreaterThan(0);
    expect(execution.hasCredentialIndexFile).toBe(true);
    expect(execution.helloProxyBase).toBe(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai`,
    );
    expect(execution.endpointProxyBase).toBeNull();

    let messagesBody: Array<{ role: string; content: string }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const messagesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      );
      expect(messagesRes.status).toBe(200);
      messagesBody = (await messagesRes.json()) as Array<{ role: string; content: string }>;
      if (messagesBody.some((item) => item.role === 'agent' && item.content.includes('task-output'))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(messagesBody.some((item) => item.role === 'agent' && item.content.includes('task-output'))).toBe(true);

    let tracesBody: {
      items: Array<{ message_id: string; category: string; summary: string }>;
      total: number;
      has_more?: boolean;
      next_after_id?: string | null;
    } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const tracesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces`,
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
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/artifacts`,
      );
      expect(artifactsRes.status).toBe(200);
      artifactsBody = (await artifactsRes.json()) as Array<{ type: string; title?: string }>;
      if (artifactsBody.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(artifactsBody.some((item) => item.type === 'image' && item.title === 'plot.png')).toBe(true);

    const taskAfterRunRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
    );
    expect(taskAfterRunRes.status).toBe(200);
    const taskAfterRun = (await taskAfterRunRes.json()) as { status: string };
    expect(taskAfterRun.status).toBe('active');

    let secondTurnStatus = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const secondTurnRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: 'follow-up request',
          }),
        },
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
  });

  it('synthesizes terminal trace and closes task when notebook execution dispatch fails', async () => {
    const { baseUrl } = startServer();
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Offline Execution Workspace');

    const createCredentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'task-runner-key-offline',
          type: 'api_key',
          value: 'sk-task-offline',
        }),
      },
    );
    expect(createCredentialRes.status).toBe(201);
    const credential = (await createCredentialRes.json()) as { id: string };

    const createEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'task-endpoint-offline',
          model: 'gpt-5-codex',
          type: 'openai',
          mode: 'openai',
          base_url: 'https://example.com/v1',
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
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpointRes.status).toBe(201);
    const endpoint = (await createEndpointRes.json()) as { id: string };

    const createAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'notebook-runner-offline',
          mode: 'external',
          interaction_mode: 'notebook',
          execution_preferences: {
            notebook: {
              endpoint_id: endpoint.id,
              wire_api: 'chat',
              model: 'gpt-5-codex',
            },
          },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgentRes.status).toBe(201);
    const agent = (await createAgentRes.json()) as { id: string };

    const keyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'runner-offline' }),
      },
    );
    expect(keyRes.status).toBe(201);
    const keyPayload = (await keyRes.json()) as { key: string };
    const connInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connInfoRes.status).toBe(200);
    const connInfo = (await connInfoRes.json()) as { ws_url: string };
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
          payload: { capabilities: { wire_api: 'chat' } },
        }));
        resolve();
      });
    });

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Notebook task offline execution',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };
    ws.close();

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'run this despite offline execution',
        }),
      },
    );
    expect(postMessageRes.status).toBe(200);

    let tracesBody: { items: Array<{ status?: string; name?: string; summary?: string; details?: Record<string, unknown> }> } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const tracesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces`,
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
    expect(terminalTrace?.summary).toContain('AGENT_OFFLINE');
    expect((terminalTrace?.details as { synthesized?: boolean } | undefined)?.synthesized).toBe(true);

    const taskAfterRunRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
    );
    expect(taskAfterRunRes.status).toBe(200);
    const taskAfterRun = (await taskAfterRunRes.json()) as { status: string };
    expect(taskAfterRun.status).toBe('active');
  });

  it('exposes authenticated notebook task metrics snapshot', async () => {
    const { baseUrl } = startServer();

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
    const { baseUrl } = startServer();

    const metricsRes = await apiFetch(baseUrl, '/api/v1/internal/notebook-task-metrics/prometheus');
    expect(metricsRes.status).toBe(200);
    const text = await metricsRes.text();
    expect(text).toContain('notebook_active_runs ');
    expect(text).toContain('notebook_task_runs_started_total ');
    expect(text).toContain('notebook_task_traces_query_duration_ms_count');
  });

  it('records task trace query metrics for message-scoped requests', async () => {
    const { baseUrl, deps } = startServer();
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Trace Metrics Workspace');

    const createCredentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'trace-metrics-key',
          type: 'api_key',
          value: 'sk-trace-metrics',
        }),
      },
    );
    expect(createCredentialRes.status).toBe(201);
    const credential = (await createCredentialRes.json()) as { id: string };

    const createEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'trace-metrics-endpoint',
          model: 'placeholder-model',
          type: 'openai',
          mode: 'responses',
          base_url: 'https://example.com/v1',
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
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpointRes.status).toBe(201);
    const endpoint = (await createEndpointRes.json()) as { id: string };

    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'Metrics notebook agent',
      mode: 'internal',
      interaction_mode: 'notebook',
      status: 'enabled',
      config: {
        image: 'runner:v1',
        _internal_raw_key: 'ask_test',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
      execution_preferences_json: {
        notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'placeholder-model' },
      },
    });

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Trace metrics task',
          agent_id: agent.id,
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

  it('builds external terminal sessions with file-library execution context and no workspace path', async () => {
    const deps = createDefaultNodeApiDeps();
    let capturedExecutionContext: Record<string, unknown> | null = null;
    deps.notebookTerminalService.createSession = async (input) => {
      capturedExecutionContext = input.executionContext ?? null;
      return {
        sessionId: 'term_external_capture',
        wsPath: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_external_terminal/terminal/ws?session_id=term_external_capture&ticket=term_ticket',
        wsTicket: 'term_ticket',
      };
    };
    deps.agentExecutionService.getAgentSessionOnlineState = () => true;
    deps.agentExecutionService.getAgentOnlineState = () => true;
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'external-terminal-agent',
      mode: 'external',
      interaction_mode: 'notebook',
      status: 'enabled',
      presence: 'online',
      config: {
        _external_key_source: 'generated',
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
    await deps.agentResourceService.markAgentConnected(agent.id, {
      remote_ip: '127.0.0.1',
      protocol_version: '1.0',
      last_pong_at: new Date().toISOString(),
    });

    const { baseUrl } = startServerWithDeps(deps);
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
          agent_id: agent.id,
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 120, rows: 40, shell: '/bin/zsh' }),
      },
    );
    expect(createTerminalRes.status).toBe(201);
    expect(capturedExecutionContext).toBeTruthy();
    expect(capturedExecutionContext?.workspace_binding_mode).toBe('file_library');
    expect(capturedExecutionContext?.workspace_path).toBeUndefined();
    expect(capturedExecutionContext?.workspace_file_library_id).toBe(workspaceLibrary.id);
    expect(capturedExecutionContext?.workspace_dir_name).toBe(workspaceLibrary.filesystem_name);
    expect(capturedExecutionContext?.notebook_mode).toBe(true);
    expect(Array.isArray(capturedExecutionContext?.credential_files)).toBe(true);
  });

  it('builds internal terminal sessions with a task-root workspace path', async () => {
    const deps = createDefaultNodeApiDeps();
    let capturedExecutionContext: Record<string, unknown> | null = null;
    let ensuredWorkspaceMountPath = '';
    let ensuredWorkspaceTaskId = '';
    deps.notebookTerminalService.createSession = async (input) => {
      capturedExecutionContext = input.executionContext ?? null;
      return {
        sessionId: 'term_internal_capture',
        wsPath: '/api/v1/workspaces/ws_default/projects/proj_1/tasks/task_internal_terminal/terminal/ws?session_id=term_internal_capture&ticket=term_ticket',
        wsTicket: 'term_ticket',
      };
    };
    deps.internalAgentWorkspaceBindingManager = {
      ensureWorkspaceBinding: async (input) => {
        ensuredWorkspaceTaskId = input.taskId;
        ensuredWorkspaceMountPath = `/workspace/${input.taskId}`;
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
            mountPath: ensuredWorkspaceMountPath,
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
    const agent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-terminal-agent',
      mode: 'internal',
      interaction_mode: 'notebook',
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

    const { baseUrl } = startServerWithDeps(deps);
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
          agent_id: agent.id,
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      },
    );
    expect(createTerminalRes.status).toBe(201);
    expect(ensuredWorkspaceTaskId).toBe(task.id);
    expect(ensuredWorkspaceMountPath).toBe(`/workspace/${task.id}`);
    expect(capturedExecutionContext).toBeTruthy();
    expect(capturedExecutionContext?.workspace_binding_mode).toBe('pre_mounted');
    expect(capturedExecutionContext?.workspace_path).toBe(`/workspace/${task.id}`);
    expect(capturedExecutionContext?.workspace_file_library_id).toBe(workspaceLibrary.id);
    expect(capturedExecutionContext?.workspace_dir_name).toBe(workspaceLibrary.filesystem_name);
    expect(capturedExecutionContext?.notebook_mode).toBe(true);
  });
});
