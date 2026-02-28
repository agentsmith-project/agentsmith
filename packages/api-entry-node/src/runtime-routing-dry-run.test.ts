import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { dryRunRuntimeRouting } from './runtime-routing-dry-run.js';

describe('runtime-routing-dry-run', () => {
  it('resolves combo routing with active connection and project pricing', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';

    await docStore.upsert('runtime_provider_connections', 'rpc_1', {
      id: 'rpc_1',
      workspace_id: workspaceId,
      project_id: projectId,
      provider: 'openai',
      auth_mode: 'api_key',
      base_url: 'https://api.openai.com/v1',
      credential_ref: 'cred_1',
      priority: 10,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await docStore.upsert('runtime_model_catalog_entries', 'rmc_1', {
      id: 'rmc_1',
      workspace_id: workspaceId,
      project_id: projectId,
      provider: 'openai',
      model_id: 'gpt-4o',
      capabilities: ['chat'],
      pricing: { input: 3, output: 12 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await docStore.upsert('runtime_model_combos', 'rmco_1', {
      id: 'rmco_1',
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'prod-chat',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
      fallback_policy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await docStore.upsert('runtime_pricing_maps', `runtime_pricing_${workspaceId}_${projectId}`, {
      id: `runtime_pricing_${workspaceId}_${projectId}`,
      workspace_id: workspaceId,
      project_id: projectId,
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

    const result = await dryRunRuntimeRouting({
      deps: { docStore } as never,
      workspaceId,
      projectId,
      rawBody: { model: 'combo:prod-chat' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      model: 'combo:prod-chat',
      routed_by: 'combo',
      combo_name: 'prod-chat',
      issues: [],
    });
    expect('attempts' in result.body && result.body.attempts[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      provider_connection_status: 'active',
      provider_connection_id: 'rpc_1',
      pricing_source: 'project_override',
      pricing: { input: 2, output: 10 },
    });
  });

  it('surfaces missing connection and pricing issues for alias routing', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';

    await docStore.upsert('runtime_model_catalog_entries', 'rmc_1', {
      id: 'rmc_1',
      workspace_id: workspaceId,
      project_id: projectId,
      provider: 'anthropic',
      model_id: 'claude-sonnet-4-5',
      capabilities: ['chat'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await docStore.upsert('runtime_model_aliases', 'rma_1', {
      id: 'rma_1',
      workspace_id: workspaceId,
      project_id: projectId,
      alias: 'assistant-main',
      target_provider: 'anthropic',
      target_model: 'claude-sonnet-4-5',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await dryRunRuntimeRouting({
      deps: { docStore } as never,
      workspaceId,
      projectId,
      rawBody: { model: 'assistant-main' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      routed_by: 'alias',
      alias: 'assistant-main',
      issues: ['runtime_pricing_missing', 'runtime_provider_connection_missing'],
    });
    expect('attempts' in result.body && result.body.attempts[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      provider_connection_status: 'missing',
      pricing_source: 'missing',
    });
  });
});
