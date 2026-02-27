import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { handleRuntimeRoute } from './runtime-route-handler.js';

type TestResponse = {
  statusCode: number;
  ended: boolean;
  body?: unknown;
  headers?: Record<string, string>;
};

function createDeps(): NodeApiDeps {
  return {
    docStore: new InMemoryJsonDocStore(),
    endpointResourceService: {
      getCredentialSecret: async () => 'test_api_key',
    },
  } as unknown as NodeApiDeps;
}

async function executeRoute(params: {
  deps: NodeApiDeps;
  route: { kind: string; workspaceId: string; projectId: string; providerConnectionId?: string };
  method: string;
  body?: unknown;
}): Promise<TestResponse> {
  const response: TestResponse = { statusCode: 200, ended: false, headers: {} };
  const responseHeaders: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      responseHeaders[name.toLowerCase()] = value;
      response.headers = responseHeaders;
    },
    getHeader: (name: string) => responseHeaders[name.toLowerCase()],
    end: (payload?: string | Buffer) => {
      response.ended = true;
      response.statusCode = res.statusCode;
      if (typeof payload === 'string') {
        try {
          response.body = JSON.parse(payload) as unknown;
        } catch {
          response.body = payload;
        }
      } else if (payload) {
        response.body = payload.toString('utf8');
      }
    },
  } as unknown as http.ServerResponse;

  await handleRuntimeRoute({
    route: params.route,
    method: params.method,
    req: { headers: {} } as http.IncomingMessage,
    res,
    deps: params.deps,
    user: { id: 'user_test', email: 'u@test', name: 'U' },
    readBody: async () => params.body,
    json: (_res, status, payload) => {
      response.statusCode = status;
      response.body = payload;
    },
  });

  return response;
}

describe('runtime-route-handler', () => {
  const workspaceId = 'ws_default';
  const projectId = 'proj_1';

  it('creates and lists runtime providers', async () => {
    const deps = createDeps();

    const createRes = await executeRoute({
      deps,
      route: { kind: 'runtimeProviders', workspaceId, projectId },
      method: 'POST',
      body: {
        provider: 'openai',
        auth_mode: 'api_key',
        base_url: 'https://api.openai.com/v1',
      },
    });

    expect(createRes.statusCode).toBe(201);

    const listRes = await executeRoute({
      deps,
      route: { kind: 'runtimeProviders', workspaceId, projectId },
      method: 'GET',
    });

    expect(listRes.statusCode).toBe(200);
    const payload = listRes.body as { items: Array<{ provider: string }> };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.provider).toBe('openai');
  });

  it('updates and reads runtime pricing map', async () => {
    const deps = createDeps();

    const patchRes = await executeRoute({
      deps,
      route: { kind: 'runtimePricing', workspaceId, projectId },
      method: 'PATCH',
      body: {
        openai: {
          'gpt-4o': {
            input: 2.5,
            output: 10,
          },
        },
      },
    });

    expect(patchRes.statusCode).toBe(200);

    const getRes = await executeRoute({
      deps,
      route: { kind: 'runtimePricing', workspaceId, projectId },
      method: 'GET',
    });

    expect(getRes.statusCode).toBe(200);
    const map = getRes.body as {
      openai?: {
        'gpt-4o'?: {
          input?: number;
          output?: number;
        };
      };
    };
    expect(map.openai?.['gpt-4o']?.input).toBe(2.5);
    expect(map.openai?.['gpt-4o']?.output).toBe(10);
  });

  it('returns not implemented for unified chat', async () => {
    const deps = createDeps();

    const res = await executeRoute({
      deps,
      route: { kind: 'llmUnifiedChat', workspaceId, projectId },
      method: 'POST',
      body: {
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(res.statusCode).toBe(502);
    expect((res.body as { error_code?: string }).error_code).toBe('RUNTIME_PROVIDER_CONNECTION_NOT_FOUND');
  });

  it('handles unified chat direct model and writes usage fact', async () => {
    const deps = createDeps();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_test',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await executeRoute({
        deps,
        route: { kind: 'runtimeProviders', workspaceId, projectId },
        method: 'POST',
        body: {
          provider: 'openai',
          auth_mode: 'api_key',
          base_url: 'https://api.openai.com/v1',
          credential_ref: 'cred_runtime',
        },
      });

      const res = await executeRoute({
        deps,
        route: { kind: 'llmUnifiedChat', workspaceId, projectId },
        method: 'POST',
        body: {
          model: 'openai/gpt-4o',
          messages: [{ role: 'user', content: 'hello' }],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(fetchCalls).toBe(1);
      const payload = res.body as {
        runtime?: { provider?: string; resolved_model?: string; fallback_hops?: number };
      };
      expect(payload.runtime?.provider).toBe('openai');
      expect(payload.runtime?.resolved_model).toBe('gpt-4o');
      expect(payload.runtime?.fallback_hops).toBe(0);

      const usageFacts = await deps.docStore.list<{ resource_type: string; result: string }>('project_usage_facts', {});
      expect(usageFacts.length).toBeGreaterThanOrEqual(1);
      expect(usageFacts.some((fact) => fact.resource_type === 'endpoint' && fact.result === 'ok')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles combo fallback when first provider returns retryable error', async () => {
    const deps = createDeps();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'rate limited' } }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_test2',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'fallback ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await executeRoute({
        deps,
        route: { kind: 'runtimeProviders', workspaceId, projectId },
        method: 'POST',
        body: {
          provider: 'openai',
          auth_mode: 'api_key',
          base_url: 'https://api.openai.com/v1',
          credential_ref: 'cred_runtime_openai',
          priority: 1,
        },
      });
      await executeRoute({
        deps,
        route: { kind: 'runtimeProviders', workspaceId, projectId },
        method: 'POST',
        body: {
          provider: 'anthropic',
          auth_mode: 'api_key',
          base_url: 'https://api.anthropic.com/v1',
          credential_ref: 'cred_runtime_anthropic',
          priority: 1,
        },
      });
      await executeRoute({
        deps,
        route: { kind: 'runtimeRoutingCombos', workspaceId, projectId },
        method: 'POST',
        body: {
          name: 'prod-chat',
          targets: [
            { provider: 'openai', model: 'gpt-4o' },
            { provider: 'anthropic', model: 'claude-sonnet-4-5' },
          ],
          fallback_policy: {
            max_hops: 2,
            retryable_error_classes: ['provider_retryable'],
          },
        },
      });

      const res = await executeRoute({
        deps,
        route: { kind: 'llmUnifiedChat', workspaceId, projectId },
        method: 'POST',
        body: {
          model: 'combo:prod-chat',
          messages: [{ role: 'user', content: 'hello' }],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(fetchCalls).toBe(2);
      const payload = res.body as {
        runtime?: { provider?: string; resolved_model?: string; fallback_hops?: number };
      };
      expect(payload.runtime?.provider).toBe('anthropic');
      expect(payload.runtime?.fallback_hops).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
