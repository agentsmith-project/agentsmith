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
      guardrails: {
        release_readiness: 'ready',
        blockers: [],
        warnings: [],
      },
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
      guardrails: {
        release_readiness: 'blocked',
        blockers: [
          'runtime_guardrail_primary_connection_unavailable',
          'runtime_guardrail_primary_pricing_missing',
        ],
        warnings: [],
      },
    });
    expect('attempts' in result.body && result.body.attempts[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      provider_connection_status: 'missing',
      pricing_source: 'missing',
    });
  });

  it('blocks rollout when only a disabled primary connection exists', async () => {
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
      priority: 1,
      status: 'disabled',
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
      pricing: { input: 2, output: 10 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const result = await dryRunRuntimeRouting({
      deps: { docStore } as never,
      workspaceId,
      projectId,
      rawBody: { model: 'openai/gpt-4o' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      issues: ['runtime_provider_connection_disabled'],
      guardrails: {
        release_readiness: 'blocked',
        blockers: ['runtime_guardrail_primary_connection_unavailable'],
      },
    });
    expect('attempts' in result.body && result.body.attempts[0]).toMatchObject({
      provider_connection_status: 'disabled',
      provider_connection_has_credential: true,
    });
  });

  it('reports workspace and global pricing sources when active versions resolve pricing', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = 'ws_1';
    const projectId = 'proj_1';
    const now = new Date().toISOString();

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
      created_at: now,
      updated_at: now,
    });
    await docStore.upsert('runtime_model_catalog_entries', 'rmc_1', {
      id: 'rmc_1',
      workspace_id: workspaceId,
      project_id: projectId,
      provider: 'openai',
      model_id: 'gpt-4o',
      capabilities: ['chat'],
      created_at: now,
      updated_at: now,
    });
    await docStore.upsert('runtime_pricing_versions', 'rpv_workspace', {
      id: 'rpv_workspace',
      scope_type: 'workspace',
      workspace_id: workspaceId,
      version_name: 'workspace-default',
      pricing_map: {
        openai: {
          'gpt-4o': { input: 2, output: 10 },
        },
      },
      status: 'active',
      created_at: now,
      updated_at: now,
      activated_at: now,
    });

    const workspaceResult = await dryRunRuntimeRouting({
      deps: { docStore } as never,
      workspaceId,
      projectId,
      rawBody: { model: 'openai/gpt-4o' },
    });
    expect(workspaceResult.statusCode).toBe(200);
    expect('attempts' in workspaceResult.body && workspaceResult.body.attempts[0]).toMatchObject({
      pricing_source: 'workspace_default',
      pricing: { input: 2, output: 10 },
    });

    await docStore.upsert('runtime_pricing_versions', 'rpv_workspace', {
      id: 'rpv_workspace',
      scope_type: 'workspace',
      workspace_id: workspaceId,
      version_name: 'workspace-default',
      pricing_map: {
        openai: {
          'gpt-4o': { input: 2, output: 10 },
        },
      },
      status: 'archived',
      created_at: now,
      updated_at: now,
      activated_at: now,
    });
    await docStore.upsert('runtime_pricing_versions', 'rpv_global', {
      id: 'rpv_global',
      scope_type: 'global',
      version_name: 'global-default',
      pricing_map: {
        openai: {
          'gpt-4o': { input: 3, output: 11 },
        },
      },
      status: 'active',
      created_at: now,
      updated_at: now,
      activated_at: now,
    });

    const globalResult = await dryRunRuntimeRouting({
      deps: { docStore } as never,
      workspaceId,
      projectId,
      rawBody: { model: 'openai/gpt-4o' },
    });
    expect(globalResult.statusCode).toBe(200);
    expect('attempts' in globalResult.body && globalResult.body.attempts[0]).toMatchObject({
      pricing_source: 'global_default',
      pricing: { input: 3, output: 11 },
    });
  });
});
