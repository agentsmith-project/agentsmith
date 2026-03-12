import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { handleModelConfigRoute } from './model-config-route-handler.js';

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
  route: { kind: string; workspaceId: string; projectId: string };
  method: string;
  body?: unknown;
  reqUrl?: string;
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

  await handleModelConfigRoute({
    route: params.route,
    method: params.method,
    req: { headers: {}, url: params.reqUrl } as http.IncomingMessage,
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

describe('model-config-route-handler', () => {
  const workspaceId = 'ws_default';
  const projectId = 'proj_1';

  it('exposes model catalog providers/models and syncs from remote source', async () => {
    const deps = createDeps();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          openai: {
            id: 'openai',
            name: 'OpenAI',
            models: {
              'gpt-4o': {
                id: 'gpt-4o',
                name: 'GPT-4o',
                reasoning: true,
                tool_call: true,
                modalities: { input: ['text'], output: ['text'] },
              },
            },
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    try {
      const syncRes = await executeRoute({
        deps,
        route: { kind: 'modelCatalogSync', workspaceId, projectId },
        method: 'POST',
      });
      expect(syncRes.statusCode).toBe(201);

      const providersRes = await executeRoute({
        deps,
        route: { kind: 'modelCatalogProviders', workspaceId, projectId },
        method: 'GET',
      });
      expect(providersRes.statusCode).toBe(200);
      const providersPayload = providersRes.body as { items: Array<{ provider_key: string }> };
      expect(providersPayload.items[0]?.provider_key).toBe('openai');

      const modelsRes = await executeRoute({
        deps,
        route: { kind: 'modelCatalogModels', workspaceId, projectId },
        method: 'GET',
        reqUrl: `/api/v1/workspaces/${workspaceId}/projects/${projectId}/model-catalog/models?capability=reasoning`,
      });
      expect(modelsRes.statusCode).toBe(200);
      const modelsPayload = modelsRes.body as { items: Array<{ model_id: string }> };
      expect(modelsPayload.items).toHaveLength(1);
      expect(modelsPayload.items[0]?.model_id).toBe('gpt-4o');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('updates and reads project pricing map', async () => {
    const deps = createDeps();

    const patchRes = await executeRoute({
      deps,
      route: { kind: 'projectPricing', workspaceId, projectId },
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
      route: { kind: 'projectPricing', workspaceId, projectId },
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

  it('returns catalog not initialized until sync happens', async () => {
    const deps = createDeps();

    const providersRes = await executeRoute({
      deps,
      route: { kind: 'modelCatalogProviders', workspaceId, projectId },
      method: 'GET',
    });

    expect(providersRes.statusCode).toBe(503);
    expect(providersRes.body).toEqual({
      error_code: 'CATALOG_NOT_INITIALIZED',
      message: 'model_catalog_not_initialized',
    });
  });
});
