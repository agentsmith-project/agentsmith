import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, startServer } from './test-support.js';

vi.mock('../auth.js', async () => {
  const actual = await vi.importActual<typeof import('../auth.js')>('../auth.js');
  return {
    ...actual,
    verifyBearerToken: vi.fn(async () => ({
      id: 'user_test',
      email: 'test@example.com',
      name: 'Test User',
    })),
  };
});

const upstreamServers: Server[] = [];

afterEach(async () => {
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

function startProtocolBridgeUpstreamServer(): {
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
  lastPath: () => string;
  lastHeaders: () => http.IncomingHttpHeaders;
} {
  let body: unknown = null;
  let path = '';
  let headers: http.IncomingHttpHeaders = {};
  const server = http.createServer((req, res) => {
    void (async () => {
      path = req.url ?? '';
      headers = req.headers;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};

      if (req.url?.includes('/messages')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'msg_bridge_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: 'Hello from anthropic upstream.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 4, output_tokens: 6 },
          }),
        );
        return;
      }

      if (req.url?.includes('/chat/completions')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'chatcmpl_bridge_1',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello from openai upstream.' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          }),
        );
        return;
      }

      if (req.url?.includes('/responses')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'resp_bridge_1',
            object: 'response',
            status: 'completed',
            model: 'gpt-4o-mini',
            output: [
              {
                id: 'msg_resp_1',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Hello from responses upstream.' }],
              },
            ],
            output_text: 'Hello from responses upstream.',
            usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
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
    lastHeaders: () => headers,
  };
}

describe('api-entry-node endpoint proxy bridge routes', () => {
  it('bridges openai chat/completions requests to anthropic-compatible endpoint through unified proxy', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bridge-ant-key', type: 'api_key', value: 'sk-ant' }),
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
          name: 'bridge-anthropic-endpoint',
          model: 'claude-sonnet-4-5',
          type: 'anthropic',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'anthropic',
          protocol: 'anthropic_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored-by-proxy',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    expect(proxyRes.headers.get('x-agentsmith-proxy-source-protocol')).toBe('openai_completion');
    expect(proxyRes.headers.get('x-agentsmith-proxy-target-protocol')).toBe('anthropic');
    expect(proxyRes.headers.get('x-agentsmith-proxy-converted')).toBe('1');
    const payload = (await proxyRes.json()) as {
      object?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    expect(payload.object).toBe('chat.completion');
    expect(payload.choices?.[0]?.message?.content).toBe('Hello from anthropic upstream.');
    expect(upstream.lastPath()).toBe('/v1/messages');
  });

  it('bridges anthropic messages requests to openai-compatible endpoint through unified proxy', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bridge-oa-key', type: 'api_key', value: 'sk-oa' }),
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
          name: 'bridge-openai-endpoint',
          model: 'gpt-4o-mini',
          type: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'openai',
          protocol: 'openai_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello from anthropic client' }] }],
          max_tokens: 128,
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    expect(proxyRes.headers.get('x-agentsmith-proxy-source-protocol')).toBe('anthropic');
    expect(proxyRes.headers.get('x-agentsmith-proxy-target-protocol')).toBe('openai_completion');
    expect(proxyRes.headers.get('x-agentsmith-proxy-converted')).toBe('1');
    const payload = (await proxyRes.json()) as {
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    expect(payload.type).toBe('message');
    expect(payload.content?.[0]?.text).toBe('Hello from openai upstream.');
    expect(upstream.lastPath()).toBe('/v1/chat/completions');
  });

  it('bridges openai responses requests to anthropic-compatible endpoint through unified proxy', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bridge-ant-key-resp', type: 'api_key', value: 'sk-ant-resp' }),
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
          name: 'bridge-anthropic-responses-endpoint',
          model: 'claude-sonnet-4-5',
          type: 'anthropic',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'anthropic',
          protocol: 'anthropic_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/responses`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          input: 'hello via responses',
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    expect(proxyRes.headers.get('x-agentsmith-proxy-source-protocol')).toBe('openai_responses');
    expect(proxyRes.headers.get('x-agentsmith-proxy-target-protocol')).toBe('anthropic');
    expect(proxyRes.headers.get('x-agentsmith-proxy-converted')).toBe('1');
    const payload = (await proxyRes.json()) as { object?: string; output_text?: string };
    expect(payload.object).toBe('response');
    expect(payload.output_text).toBe('Hello from anthropic upstream.');
    expect(upstream.lastPath()).toBe('/v1/messages');
  });

  it('routes llm-gateway requests by model while keeping endpoint governance chain', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'gateway-ant-key', type: 'api_key', value: 'sk-gateway-ant' }),
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
          name: 'gateway-anthropic-endpoint',
          model: 'glm-5',
          type: 'anthropic',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'anthropic',
          protocol: 'anthropic_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string; name: string };

    const gatewayRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'glm-5',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello via gateway' }] }],
          max_tokens: 128,
        }),
      },
    );
    expect(gatewayRes.status).toBe(200);
    expect(gatewayRes.headers.get('x-agentsmith-proxy-source-protocol')).toBe('anthropic');
    expect(gatewayRes.headers.get('x-agentsmith-proxy-target-protocol')).toBe('anthropic');
    expect(upstream.lastPath()).toBe('/v1/messages');
    expect((upstream.lastBody() as { model?: string }).model).toBe('glm-5');

    const gatewayResInternalModel = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: endpoint.id,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello via internal endpoint model id' }] }],
          max_tokens: 128,
        }),
      },
    );
    expect(gatewayResInternalModel.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/messages');
    expect((upstream.lastBody() as { model?: string }).model).toBe('glm-5');

    const gatewayResInternalName = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: endpoint.name,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello via internal endpoint model name' }] }],
          max_tokens: 128,
        }),
      },
    );
    expect(gatewayResInternalName.status).toBe(200);
    expect((upstream.lastBody() as { model?: string }).model).toBe('glm-5');
  });

  it('forwards anthropic protocol headers through llm-gateway and preserves messages/count_tokens path', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'gateway-ant-key-headers', type: 'api_key', value: 'sk-gateway-ant-headers' }),
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
          name: 'gateway-anthropic-endpoint-headers',
          model: 'glm-4.7',
          type: 'anthropic',
          base_url: 'http://127.0.0.1:0/unused',
          credential_ref: credential.id,
          provider_family: 'anthropic',
          protocol: 'anthropic_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base_url: upstream.baseUrl }),
      },
    );

    const gatewayRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/messages/count_tokens',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: 'glm-4.7',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'tokenize me' }] }],
        }),
      },
    );
    expect(gatewayRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/messages/count_tokens');
    expect(upstream.lastHeaders()['anthropic-version']).toBe('2023-06-01');
    expect(upstream.lastHeaders()['anthropic-beta']).toBe('prompt-caching-2024-07-31');
  });
});
