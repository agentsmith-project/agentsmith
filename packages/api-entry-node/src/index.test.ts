import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createDefaultNodeApiDeps } from './index.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import { UniversalProxyService } from './universal-proxy-service.js';
import {
  startUniversalProxyChatServer,
} from './__integration__/chat-test-support.js';
import { apiFetch, startServer, startServerWithDeps } from './__integration__/test-support.js';

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

describe('api-entry-node me routes', () => {
  it('returns unread notification count for authenticated user', async () => {
    const { baseUrl } = startServer();
    const response = await apiFetch(baseUrl, '/api/v1/me/notifications/unread-count');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ unread_count: 0 });
  });
});

describe('api-entry-node sse ticket routes', () => {
  it('returns an sse ticket for authenticated requests', async () => {
    const { baseUrl } = startServer();
    const response = await apiFetch(baseUrl, '/api/v1/sse-ticket', { method: 'POST' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ticket: string;
      expires_at: string;
      max_connections: number;
      sso_url: string;
    };
    expect(body.ticket).toMatch(/^sse_/);
    expect(body.ticket).not.toBe('test-token');
    expect(body.max_connections).toBe(1);
    expect(body.sso_url).toContain(`/api/v1/events?ticket=${encodeURIComponent(body.ticket)}`);
    expect(typeof body.expires_at).toBe('string');
    expect(Number.isNaN(Date.parse(body.expires_at))).toBe(false);
  });
});

describe('api-entry-node projects routes', () => {
  it('streams chat via external agent websocket execution channel', async () => {
    const { baseUrl } = startServer();

    const createAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'echo-agent',
          mode: 'external',
          interaction_mode: 'chat',
          capabilities: { streaming_completion: true, multimodal_completion: true },
        }),
      },
    );
    expect(createAgentRes.status).toBe(201);
    const agent = (await createAgentRes.json()) as { id: string };
    await createFileLibrary(baseUrl, 'Truncate Trace Workspace');

    const keyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(keyRes.status).toBe(201);
    const keyPayload = (await keyRes.json()) as { key: string };
    expect(keyPayload.key).toBeTruthy();

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
    let observedExecutionTicket = '';
    let observedLegacyBearer = '';
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({
          type: 'agent.ready',
          payload: { capabilities: { wire_api: 'responses', streaming_completion: true } },
        }));
        resolve();
      });
      ws.once('error', reject);
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as {
        type?: string;
        request_id?: string;
        payload?: {
          messages?: unknown[];
          execution_context?: {
            execution_ticket?: string;
            user_bearer_token?: string;
          };
        };
      };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      observedExecutionTicket = msg.payload?.execution_context?.execution_ticket ?? '';
      observedLegacyBearer = msg.payload?.execution_context?.user_bearer_token ?? '';
      ws.send(JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        payload: { delta: 'echo:' },
      }));
      ws.send(JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        payload: { delta: ' hello' },
      }));
      ws.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 6 },
      }));
    });

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_agent_id: agent.id, model: 'external-echo' }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { role: 'user', content: 'hello' },
        }),
      },
    );
    expect(streamRes.status).toBe(200);
    const text = await streamRes.text();
    expect(text).toContain('event: delta');
    expect(text).toContain('echo:');
    expect(text).toContain('event: done');
    expect(observedExecutionTicket).toMatch(/^exec_/);
    expect(observedLegacyBearer).toBe('');
    ws.close();
  });

  it('enforces endpoint requests_per_minute policy for chat stream preflight', async () => {
    const upstream = startUniversalProxyChatServer();
    const deps = createDefaultNodeApiDeps();
    deps.universalProxyService = new UniversalProxyService(upstream.baseUrl);
    const { baseUrl } = startServerWithDeps(deps);

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'chat-rate-cred', value: 'sk-chat-rate' }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-rate-endpoint',
          model: 'deepseek-chat',
          type: 'custom',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'custom',
          upstream_protocol: 'openai_chat_completions',
          capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'deepseek-chat' }],
          models: [{ capability: 'chat_completion', model_id: 'deepseek-chat' }],
          defaults: { chat_model_id: 'deepseek-chat' },
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const patchPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 1 }] },
        }),
      },
    );
    expect(patchPolicyRes.status).toBe(204);

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'deepseek-chat' }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    const firstStreamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'deepseek-chat', input: { role: 'user', content: 'first' } }),
      },
    );
    expect(firstStreamRes.status).toBe(200);
    await firstStreamRes.text();

    const secondStreamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'deepseek-chat', input: { role: 'user', content: 'second' } }),
      },
    );
    expect(secondStreamRes.status).toBe(429);
    const secondBody = (await secondStreamRes.json()) as {
      error_code?: string;
      message?: string;
      resource_type?: string;
      resource_id?: string;
      retry_after_seconds?: number;
    };
    expect(secondBody).toMatchObject({
      error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      message: 'resource_policy_rate_limited',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
    });
    expect(typeof secondBody.retry_after_seconds).toBe('number');

  });

  it('returns AGENT_OFFLINE when external agent session streams without active execution socket', async () => {
    const { baseUrl } = startServer();

    const createAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'offline-agent',
          mode: 'external',
          interaction_mode: 'chat',
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgentRes.status).toBe(201);
    const agent = (await createAgentRes.json()) as { id: string };

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_agent_id: agent.id, model: 'external-echo' }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { role: 'user', content: 'hello' },
        }),
      },
    );
    expect(streamRes.status).toBe(502);
    const body = (await streamRes.json()) as { error_code?: string; message?: string };
    expect(body.error_code).toBe('AGENT_OFFLINE');
    expect(body.message).toBe('agent_offline');
  });

  it('validates notebook endpoint for notebook-capable external agent', async () => {
    const { baseUrl } = startServer();

    const createWithoutEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'nb-agent-invalid',
          mode: 'external',
          interaction_mode: 'notebook',
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createWithoutEndpointRes.status).toBe(422);

    const createChatAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'nb-agent-patch',
          mode: 'external',
          interaction_mode: 'chat',
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createChatAgentRes.status).toBe(201);
    const created = (await createChatAgentRes.json()) as { id: string };

    const patchInvalidRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interaction_mode: 'both',
          execution_preferences: {
            notebook: {},
          },
        }),
      },
    );
    expect(patchInvalidRes.status).toBe(422);
  });

  it('fails fast when creating internal agent without sandbox manager configured', async () => {
    const { baseUrl } = startServer();

    const createInternalRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'internal-no-sandbox',
          mode: 'internal',
          interaction_mode: 'chat',
          config: {
            image: 'runner:v1',
          },
        }),
      },
    );
    expect(createInternalRes.status).toBe(422);
    const body = (await createInternalRes.json()) as { error_code?: string };
    expect(body.error_code).toBe('AGENT_SANDBOX_NOT_CONFIGURED');
  });

  it('validates internal agent idle timeout floor on create', async () => {
    const { baseUrl, deps } = startServer();
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };

    const createInternalRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'internal-too-low-idle',
          mode: 'internal',
          interaction_mode: 'chat',
          config: {
            image: 'runner:v1',
            idle_timeout_sec: 120,
          },
        }),
      },
    );
    expect(createInternalRes.status).toBe(422);
    const body = (await createInternalRes.json()) as { message?: string };
    expect(body.message).toBe('idle_timeout_sec_too_low');
  });

  it('validates internal agent max lifetime against idle timeout on patch', async () => {
    const { baseUrl, deps } = startServer();
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };

    const createInternalRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'internal-patch-validate',
          mode: 'internal',
          interaction_mode: 'chat',
          config: {
            image: 'runner:v1',
            idle_timeout_sec: 300,
            max_lifetime_sec: 3600,
          },
        }),
      },
    );
    expect(createInternalRes.status).toBe(201);
    const created = (await createInternalRes.json()) as { id: string };

    const patchRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            idle_timeout_sec: 900,
            max_lifetime_sec: 700,
          },
        }),
      },
    );
    expect(patchRes.status).toBe(422);
    const body = (await patchRes.json()) as { message?: string };
    expect(body.message).toBe('max_lifetime_sec_lt_idle_timeout_sec');
  });

  it('returns AGENT_SANDBOX_NOT_CONFIGURED for internal agent chat stream without pod manager', async () => {
    const { baseUrl, deps } = startServer();
    const internalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-chat',
      mode: 'internal',
      interaction_mode: 'chat',
      status: 'enabled',
      config: {
        image: 'runner:v1',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
    });

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_agent_id: internalAgent.id, model: 'gpt-5-codex' }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { role: 'user', content: 'hello internal' },
        }),
      },
    );
    expect(streamRes.status).toBe(422);
    const body = (await streamRes.json()) as { error_code?: string };
    expect(body.error_code).toBe('AGENT_SANDBOX_NOT_CONFIGURED');
  });

  it('starts and clears internal chat keepalive timer when streaming via internal agent', async () => {
    const deps = createDefaultNodeApiDeps();
    const ensureAgentReady = vi.fn(async () => undefined);
    const keepalive = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady,
      keepalive,
      releasePod: vi.fn(async () => undefined),
    };
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_internal_chat_keepalive',
      stream: (async function* streamEvents() {
        yield { type: 'delta', delta: 'hello' };
        yield { type: 'done', finish_reason: 'stop', usage_tokens: 5 };
      })(),
      cancel: vi.fn(),
    }));
    deps.agentExecutionService.dispatchStreamingRequest = dispatchStreamingRequest as typeof deps.agentExecutionService.dispatchStreamingRequest;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { baseUrl } = startServerWithDeps(deps);

    const internalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-chat-keepalive',
      mode: 'internal',
      interaction_mode: 'chat',
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

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_agent_id: internalAgent.id, model: 'gpt-5-codex' }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { role: 'user', content: 'hello internal keepalive' },
        }),
      },
    );
    expect(streamRes.status).toBe(200);
    expect(ensureAgentReady).toHaveBeenCalledTimes(1);
    expect(keepalive).toHaveBeenCalled();
    expect(dispatchStreamingRequest).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls.some((call) => call[1] === 60_000)).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('releases internal workload pod when notebook task is archived', async () => {
    const deps = createDefaultNodeApiDeps();
    const releasePod = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod,
    };
    const { baseUrl } = startServerWithDeps(deps);

    const internalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook',
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

    const taskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Internal Task',
          agent_id: internalAgent.id,
          workspace_mode: 'create_new',
          initial_inputs: [],
        }),
      },
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string };

    const archiveRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      },
    );
    expect(archiveRes.status).toBe(200);
    expect(releasePod).toHaveBeenCalledWith('ws_default', 'proj_1', sanitizeWorkloadId(task.id));
  });

  it('does not leak internal raw key in agent API responses', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'internal-sanitized',
          mode: 'internal',
          interaction_mode: 'chat',
          config: {
            image: 'runner:v1',
          },
        }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; config?: Record<string, unknown> };
    expect(created.config?._internal_raw_key).toBeUndefined();
    expect(created.config?._internal_key_id).toBeUndefined();

    const listRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { items: Array<{ id: string; config?: Record<string, unknown> }> };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed).toBeTruthy();
    expect(listed?.config?._internal_raw_key).toBeUndefined();
    expect(listed?.config?._internal_key_id).toBeUndefined();

    const itemRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
    );
    expect(itemRes.status).toBe(200);
    const itemBody = (await itemRes.json()) as { config?: Record<string, unknown> };
    expect(itemBody.config?._internal_raw_key).toBeUndefined();
    expect(itemBody.config?._internal_key_id).toBeUndefined();

    const stored = await deps.agentResourceService.getAgent('ws_default', 'proj_1', created.id);
    expect(typeof (stored?.config as Record<string, unknown> | undefined)?._internal_raw_key).toBe('string');
    expect(typeof (stored?.config as Record<string, unknown> | undefined)?._internal_key_id).toBe('string');
  });

  it('releases internal workload pod when notebook task is deleted', async () => {
    const deps = createDefaultNodeApiDeps();
    const releasePod = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod,
    };
    const { baseUrl } = startServerWithDeps(deps);

    const internalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook-delete',
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

    const taskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Internal Task Delete',
          agent_id: internalAgent.id,
          workspace_mode: 'create_new',
          initial_inputs: [],
        }),
      },
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string };

    const deleteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
      {
        method: 'DELETE',
      },
    );
    expect(deleteRes.status).toBe(200);
    expect(releasePod).toHaveBeenCalledWith('ws_default', 'proj_1', sanitizeWorkloadId(task.id));
  });



  it('normalizes endpoint base_url when full chat/completions path is provided', async () => {
    const upstream = startUniversalProxyChatServer();
    const deps = createDefaultNodeApiDeps();
    deps.universalProxyService = new UniversalProxyService(upstream.baseUrl);
    const { baseUrl } = startServerWithDeps(deps);

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-key',
          type: 'api_key',
          value: 'sk-placeholder-test',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-chat',
          model: 'placeholder-model',
          type: 'custom',
          base_url: `${upstream.baseUrl}/chat/completions`,
          credential_ref: credential.id,
          provider_family: 'custom',
          upstream_protocol: 'openai_chat_completions',
          capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'placeholder-model' }],
          models: [{ capability: 'chat_completion', model_id: 'placeholder-model' }],
          defaults: { chat_model_id: 'placeholder-model' },
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string; base_url: string };
    expect(endpoint.base_url.endsWith('/chat/completions')).toBe(false);

    const streamRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'placeholder-model',
        }),
      },
    );
    expect(streamRes.status).toBe(201);
    const session = (await streamRes.json()) as { id: string };

    const sendRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { role: 'user', content: 'hello glm' },
        }),
      },
    );
    expect(sendRes.status).toBe(200);
    expect(upstream.lastPath().endsWith('/openai/v1/chat/completions')).toBe(true);
  });

  it('truncates oversized notebook trace details payloads', async () => {
    const { baseUrl } = startServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'glm-key', type: 'api_key', value: 'sk-placeholder-test' }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-coding',
          type: 'custom',
          provider_family: 'custom',
          upstream_protocol: 'openai_chat_completions',
          status: 'active',
          wire_api: 'responses',
          base_url: 'https://example.com',
          model: 'placeholder-model',
          capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'placeholder-model' }],
          models: [{ capability: 'chat_completion', model_id: 'placeholder-model', display_name: 'placeholder-model' }],
          defaults: { chat_model_id: 'placeholder-model' },
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
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createAgent = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'External notebook agent',
          mode: 'external',
          interaction_mode: 'notebook',
          execution_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'placeholder-model' } },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgent.status).toBe(201);
    const agent = (await createAgent.json()) as { id: string };
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Truncate Trace Workspace');

    const createAgentKeyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(createAgentKeyRes.status).toBe(201);
    const agentKey = (await createAgentKeyRes.json()) as { key: string };

    const connectionInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connectionInfoRes.status).toBe(200);
    const connectionInfo = (await connectionInfoRes.json()) as { ws_url: string };

    const executionSocket = new WebSocket(
      connectionInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );

    const huge = 'x'.repeat(40_000);
    executionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      executionSocket.send(JSON.stringify({
        type: 'agent.response.event',
        request_id: msg.request_id,
        payload: {
          sequence: 1,
          at: new Date().toISOString(),
          category: 'debug',
          phase: 'update',
          name: 'runner.debug',
          summary: 'huge details payload',
          details: { stderr: huge },
        },
      }));
      executionSocket.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 1 },
      }));
    });
    await new Promise<void>((resolve) => executionSocket.on('open', () => {
      executionSocket.send(JSON.stringify({ type: 'agent.ready', payload: { capabilities: { wire_api: 'responses' } } }));
      resolve();
    }));

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Truncate trace details',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'run' }) },
    );
    expect(postMessageRes.status).toBe(200);

    let tracesBody: { items: Array<{ details?: Record<string, unknown> }> } | null = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const tracesRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces`);
      expect(tracesRes.status).toBe(200);
      tracesBody = (await tracesRes.json()) as { items: Array<{ details?: Record<string, unknown> }> };
      if (tracesBody.items.some((item) => item.details?._truncated === true)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(tracesBody).not.toBeNull();
    const detailEvent = tracesBody!.items.find((item) => item.details && Object.keys(item.details).length > 0);
    expect(detailEvent).toBeTruthy();
    expect(detailEvent!.details?._truncated).toBe(true);
    expect(detailEvent!.details?._reason).toBe('trace_details_too_large');
    expect(typeof detailEvent!.details?._preview).toBe('string');

    executionSocket.close();
  }, 20_000);

  it('writes notebook task data to docStore (tasks/messages/traces)', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'glm-key', type: 'api_key', value: 'sk-placeholder-test' }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-coding',
          type: 'custom',
          provider_family: 'custom',
          upstream_protocol: 'openai_chat_completions',
          status: 'active',
          wire_api: 'responses',
          base_url: 'https://example.com',
          model: 'placeholder-model',
          capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'placeholder-model' }],
          models: [{ capability: 'chat_completion', model_id: 'placeholder-model', display_name: 'placeholder-model' }],
          defaults: { chat_model_id: 'placeholder-model' },
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
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createAgent = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'External notebook agent',
          mode: 'external',
          interaction_mode: 'notebook',
          execution_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'placeholder-model' } },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgent.status).toBe(201);
    const agent = (await createAgent.json()) as { id: string };
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Persist Notebook Workspace');

    const createAgentKeyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(createAgentKeyRes.status).toBe(201);
    const agentKey = (await createAgentKeyRes.json()) as { key: string };

    const connectionInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connectionInfoRes.status).toBe(200);
    const connectionInfo = (await connectionInfoRes.json()) as { ws_url: string };

    const executionSocket = new WebSocket(
      connectionInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );
    executionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      executionSocket.send(JSON.stringify({
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
      executionSocket.send(JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        payload: { delta: 'persisted-output' },
      }));
      executionSocket.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 3 },
      }));
    });
    await new Promise<void>((resolve) => executionSocket.on('open', () => {
      executionSocket.send(JSON.stringify({ type: 'agent.ready', payload: { capabilities: { wire_api: 'responses' } } }));
      resolve();
    }));

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Persist notebook docs',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'run' }) },
    );
    expect(postMessageRes.status).toBe(200);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const traces = await deps.docStore.list<{ task_id: string }>('ws_default_notebook_task_trace_events', { task_id: task.id });
      const msgs = await deps.docStore.list<{ task_id: string; role: string; content: string }>('ws_default_notebook_task_messages', { task_id: task.id });
      if (
        traces.some((trace) => trace.task_id === task.id)
        && msgs.some((m) => m.role === 'agent' && m.content.includes('persisted-output'))
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const baseTasks = await deps.docStore.list<{ id: string }>('notebook_tasks', {});
    const baseMessages = await deps.docStore.list<{ task_id: string; role: string; content: string }>('notebook_task_messages', { task_id: task.id });
    const baseTraces = await deps.docStore.list<{ task_id: string; category: string }>('notebook_task_trace_events', { task_id: task.id });
    const storedTasks = await deps.docStore.list<{ id: string }>('ws_default_notebook_tasks', {});
    const storedMessages = await deps.docStore.list<{ task_id: string; role: string; content: string }>('ws_default_notebook_task_messages', { task_id: task.id });
    const storedTraces = await deps.docStore.list<{ task_id: string; category: string }>('ws_default_notebook_task_trace_events', { task_id: task.id });

    expect(baseTasks).toHaveLength(0);
    expect(baseMessages).toHaveLength(0);
    expect(baseTraces).toHaveLength(0);
    expect(storedTasks.some((t) => t.id === task.id)).toBe(true);
    expect(storedMessages.some((m) => m.role === 'user')).toBe(true);
    expect(storedMessages.some((m) => m.role === 'agent' && m.content.includes('persisted-output'))).toBe(true);
    expect(storedTraces.some((t) => t.category === 'progress')).toBe(true);

    executionSocket.close();
  }, 20_000);

  it('keeps docStore traces bounded when retention truncation is triggered', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'glm-key', type: 'api_key', value: 'sk-placeholder-test' }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-coding',
          type: 'custom',
          provider_family: 'custom',
          upstream_protocol: 'openai_chat_completions',
          status: 'active',
          wire_api: 'responses',
          base_url: 'https://example.com',
          model: 'placeholder-model',
          capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'placeholder-model' }],
          models: [{ capability: 'chat_completion', model_id: 'placeholder-model', display_name: 'placeholder-model' }],
          defaults: { chat_model_id: 'placeholder-model' },
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
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createAgent = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'External notebook agent',
          mode: 'external',
          interaction_mode: 'notebook',
          execution_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'placeholder-model' } },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgent.status).toBe(201);
    const agent = (await createAgent.json()) as { id: string };
    const workspaceLibrary = await createFileLibrary(baseUrl, 'Trace Retention Workspace');

    const createAgentKeyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(createAgentKeyRes.status).toBe(201);
    const agentKey = (await createAgentKeyRes.json()) as { key: string };

    const connectionInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connectionInfoRes.status).toBe(200);
    const connectionInfo = (await connectionInfoRes.json()) as { ws_url: string };

    const executionSocket = new WebSocket(
      connectionInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );
    executionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      for (let i = 0; i < 1010; i += 1) {
        executionSocket.send(JSON.stringify({
          type: 'agent.response.event',
          request_id: msg.request_id,
          payload: {
            sequence: i + 1,
            at: new Date(Date.now() + i).toISOString(),
            category: 'debug',
            phase: 'update',
            name: 'runner.debug',
            summary: `evt-${i}`,
          },
        }));
      }
      executionSocket.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 1 },
      }));
    });
    await new Promise<void>((resolve) => executionSocket.on('open', () => {
      executionSocket.send(JSON.stringify({ type: 'agent.ready', payload: { capabilities: { wire_api: 'responses' } } }));
      resolve();
    }));

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Trace retention bound',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'run' }) },
    );
    expect(postMessageRes.status).toBe(200);

    let storedTraces: Array<{ task_id: string; summary: string; name: string }> = [];
    for (let attempt = 0; attempt < 300; attempt += 1) {
      storedTraces = await deps.docStore.list<{ task_id: string; summary: string; name: string }>(
        'ws_default_notebook_task_trace_events',
        { task_id: task.id },
      );
      if (
        storedTraces.some((t) => t.name === 'trace.buffer')
        || (storedTraces.length === 1000 && storedTraces.some((t) => t.summary === 'evt-1009'))
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(storedTraces.length).toBeLessThanOrEqual(1000);
    expect(
      storedTraces.some((t) => t.name === 'trace.buffer')
      || storedTraces.length === 1000,
    ).toBe(true);
    expect(storedTraces.some((t) => t.summary === 'evt-0')).toBe(false);
    expect(storedTraces.some((t) => t.summary === 'evt-1009')).toBe(true);

    executionSocket.close();
  }, 20_000);

});
