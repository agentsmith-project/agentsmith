import { execFileSync } from 'node:child_process';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createUniversalProxyAdminHarness,
  type UniversalProxyAdminConfigRequest,
} from './chat-test-support.js';
import { apiFetch, apiFetchWithToken, startServer } from './test-support.js';

const upstreamServers: Server[] = [];
const originalUniversalProxyBaseUrl = process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;

function allocateMockPort(): number {
  const raw = execFileSync('python3', ['-c', 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'], {
    encoding: 'utf8',
  }).trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid_mock_port:${raw}`);
  }
  return port;
}

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
  if (originalUniversalProxyBaseUrl === undefined) {
    delete process.env.MBOS_UNIVERSAL_PROXY_BASE_URL;
  } else {
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = originalUniversalProxyBaseUrl;
  }
});

function startUniversalProxyMockServer(): {
  baseUrl: string;
  configRequests: () => UniversalProxyAdminConfigRequest[];
  namespaceRequests: () => Array<{
    path: string;
    headers: IncomingHttpHeaders;
    body: unknown;
  }>;
} {
  const namespaceRequests: Array<{
    path: string;
    headers: IncomingHttpHeaders;
    body: unknown;
  }> = [];
  const adminHarness = createUniversalProxyAdminHarness();
  const server = http.createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') as Record<string, unknown>;

      if (adminHarness.handleAdminRequest({ req, res, path: requestUrl.pathname, body })) {
        return;
      }

      const namespaceMatch = requestUrl.pathname.match(/^\/namespaces\/([^/]+)\/(.+)$/);
      if (req.method === 'POST' && namespaceMatch) {
        const namespace = decodeURIComponent(namespaceMatch[1] ?? '');
        if (!adminHarness.hasNamespace(namespace)) {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'namespace_not_found' }));
          return;
        }
        namespaceRequests.push({
          path: requestUrl.pathname,
          headers: req.headers,
          body,
        });
      }

      if (requestUrl.pathname.includes('/responses')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          id: 'resp_test_1',
          object: 'response',
          status: 'completed',
          model: body.model ?? 'placeholder-openai-model',
          output: [],
          output_text: 'hello from openai canonical',
          usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
        }));
        return;
      }

      if (requestUrl.pathname.includes('/chat/completions')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          id: 'chatcmpl_test_1',
          object: 'chat.completion',
          model: body.model ?? 'placeholder-openai-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'hello from openai canonical' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }));
        return;
      }

      if (requestUrl.pathname.endsWith('/anthropic/v1/messages')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          id: 'msg_test_1',
          type: 'message',
          role: 'assistant',
          model: body.model ?? 'placeholder-anthropic-model',
          content: [{ type: 'text', text: 'hello from anthropic canonical' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 4 },
        }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });
  const port = allocateMockPort();
  server.listen(port, '127.0.0.1');
  upstreamServers.push(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    configRequests: () => adminHarness.configRequests(),
    namespaceRequests: () => namespaceRequests,
  };
}

function startAnthropicDirectUpstreamMockServer(): {
  baseUrl: string;
  requests: () => Array<{
    path: string;
    headers: IncomingHttpHeaders;
    body: unknown;
  }>;
} {
  const requests: Array<{
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
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') as Record<string, unknown>;

      requests.push({
        path: requestUrl.pathname,
        headers: req.headers,
        body,
      });

      if (req.method === 'POST' && requestUrl.pathname === '/v1/messages/count_tokens') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ input_tokens: 12 }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });
  const port = allocateMockPort();
  server.listen(port, '127.0.0.1');
  upstreamServers.push(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests: () => requests,
  };
}

async function createProjectEndpoint(
  baseUrl: string,
  upstreamBaseUrl: string,
  upstreamProtocol: 'openai_chat_completions' | 'anthropic_messages',
  model: string,
) {
  const credentialRes = await apiFetch(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `cred-${upstreamProtocol}`, type: 'api_key', value: `sk-${upstreamProtocol}` }),
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
        name: `endpoint-${upstreamProtocol}`,
        model,
        type: 'catalog',
        base_url: upstreamBaseUrl,
        credential_ref: credential.id,
        provider_family: upstreamProtocol === 'anthropic_messages' ? 'anthropic' : 'openai',
        upstream_protocol: upstreamProtocol,
      }),
    },
  );
  expect(endpointRes.status).toBe(201);
}

describe('user api keys integration', () => {
  it('creates, lists, uses, and revokes personal API keys', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(baseUrl, '/api/v1/user/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'CLI Key', expires_in: 7 }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      user_id: string;
      key_prefix: string;
      key?: string;
      status: string;
    };
    expect(created.user_id).toBe('user_test');
    expect(created.status).toBe('active');
    expect(created.key?.startsWith('asku_')).toBe(true);

    const listRes = await apiFetch(baseUrl, '/api/v1/user/keys');
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { items: Array<{ id: string; key_prefix: string }> };
    expect(listed.items.map((item) => item.id)).toContain(created.id);

    const apiKey = created.key ?? '';
    const meRes = await apiFetchWithToken(baseUrl, '/api/v1/me/profile', apiKey);
    expect(meRes.status).toBe(200);

    const revokeRes = await apiFetch(baseUrl, `/api/v1/user/keys/${created.id}`, { method: 'DELETE' });
    expect(revokeRes.status).toBe(204);

    const revokedMeRes = await apiFetchWithToken(baseUrl, '/api/v1/me/profile', apiKey);
    expect(revokedMeRes.status).toBe(401);
  });

  it('uses personal API keys against canonical llm-gateway paths and rejects legacy bare paths', async () => {
    const universalProxy = startUniversalProxyMockServer();
    const anthropicDirectUpstream = startAnthropicDirectUpstreamMockServer();
    process.env.MBOS_UNIVERSAL_PROXY_BASE_URL = universalProxy.baseUrl;
    const { baseUrl } = startServer();
    await createProjectEndpoint(baseUrl, 'https://openai-compatible.provider.example/v1', 'openai_chat_completions', 'placeholder-openai-model');
    await createProjectEndpoint(baseUrl, anthropicDirectUpstream.baseUrl, 'anthropic_messages', 'placeholder-anthropic-model');

    const keyRes = await apiFetch(baseUrl, '/api/v1/user/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Gateway Key' }),
    });
    expect(keyRes.status).toBe(201);
    const keyPayload = (await keyRes.json()) as { key?: string };
    const apiKey = keyPayload.key ?? '';

    const projectsRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/projects', apiKey);
    expect(projectsRes.status).toBe(200);

    const openAiRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/openai/responses',
      apiKey,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'placeholder-openai-model', input: 'hello' }),
      },
    );
    expect(openAiRes.status).toBe(200);
    await expect(openAiRes.json()).resolves.toEqual(
      expect.objectContaining({ output_text: 'hello from openai canonical' }),
    );

    const anthropicRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/anthropic/messages',
      apiKey,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'placeholder-anthropic-model',
          max_tokens: 128,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        }),
      },
    );
    expect(anthropicRes.status).toBe(200);
    await expect(anthropicRes.json()).resolves.toEqual(
      expect.objectContaining({
        content: expect.arrayContaining([expect.objectContaining({ text: 'hello from anthropic canonical' })]),
      }),
    );

    const countTokensRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/anthropic/messages/count_tokens',
      apiKey,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'placeholder-anthropic-model',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        }),
      },
    );
    expect(countTokensRes.status).toBe(200);
    expect(universalProxy.configRequests()).toHaveLength(2);
    const firstConfigRequest = universalProxy.configRequests()[0];
    const secondConfigRequest = universalProxy.configRequests()[1];
    expect((firstConfigRequest?.body as {
      if_revision?: string | null;
      revision?: string;
    }).revision).toBeUndefined();
    expect((firstConfigRequest?.body as {
      if_revision?: string | null;
    }).if_revision ?? null).toBeNull();
    expect((secondConfigRequest?.body as {
      if_revision?: string | null;
      revision?: string;
    }).revision).toBeUndefined();
    expect((secondConfigRequest?.body as {
      if_revision?: string | null;
    }).if_revision ?? null).toBeNull();
    expect(secondConfigRequest?.namespace).not.toBe(firstConfigRequest?.namespace);
    expect(universalProxy.namespaceRequests().map((item) => item.path)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/openai\/v1\/responses$/),
        expect.stringMatching(/\/anthropic\/v1\/messages$/),
      ]),
    );
    expect(universalProxy.namespaceRequests().map((item) => item.path)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/anthropic\/v1\/messages\/count_tokens$/),
      ]),
    );
    expect(anthropicDirectUpstream.requests()).toHaveLength(1);
    expect(anthropicDirectUpstream.requests()[0]?.path).toBe('/v1/messages/count_tokens');
    expect(anthropicDirectUpstream.requests()[0]?.headers['authorization']).toBe('Bearer sk-anthropic_messages');

    const legacyRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/responses',
      apiKey,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'placeholder-openai-model', input: 'legacy' }),
      },
    );
    expect(legacyRes.status).toBe(422);
    await expect(legacyRes.json()).resolves.toEqual(
      expect.objectContaining({ message: 'gateway_proxy_path_not_supported' }),
    );
  });
});
