import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { previewRuntimeImpact } from './runtime-impact-preview.js';
import { recordUsageFact } from './audit-usage-store.js';

describe('runtime-impact-preview', () => {
  it('projects a primary and range cost from recent usage facts', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date('2026-02-28T16:00:00.000Z');

    await docStore.upsert('runtime_provider_connections', 'rpc_1', {
      id: 'rpc_1',
      workspace_id: workspaceId,
      project_id: projectId,
      provider: 'openai',
      auth_mode: 'api_key',
      base_url: 'https://api.openai.com/v1',
      credential_ref: 'cred_1',
      priority: 1,
      status: 'active',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    await docStore.upsert('runtime_model_combos', 'rmco_1', {
      id: 'rmco_1',
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'prod-chat',
      targets: [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'openai', model: 'gpt-4.1' },
      ],
      fallback_policy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    await docStore.upsert('runtime_pricing_maps', `runtime_pricing_${workspaceId}_${projectId}`, {
      id: `runtime_pricing_${workspaceId}_${projectId}`,
      workspace_id: workspaceId,
      project_id: projectId,
      pricing_map: {
        openai: {
          'gpt-4o': { input: 2, output: 10 },
          'gpt-4.1': { input: 4, output: 16 },
        },
      },
      updated_at: now.toISOString(),
    });

    await recordUsageFact(docStore, {
      timestamp: new Date(now.getTime() - 60_000).toISOString(),
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      requests: 1,
      tokens_in: 1000,
      tokens_out: 500,
      tokens_total: 1500,
      result: 'ok',
      metadata_json: { estimated_cost: 0.007 },
      request_id: 'req_1',
    });
    await recordUsageFact(docStore, {
      timestamp: new Date(now.getTime() - 120_000).toISOString(),
      workspace_id: workspaceId,
      project_id: projectId,
      resource_type: 'endpoint',
      requests: 1,
      tokens_in: 500,
      tokens_out: 250,
      tokens_total: 750,
      result: 'ok',
      metadata_json: { estimated_cost: 0.0035 },
      request_id: 'req_2',
    });

    const result = await previewRuntimeImpact({
      deps: { docStore } as never,
      workspaceId,
      projectId,
      rawBody: {
        model: 'combo:prod-chat',
        lookback_hours: 24,
      },
      now,
    });

    expect(result.statusCode).toBe(200);
    if (!('sample' in result.body)) return;
    expect(result.body.sample.request_count).toBe(2);
    expect(result.body.sample.avg_tokens_in).toBe(750);
    expect(result.body.sample.avg_tokens_out).toBe(375);
    expect(result.body.projected_cost.primary_avg_cost).toBe(0.00525);
    expect(result.body.projected_cost.range_avg_cost.low).toBe(0.00525);
    expect(result.body.projected_cost.range_avg_cost.high).toBe(0.009);
  });
});
