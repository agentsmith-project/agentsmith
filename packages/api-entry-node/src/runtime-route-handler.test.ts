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
  route: {
    kind: string;
    workspaceId: string;
    projectId: string;
    providerConnectionId?: string;
    modelId?: string;
    alias?: string;
    combo?: string;
  };
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

  it('supports runtime model/alias/combo item CRUD operations', async () => {
    const deps = createDeps();

    const modelCreate = await executeRoute({
      deps,
      route: { kind: 'runtimeModels', workspaceId, projectId },
      method: 'POST',
      body: {
        provider: 'openai',
        model_id: 'gpt-4o',
        capabilities: ['chat'],
      },
    });
    expect(modelCreate.statusCode).toBe(201);

    const modelGet = await executeRoute({
      deps,
      route: { kind: 'runtimeModelItem', workspaceId, projectId, modelId: 'gpt-4o' },
      method: 'GET',
    });
    expect(modelGet.statusCode).toBe(200);

    const modelPut = await executeRoute({
      deps,
      route: { kind: 'runtimeModelItem', workspaceId, projectId, modelId: 'gpt-4o' },
      method: 'PUT',
      body: {
        display_name: 'GPT-4o Main',
        capabilities: ['chat', 'tools'],
      },
    });
    expect(modelPut.statusCode).toBe(200);
    const modelPutPayload = modelPut.body as { display_name?: string; capabilities?: string[] };
    expect(modelPutPayload.display_name).toBe('GPT-4o Main');
    expect(modelPutPayload.capabilities).toEqual(['chat', 'tools']);

    const aliasCreate = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingAliases', workspaceId, projectId },
      method: 'POST',
      body: {
        alias: 'assistant-main',
        target_provider: 'openai',
        target_model: 'gpt-4o',
      },
    });
    expect(aliasCreate.statusCode).toBe(201);

    const aliasPut = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingAliasItem', workspaceId, projectId, alias: 'assistant-main' },
      method: 'PUT',
      body: {
        target_model: 'gpt-4.1',
      },
    });
    expect(aliasPut.statusCode).toBe(200);
    const aliasPutPayload = aliasPut.body as { target_model?: string };
    expect(aliasPutPayload.target_model).toBe('gpt-4.1');

    const comboCreate = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingCombos', workspaceId, projectId },
      method: 'POST',
      body: {
        name: 'prod-chat',
        targets: [{ provider: 'openai', model: 'gpt-4o' }],
        fallback_policy: {
          max_hops: 1,
          retryable_error_classes: ['provider_retryable'],
        },
      },
    });
    expect(comboCreate.statusCode).toBe(201);

    const comboGet = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingComboItem', workspaceId, projectId, combo: 'prod-chat' },
      method: 'GET',
    });
    expect(comboGet.statusCode).toBe(200);

    const comboDelete = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingComboItem', workspaceId, projectId, combo: 'prod-chat' },
      method: 'DELETE',
    });
    expect(comboDelete.statusCode).toBe(204);

    const aliasDelete = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingAliasItem', workspaceId, projectId, alias: 'assistant-main' },
      method: 'DELETE',
    });
    expect(aliasDelete.statusCode).toBe(204);

    const modelDelete = await executeRoute({
      deps,
      route: { kind: 'runtimeModelItem', workspaceId, projectId, modelId: 'gpt-4o' },
      method: 'DELETE',
    });
    expect(modelDelete.statusCode).toBe(204);
  });

  it('returns conflict on duplicate model/alias/combo definitions', async () => {
    const deps = createDeps();

    const modelBody = { provider: 'openai', model_id: 'gpt-4o', capabilities: ['chat'] };
    await executeRoute({
      deps,
      route: { kind: 'runtimeModels', workspaceId, projectId },
      method: 'POST',
      body: modelBody,
    });
    const duplicateModel = await executeRoute({
      deps,
      route: { kind: 'runtimeModels', workspaceId, projectId },
      method: 'POST',
      body: modelBody,
    });
    expect(duplicateModel.statusCode).toBe(409);

    const aliasBody = {
      alias: 'assistant-main',
      target_provider: 'openai',
      target_model: 'gpt-4o',
    };
    await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingAliases', workspaceId, projectId },
      method: 'POST',
      body: aliasBody,
    });
    const duplicateAlias = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingAliases', workspaceId, projectId },
      method: 'POST',
      body: aliasBody,
    });
    expect(duplicateAlias.statusCode).toBe(409);

    const comboBody = {
      name: 'prod-chat',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
      fallback_policy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
    };
    await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingCombos', workspaceId, projectId },
      method: 'POST',
      body: comboBody,
    });
    const duplicateCombo = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingCombos', workspaceId, projectId },
      method: 'POST',
      body: comboBody,
    });
    expect(duplicateCombo.statusCode).toBe(409);
  });

  it('returns not found for missing runtime model/alias/combo item routes', async () => {
    const deps = createDeps();

    const modelGet = await executeRoute({
      deps,
      route: { kind: 'runtimeModelItem', workspaceId, projectId, modelId: 'missing-model' },
      method: 'GET',
    });
    expect(modelGet.statusCode).toBe(404);

    const aliasGet = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingAliasItem', workspaceId, projectId, alias: 'missing-alias' },
      method: 'GET',
    });
    expect(aliasGet.statusCode).toBe(404);

    const comboGet = await executeRoute({
      deps,
      route: { kind: 'runtimeRoutingComboItem', workspaceId, projectId, combo: 'missing-combo' },
      method: 'GET',
    });
    expect(comboGet.statusCode).toBe(404);
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

  it('resolves alias target and persists estimated cost metadata from pricing map', async () => {
    const deps = createDeps();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        id: 'chatcmpl_alias',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'alias ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

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
        },
      });
      await executeRoute({
        deps,
        route: { kind: 'runtimePricing', workspaceId, projectId },
        method: 'PATCH',
        body: {
          openai: {
            'gpt-4o': {
              input: 2,
              output: 10,
            },
          },
        },
      });
      await executeRoute({
        deps,
        route: { kind: 'runtimeRoutingAliases', workspaceId, projectId },
        method: 'POST',
        body: {
          alias: 'assistant-main',
          target_provider: 'openai',
          target_model: 'gpt-4o',
        },
      });

      const res = await executeRoute({
        deps,
        route: { kind: 'llmUnifiedChat', workspaceId, projectId },
        method: 'POST',
        body: {
          model: 'assistant-main',
          messages: [{ role: 'user', content: 'hello' }],
        },
      });

      expect(res.statusCode).toBe(200);
      const payload = res.body as {
        runtime?: { provider?: string; resolved_model?: string; fallback_hops?: number };
      };
      expect(payload.runtime?.provider).toBe('openai');
      expect(payload.runtime?.resolved_model).toBe('gpt-4o');
      expect(payload.runtime?.fallback_hops).toBe(0);

      const usageFacts = await deps.docStore.list<{
        resource_type: string;
        result: string;
        metadata_json?: {
          routed_by?: string;
          estimated_cost?: number;
          pricing_version?: string | null;
        };
      }>('project_usage_facts', {});
      const lastFact = usageFacts[usageFacts.length - 1];
      expect(lastFact?.resource_type).toBe('endpoint');
      expect(lastFact?.result).toBe('ok');
      expect(lastFact?.metadata_json?.routed_by).toBe('alias');
      expect(lastFact?.metadata_json?.pricing_version).toBeTruthy();
      expect(lastFact?.metadata_json?.estimated_cost).toBe(0.007);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not fallback on provider_non_retryable status even when combo has backups', async () => {
    const deps = createDeps();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({ error: { message: 'bad request' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
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
          name: 'strict-chat',
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
          model: 'combo:strict-chat',
          messages: [{ role: 'user', content: 'hello' }],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(fetchCalls).toBe(1);
      const payload = res.body as { runtime?: { provider?: string; fallback_hops?: number } };
      expect(payload.runtime?.provider).toBe('openai');
      expect(payload.runtime?.fallback_hops).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('respects combo max_hops limit and stops before third attempt', async () => {
    const deps = createDeps();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({ error: { message: 'rate limited' } }),
        { status: 429, headers: { 'content-type': 'application/json' } },
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
        route: { kind: 'runtimeProviders', workspaceId, projectId },
        method: 'POST',
        body: {
          provider: 'deepseek',
          auth_mode: 'api_key',
          base_url: 'https://api.deepseek.com/v1',
          credential_ref: 'cred_runtime_deepseek',
          priority: 1,
        },
      });
      await executeRoute({
        deps,
        route: { kind: 'runtimeRoutingCombos', workspaceId, projectId },
        method: 'POST',
        body: {
          name: 'two-hop-cap',
          targets: [
            { provider: 'openai', model: 'gpt-4o' },
            { provider: 'anthropic', model: 'claude-sonnet-4-5' },
            { provider: 'deepseek', model: 'deepseek-chat' },
          ],
          fallback_policy: {
            max_hops: 1,
            retryable_error_classes: ['provider_retryable'],
          },
        },
      });

      const res = await executeRoute({
        deps,
        route: { kind: 'llmUnifiedChat', workspaceId, projectId },
        method: 'POST',
        body: {
          model: 'combo:two-hop-cap',
          messages: [{ role: 'user', content: 'hello' }],
        },
      });

      expect(res.statusCode).toBe(429);
      expect(fetchCalls).toBe(2);
      const payload = res.body as { runtime?: { provider?: string; fallback_hops?: number } };
      expect(payload.runtime?.provider).toBe('anthropic');
      expect(payload.runtime?.fallback_hops).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
