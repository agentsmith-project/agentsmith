import type { AddressInfo } from 'node:net';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
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

const servers: Server[] = [];
const originalUniversalProxyBaseUrl = process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.closeIdleConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
  if (originalUniversalProxyBaseUrl === undefined) {
    delete process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;
  } else {
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = originalUniversalProxyBaseUrl;
  }
});

function startUniversalProxyMockServer(): {
  baseUrl: string;
  configRequests: () => Array<{ namespace: string; body: unknown }>;
  namespaceRequests: () => Array<{
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: unknown;
  }>;
} {
  const configRequests: Array<{ namespace: string; body: unknown }> = [];
  const namespaceRequests: Array<{
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: unknown;
  }> = [];

  const server = http.createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      const body = text ? JSON.parse(text) : {};

      const configMatch = requestUrl.pathname.match(/^\/admin\/namespaces\/([^/]+)\/config$/);
      if (req.method === 'POST' && configMatch) {
        configRequests.push({
          namespace: decodeURIComponent(configMatch[1]),
          body,
        });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'applied' }));
        return;
      }

      const namespaceMatch = requestUrl.pathname.match(/^\/namespaces\/([^/]+)\/(.+)$/);
      if (req.method === 'POST' && namespaceMatch) {
        namespaceRequests.push({
          method: req.method,
          path: requestUrl.pathname,
          headers: req.headers,
          body,
        });

        if (requestUrl.pathname.endsWith('/openai/v1/chat/completions')) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              object: 'chat.completion',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Hello from universal proxy chat.' },
                  finish_reason: 'stop',
                },
              ],
              usage: { total_tokens: 7 },
            }),
          );
          return;
        }

        if (requestUrl.pathname.endsWith('/openai/v1/responses')) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              object: 'response',
              output_text: 'Hello from universal proxy responses.',
              usage: { total_tokens: 9 },
            }),
          );
          return;
        }

        if (requestUrl.pathname.endsWith('/anthropic/v1/messages/count_tokens')) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ input_tokens: 12 }));
          return;
        }

        if (requestUrl.pathname.endsWith('/anthropic/v1/messages')) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              type: 'message',
              content: [{ type: 'text', text: 'Hello from universal proxy messages.' }],
              usage: { total_tokens: 8 },
            }),
          );
          return;
        }
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });
  server.listen(0);
  servers.push(server);
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    configRequests: () => configRequests,
    namespaceRequests: () => namespaceRequests,
  };
}

describe('api-entry-node endpoint proxy and llm-gateway routing', () => {
  it('routes endpoint proxy chat requests through universal proxy instead of direct upstream access', async () => {
    const universalProxy = startUniversalProxyMockServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();

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
          model: 'placeholder-model',
          type: 'openai',
          base_url: 'https://openai-compatible.provider.example/v1',
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
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored-client-model',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    const payload = (await proxyRes.json()) as {
      object?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    expect(payload.object).toBe('chat.completion');
    expect(payload.choices?.[0]?.message?.content).toBe('Hello from universal proxy chat.');
    expect(universalProxy.configRequests()).toHaveLength(1);
    expect(universalProxy.namespaceRequests()).toHaveLength(1);
    expect(universalProxy.namespaceRequests()[0]?.path).toBe(
      `/namespaces/ws_default__proj_1__${endpoint.id}/openai/v1/chat/completions`,
    );
    expect((universalProxy.namespaceRequests()[0]?.body as { model?: string }).model).toBe('placeholder-model');
  });

  it('routes llm-gateway requests by model through universal proxy while keeping endpoint resolution intact', async () => {
    const universalProxy = startUniversalProxyMockServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();

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
          model: 'placeholder-model',
          type: 'anthropic',
          base_url: 'https://anthropic-compatible.provider.example/v1',
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
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/anthropic/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'placeholder-model',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello via gateway' }] }],
          max_tokens: 128,
        }),
      },
    );
    expect(gatewayRes.status).toBe(200);
    const payload = (await gatewayRes.json()) as {
      type?: string;
      content?: Array<{ text?: string }>;
    };
    expect(payload.type).toBe('message');
    expect(payload.content?.[0]?.text).toBe('Hello from universal proxy messages.');
    expect(universalProxy.namespaceRequests()[0]?.path).toBe(
      `/namespaces/ws_default__proj_1__${endpoint.id}/anthropic/v1/messages`,
    );

    const gatewayResInternalModel = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/anthropic/messages',
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
    expect((universalProxy.namespaceRequests()[1]?.body as { model?: string }).model).toBe('placeholder-model');

    const gatewayResInternalName = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/anthropic/messages',
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
    expect((universalProxy.namespaceRequests()[2]?.body as { model?: string }).model).toBe('placeholder-model');
  });

  it('forwards anthropic protocol headers through canonical llm-gateway path and preserves messages/count_tokens path', async () => {
    const universalProxy = startUniversalProxyMockServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();

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
          model: 'placeholder-model',
          type: 'anthropic',
          base_url: 'https://anthropic-compatible.provider.example/v1',
          credential_ref: credential.id,
          provider_family: 'anthropic',
          protocol: 'anthropic_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);

    const gatewayRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/anthropic/messages/count_tokens',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: 'placeholder-model',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'tokenize me' }] }],
        }),
      },
    );
    expect(gatewayRes.status).toBe(200);
    expect(universalProxy.namespaceRequests()).toHaveLength(1);
    expect(universalProxy.namespaceRequests()[0]?.path).toContain('/anthropic/v1/messages/count_tokens');
    expect(universalProxy.namespaceRequests()[0]?.headers['anthropic-version']).toBe('2023-06-01');
    expect(universalProxy.namespaceRequests()[0]?.headers['anthropic-beta']).toBe('prompt-caching-2024-07-31');
  });

  it('rejects legacy llm-gateway paths without protocol prefix', async () => {
    const { baseUrl } = startServer();
    const response = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/responses',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'placeholder-model', input: 'hello' }),
      },
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ message: 'gateway_proxy_path_not_supported' }),
    );
  });

  it('fails fast when llm requests arrive without universal proxy configured', async () => {
    delete process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;
    const { baseUrl } = startServer();
    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'gateway-key-no-upx', type: 'api_key', value: 'sk-no-upx' }),
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
          name: 'gateway-endpoint-no-upx',
          model: 'placeholder-model',
          type: 'openai',
          base_url: 'https://openai-compatible.provider.example/v1',
          credential_ref: credential.id,
          provider_family: 'openai',
          protocol: 'openai_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const response = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/openai/responses',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'placeholder-model', input: 'hello' }),
      },
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        error_code: 'UNIVERSAL_PROXY_REQUIRED',
        message: 'universal_proxy_required_for_llm_requests',
      }),
    );
  });
});
