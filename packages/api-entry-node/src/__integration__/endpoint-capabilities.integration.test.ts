import { execFileSync } from 'node:child_process';
import http, { type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { apiFetch, startServer } from './test-support.js';

const upstreamServers: Server[] = [];

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
  const port = allocateMockPort();
  server.listen(port, '127.0.0.1');
  upstreamServers.push(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    lastBody: () => body,
    lastPath: () => path,
  };
}

describe('api-entry-node endpoint capability routes', () => {
  it('imports endpoint capability bundle in one request', async () => {
    const { baseUrl } = startServer();
    const importRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints/import-bulk',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reranker: {
            model: 'qwen3-reranker-0.6b',
            api_base: 'http://pullot.com:20551/v1',
            api_key: '20552055',
            mode: 'openai',
          },
          embedding: {
            model: 'qwen3-embedding-0.6b',
            api_base: 'http://pullot.com:20553/v1',
            api_key: '20552055',
          },
          completion: {
            model: 'deepseek-chat',
            api_base: 'https://api.deepseek.com',
            api_key: 'sk-test',
          },
        }),
      },
    );
    expect(importRes.status).toBe(201);
    const imported = (await importRes.json()) as { items: Array<{ id: string }> };
    expect(imported.items.length).toBe(3);

    const listed = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { items: Array<{ id: string }> };
    expect(body.items.length).toBe(3);
  });

  it('imports exported endpoint records as new endpoints', async () => {
    const { baseUrl } = startServer();
    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'exported-endpoint-key',
          type: 'api_key',
          value: 'sk-exported',
        }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const importRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints/import-bulk',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          exported_at: '2026-05-07T00:00:00.000Z',
          workspace_id: 'ws_default',
          project_id: 'proj_1',
          endpoints: [
            {
              name: 'Imported clone',
              description: 'round-trip export clone',
              model: 'gpt-5.5',
              type: 'catalog',
              provider_family: 'openai',
              upstream_protocol: 'openai_responses',
              capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'gpt-5.5' }],
              models: [{ capability: 'chat_completion', model_id: 'gpt-5.5', display_name: 'GPT 5.5' }],
              defaults: { chat_model_id: 'gpt-5.5' },
              api_base: 'https://api.openai.example/v1/responses',
              status: 'active',
              credential_ref: credential.id,
              limits: { timeout_seconds: 45 },
            },
          ],
        }),
      },
    );
    expect(importRes.status).toBe(201);
    const imported = (await importRes.json()) as {
      items: Array<{
        id: string;
        name: string;
        base_url: string;
        credential_ref?: string;
        defaults?: { chat_model_id?: string };
      }>;
    };
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0]).toMatchObject({
      name: 'Imported clone',
      base_url: 'https://api.openai.example/v1',
      credential_ref: credential.id,
      defaults: { chat_model_id: 'gpt-5.5' },
    });

    const listed = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { items: Array<{ id: string; name: string }> };
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: imported.items[0].id, name: 'Imported clone' }),
    ]));
  });

  it('rejects bulk imports with no importable endpoint entries', async () => {
    const { baseUrl } = startServer();
    const importRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints/import-bulk',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          exported_at: '2026-05-07T00:00:00.000Z',
          bulk_import_template_examples: {
            completion: { model: '', api_base: '', api_key: '', mode: 'openai' },
          },
        }),
      },
    );
    expect(importRes.status).toBe(422);
    const body = (await importRes.json()) as { message: string };
    expect(body.message).toBe('endpoint_import_empty');
  });

  it('supports rerank route with capability model selection', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'rerank-key',
          type: 'api_key',
          value: 'sk-rerank',
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
          name: 'rerank-endpoint',
          model: 'qwen-reranker',
          type: 'custom',
          provider_family: 'custom',
          upstream_protocol: 'openai_chat_completions',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          capabilities: [{ type: 'rerank', enabled: true, default_model_id: 'qwen-reranker' }],
          models: [{ capability: 'rerank', model_id: 'qwen-reranker', display_name: 'qwen-reranker' }],
          defaults: { rerank_model_id: 'qwen-reranker' },
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const rerankRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/rerank`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored-model',
          query: 'hello',
          documents: ['a', 'b'],
        }),
      },
    );
    expect(rerankRes.status).toBe(200);
    const echoed = upstream.lastBody() as { model?: string; query?: string; documents?: string[] };
    expect(upstream.lastPath()).toBe('/v1/rerank');
    expect(echoed.model).toBe('qwen-reranker');
    expect(echoed.query).toBe('hello');
    expect(echoed.documents).toEqual(['a', 'b']);
  });

  it('fails fast when endpoint capability is not enabled or unsupported by protocol', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'generic-key',
          type: 'api_key',
          value: 'sk-generic',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const disabledCapabilityEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-only',
          model: 'chat-model',
          upstream_protocol: 'openai_chat_completions',
          type: 'catalog',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'chat-model' }],
          models: [{ capability: 'chat_completion', model_id: 'chat-model' }],
          defaults: { chat_model_id: 'chat-model' },
        }),
      },
    );
    expect(disabledCapabilityEndpointRes.status).toBe(201);
    const disabledCapabilityEndpoint = (await disabledCapabilityEndpointRes.json()) as { id: string };

    const disabledRerankRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${disabledCapabilityEndpoint.id}/rerank`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'q', documents: ['a'] }),
      },
    );
    expect(disabledRerankRes.status).toBe(422);
    const disabledBody = (await disabledRerankRes.json()) as { message: string };
    expect(disabledBody.message).toBe('endpoint_capability_not_enabled');

    const unsupportedProtocolEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'anthropic-rerank',
          model: 'claude-rerank',
          upstream_protocol: 'anthropic_messages',
          provider_family: 'anthropic',
          type: 'custom',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          capabilities: [{ type: 'rerank', enabled: true, default_model_id: 'claude-rerank' }],
          models: [{ capability: 'rerank', model_id: 'claude-rerank' }],
          defaults: { rerank_model_id: 'claude-rerank' },
        }),
      },
    );
    expect(unsupportedProtocolEndpointRes.status).toBe(201);
    const unsupportedProtocolEndpoint = (await unsupportedProtocolEndpointRes.json()) as { id: string };

    const unsupportedRerankRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${unsupportedProtocolEndpoint.id}/rerank`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'q', documents: ['a'] }),
      },
    );
    expect(unsupportedRerankRes.status).toBe(422);
    const unsupportedBody = (await unsupportedRerankRes.json()) as { message: string };
    expect(unsupportedBody.message).toBe('endpoint_capability_not_supported_for_protocol');
  });

  it('supports image/video generation routes with capability model binding', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'media-key',
          type: 'api_key',
          value: 'sk-media',
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
          name: 'media-endpoint',
          model: 'gpt-4o-mini',
          upstream_protocol: 'openai_chat_completions',
          type: 'custom',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          capabilities: [
            { type: 'image_generation', enabled: true, default_model_id: 'gpt-image-1' },
            { type: 'video_generation', enabled: true, default_model_id: 'sora' },
          ],
          models: [
            { capability: 'image_generation', model_id: 'gpt-image-1' },
            { capability: 'video_generation', model_id: 'sora' },
          ],
          defaults: { image_model_id: 'gpt-image-1', video_model_id: 'sora' },
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const imageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/images/generations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'red mountain' }),
      },
    );
    expect(imageRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/images/generations');
    const imagePayload = upstream.lastBody() as { model?: string; prompt?: string };
    expect(imagePayload.model).toBe('gpt-image-1');
    expect(imagePayload.prompt).toBe('red mountain');

    const videoCreateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/videos/generations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'flying over city' }),
      },
    );
    expect(videoCreateRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/videos/generations');
    const videoPayload = upstream.lastBody() as { model?: string; prompt?: string };
    expect(videoPayload.model).toBe('sora');
    expect(videoPayload.prompt).toBe('flying over city');

    const videoPollRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/videos/generations/job_123`,
      {
        method: 'GET',
      },
    );
    expect(videoPollRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/videos/generations/job_123');
    const pollPayload = upstream.lastBody() as { model?: string };
    expect(pollPayload.model).toBeUndefined();

    const videoCancelRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/videos/generations/job_123/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(videoCancelRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/videos/generations/job_123/cancel');
    const cancelPayload = upstream.lastBody() as { model?: string };
    expect(cancelPayload.model).toBe('sora');
  });

  it('allows multiple endpoints with the same model id when their configurations differ', async () => {
    const { baseUrl } = startServer();
    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'audit-fail-credential', type: 'api_key', value: 'sk-audit-fail' }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const firstEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'placeholder-model anthropic',
          model: 'duplicate-model',
          type: 'catalog',
          base_url: 'https://anthropic-compatible.provider.example',
          credential_ref: credential.id,
          upstream_protocol: 'anthropic_messages',
        }),
      },
    );
    expect(firstEndpointRes.status).toBe(201);
    const firstEndpoint = (await firstEndpointRes.json()) as { id: string; upstream_protocol: string };
    expect(firstEndpoint.upstream_protocol).toBe('anthropic_messages');

    const secondEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_cfg_duplicate_model_allowed' },
        body: JSON.stringify({
          name: 'placeholder-model openai',
          model: 'duplicate-model',
          type: 'catalog',
          base_url: 'https://openai-compatible.provider.example',
          credential_ref: credential.id,
          upstream_protocol: 'openai_chat_completions',
        }),
      },
    );
    expect(secondEndpointRes.status).toBe(201);
    const secondEndpoint = (await secondEndpointRes.json()) as { id: string; upstream_protocol: string };
    expect(secondEndpoint.upstream_protocol).toBe('openai_chat_completions');
    expect(secondEndpoint.id).not.toBe(firstEndpoint.id);

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{ action: string; request_id?: string; result: string; error_code?: string }>;
    };
    expect(
      audit.items.some(
        (item) =>
          item.action === 'endpoint.create'
          && item.request_id === 'req_cfg_duplicate_model_allowed'
          && item.result === 'ok',
      ),
    ).toBe(true);
  });
});
