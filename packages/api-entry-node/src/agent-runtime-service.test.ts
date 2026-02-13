import { afterEach, describe, expect, it } from 'vitest';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { AgentResourceService } from './agent-resource-service.js';
import { AgentRuntimeService } from './agent-runtime-service.js';

const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
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

async function setupRuntime() {
  const agentResourceService = new AgentResourceService(new InMemoryJsonDocStore());
  const runtime = new AgentRuntimeService(agentResourceService);
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  server.on('upgrade', (req, socket, head) => runtime.handleUpgrade(req, socket, head));
  server.listen(0);
  servers.push(server);
  const address = server.address() as AddressInfo;
  const wsBase = `ws://127.0.0.1:${address.port}`;

  const agent = await agentResourceService.createAgent('ws_default', 'proj_1', {
    name: 'runtime-agent',
    mode: 'external',
  });
  const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);

  const ws = new WebSocket(`${wsBase}/api/v1/agent-runtime/ws?agent_id=${encodeURIComponent(agent.id)}`, {
    headers: { Authorization: `Bearer ${keyPair.key}` },
  });
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  return {
    runtime,
    agent,
    ws,
  };
}

describe('AgentRuntimeService', () => {
  it('emits protocol error when agent delta payload is invalid', async () => {
    const { runtime, agent, ws } = await setupRuntime();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      ws.send(JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        payload: { delta: 12345 },
      }));
    });

    const dispatched = await runtime.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_1',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
      timeoutMs: 2000,
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

  it('emits timeout error when agent does not answer', async () => {
    const { runtime, agent } = await setupRuntime();
    const dispatched = await runtime.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_2',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
      timeoutMs: 150,
    });

    const iterator = dispatched.stream[Symbol.asyncIterator]();
    const next = await iterator.next();
    expect(next.done).toBe(false);
    expect(next.value).toEqual({
      type: 'error',
      error_code: 'AGENT_TIMEOUT',
      error_message: 'agent_response_timeout',
    });
  });

  it('emits protocol error for unsupported response type with request_id', async () => {
    const { runtime, agent, ws } = await setupRuntime();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      ws.send(JSON.stringify({
        type: 'agent.response.unknown',
        request_id: msg.request_id,
        payload: {},
      }));
    });

    const dispatched = await runtime.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_3',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
      timeoutMs: 2000,
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
});
