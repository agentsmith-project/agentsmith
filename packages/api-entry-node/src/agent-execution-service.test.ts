import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import type { CachePort } from '@mbos/ports';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
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
  executionServiceOptions?: ConstructorParameters<typeof AgentExecutionService>[1];
}) {
  const agentResourceService = new AgentResourceService(new InMemoryJsonDocStore());
  const executionService = new AgentExecutionService(agentResourceService, options?.executionServiceOptions);
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
    keyPair,
    ws,
    wsBase,
    helloFramePromise,
  };
}

async function startExecutionServer(executionService: AgentExecutionService): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  server.on('upgrade', (req, socket, head) => executionService.handleUpgrade(req, socket, head));
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  servers.push(server);
  const address = server.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}`;
}

async function openAgentWebSocket(input: {
  wsBase: string;
  agentId: string;
  key: string;
  sessionId?: string;
}): Promise<WebSocket> {
  const url = new URL(`${input.wsBase}/api/v1/agent-execution/ws`);
  url.searchParams.set('agent_id', input.agentId);
  if (input.sessionId) url.searchParams.set('session_id', input.sessionId);
  const ws = new WebSocket(url.toString(), {
    headers: { Authorization: `Bearer ${input.key}` },
  });
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

async function waitForConnectionInfo(
  agentResourceService: AgentResourceService,
  agentId: string,
  predicate: (connection: Awaited<ReturnType<AgentResourceService['getConnectionInfo']>>) => boolean,
): Promise<Awaited<ReturnType<AgentResourceService['getConnectionInfo']>>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const connection = await agentResourceService.getConnectionInfo(agentId);
    if (predicate(connection)) return connection;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const connection = await agentResourceService.getConnectionInfo(agentId);
  throw new Error(`connection info did not reach expected state: ${JSON.stringify(connection)}`);
}

function captureUnhandledRejections(): {
  errors: unknown[];
  dispose: () => void;
} {
  const errors: unknown[] = [];
  const handler = (reason: unknown) => {
    errors.push(reason);
  };
  process.on('unhandledRejection', handler);
  return {
    errors,
    dispose: () => {
      process.off('unhandledRejection', handler);
    },
  };
}

interface ExecutionRacePause {
  entered: Promise<void>;
  resume: () => void;
}

class ExecutionRaceCache implements CachePort {
  private nextWritePause: {
    entered: Promise<void>;
    resumePromise: Promise<void>;
    resolveEntered: () => void;
    resolveResume: () => void;
  } | null = null;

  constructor(private readonly sharedStore: Map<string, { value: string; expiresAt?: number }>) {}

  pauseNextWrite(): ExecutionRacePause {
    let resolveEntered!: () => void;
    let resolveResume!: () => void;
    const pause = {
      entered: new Promise<void>((resolve) => {
        resolveEntered = resolve;
      }),
      resumePromise: new Promise<void>((resolve) => {
        resolveResume = resolve;
      }),
      resolveEntered,
      resolveResume,
    };
    this.nextWritePause = pause;
    return {
      entered: pause.entered,
      resume: pause.resolveResume,
    };
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.pauseIfRequested();
    this.sharedStore.set(key, {
      value,
      ...(ttlSeconds && ttlSeconds > 0 ? { expiresAt: Date.now() + ttlSeconds * 1000 } : {}),
    });
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const next = Number.parseInt(this.read(key) ?? '0', 10) + 1;
    await this.set(key, String(next), ttlSeconds);
    return next;
  }

  async del(key: string): Promise<void> {
    await this.pauseIfRequested();
    this.sharedStore.delete(key);
  }

  async compareAndSet(
    key: string,
    expectedValue: string | null,
    nextValue: string | null,
    ttlSeconds?: number,
  ): Promise<boolean> {
    await this.pauseIfRequested();
    if (this.read(key) !== expectedValue) return false;
    if (nextValue === null) {
      this.sharedStore.delete(key);
      return true;
    }
    this.sharedStore.set(key, {
      value: nextValue,
      ...(ttlSeconds && ttlSeconds > 0 ? { expiresAt: Date.now() + ttlSeconds * 1000 } : {}),
    });
    return true;
  }

  private read(key: string): string | null {
    const record = this.sharedStore.get(key);
    if (!record) return null;
    if (typeof record.expiresAt === 'number' && record.expiresAt <= Date.now()) {
      this.sharedStore.delete(key);
      return null;
    }
    return record.value;
  }

  private async pauseIfRequested(): Promise<void> {
    const pause = this.nextWritePause;
    if (!pause) return;
    this.nextWritePause = null;
    pause.resolveEntered();
    await pause.resumePromise;
  }
}

describe('AgentExecutionService', () => {
  it('does not call legacy unscoped presence mutators from the websocket execution path', () => {
    const sourcePath = process.cwd().endsWith('/packages/api-entry-node')
      ? 'src/agent-execution-service.ts'
      : 'packages/api-entry-node/src/agent-execution-service.ts';
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toContain('markAgentDisconnected(');
    expect(source).not.toContain('markAgentConnected(');
  });

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

  it('keeps shared presence online when an old API instance releases after cross-instance reconnect', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const resourceA = new AgentResourceService(docStore, cache);
    const resourceB = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const serviceA = new AgentExecutionService(resourceA, { heartbeatIntervalMs: 10_000 });
    const serviceB = new AgentExecutionService(resourceB, { heartbeatIntervalMs: 10_000 });
    const wsBaseA = await startExecutionServer(serviceA);
    const wsBaseB = await startExecutionServer(serviceB);
    const agent = await resourceA.createAgent('ws_default', 'proj_1', {
      name: 'cross-instance-agent',
      mode: 'external',
      interaction_kind: 'chat',
    });
    const keyPair = await resourceA.createAgentKey('ws_default', 'proj_1', agent.id);

    const first = await openAgentWebSocket({ wsBase: wsBaseA, agentId: agent.id, key: keyPair.key });
    await waitForConnectionInfo(reader, agent.id, (connection) =>
      connection?.active_connection_count === 1 && connection.api_instance_id !== undefined,
    );
    const second = await openAgentWebSocket({ wsBase: wsBaseB, agentId: agent.id, key: keyPair.key });
    await waitForConnectionInfo(reader, agent.id, (connection) =>
      connection?.active_connection_count === 1 && connection.api_instance_id !== undefined,
    );

    await new Promise<void>((resolve) => {
      first.once('close', () => resolve());
      first.close();
    });
    await waitForConnectionInfo(reader, agent.id, (connection) =>
      connection?.active_connection_count === 1 && connection.api_instance_id !== undefined,
    );

    await expect(reader.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(expect.objectContaining({
      presence: 'online',
    }));
    expect(second.readyState).toBe(second.OPEN);
  });

  it('surfaces a remote-owned session as remote_owned_not_local_dispatchable instead of offline on another API instance', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const resourceA = new AgentResourceService(docStore, cache);
    const resourceB = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const serviceA = new AgentExecutionService(resourceA, { heartbeatIntervalMs: 10_000 });
    const serviceB = new AgentExecutionService(resourceB, { heartbeatIntervalMs: 10_000 });
    const wsBaseA = await startExecutionServer(serviceA);
    const agent = await resourceA.createAgent('ws_default', 'proj_1', {
      name: 'remote-owned-session-agent',
      mode: 'external',
      interaction_kind: 'notebook',
    });
    const keyPair = await resourceA.createAgentKey('ws_default', 'proj_1', agent.id);

    await openAgentWebSocket({
      wsBase: wsBaseA,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_remote_owned',
    });
    await waitForConnectionInfo(reader, agent.id, (connection) => connection?.active_connection_count === 1);

    expect(serviceB.getAgentSessionOnlineState(agent.id, 'task_remote_owned')).toBe(false);
    await expect(
      (
        serviceB as AgentExecutionService & {
          getAgentSessionDispatchAuthority?: (
            agentId: string,
            sessionId: string,
          ) => Promise<string>;
        }
      ).getAgentSessionDispatchAuthority?.(agent.id, 'task_remote_owned'),
    ).resolves.toBe('remote_owned_not_local_dispatchable');
  });

  it('refuses to dispatch through a stale local session before heartbeat catches up after remote takeover', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const resourceA = new AgentResourceService(docStore, cache);
    const resourceB = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const serviceA = new AgentExecutionService(resourceA, { heartbeatIntervalMs: 10_000, heartbeatMaxMisses: 100 });
    const serviceB = new AgentExecutionService(resourceB, { heartbeatIntervalMs: 10_000, heartbeatMaxMisses: 100 });
    const wsBaseA = await startExecutionServer(serviceA);
    const wsBaseB = await startExecutionServer(serviceB);
    const agent = await resourceA.createAgent('ws_default', 'proj_1', {
      name: 'dispatch-fence-agent',
      mode: 'external',
      interaction_kind: 'notebook',
    });
    const keyPair = await resourceA.createAgentKey('ws_default', 'proj_1', agent.id);
    const first = await openAgentWebSocket({
      wsBase: wsBaseA,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_dispatch_fence',
    });
    const staleFrames: Array<Record<string, unknown>> = [];
    first.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
      if (message.type === 'server.request.start') {
        staleFrames.push(message);
      }
    });
    await waitForConnectionInfo(reader, agent.id, (connection) => connection?.active_connection_count === 1);

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      first.once('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });

    await openAgentWebSocket({
      wsBase: wsBaseB,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_dispatch_fence',
    });
    await waitForConnectionInfo(reader, agent.id, (connection) => (
      connection?.active_connection_count === 1
      && connection.session_id === 'task_dispatch_fence'
      && connection.api_instance_id !== undefined
    ));

    await expect(serviceA.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'task_dispatch_fence',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
      executionContext: {
        interaction_kind: 'notebook',
      },
    })).rejects.toThrow('agent_offline');

    expect(staleFrames).toEqual([]);
    await expect(closed).resolves.toEqual({
      code: 4001,
      reason: 'agent_stale_connection',
    });
    await expect(serviceA.getAgentSessionDispatchAuthority(agent.id, 'task_dispatch_fence')).resolves.toBe(
      'remote_owned_not_local_dispatchable',
    );
  });

  it('dispatches immediately through the new owner after session takeover without waiting for stale heartbeat expiry', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const resourceA = new AgentResourceService(docStore, cache);
    const resourceB = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const serviceA = new AgentExecutionService(resourceA, { heartbeatIntervalMs: 10_000, heartbeatMaxMisses: 100 });
    const serviceB = new AgentExecutionService(resourceB, { heartbeatIntervalMs: 10_000, heartbeatMaxMisses: 100 });
    const wsBaseA = await startExecutionServer(serviceA);
    const wsBaseB = await startExecutionServer(serviceB);
    const agent = await resourceA.createAgent('ws_default', 'proj_1', {
      name: 'takeover-dispatch-agent',
      mode: 'external',
      interaction_kind: 'notebook',
    });
    const keyPair = await resourceA.createAgentKey('ws_default', 'proj_1', agent.id);
    const first = await openAgentWebSocket({
      wsBase: wsBaseA,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_takeover_dispatch',
    });
    const staleFrames: Array<Record<string, unknown>> = [];
    first.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
      if (message.type === 'server.request.start') {
        staleFrames.push(message);
      }
    });
    await waitForConnectionInfo(reader, agent.id, (connection) => connection?.active_connection_count === 1);

    const second = await openAgentWebSocket({
      wsBase: wsBaseB,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_takeover_dispatch',
    });
    const secondFrame = new Promise<Record<string, unknown>>((resolve) => {
      second.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
        if (message.type === 'server.request.start') {
          resolve(message);
        }
      });
    });

    await waitForConnectionInfo(reader, agent.id, (connection) => (
      connection?.active_connection_count === 1
      && connection.session_id === 'task_takeover_dispatch'
      && connection.api_instance_id !== undefined
    ));

    const dispatched = await serviceB.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'task_takeover_dispatch',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'owner wins immediately' }],
      executionContext: {
        interaction_kind: 'notebook',
      },
    });

    expect(dispatched.requestId).toEqual(expect.any(String));
    await expect(secondFrame).resolves.toMatchObject({
      type: 'server.request.start',
      session_id: 'task_takeover_dispatch',
      request_id: dispatched.requestId,
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(staleFrames).toEqual([]);
    await expect(serviceB.getAgentSessionDispatchAuthority(agent.id, 'task_takeover_dispatch')).resolves.toBe(
      'local_dispatchable',
    );
    await expect(serviceA.getAgentSessionDispatchAuthority(agent.id, 'task_takeover_dispatch')).resolves.toBe(
      'remote_owned_not_local_dispatchable',
    );
  });

  it('does not fall back from notebook session dispatch to an unscoped agent socket', async () => {
    const { executionService, agent, ws } = await setupExecutionService({ interactionKind: 'notebook' });
    const requestFrames: Array<Record<string, unknown>> = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
      if (message.type === 'server.request.start') {
        requestFrames.push(message);
      }
    });

    await expect(executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'task_requires_scoped_socket',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'notebook strict authority' }],
      executionContext: {
        interaction_kind: 'notebook',
      },
    })).rejects.toThrow('agent_offline');

    expect(requestFrames).toEqual([]);
  });

  it('keeps chat dispatch available through the agent-level socket when no session-scoped socket exists', async () => {
    const { executionService, agent, ws } = await setupExecutionService({ interactionKind: 'chat' });
    const startFrame = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
        if (message.type === 'server.request.start') {
          resolve(message);
        }
      });
    });

    const dispatched = await executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'chat_agent_level_fallback',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'chat may fallback' }],
      executionContext: {
        interaction_kind: 'chat',
      },
    });

    expect(dispatched.requestId).toEqual(expect.any(String));
    await expect(startFrame).resolves.toMatchObject({
      type: 'server.request.start',
      session_id: 'chat_agent_level_fallback',
      request_id: dispatched.requestId,
    });
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

  it('keeps shared presence online when one of multiple session-scoped sockets closes', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const agentResourceService = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const executionService = new AgentExecutionService(agentResourceService, { heartbeatIntervalMs: 10_000 });
    const wsBase = await startExecutionServer(executionService);
    const agent = await agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'session-presence-agent',
      mode: 'external',
      interaction_kind: 'notebook',
    });
    const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);
    const sessionA = await openAgentWebSocket({
      wsBase,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_a',
    });
    await openAgentWebSocket({
      wsBase,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_b',
    });
    await waitForConnectionInfo(reader, agent.id, (connection) => connection?.active_connection_count === 2);

    await new Promise<void>((resolve) => {
      sessionA.once('close', () => resolve());
      sessionA.close();
    });
    await waitForConnectionInfo(reader, agent.id, (connection) => connection?.active_connection_count === 1);

    await expect(reader.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(expect.objectContaining({
      presence: 'online',
    }));
  });

  it('self-heals a stale socket claim after another API instance owns the same socket key', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const resourceA = new AgentResourceService(docStore, cache);
    const resourceB = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const serviceA = new AgentExecutionService(resourceA, {
      heartbeatIntervalMs: 25,
      heartbeatMaxMisses: 100,
    });
    const serviceB = new AgentExecutionService(resourceB, {
      heartbeatIntervalMs: 10_000,
      heartbeatMaxMisses: 100,
    });
    const wsBaseA = await startExecutionServer(serviceA);
    const wsBaseB = await startExecutionServer(serviceB);
    const agent = await resourceA.createAgent('ws_default', 'proj_1', {
      name: 'stale-claim-agent',
      mode: 'external',
      interaction_kind: 'chat',
    });
    const keyPair = await resourceA.createAgentKey('ws_default', 'proj_1', agent.id);
    const first = await openAgentWebSocket({ wsBase: wsBaseA, agentId: agent.id, key: keyPair.key });
    await waitForConnectionInfo(reader, agent.id, (connection) => connection?.active_connection_count === 1);
    await openAgentWebSocket({ wsBase: wsBaseB, agentId: agent.id, key: keyPair.key });

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      first.once('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });

    await expect(closed).resolves.toEqual({
      code: 4001,
      reason: 'agent_stale_connection',
    });
    await waitForConnectionInfo(reader, agent.id, (connection) => connection?.active_connection_count === 1);
    await expect(reader.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(expect.objectContaining({
      presence: 'online',
    }));
  });

  it('does not let a delayed old websocket release erase a newer websocket from another API instance', async () => {
    const docStore = new InMemoryJsonDocStore();
    const sharedStore = new Map<string, { value: string; expiresAt?: number }>();
    const cacheA = new ExecutionRaceCache(sharedStore);
    const cacheB = new ExecutionRaceCache(sharedStore);
    const resourceA = new AgentResourceService(docStore, cacheA);
    const resourceB = new AgentResourceService(docStore, cacheB);
    const reader = new AgentResourceService(docStore, cacheB);
    const serviceA = new AgentExecutionService(resourceA, {
      heartbeatIntervalMs: 10_000,
      heartbeatMaxMisses: 100,
    });
    const serviceB = new AgentExecutionService(resourceB, {
      heartbeatIntervalMs: 10_000,
      heartbeatMaxMisses: 100,
    });
    const wsBaseA = await startExecutionServer(serviceA);
    const wsBaseB = await startExecutionServer(serviceB);
    const agent = await resourceA.createAgent('ws_default', 'proj_1', {
      name: 'delayed-release-agent',
      mode: 'external',
      interaction_kind: 'chat',
    });
    const keyPair = await resourceA.createAgentKey('ws_default', 'proj_1', agent.id);
    const first = await openAgentWebSocket({ wsBase: wsBaseA, agentId: agent.id, key: keyPair.key });
    await waitForConnectionInfo(reader, agent.id, (connection) => connection?.active_connection_count === 1);

    const pause = cacheA.pauseNextWrite();
    first.close();
    await pause.entered;
    const second = await openAgentWebSocket({ wsBase: wsBaseB, agentId: agent.id, key: keyPair.key });
    await waitForConnectionInfo(reader, agent.id, (connection) => (
      connection?.active_connection_count === 1
      && connection.connection_id !== undefined
      && connection.api_instance_id !== undefined
    ));
    pause.resume();
    await waitForConnectionInfo(reader, agent.id, (connection) => (
      connection?.active_connection_count === 1
      && connection.api_instance_id !== undefined
    ));

    await expect(reader.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(expect.objectContaining({
      presence: 'online',
    }));
    expect(second.readyState).toBe(second.OPEN);
  });

  it('keeps the previous socket active when replacement registration fails before handoff completes', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const agentResourceService = new AgentResourceService(docStore, cache);
    const executionService = new AgentExecutionService(agentResourceService, {
      heartbeatIntervalMs: 10_000,
      heartbeatMaxMisses: 100,
    });
    const wsBase = await startExecutionServer(executionService);
    const agent = await agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'handoff-register-failure-agent',
      mode: 'external',
      interaction_kind: 'chat',
    });
    const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);
    const first = await openAgentWebSocket({ wsBase, agentId: agent.id, key: keyPair.key });
    const firstRequestFrames: Array<Record<string, unknown>> = [];
    const firstRequestFrame = new Promise<Record<string, unknown>>((resolve) => {
      first.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
        if (message.type === 'server.request.start') {
          firstRequestFrames.push(message);
          resolve(message);
        }
      });
    });
    first.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
      if (message.type === 'server.request.start') return;
    });
    const initialConnection = await waitForConnectionInfo(
      agentResourceService,
      agent.id,
      (connection) => connection?.active_connection_count === 1,
    );

    const originalRegister = agentResourceService.registerAgentConnection.bind(agentResourceService);
    let registerAttempts = 0;
    vi.spyOn(agentResourceService, 'registerAgentConnection').mockImplementation(async (input) => {
      registerAttempts += 1;
      if (registerAttempts === 1) {
        throw new Error('presence_register_failed');
      }
      return originalRegister(input);
    });

    const second = await openAgentWebSocket({ wsBase, agentId: agent.id, key: keyPair.key });
    const secondClosed = new Promise<{ code: number; reason: string }>((resolve) => {
      second.once('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });

    await expect(secondClosed).resolves.toEqual({
      code: 1011,
      reason: 'agent_connection_registration_failed',
    });
    await expect(agentResourceService.getConnectionInfo(agent.id)).resolves.toEqual(expect.objectContaining({
      connection_id: initialConnection?.connection_id,
      active_connection_count: 1,
    }));
    expect(first.readyState).toBe(first.OPEN);

    const dispatched = await executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'chat_session_handoff',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'still there?' }],
      executionContext: {
        interaction_kind: 'chat',
      },
    });
    expect(dispatched.requestId).toEqual(expect.any(String));
    await expect(firstRequestFrame).resolves.toMatchObject({
      type: 'server.request.start',
      session_id: 'chat_session_handoff',
    });
    expect(firstRequestFrames).toEqual([
      expect.objectContaining({
        type: 'server.request.start',
        session_id: 'chat_session_handoff',
      }),
    ]);
  });

  it('sends a precise terminal close control message without requiring an active terminal dispatch queue', async () => {
    const { executionService, agent, keyPair, wsBase } = await setupExecutionService({ interactionKind: 'notebook' });
    const ws = await openAgentWebSocket({
      wsBase,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_1',
    });
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

  it('stops stale terminal handles from sending stdin, resize, or close frames after remote takeover', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const resourceA = new AgentResourceService(docStore, cache);
    const resourceB = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const serviceA = new AgentExecutionService(resourceA, { heartbeatIntervalMs: 10_000, heartbeatMaxMisses: 100 });
    const serviceB = new AgentExecutionService(resourceB, { heartbeatIntervalMs: 10_000, heartbeatMaxMisses: 100 });
    const wsBaseA = await startExecutionServer(serviceA);
    const wsBaseB = await startExecutionServer(serviceB);
    const agent = await resourceA.createAgent('ws_default', 'proj_1', {
      name: 'terminal-takeover-fence-agent',
      mode: 'external',
      interaction_kind: 'notebook',
    });
    const keyPair = await resourceA.createAgentKey('ws_default', 'proj_1', agent.id);
    const first = await openAgentWebSocket({
      wsBase: wsBaseA,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_terminal_takeover',
    });
    const initialConnection = await waitForConnectionInfo(reader, agent.id, (connection) => (
      connection?.session_id === 'task_terminal_takeover'
      && connection.active_connection_count === 1
    ));
    const staleControlFrames: string[] = [];
    first.on('message', (raw) => {
      const message = JSON.parse(raw.toString('utf-8')) as { type?: string };
      if (
        typeof message.type === 'string'
        && message.type.startsWith('server.terminal.')
        && message.type !== 'server.terminal.start'
      ) {
        staleControlFrames.push(message.type);
      }
    });
    const terminalStart = new Promise<Record<string, unknown>>((resolve) => {
      first.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
        if (message.type === 'server.terminal.start') {
          resolve(message);
        }
      });
    });

    const terminal = await serviceA.dispatchTerminalSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'task_terminal_takeover',
      agentId: agent.id,
      terminalSessionId: 'term_takeover',
      payload: {
        cols: 80,
        rows: 24,
      },
    });
    await expect(terminalStart).resolves.toMatchObject({
      type: 'server.terminal.start',
      session_id: 'task_terminal_takeover',
      terminal_session_id: 'term_takeover',
    });

    const firstClosed = new Promise<{ code: number; reason: string }>((resolve) => {
      first.once('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });

    await openAgentWebSocket({
      wsBase: wsBaseB,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_terminal_takeover',
    });
    await waitForConnectionInfo(reader, agent.id, (connection) => (
      connection?.session_id === 'task_terminal_takeover'
      && connection.active_connection_count === 1
      && connection.connection_id !== initialConnection?.connection_id
    ));

    terminal.writeInput('echo stale');
    terminal.resize(120, 40);
    terminal.close();

    await expect(firstClosed).resolves.toEqual({
      code: 4001,
      reason: 'agent_stale_connection',
    });
    expect(staleControlFrames).toEqual([]);
    await expect(serviceA.getAgentSessionDispatchAuthority(agent.id, 'task_terminal_takeover')).resolves.toBe(
      'remote_owned_not_local_dispatchable',
    );
  });

  it('closes a stale runner socket when server heartbeat pings are missed and clears pending streams', async () => {
    const { agentResourceService, executionService, agent, ws } = await setupExecutionService({
      executionServiceOptions: {
        heartbeatIntervalMs: 25,
        heartbeatMaxMisses: 1,
      },
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });

    const dispatched = await executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_heartbeat',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const iterator = dispatched.stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'error',
        error_code: 'AGENT_HEARTBEAT_TIMEOUT',
        error_message: 'agent_heartbeat_timeout',
      },
    });
    await expect(closed).resolves.toEqual({
      code: 4000,
      reason: 'agent_heartbeat_timeout',
    });
    await expect(agentResourceService.getAgent('ws_default', 'proj_1', agent.id)).resolves.toMatchObject({
      presence: 'offline',
    });
    expect((executionService as unknown as {
      socketsByKey: Map<string, { pendingByRequestId: Map<string, unknown> }>;
    }).socketsByKey.size).toBe(0);
  });

  it('degrades the socket instead of leaving a false online session when heartbeat authority lookup throws', async () => {
    const agentResourceService = new AgentResourceService(new InMemoryJsonDocStore());
    const authorityError = new Error('presence_authority_lookup_failed');
    const authoritySpy = vi
      .spyOn(agentResourceService, 'isAgentConnectionCurrent')
      .mockRejectedValue(authorityError);
    const executionService = new AgentExecutionService(agentResourceService, {
      heartbeatIntervalMs: 25,
      heartbeatMaxMisses: 100,
    });
    const wsBase = await startExecutionServer(executionService);
    const agent = await agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'heartbeat-authority-failure-agent',
      mode: 'external',
      interaction_kind: 'chat',
    });
    const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);
    const unhandled = captureUnhandledRejections();

    try {
      await openAgentWebSocket({ wsBase, agentId: agent.id, key: keyPair.key });
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(authoritySpy).toHaveBeenCalled();
      expect(unhandled.errors).toEqual([]);
      expect(executionService.getAgentOnlineState(agent.id)).toBe(false);
      await expect(agentResourceService.getAgent('ws_default', 'proj_1', agent.id)).resolves.toMatchObject({
        presence: 'offline',
      });
    } finally {
      unhandled.dispose();
      await executionService.shutdown();
    }
  });

  it('serializes agent.pong refreshes so only one shared presence refresh runs at a time', async () => {
    const { agentResourceService, executionService, ws } = await setupExecutionService({
      executionServiceOptions: {
        heartbeatIntervalMs: 10_000,
        heartbeatMaxMisses: 100,
      },
    });
    let resolveFirstRefresh!: () => void;
    const firstRefreshEntered = new Promise<void>((resolve) => {
      resolveFirstRefresh = resolve;
    });
    let releaseFirstRefresh!: () => void;
    const firstRefreshResume = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    let refreshCalls = 0;
    const refreshSpy = vi.spyOn(agentResourceService, 'refreshAgentConnection').mockImplementation(async () => {
      refreshCalls += 1;
      if (refreshCalls === 1) {
        resolveFirstRefresh();
        await firstRefreshResume;
      }
      return {
        refreshed: true,
        stale: false,
        active_connection_count: 1,
        presence: 'online',
      };
    });

    try {
      ws.send(JSON.stringify({ type: 'agent.pong' }));
      await firstRefreshEntered;
      ws.send(JSON.stringify({ type: 'agent.pong' }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      releaseFirstRefresh();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (refreshSpy.mock.calls.length >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(refreshSpy).toHaveBeenCalledTimes(2);
    } finally {
      await executionService.shutdown();
    }
  });

  it('degrades the socket without unhandled rejections when agent.pong refresh fails', async () => {
    const { agentResourceService, executionService, agent, ws } = await setupExecutionService({
      executionServiceOptions: {
        heartbeatIntervalMs: 10_000,
        heartbeatMaxMisses: 100,
      },
    });
    const refreshSpy = vi
      .spyOn(agentResourceService, 'refreshAgentConnection')
      .mockRejectedValue(new Error('presence_refresh_failed'));
    const unhandled = captureUnhandledRejections();
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });

    try {
      ws.send(JSON.stringify({ type: 'agent.pong' }));

      await expect(closed).resolves.toEqual({
        code: 1011,
        reason: 'agent_connection_authority_failed',
      });
      expect(refreshSpy).toHaveBeenCalled();
      expect(unhandled.errors).toEqual([]);
      expect(executionService.getAgentOnlineState(agent.id)).toBe(false);
      await expect(agentResourceService.getAgent('ws_default', 'proj_1', agent.id)).resolves.toMatchObject({
        presence: 'offline',
      });
    } finally {
      unhandled.dispose();
      await executionService.shutdown();
    }
  });

  it('explicitly degrades socket state when registerAgentConnection fails instead of leaving the websocket hanging online', async () => {
    const agentResourceService = new AgentResourceService(new InMemoryJsonDocStore());
    const registerError = new Error('presence_register_failed');
    const registerSpy = vi
      .spyOn(agentResourceService, 'registerAgentConnection')
      .mockRejectedValue(registerError);
    const executionService = new AgentExecutionService(agentResourceService, {
      heartbeatIntervalMs: 10_000,
      heartbeatMaxMisses: 100,
    });
    const wsBase = await startExecutionServer(executionService);
    const agent = await agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'register-failure-agent',
      mode: 'external',
      interaction_kind: 'chat',
    });
    const keyPair = await agentResourceService.createAgentKey('ws_default', 'proj_1', agent.id);
    const unhandled = captureUnhandledRejections();

    try {
      const ws = await openAgentWebSocket({ wsBase, agentId: agent.id, key: keyPair.key });
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(registerSpy).toHaveBeenCalled();
      expect(unhandled.errors).toEqual([]);
      expect(executionService.getAgentOnlineState(agent.id)).toBe(false);
      expect(ws.readyState).not.toBe(ws.OPEN);
    } finally {
      unhandled.dispose();
      await executionService.shutdown();
    }
  });

  it('expires a stream request that never receives the first runner event and removes its pending map entry', async () => {
    const { executionService, agent, ws } = await setupExecutionService({
      executionServiceOptions: {
        streamFirstEventTimeoutMs: 25,
        streamIdleTimeoutMs: 10_000,
        streamMaxRuntimeMs: 10_000,
        heartbeatIntervalMs: 10_000,
      },
    });
    const startFrame = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
        if (message.type === 'server.request.start') {
          resolve(message);
        }
      });
    });

    const dispatched = await executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_first_event_timeout',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await expect(startFrame).resolves.toMatchObject({
      type: 'server.request.start',
      session_id: 'sess_first_event_timeout',
    });
    const iterator = dispatched.stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'error',
        error_code: 'AGENT_REQUEST_TIMEOUT',
        error_message: 'agent_request_first_event_timeout',
      },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect((executionService as unknown as {
      socketsByKey: Map<string, { pendingByRequestId: Map<string, unknown> }>;
    }).socketsByKey.get(agent.id)?.pendingByRequestId.size).toBe(0);
  });

  it('expires a terminal start that never receives runner terminal events and removes its pending map entry', async () => {
    const { executionService, agent, keyPair, wsBase } = await setupExecutionService({
      interactionKind: 'notebook',
      executionServiceOptions: {
        terminalFirstEventTimeoutMs: 25,
        terminalIdleTimeoutMs: 10_000,
        terminalMaxRuntimeMs: 10_000,
        heartbeatIntervalMs: 10_000,
      },
    });
    const ws = await openAgentWebSocket({
      wsBase,
      agentId: agent.id,
      key: keyPair.key,
      sessionId: 'task_1',
    });
    const startFrame = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
        if (message.type === 'server.terminal.start') {
          resolve(message);
        }
      });
    });

    const terminal = await executionService.dispatchTerminalSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'task_1',
      agentId: agent.id,
      terminalSessionId: 'term_first_event_timeout',
      payload: {
        cols: 80,
        rows: 24,
      },
    });

    await expect(startFrame).resolves.toMatchObject({
      type: 'server.terminal.start',
      session_id: 'task_1',
      terminal_session_id: 'term_first_event_timeout',
    });
    const iterator = terminal.stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'error',
        session_id: 'term_first_event_timeout',
        error_code: 'AGENT_TERMINAL_TIMEOUT',
        error_message: 'agent_terminal_first_event_timeout',
      },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect((executionService as unknown as {
      socketsByKey: Map<string, { terminalBySessionId: Map<string, unknown> }>;
    }).socketsByKey.get(agent.id)?.terminalBySessionId.size).toBe(0);
  });

  it('shutdown closes sockets, clears timers, and fails pending execution resources', async () => {
    const { executionService, agent, ws } = await setupExecutionService({
      executionServiceOptions: {
        heartbeatIntervalMs: 10_000,
        streamFirstEventTimeoutMs: 10_000,
      },
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString('utf-8') });
      });
    });
    const dispatched = await executionService.dispatchStreamingRequest({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'sess_shutdown',
      agentId: agent.id,
      model: 'external-test',
      messages: [{ role: 'user', content: 'hello' }],
    });

    await executionService.shutdown();

    await expect(dispatched.stream[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: false,
      value: {
        type: 'error',
        error_code: 'AGENT_SERVICE_SHUTDOWN',
        error_message: 'agent_service_shutdown',
      },
    });
    await expect(closed).resolves.toEqual({
      code: 1001,
      reason: 'server_shutdown',
    });
    expect((executionService as unknown as { socketsByKey: Map<string, unknown> }).socketsByKey.size).toBe(0);
  });

  it('waits for in-flight presence release to settle before shutdown resolves', async () => {
    const { agentResourceService, executionService } = await setupExecutionService({
      executionServiceOptions: {
        heartbeatIntervalMs: 10_000,
        heartbeatMaxMisses: 100,
      },
    });
    const originalRelease = agentResourceService.releaseAgentConnection.bind(agentResourceService);
    let allowRelease!: () => void;
    const releaseGate = new Promise<void>((resolve) => {
      allowRelease = resolve;
    });
    let releaseSettled = false;
    vi.spyOn(agentResourceService, 'releaseAgentConnection').mockImplementation(async (input) => {
      await releaseGate;
      const result = await originalRelease(input);
      releaseSettled = true;
      return result;
    });

    const shutdownPromise = executionService.shutdown();
    let resolved = false;
    shutdownPromise.then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resolved).toBe(false);

    allowRelease();
    await shutdownPromise;
    expect(releaseSettled).toBe(true);
  });

  it('retries transient presence release failures instead of leaving the shared lease online', async () => {
    const { agentResourceService, executionService, agent, ws } = await setupExecutionService({
      executionServiceOptions: {
        heartbeatIntervalMs: 10_000,
        heartbeatMaxMisses: 100,
      },
    });
    const originalRelease = agentResourceService.releaseAgentConnection.bind(agentResourceService);
    let attempts = 0;
    vi.spyOn(agentResourceService, 'releaseAgentConnection').mockImplementation(async (input) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('transient_release_failure');
      }
      return originalRelease(input);
    });
    const unhandled = captureUnhandledRejections();

    try {
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        ws.close();
      });

      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (attempts >= 2) {
          const current = await agentResourceService.getConnectionInfo(agent.id);
          if (!current) break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(unhandled.errors).toEqual([]);
      expect(executionService.getAgentOnlineState(agent.id)).toBe(false);
      await expect(agentResourceService.getConnectionInfo(agent.id)).resolves.toBeNull();
      await expect(agentResourceService.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(
        expect.objectContaining({
          presence: 'offline',
        }),
      );
    } finally {
      unhandled.dispose();
      await executionService.shutdown();
    }
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
