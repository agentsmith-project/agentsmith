import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDefaultNodeApiDeps } from '../index.js';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  getNotebookTaskRunCancellationRequest,
} from '../notebook-task/task-run-coordination.js';
import { apiFetch, startServer, startServerWithDeps } from './test-support.js';

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
  server.listen(0);
  upstreamServers.push(server);
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
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
  it('requires workspace file library when creating a notebook task', async () => {
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
          model: 'glm-4.7',
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
      workspace_dir_name: 'workspace-access-task',
      file_library_id: workspaceLibrary.id,
      file_library_name: workspaceLibrary.name,
      filesystem_name: expect.any(String),
      metadata_url: expect.any(String),
      recommended_mount_path: expect.any(String),
      created_at: expect.any(String),
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
      metadata_url: expect.any(String),
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

    const executionReceived = new Promise<{
      requestId: string;
      helloProxyBase: string;
      endpointProxyBase: string | null;
      apiBase: string;
      userToken: string;
      notebookMode: boolean | null;
      workspaceBindingMode: string | null;
      workspaceFileLibraryId: string | null;
      workspaceFileLibraryName: string | null;
      workspaceDirName: string | null;
      taskInputsCount: number | null;
      credentialFilesCount: number | null;
      hasCredentialIndexFile: boolean;
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
              user_bearer_token?: string;
              notebook_mode?: boolean;
              workspace_binding_mode?: string;
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
          userToken: msg.payload?.execution_context?.user_bearer_token ?? '',
          notebookMode: typeof msg.payload?.execution_context?.notebook_mode === 'boolean'
            ? msg.payload.execution_context.notebook_mode
            : null,
          workspaceBindingMode: typeof msg.payload?.execution_context?.workspace_binding_mode === 'string'
            ? msg.payload.execution_context.workspace_binding_mode
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
            ? msg.payload.execution_context.credential_files.some((item) => item?.relative_path === '.codex/credential/index.json')
            : false,
          close: () => ws.close(),
        });
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
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: 'agent.response.done',
            request_id: msg.request_id,
            payload: { finish_reason: 'stop', usage_tokens: 8 },
          }));
        }, 20);
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

    const execution = await executionReceived;
    expect(execution.requestId).toBeTruthy();
    expect(execution.userToken).toBe('test-token');
    expect(execution.apiBase).toBe(baseUrl);
    expect(execution.notebookMode).toBe(true);
    expect(execution.workspaceBindingMode).toBe('file_library');
    expect(execution.workspaceFileLibraryId).toBe(workspaceLibrary.id);
    expect(execution.workspaceFileLibraryName).toBe(workspaceLibrary.name);
    expect(execution.workspaceDirName).toBe('notebook-task');
    expect(execution.taskInputsCount).toBe(0);
    expect(execution.credentialFilesCount).toBeGreaterThan(0);
    expect(execution.hasCredentialIndexFile).toBe(true);
    expect(execution.helloProxyBase).toBe(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy`,
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
          model: 'glm-4.7',
          type: 'openai',
          mode: 'responses',
          base_url: 'https://example.com/v1',
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
        notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'glm-4.7' },
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
});
