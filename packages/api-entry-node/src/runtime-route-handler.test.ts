import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { handleRuntimeRoute } from './runtime-route-handler.js';

type TestResponse = {
  statusCode: number;
  ended: boolean;
  body?: unknown;
};

function createDeps(): NodeApiDeps {
  return {
    docStore: new InMemoryJsonDocStore(),
  } as unknown as NodeApiDeps;
}

async function executeRoute(params: {
  deps: NodeApiDeps;
  route: { kind: string; workspaceId: string; projectId: string; providerConnectionId?: string };
  method: string;
  body?: unknown;
}): Promise<TestResponse> {
  const response: TestResponse = { statusCode: 200, ended: false };
  const res = {
    statusCode: 200,
    end: () => {
      response.ended = true;
      response.statusCode = res.statusCode;
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
});
