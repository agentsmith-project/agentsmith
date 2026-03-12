import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { executeModelRequest } from './model-request-execution.js';

function createDeps(): NodeApiDeps {
  return {
    docStore: new InMemoryJsonDocStore(),
    endpointResourceService: {
      getCredentialSecret: async () => 'test_api_key',
    },
  } as unknown as NodeApiDeps;
}

describe('model-request-execution', () => {
  it('returns validation error when model is missing', async () => {
    const deps = createDeps();
    const result = await executeModelRequest({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      rawBody: { messages: [] },
      endUserId: 'user_test',
    });

    expect(result.statusCode).toBe(422);
    if (!('body' in result)) throw new Error('expected_json_result');
    expect((result.body as { message?: string }).message).toBe('model_request_model_required');
  });

  it('returns validation error when model is not provider/model', async () => {
    const deps = createDeps();
    const result = await executeModelRequest({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      rawBody: { model: 'assistant-main', messages: [] },
      endUserId: 'user_test',
    });

    expect(result.statusCode).toBe(422);
    if (!('body' in result)) throw new Error('expected_json_result');
    expect((result.body as { message?: string }).message).toBe('model_request_model_format_invalid');
  });

  it('executes direct model routing and records usage', async () => {
    const deps = createDeps();
    const nowMs = (() => {
      let value = 1_000;
      return () => {
        value += 10;
        return value;
      };
    })();

    await deps.docStore.upsert('provider_connections', 'rpc_1', {
      id: 'rpc_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      provider: 'openai',
      auth_mode: 'api_key',
      base_url: 'https://api.openai.com/v1',
      credential_ref: 'cred_1',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await deps.docStore.upsert('project_pricing_maps', 'project_pricing_ws_default_proj_1', {
      id: 'project_pricing_ws_default_proj_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      pricing_map: {
        openai: {
          'gpt-4o': {
            input: 2,
            output: 10,
          },
        },
      },
      updated_at: new Date().toISOString(),
    });

    const result = await executeModelRequest({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      rawBody: {
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      },
      endUserId: 'user_test',
      requestId: 'req_1',
      nowMs,
      fetchFn: (async () => new Response(
        JSON.stringify({
          id: 'chatcmpl_1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch,
    });

    expect(result.statusCode).toBe(200);
    if (!('body' in result)) throw new Error('expected_json_result');
    const requestDetails = (result.body as {
      request_details?: {
        provider?: string;
        resolved_model?: string;
        pricing_source?: string | null;
        estimated_cost?: number | null;
        attempts?: Array<{ outcome: string; durationMs?: number }>;
      };
    }).request_details;
    expect(requestDetails?.provider).toBe('openai');
    expect(requestDetails?.resolved_model).toBe('gpt-4o');
    expect(requestDetails?.pricing_source).toBe('project_pricing_ws_default_proj_1');
    expect(requestDetails?.estimated_cost).toBe(0.007);
    expect(requestDetails?.attempts).toHaveLength(1);
    expect(requestDetails?.attempts?.[0]).toMatchObject({
      index: 0,
      provider: 'openai',
      model: 'gpt-4o',
      providerConnectionId: 'rpc_1',
      outcome: 'success',
      statusCode: 200,
      reason: 'model_upstream_ok',
    });
    expect(requestDetails?.attempts?.[0]?.durationMs).toBe(10);
  });

  it('records terminal failure usage with attempt trace when no provider connection exists', async () => {
    const deps = createDeps();

    const result = await executeModelRequest({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      rawBody: {
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      },
      endUserId: 'user_test',
      requestId: 'req_missing_provider',
    });

    expect(result.statusCode).toBe(502);
    if (!('body' in result)) throw new Error('expected_json_result');
    const failurePayload = result.body as {
      error_code?: string;
      request_details?: {
        pricing_source?: string | null;
        attempts?: Array<{ outcome?: string; provider?: string }>;
      };
    };
    expect(failurePayload.error_code).toBe('PROVIDER_CONNECTION_NOT_FOUND');
    expect(failurePayload.request_details?.pricing_source).toBeNull();
    expect(failurePayload.request_details?.attempts).toEqual([
      expect.objectContaining({
        index: 0,
        provider: 'openai',
        model: 'gpt-4o',
        outcome: 'provider_connection_missing',
      }),
    ]);
  });
});
