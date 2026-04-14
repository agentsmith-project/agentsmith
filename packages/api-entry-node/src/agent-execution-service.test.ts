import { afterEach, describe, expect, it } from 'vitest';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { AgentResourceService } from './agent-resource-service.js';
import { AgentExecutionService } from './agent-execution-service.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  delete process.env.PUBLIC_API_BASE_URL;
  for (const ws of sockets) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  sockets.length = 0;
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});

async function setupExecutionService(options?: {
  endpointId?: string;
  interactionKind?: 'chat' | 'notebook' | null;
}) {
  const agentResourceService = new AgentResourceService(new InMemoryJsonDocStore());
  const executionService = new AgentExecutionService(agentResourceService);
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  server.on('upgrade', (req, socket, head) => executionService.handleUpgrade(req, socket, head));
  server.listen(0);
  servers.push(server);
  const address = server.address() as AddressInfo;
  const wsBase = `ws://127.0.0.1:${address.port}`;
  const persistedInteractionKind = options?.interactionKind === undefined
    ? 'chat'
    : options.interactionKind;

  const agent = await agentResourceService.createAgent('ws_default', 'proj_1', {
    name: 'execution-agent',
    mode: 'external',
    ...(persistedInteractionKind ? { interaction_kind: persistedInteractionKind } : {}),
    ...(options?.endpointId
      ? {
        execution_preferences_json: {
          [((persistedInteractionKind ?? 'notebook'))]: {
            endpoint_id: options.endpointId,
          },
        },
      }
      : {}),
  });
  const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);

  const ws = new WebSocket(`${wsBase}/api/v1/agent-execution/ws?agent_id=${encodeURIComponent(agent.id)}`, {
    headers: { Authorization: `Bearer ${keyPair.key}` },
  });
  sockets.push(ws);
  const helloFramePromise = new Promise<Record<string, unknown>>((resolve) => {
    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
        if (message.type === 'server.hello') {
          resolve(message);
        }
      } catch {
        // ignore invalid frames in test helper
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  return {
    agentResourceService,
    executionService,
    agent,
    ws,
    wsBase,
    helloFramePromise,
  };
}

describe('AgentExecutionService', () => {
  it('includes static resource proxy base in server.hello when agent endpoint is configured', async () => {
    process.env.PUBLIC_API_BASE_URL = 'http://trusted.example/api/v1';
    const { helloFramePromise } = await setupExecutionService({
      endpointId: 'ep_hello',
      interactionKind: 'notebook',
    });
    const hello = await helloFramePromise;
    expect(hello.type).toBe('server.hello');
    const payload = (hello.payload ?? {}) as {
      protocol_version?: string;
      heartbeat_interval_sec?: number;
      resource_proxy?: { base_url?: string };
    };
    expect(payload.protocol_version).toBe('1.0');
    expect(payload.heartbeat_interval_sec).toBe(15);
    expect(payload.resource_proxy?.base_url).toBe(
      'http://trusted.example'
      + `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_hello/proxy/openai`,
    );
  });

  it('includes static resource proxy base in server.hello for chat agents using trusted configured api base', async () => {
    process.env.PUBLIC_API_BASE_URL = 'http://trusted.example/api/v1';
    const { helloFramePromise } = await setupExecutionService({
      endpointId: 'ep_chat_hello',
      interactionKind: 'chat',
    });
    const hello = await helloFramePromise;
    const payload = (hello.payload ?? {}) as {
      resource_proxy?: { base_url?: string };
    };
    expect(payload.resource_proxy?.base_url).toBe(
      'http://trusted.example'
      + '/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_chat_hello/proxy/openai',
    );
  });

  it('does not trust forwarded host headers when building server.hello resource proxy base', async () => {
    process.env.PUBLIC_API_BASE_URL = 'http://trusted.example/api/v1';
    const agentResourceService = new AgentResourceService(new InMemoryJsonDocStore());
    const executionService = new AgentExecutionService(agentResourceService);
    const server = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    server.on('upgrade', (req, socket, head) => executionService.handleUpgrade(req, socket, head));
    server.listen(0);
    servers.push(server);
    const address = server.address() as AddressInfo;

    const agent = await agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'secure-agent',
      mode: 'external',
      interaction_kind: 'chat',
      execution_preferences_json: {
        chat: {
          endpoint_id: 'ep_secure',
        },
      },
    });
    const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/agent-execution/ws?agent_id=${encodeURIComponent(agent.id)}`, {
      headers: {
        Authorization: `Bearer ${keyPair.key}`,
        Host: 'evil.example:8443',
        'X-Forwarded-Host': 'evil.example:8443',
        'X-Forwarded-Proto': 'https',
      },
    });
    sockets.push(ws);

    const hello = await new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.once('error', reject);
      ws.on('message', (raw) => {
        try {
          const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
          if (message.type === 'server.hello') {
            resolve(message);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    const payload = (hello.payload ?? {}) as { resource_proxy?: { base_url?: string } };
    expect(payload.resource_proxy?.base_url).toBe(
      'http://trusted.example/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_secure/proxy/openai',
    );
  });

  it('stores agent.ready runtime metadata separately without mutating execution preferences', async () => {
    const { agentResourceService, agent, ws } = await setupExecutionService({ interactionKind: 'notebook' });
    await agentResourceService.updateAgent('ws_default', 'proj_1', agent.id, {
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_keep',
          wire_api: 'chat',
        },
      },
    });

    ws.send(JSON.stringify({
      type: 'agent.ready',
      payload: {
        capabilities: {
          streaming_completion: true,
          multimodal_completion: false,
        },
        execution_context: {
          executor: 'codex_cli',
          wire_api: 'chat',
        },
        request_details: {
          cwd: '/tmp/task-home',
        },
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    const updated = await agentResourceService.getAgent('ws_default', 'proj_1', agent.id);
    expect(updated?.execution_preferences_json).toEqual({
      notebook: {
        endpoint_id: 'ep_keep',
        wire_api: 'chat',
      },
    });
    expect(await agentResourceService.getAgentRuntimeState('ws_default', 'proj_1', agent.id)).toEqual(
      expect.objectContaining({
        agent_id: agent.id,
        metadata: expect.objectContaining({
          capabilities: {
            streaming_completion: true,
            multimodal_completion: false,
          },
          execution_context: {
            executor: 'codex_cli',
            wire_api: 'chat',
          },
          request_details: {
            cwd: '/tmp/task-home',
          },
          ready_at: expect.any(String),
        }),
      }),
    );
  });

  it('records runner_spec mismatch in diagnostics without mutating execution preferences', async () => {
    process.env.PUBLIC_API_BASE_URL = 'http://trusted.example/api/v1';
    const { agentResourceService, agent, ws } = await setupExecutionService({
      interactionKind: 'chat',
      endpointId: 'ep_chat',
    });

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });

    ws.send(JSON.stringify({
      type: 'agent.ready',
      payload: {
        runner_spec: {
          interaction_kind: 'notebook',
          app_family: 'codex_runner',
          protocol_version: '1.0',
          context_model: 'cli_session',
          workspace_policy: 'persistent_task_workspace',
          supports_terminal: true,
        },
      },
    }));

    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: 'agent_runner_spec_mismatch',
    });

    const updated = await agentResourceService.getAgent('ws_default', 'proj_1', agent.id);
    expect(updated?.execution_preferences_json).toEqual({
      chat: {
        endpoint_id: 'ep_chat',
      },
    });
    await expect(
      agentResourceService.getDiagnostics('ws_default', 'proj_1', agent.id),
    ).resolves.toEqual(expect.objectContaining({
      last_error: 'agent_runner_spec_mismatch',
      last_error_at: expect.any(String),
      runner_spec_mismatch: {
        expected_interaction_kind: 'chat',
        actual_runner_spec: {
          interaction_kind: 'notebook',
          app_family: 'codex_runner',
          protocol_version: '1.0',
          context_model: 'cli_session',
          workspace_policy: 'persistent_task_workspace',
          supports_terminal: true,
        },
      },
    }));
  });

  it('rejects agent.ready when the persisted agent is missing interaction_kind and records diagnostics', async () => {
    const agentResourceService = new AgentResourceService(new InMemoryJsonDocStore());
    const executionService = new AgentExecutionService(agentResourceService);
    const server = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    server.on('upgrade', (req, socket, head) => executionService.handleUpgrade(req, socket, head));
    server.listen(0);
    servers.push(server);
    const address = server.address() as AddressInfo;

    const agent = await agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'missing-kind-agent',
      mode: 'external',
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_missing_kind',
        },
      },
    });
    const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);
    const ws = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/v1/agent-execution/ws?agent_id=${encodeURIComponent(agent.id)}`,
      { headers: { Authorization: `Bearer ${keyPair.key}` } },
    );
    sockets.push(ws);

    const error = await new Promise<Error>((resolve) => {
      ws.once('error', (event) => resolve(event as Error));
    });

    expect(error.message).toContain('Unexpected server response: 403');

    await expect(
      agentResourceService.getDiagnostics('ws_default', 'proj_1', agent.id),
    ).resolves.toEqual(expect.objectContaining({
      last_error: 'agent_interaction_kind_required',
      last_error_at: expect.any(String),
    }));
  });

  it('rejects unsupported interaction_mode records with interaction_kind_required', async () => {
    const docStore = new InMemoryJsonDocStore();
    const agentResourceService = new AgentResourceService(docStore);
    const executionService = new AgentExecutionService(agentResourceService);
    const server = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    server.on('upgrade', (req, socket, head) => executionService.handleUpgrade(req, socket, head));
    server.listen(0);
    servers.push(server);
    const address = server.address() as AddressInfo;

    await docStore.upsert(resolveWorkspaceScopedCollection('agents', 'ws_default'), 'ag_legacy_chat', {
      id: 'ag_legacy_chat',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'legacy-chat-agent',
      mode: 'external',
      interaction_mode: 'chat',
      execution_preferences_json: {
        chat: {
          endpoint_id: 'ep_chat_legacy',
        },
      },
      status: 'enabled',
      created_at: '2026-04-09T00:00:00.000Z',
      updated_at: '2026-04-09T00:00:00.000Z',
    });
    const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', 'ag_legacy_chat');

    const ws = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/v1/agent-execution/ws?agent_id=ag_legacy_chat`,
      { headers: { Authorization: `Bearer ${keyPair.key}` } },
    );
    sockets.push(ws);

    const error = await new Promise<Error>((resolve) => {
      ws.once('error', (event) => resolve(event as Error));
    });

    expect(error.message).toContain('Unexpected server response: 403');
    await expect(
      agentResourceService.getDiagnostics('ws_default', 'proj_1', 'ag_legacy_chat'),
    ).resolves.toEqual(expect.objectContaining({
      last_error: 'agent_interaction_kind_required',
      last_error_at: expect.any(String),
    }));
  });

  it('rejects runner_spec interaction_kind mismatch during agent.ready handshake', async () => {
    const { agentResourceService, agent, ws } = await setupExecutionService();
    await agentResourceService.updateAgent('ws_default', 'proj_1', agent.id, {
      interaction_kind: 'chat',
    });

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });

    ws.send(JSON.stringify({
      type: 'agent.ready',
      payload: {
        runner_spec: {
          interaction_kind: 'notebook',
        },
      },
    }));

    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: 'agent_runner_spec_mismatch',
    });
  });

  it('rejects runner_spec when notebook fields do not match the expected notebook app contract', async () => {
    const { agentResourceService, agent, ws } = await setupExecutionService();
    await agentResourceService.updateAgent('ws_default', 'proj_1', agent.id, {
      interaction_kind: 'notebook',
    });

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });

    ws.send(JSON.stringify({
      type: 'agent.ready',
      payload: {
        runner_spec: {
          interaction_kind: 'notebook',
          app_family: 'codex_runner',
          protocol_version: '1.0',
          context_model: 'cli_session',
          workspace_policy: 'persistent_task_workspace',
          supports_terminal: false,
        },
      },
    }));

    await expect(closed).resolves.toEqual({
      code: 1008,
      reason: 'agent_runner_spec_mismatch',
    });
  });

  it('keeps replacement websocket online when the previous runner connection closes', async () => {
    const { agentResourceService, executionService, agent, ws, wsBase } = await setupExecutionService();
    const firstSocket = ws;
    const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);

    const replacement = new WebSocket(
      `${wsBase}/api/v1/agent-execution/ws?agent_id=${encodeURIComponent(agent.id)}`,
      { headers: { Authorization: `Bearer ${keyPair.key}` } },
    );
    sockets.push(replacement);

    await new Promise<void>((resolve, reject) => {
      replacement.once('open', () => resolve());
      replacement.once('error', reject);
    });

    await new Promise<void>((resolve) => {
      firstSocket.once('close', () => resolve());
      firstSocket.close();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(executionService.getAgentOnlineState(agent.id)).toBe(true);
    const updated = await agentResourceService.getAgent('ws_default', 'proj_1', agent.id);
    expect(updated?.presence).toBe('online');
  });

  it('keeps multiple session-scoped sockets for the same agent without replacement', async () => {
    const { agentResourceService, executionService, agent, wsBase } = await setupExecutionService();
    const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);

    const sessionA = new WebSocket(
      `${wsBase}/api/v1/agent-execution/ws?agent_id=${encodeURIComponent(agent.id)}&session_id=task_a`,
      { headers: { Authorization: `Bearer ${keyPair.key}` } },
    );
    const sessionB = new WebSocket(
      `${wsBase}/api/v1/agent-execution/ws?agent_id=${encodeURIComponent(agent.id)}&session_id=task_b`,
      { headers: { Authorization: `Bearer ${keyPair.key}` } },
    );
    sockets.push(sessionA, sessionB);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        sessionA.once('open', () => resolve());
        sessionA.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        sessionB.once('open', () => resolve());
        sessionB.once('error', reject);
      }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(executionService.getAgentSessionOnlineState(agent.id, 'task_a')).toBe(true);
    expect(executionService.getAgentSessionOnlineState(agent.id, 'task_b')).toBe(true);
    expect(executionService.getAgentOnlineState(agent.id)).toBe(true);
  });

  it('sends a precise terminal close control message without requiring an active terminal dispatch queue', async () => {
    const { executionService, agent, ws } = await setupExecutionService({ interactionKind: 'notebook' });
    const closeFrame = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
        if (message.type === 'server.terminal.close') {
          resolve(message);
        }
      });
    });

    await expect(executionService.closeTerminalSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'task_1',
      agentId: agent.id,
      terminalSessionId: 'term_persisted',
    })).resolves.toBe('signaled');

    await expect(closeFrame).resolves.toMatchObject({
      type: 'server.terminal.close',
      session_id: 'task_1',
      terminal_session_id: 'term_persisted',
    });
  });

  it('emits protocol error when agent delta payload is invalid', async () => {
    const { executionService, agent, ws } = await setupExecutionService();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      ws.send(JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        payload: { delta: 12345 },
      }));
    });

    const dispatched = await executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_1',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const iterator = dispatched.stream[Symbol.asyncIterator]();
    const next = await iterator.next();
    expect(next.done).toBe(false);
    expect(next.value).toEqual({
      type: 'error',
      error_code: 'AGENT_PROTOCOL_ERROR',
      error_message: 'agent_response_delta_invalid',
    });
  });

  it('emits protocol error for unsupported response type with request_id', async () => {
    const { executionService, agent, ws } = await setupExecutionService();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      ws.send(JSON.stringify({
        type: 'agent.response.unknown',
        request_id: msg.request_id,
        payload: {},
      }));
    });

    const dispatched = await executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_3',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const iterator = dispatched.stream[Symbol.asyncIterator]();
    const next = await iterator.next();
    expect(next.done).toBe(false);
    expect(next.value).toEqual({
      type: 'error',
      error_code: 'AGENT_PROTOCOL_ERROR',
      error_message: 'agent_response_type_unsupported',
    });
  });

  it('forwards structured agent response events to the request stream', async () => {
    const { executionService, agent, ws } = await setupExecutionService();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
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
          details: { model: 'external-test' },
        },
      }));
      ws.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 1 },
      }));
    });

    const dispatched = await executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_4',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const iterator = dispatched.stream[Symbol.asyncIterator]();
    const eventItem = await iterator.next();
    expect(eventItem.done).toBe(false);
    expect(eventItem.value.type).toBe('event');
    expect(eventItem.value.event).toMatchObject({
      sequence: 1,
      category: 'progress',
      phase: 'start',
      status: 'running',
      name: 'codex.exec',
      summary: 'Starting Codex execution',
    });

    const doneItem = await iterator.next();
    expect(doneItem.done).toBe(false);
    expect(doneItem.value).toMatchObject({
      type: 'done',
      finish_reason: 'stop',
      usage_tokens: 1,
    });
  });

  it('forwards agent artifacts to the request stream', async () => {
    const { executionService, agent, ws } = await setupExecutionService();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      ws.send(JSON.stringify({
        type: 'agent.response.artifact',
        request_id: msg.request_id,
        payload: {
          filename: 'plot.png',
          task_relative_path: '.artifacts/plot.png',
          artifact_type: 'image',
          mime_type: 'image/png',
          file_size: 128,
          title: 'plot.png',
          content: 'data:image/png;base64,AAAA',
        },
      }));
      ws.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 1 },
      }));
    });

    const dispatched = await executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_5',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const iterator = dispatched.stream[Symbol.asyncIterator]();
    const artifactItem = await iterator.next();
    expect(artifactItem.done).toBe(false);
    expect(artifactItem.value).toMatchObject({
      type: 'artifact',
      artifact: {
        filename: 'plot.png',
        task_relative_path: '.artifacts/plot.png',
        artifact_type: 'image',
        mime_type: 'image/png',
      },
    });
  });
});
