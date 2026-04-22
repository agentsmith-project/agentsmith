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

function getRequest(fetchMock: ReturnType<typeof vi.fn>, index = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, init };
}

function createJsonResponse(body: Record<string, unknown>, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(headers ?? {}),
    },
  });
}

describe('UniversalProxyService', () => {
  it('adds bearer authorization to admin config pushes when admin token is configured from env', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ revision: 'srv_rev_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = UniversalProxyService.fromEnv({
      MBOS_UNIVERSAL_PROXY_BASE_URL: 'http://proxy.internal:8080',
      MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: ' proxy-admin-token ',
    });

    expect(service).toBeDefined();

    await service?.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint(),
      'secret-key',
    );

    expect(getRequest(fetchMock).init.headers).toEqual({
      'content-type': 'application/json',
      Authorization: 'Bearer proxy-admin-token',
    });
  });

  it('keeps admin config pushes unchanged when no admin token is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ revision: 'srv_rev_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = UniversalProxyService.fromEnv({
      MBOS_UNIVERSAL_PROXY_BASE_URL: 'http://proxy.internal:8080',
    });

    expect(service).toBeDefined();

    await service?.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint(),
      'secret-key',
    );

    expect(getRequest(fetchMock).init.headers).toEqual({
      'content-type': 'application/json',
    });
  });

  it('pushes endpoint config with the server-owned revision contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ revision: 'srv_rev_1' }), {
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
    const { url, init } = getRequest(fetchMock);
    expect(url).toBe('http://proxy.internal:8080/admin/namespaces/ws_default__proj_1__ep_1/config');
    const payload = JSON.parse(String(init.body)) as {
      if_revision: string | null;
      config: { upstreams: Array<{ api_root: string; fixed_upstream_format?: string; auth_policy: string }> };
    };
    expect(payload.if_revision).toBeNull();
    expect(payload.config.upstreams[0]).toMatchObject({
      api_root: 'https://anthropic-compatible.provider.example/v1',
      fixed_upstream_format: 'anthropic',
      auth_policy: 'force_server',
    });
  });

  it('normalizes explicit upstream route suffixes out of api_root snapshots', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ revision: 'srv_rev_1' }), {
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

  it('does not rewrite unchanged config when only endpoint metadata changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ revision: 'srv_rev_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new UniversalProxyService('http://proxy.internal:8080');
    await service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint(),
      'secret-key',
    );
    await service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint({
        name: 'Renamed Endpoint',
        updated_at: '2026-04-01T12:00:00.000Z',
      }),
      'secret-key',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the last known server revision when config changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 'srv_rev_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 'srv_rev_2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new UniversalProxyService('http://proxy.internal:8080');
    await service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint(),
      'secret-key',
    );
    await service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint({
        limits: { timeout_seconds: 45 },
        updated_at: '2026-04-01T12:00:00.000Z',
      }),
      'secret-key',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(String(getRequest(fetchMock, 0).init.body)) as { if_revision: string | null };
    const secondPayload = JSON.parse(String(getRequest(fetchMock, 1).init.body)) as {
      if_revision: string | null;
      config: { upstream_timeout_secs: number };
    };
    expect(firstPayload.if_revision).toBeNull();
    expect(secondPayload.if_revision).toBe('srv_rev_1');
    expect(secondPayload.config.upstream_timeout_secs).toBe(45);
  });

  it('retries once with current_revision after a 412 CAS conflict', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ current_revision: 'srv_rev_0' }), {
          status: 412,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 'srv_rev_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new UniversalProxyService('http://proxy.internal:8080');
    await service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint(),
      'secret-key',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(String(getRequest(fetchMock, 0).init.body)) as { if_revision: string | null };
    const secondPayload = JSON.parse(String(getRequest(fetchMock, 1).init.body)) as { if_revision: string | null };
    expect(firstPayload.if_revision).toBeNull();
    expect(secondPayload.if_revision).toBe('srv_rev_0');
  });

  it('retries with null if_revision when a stale cached revision hits a restarted proxy namespace', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 'srv_rev_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ current_revision: null }), {
          status: 412,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ revision: 'srv_rev_2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new UniversalProxyService('http://proxy.internal:8080');
    await service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint(),
      'secret-key',
    );
    await service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint({
        limits: { timeout_seconds: 45 },
        updated_at: '2026-04-01T12:00:00.000Z',
      }),
      'secret-key',
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryAttemptPayload = JSON.parse(String(getRequest(fetchMock, 1).init.body)) as { if_revision: string | null };
    const recreatePayload = JSON.parse(String(getRequest(fetchMock, 2).init.body)) as {
      if_revision: string | null;
      config: { upstream_timeout_secs: number };
    };
    expect(retryAttemptPayload.if_revision).toBe('srv_rev_1');
    expect(recreatePayload.if_revision).toBeNull();
    expect(recreatePayload.config.upstream_timeout_secs).toBe(45);
  });

  it('requires the server to return a revision on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'applied' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new UniversalProxyService('http://proxy.internal:8080');

    await expect(
      service.ensureEndpointNamespace(
        'ws_default',
        'proj_1',
        createEndpoint(),
        'secret-key',
      ),
    ).rejects.toThrow('universal_proxy_config_push_missing_revision');
  });

  it('serializes concurrent reconcile calls for the same namespace', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(firstResponse);
    vi.stubGlobal('fetch', fetchMock);

    const service = new UniversalProxyService('http://proxy.internal:8080');
    const pendingA = service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint(),
      'secret-key',
    );
    const pendingB = service.ensureEndpointNamespace(
      'ws_default',
      'proj_1',
      createEndpoint(),
      'secret-key',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(
      new Response(JSON.stringify({ revision: 'srv_rev_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await Promise.all([pendingA, pendingB]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  [
    {
      name: 'openai chat completions 429',
      proxyPath: 'openai/chat/completions',
      status: 429,
      model: 'gpt-4.1',
      requestBody: { messages: [{ role: 'user', content: 'hello' }] },
    },
    {
      name: 'openai chat completions 503',
      proxyPath: 'openai/chat/completions',
      status: 503,
      model: 'gpt-4.1',
      requestBody: { messages: [{ role: 'user', content: 'hello' }] },
    },
    {
      name: 'openai responses 429',
      proxyPath: 'openai/responses',
      status: 429,
      model: 'gpt-4.1',
      requestBody: { input: 'hello' },
    },
    {
      name: 'openai responses 503',
      proxyPath: 'openai/responses',
      status: 503,
      model: 'gpt-4.1',
      requestBody: { input: 'hello' },
    },
    {
      name: 'anthropic messages 429',
      proxyPath: 'anthropic/messages',
      status: 429,
      model: 'claude-sonnet-4-5',
      requestBody: { messages: [{ role: 'user', content: 'hello' }] },
    },
    {
      name: 'anthropic messages 503',
      proxyPath: 'anthropic/messages',
      status: 503,
      model: 'claude-sonnet-4-5',
      requestBody: { messages: [{ role: 'user', content: 'hello' }] },
    },
  ].forEach(({ name, proxyPath, status, model, requestBody }) => {
    it(`does not auto-retry non-idempotent ${name} requests by default`, async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          createJsonResponse({
            error: {
              error_class: 'provider_retryable',
              message: status === 429
                ? 'Selected model is at capacity, please retry.'
                : 'Provider overloaded, retry later.',
            },
          }, status, { 'retry-after': '0' }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            object: 'response',
            usage: { total_tokens: 21 },
          }, 200),
        );
      vi.stubGlobal('fetch', fetchMock);

      const service = new UniversalProxyService('http://proxy.internal:8080', undefined, {
        maxTransientProviderRetries: 1,
        transientProviderRetryDelayMs: 0,
      });
      const upstreamResponse = await service.forwardRequest({
        req: createRequest(),
        namespace: 'ws_default__proj_1__ep_1',
        proxyPath,
        model,
        requestBody,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(upstreamResponse.status).toBe(status);
      expect(await upstreamResponse.text()).toContain(
        status === 429 ? 'Selected model is at capacity' : 'Provider overloaded',
      );
    });
  });

  it('keeps transient retries bounded and does not retry clear non-retryable auth failures', async () => {
    const retryableFetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ error: { message: 'overloaded' } }, 503))
      .mockResolvedValueOnce(createJsonResponse({ error: { message: 'still overloaded' } }, 503));
    vi.stubGlobal('fetch', retryableFetchMock);

    const retryingService = new UniversalProxyService('http://proxy.internal:8080', undefined, {
      maxTransientProviderRetries: 1,
      transientProviderRetryDelayMs: 0,
    });
    const retryableResponse = await retryingService.forwardRequest({
      req: createRequest(),
      namespace: 'ws_default__proj_1__ep_1',
      proxyPath: 'anthropic/messages/count_tokens',
      model: 'claude-sonnet-4-5',
      requestBody: { messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(retryableFetchMock).toHaveBeenCalledTimes(2);
    expect(retryableResponse.status).toBe(503);
    expect(await retryableResponse.text()).toContain('still overloaded');
    expect(JSON.parse(String(getRequest(retryableFetchMock, 1).init.body))).toMatchObject({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const authFailureFetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        error: {
          error_class: 'provider_non_retryable',
          message: 'invalid_api_key',
        },
      }, 401),
    );
    vi.stubGlobal('fetch', authFailureFetchMock);

    const authFailureService = new UniversalProxyService('http://proxy.internal:8080', undefined, {
      maxTransientProviderRetries: 1,
      transientProviderRetryDelayMs: 0,
    });
    const authFailureResponse = await authFailureService.forwardRequest({
      req: createRequest(),
      namespace: 'ws_default__proj_1__ep_1',
      proxyPath: 'openai/chat/completions',
      model: 'gpt-4.1',
      requestBody: { messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(authFailureFetchMock).toHaveBeenCalledTimes(1);
    expect(authFailureResponse.status).toBe(401);
  });
});
