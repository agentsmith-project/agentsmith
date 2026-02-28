import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { executeRuntimeUnifiedChat } from './runtime-unified-chat.js';

function createDeps(): NodeApiDeps {
  return {
    docStore: new InMemoryJsonDocStore(),
    endpointResourceService: {
      getCredentialSecret: async () => 'test_api_key',
    },
  } as unknown as NodeApiDeps;
}

describe('runtime-unified-chat', () => {
  it('returns validation error when model is missing', async () => {
    const deps = createDeps();
    const result = await executeRuntimeUnifiedChat({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      rawBody: { messages: [] },
      endUserId: 'user_test',
    });

    expect(result.statusCode).toBe(422);
    if (!('body' in result)) throw new Error('expected_json_result');
    expect((result.body as { message?: string }).message).toBe('runtime_unified_chat_model_required');
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

    await deps.docStore.upsert('runtime_provider_connections', 'rpc_1', {
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
    await deps.docStore.upsert('runtime_pricing_maps', 'runtime_pricing_ws_default_proj_1', {
      id: 'runtime_pricing_ws_default_proj_1',
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

    const result = await executeRuntimeUnifiedChat({
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
    const runtime = (result.body as {
      runtime?: { provider?: string; resolved_model?: string; attempts?: Array<{ outcome: string; durationMs?: number }> };
    }).runtime;
    expect(runtime?.provider).toBe('openai');
    expect(runtime?.resolved_model).toBe('gpt-4o');
    expect(runtime?.attempts).toHaveLength(1);
    expect(runtime?.attempts?.[0]).toMatchObject({
      index: 0,
      provider: 'openai',
      model: 'gpt-4o',
      providerConnectionId: 'rpc_1',
      outcome: 'success',
      statusCode: 200,
      reason: 'runtime_upstream_ok',
    });
    expect(runtime?.attempts?.[0]?.durationMs).toBe(10);

    const usageFacts = await deps.docStore.list<{
      metadata_json?: {
        estimated_cost?: number;
        attempt_trace?: Array<{ outcome?: string }>;
      };
    }>('project_usage_facts', {});
    expect(usageFacts).toHaveLength(1);
    expect(usageFacts[0]?.metadata_json?.estimated_cost).toBe(0.007);
    expect(usageFacts[0]?.metadata_json?.attempt_trace?.map((item) => item.outcome)).toEqual(['success']);
  });

  it('falls back across combo targets when policy allows retryable provider errors', async () => {
    const deps = createDeps();
    let fetchCalls = 0;

    await deps.docStore.upsert('runtime_provider_connections', 'rpc_openai', {
      id: 'rpc_openai',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      provider: 'openai',
      auth_mode: 'api_key',
      base_url: 'https://api.openai.com/v1',
      credential_ref: 'cred_openai',
      priority: 1,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await deps.docStore.upsert('runtime_provider_connections', 'rpc_anthropic', {
      id: 'rpc_anthropic',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      provider: 'anthropic',
      auth_mode: 'api_key',
      base_url: 'https://api.anthropic.com/v1',
      credential_ref: 'cred_anthropic',
      priority: 1,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await deps.docStore.upsert('runtime_model_combos', 'rmco_1', {
      id: 'rmco_1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'prod-chat',
      targets: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      ],
      fallback_policy: {
        max_hops: 2,
        retryable_error_classes: ['provider_retryable'],
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await executeRuntimeUnifiedChat({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      rawBody: {
        model: 'combo:prod-chat',
        messages: [{ role: 'user', content: 'hello' }],
      },
      endUserId: 'user_test',
      fetchFn: (async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
            status: 429,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          id: 'chatcmpl_2',
          choices: [{ index: 0, message: { role: 'assistant', content: 'fallback ok' } }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });

    expect(fetchCalls).toBe(2);
    expect(result.statusCode).toBe(200);
    if (!('body' in result)) throw new Error('expected_json_result');
    const comboRuntime = (result.body as {
      runtime?: {
        provider?: string;
        fallback_hops?: number;
        attempts?: Array<{ outcome?: string; provider?: string; errorClass?: string }>;
      };
    }).runtime;
    expect(comboRuntime?.provider).toBe('anthropic');
    expect(comboRuntime?.fallback_hops).toBe(1);
    expect(comboRuntime?.attempts).toHaveLength(2);
    expect(comboRuntime?.attempts?.[0]).toMatchObject({
      index: 0,
      provider: 'openai',
      model: 'gpt-4o',
      providerConnectionId: 'rpc_openai',
      outcome: 'fallback_upstream_error',
      statusCode: 429,
      errorClass: 'provider_retryable',
      reason: 'runtime_upstream_error_recovered',
    });
    expect(comboRuntime?.attempts?.[1]).toMatchObject({
      index: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      providerConnectionId: 'rpc_anthropic',
      outcome: 'success',
      statusCode: 200,
      reason: 'runtime_upstream_ok',
    });
  });

  it('records terminal failure usage with attempt trace when no provider connection exists', async () => {
    const deps = createDeps();

    const result = await executeRuntimeUnifiedChat({
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
      runtime?: { attempts?: Array<{ outcome?: string; reason?: string }> };
    };
    expect(failurePayload.error_code).toBe('RUNTIME_PROVIDER_CONNECTION_NOT_FOUND');
    expect(failurePayload.runtime?.attempts).toHaveLength(1);
    expect(failurePayload.runtime?.attempts?.[0]).toMatchObject({
      index: 0,
      provider: 'openai',
      model: 'gpt-4o',
      outcome: 'provider_connection_missing',
      reason: 'runtime_provider_connection_not_found',
    });

    const usageFacts = await deps.docStore.list<{
      result?: string;
      error_code?: string;
      metadata_json?: { attempt_trace?: Array<{ outcome?: string }> };
    }>('project_usage_facts', {});
    expect(usageFacts).toHaveLength(1);
    expect(usageFacts[0]?.result).toBe('error');
    expect(usageFacts[0]?.error_code).toBe('RUNTIME_PROVIDER_CONNECTION_NOT_FOUND');
    expect(usageFacts[0]?.metadata_json?.attempt_trace?.map((item) => item.outcome)).toEqual(['provider_connection_missing']);
  });
});
