import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type http from 'node:http';
import type { EndpointRecord } from './resource-models.js';
import { UniversalProxyService } from './universal-proxy-service.js';

function createEndpoint(overrides: Partial<EndpointRecord> = {}): EndpointRecord {
  return {
    id: 'ep_1',
    workspace_id: 'ws_default',
    project_id: 'proj_1',
    name: 'Demo Endpoint',
    model: 'placeholder-model',
    type: 'catalog',
    base_url: 'https://anthropic-compatible.provider.example',
    status: 'active',
    upstream_protocol: 'anthropic_messages',
    created_at: '2026-03-22T00:00:00.000Z',
    updated_at: '2026-03-22T00:00:00.000Z',
    ...overrides,
  };
}

function createRequest(method = 'POST'): http.IncomingMessage {
  const request = new EventEmitter() as http.IncomingMessage;
  request.method = method;
  request.headers = {};
  return request;
}

function createResponse(): http.ServerResponse {
  const response = new EventEmitter() as http.ServerResponse;
  response.statusCode = 200;
  response.write = vi.fn(() => true);
  response.end = vi.fn();
  response.setHeader = vi.fn();
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('UniversalProxyService', () => {
  it('pushes endpoint config as a namespace snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'applied' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new UniversalProxyService('http://proxy.internal:8080');
    const namespace = await service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint(),
      'secret-key',
    );

    expect(namespace).toBe('ws_default__proj_1__ep_1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://proxy.internal:8080/admin/namespaces/ws_default__proj_1__ep_1/config');
    const payload = JSON.parse(String(init.body)) as {
      revision: string;
      config: { upstreams: Array<{ api_root: string; fixed_upstream_format?: string; auth_policy: string }> };
    };
    expect(payload.revision).toContain('2026-03-22T00:00:00.000Z:');
    expect(payload.config.upstreams[0]).toMatchObject({
      api_root: 'https://anthropic-compatible.provider.example/v1',
      fixed_upstream_format: 'anthropic',
      auth_policy: 'force_server',
    });
  });

  it('normalizes explicit upstream route suffixes out of api_root snapshots', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'applied' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new UniversalProxyService('http://proxy.internal:8080');
    await service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint({
        upstream_protocol: 'openai_chat_completions',
        base_url: 'https://openai-compatible.provider.example/chat/completions',
      }),
      'secret-key',
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as {
      config: { upstreams: Array<{ api_root: string }> };
    };
    expect(payload.config.upstreams[0]?.api_root).toBe('https://openai-compatible.provider.example');
  });

  it('forwards a unified request through the namespaced proxy route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'response',
          usage: { total_tokens: 42 },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new UniversalProxyService('http://proxy.internal:8080');
    const res = createResponse();
    const result = await service.proxyJsonRequest({
      req: createRequest(),
      res,
      namespace: 'ws_default__proj_1__ep_1',
      proxyPath: 'openai/responses',
      model: 'placeholder-model',
      requestBody: { input: 'hello' },
    });

    expect(result).toEqual({ upstream_status: 200, tokens_total: 42 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://proxy.internal:8080/namespaces/ws_default__proj_1__ep_1/openai/v1/responses');
    expect(JSON.parse(String(init.body))).toMatchObject({
      input: 'hello',
      model: 'placeholder-model',
    });
    expect(res.end).toHaveBeenCalled();
  });
});
