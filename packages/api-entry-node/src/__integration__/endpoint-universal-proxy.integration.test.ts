import { execFileSync } from 'node:child_process';
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

const originalUniversalProxyBaseUrl = process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;
const servers: Server[] = [];

function allocateMockProxyPort(): number {
  const raw = execFileSync('python3', ['-c', 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'], {
    encoding: 'utf8',
  }).trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid_mock_proxy_port:${raw}`);
  }
  return port;
}

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

function startUniversalProxyMockServer(options?: { failConfigPush?: boolean; streamMessages?: boolean }): {
  baseUrl: string;
  namespaceRequests: () => Array<{
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: unknown;
  }>;
  configRequests: () => Array<{
    namespace: string;
    body: unknown;
  }>;
} {
  const namespaceRequests: Array<{
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: unknown;
  }> = [];
  const configRequests: Array<{
    namespace: string;
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
        if (options?.failConfigPush) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'config_push_failed' }));
          return;
        }
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
        if (options?.streamMessages && requestUrl.pathname.endsWith('/anthropic/v1/messages')) {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/event-stream');
          res.write('event: message_start\n');
          res.write('data: {"type":"message_start","message":{"id":"msg_stream"}}\n\n');
          res.write('event: content_block_delta\n');
          res.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"streamed via universal proxy"}}\n\n');
          res.write('event: message_stop\n');
          res.write('data: {"type":"message_stop"}\n\n');
          res.end();
          return;
        }
        if (requestUrl.pathname.endsWith('/openai/v1/responses')) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              object: 'response',
              output_text: 'responses via universal proxy',
              usage: { total_tokens: 9 },
            }),
          );
          return;
        }
        if (requestUrl.pathname.endsWith('/openai/v1/chat/completions')) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              object: 'chat.completion',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'chat completions via universal proxy' },
                  finish_reason: 'stop',
                },
              ],
              usage: { total_tokens: 8 },
            }),
          );
          return;
        }
        if (requestUrl.pathname.endsWith('/anthropic/v1/messages')) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              type: 'message',
              content: [{ type: 'text', text: 'messages via universal proxy' }],
              usage: { total_tokens: 7 },
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
  const port = allocateMockProxyPort();
  server.listen(port, '127.0.0.1');
  servers.push(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    namespaceRequests: () => namespaceRequests,
    configRequests: () => configRequests,
  };
}

describe('api-entry-node universal proxy integration', () => {
  it('pushes normalized endpoint config and proxies explicit responses path through universal proxy', async () => {
    const universalProxy = startUniversalProxyMockServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl, deps } = startServer();
    const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
      name: 'upx-openai-key',
      value: 'sk-upx-openai',
      type: 'api_key',
    });
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'upx-openai-endpoint',
      model: 'placeholder-model',
      type: 'catalog',
      base_url: 'https://openai-compatible.provider.example/chat/completions',
      credential_ref: credential.id,
      provider_family: 'openai',
      upstream_protocol: 'openai_chat_completions',
    });

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/responses`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored-client-model',
          input: 'hello through universal proxy',
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    const payload = (await proxyRes.json()) as { output_text?: string };
    expect(payload.output_text).toBe('responses via universal proxy');

    expect(universalProxy.configRequests()).toHaveLength(1);
    expect(universalProxy.configRequests()[0]).toMatchObject({
      namespace: `ws_default__proj_1__${endpoint.id}`,
    });
    expect((universalProxy.configRequests()[0].body as {
      config?: { upstreams?: Array<{ api_root?: string }> };
    }).config?.upstreams?.[0]?.api_root).toBe('https://openai-compatible.provider.example');

    expect(universalProxy.namespaceRequests()).toHaveLength(1);
    expect(universalProxy.namespaceRequests()[0]?.path).toBe(
      `/namespaces/ws_default__proj_1__${endpoint.id}/openai/v1/responses`,
    );
    expect((universalProxy.namespaceRequests()[0]?.body as { model?: string; input?: string })).toMatchObject({
      model: endpoint.model,
      input: 'hello through universal proxy',
    });
  });

  it('proxies anthropic messages stream through universal proxy and preserves protocol headers', async () => {
    const universalProxy = startUniversalProxyMockServer({ streamMessages: true });
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl, deps } = startServer();
    const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
      name: 'upx-anth-key',
      value: 'sk-upx-anth',
      type: 'api_key',
    });
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'upx-anth-endpoint',
      model: 'placeholder-model',
      type: 'catalog',
      base_url: 'https://anthropic-compatible.provider.example',
      credential_ref: credential.id,
      provider_family: 'anthropic',
      upstream_protocol: 'anthropic_messages',
    });

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/anthropic/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: 'ignored-client-model',
          stream: true,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'stream please' }] }],
          max_tokens: 64,
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    expect(proxyRes.headers.get('content-type')).toContain('text/event-stream');
    const output = await proxyRes.text();
    expect(output).toContain('streamed via universal proxy');

    const configPayload = universalProxy.configRequests()[0]?.body as {
      config?: { upstreams?: Array<{ api_root?: string; fixed_upstream_format?: string }> };
    };
    expect(configPayload.config?.upstreams?.[0]).toMatchObject({
      api_root: 'https://anthropic-compatible.provider.example/v1',
      fixed_upstream_format: 'anthropic',
    });

    const forwarded = universalProxy.namespaceRequests()[0];
    expect(forwarded?.path).toBe(`/namespaces/ws_default__proj_1__${endpoint.id}/anthropic/v1/messages`);
    expect(forwarded?.headers['anthropic-version']).toBe('2023-06-01');
    expect(forwarded?.headers['anthropic-beta']).toBe('prompt-caching-2024-07-31');
  });

  it('uses universal proxy for openai client requests against anthropic-compatible endpoints', async () => {
    const universalProxy = startUniversalProxyMockServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl, deps } = startServer();
    const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
      name: 'upx-cross-anth-key',
      value: 'sk-upx-cross-anth',
      type: 'api_key',
    });
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'upx-cross-anth-endpoint',
      model: 'placeholder-model',
      type: 'catalog',
      base_url: 'https://anthropic-compatible.provider.example',
      credential_ref: credential.id,
      provider_family: 'anthropic',
      upstream_protocol: 'anthropic_messages',
    });

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/responses`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored-client-model',
          input: 'bridge through universal proxy',
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    const payload = (await proxyRes.json()) as { output_text?: string };
    expect(payload.output_text).toBe('responses via universal proxy');

    const configPayload = universalProxy.configRequests()[0]?.body as {
      config?: { upstreams?: Array<{ api_root?: string; fixed_upstream_format?: string }> };
    };
    expect(configPayload.config?.upstreams?.[0]).toMatchObject({
      api_root: 'https://anthropic-compatible.provider.example/v1',
      fixed_upstream_format: 'anthropic',
    });
    expect(universalProxy.namespaceRequests()[0]?.path).toBe(
      `/namespaces/ws_default__proj_1__${endpoint.id}/openai/v1/responses`,
    );
  });

  it('uses universal proxy for anthropic client requests against openai-compatible endpoints', async () => {
    const universalProxy = startUniversalProxyMockServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl, deps } = startServer();
    const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
      name: 'upx-cross-openai-key',
      value: 'sk-upx-cross-openai',
      type: 'api_key',
    });
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'upx-cross-openai-endpoint',
      model: 'placeholder-model',
      type: 'catalog',
      base_url: 'https://openai-compatible.provider.example/chat/completions',
      credential_ref: credential.id,
      provider_family: 'openai',
      upstream_protocol: 'openai_chat_completions',
    });

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/anthropic/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'ignored-client-model',
          max_tokens: 64,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'bridge through universal proxy' }] }],
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    const payload = (await proxyRes.json()) as { content?: Array<{ text?: string }> };
    expect(payload.content?.[0]?.text).toBe('messages via universal proxy');
    expect(universalProxy.namespaceRequests()[0]?.path).toBe(
      `/namespaces/ws_default__proj_1__${endpoint.id}/anthropic/v1/messages`,
    );
  });

  it('fails fast when universal proxy rejects config push', async () => {
    const universalProxy = startUniversalProxyMockServer({ failConfigPush: true });
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl, deps } = startServer();
    const credential = await deps.endpointResourceService.createCredential('ws_default', 'proj_1', {
      name: 'upx-fail-key',
      value: 'sk-upx-fail',
      type: 'api_key',
    });
    const endpoint = await deps.endpointResourceService.createEndpoint('ws_default', 'proj_1', {
      name: 'upx-failing-endpoint',
      model: 'placeholder-model',
      type: 'catalog',
      base_url: 'https://openai-compatible.provider.example',
      credential_ref: credential.id,
      provider_family: 'openai',
      upstream_protocol: 'openai_chat_completions',
    });

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/openai/responses`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: 'should fail before proxying',
        }),
      },
    );
    expect(proxyRes.status).toBe(400);
    expect(await proxyRes.json()).toMatchObject({
      error_code: 'VALIDATION_ERROR',
    });
    expect(universalProxy.namespaceRequests()).toHaveLength(0);
  });
});
