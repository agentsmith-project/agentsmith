import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { createRuntimeStore } from './runtime-store.js';

describe('runtime-store', () => {
  it('scopes provider/model/alias/combo records by workspace and project', async () => {
    const store = createRuntimeStore(new InMemoryJsonDocStore());
    const scopeA = { workspaceId: 'ws_a', projectId: 'proj_a' };
    const scopeB = { workspaceId: 'ws_b', projectId: 'proj_b' };

    await store.upsertProvider({
      id: store.createId('rpc'),
      workspace_id: scopeA.workspaceId,
      project_id: scopeA.projectId,
      provider: 'openai',
      auth_mode: 'api_key',
      base_url: 'https://api.openai.com/v1',
      status: 'active',
      created_at: store.nowIso(),
      updated_at: store.nowIso(),
    });
    await store.upsertModel({
      id: store.createId('rmc'),
      workspace_id: scopeA.workspaceId,
      project_id: scopeA.projectId,
      provider: 'openai',
      model_id: 'gpt-4o',
      capabilities: ['chat'],
      created_at: store.nowIso(),
      updated_at: store.nowIso(),
    });
    await store.upsertAlias({
      id: store.createId('rma'),
      workspace_id: scopeB.workspaceId,
      project_id: scopeB.projectId,
      alias: 'assistant-main',
      target_provider: 'openai',
      target_model: 'gpt-4o',
      created_at: store.nowIso(),
      updated_at: store.nowIso(),
    });
    await store.upsertCombo({
      id: store.createId('rmco'),
      workspace_id: scopeB.workspaceId,
      project_id: scopeB.projectId,
      name: 'prod-chat',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
      fallback_policy: {
        max_hops: 1,
        retryable_error_classes: ['provider_retryable'],
      },
      created_at: store.nowIso(),
      updated_at: store.nowIso(),
    });

    expect(await store.listProviders(scopeA)).toHaveLength(1);
    expect(await store.listProviders(scopeB)).toHaveLength(0);
    expect(await store.listModels(scopeA)).toHaveLength(1);
    expect(await store.listModels(scopeB)).toHaveLength(0);
    expect(await store.listAliases(scopeA)).toHaveLength(0);
    expect(await store.listAliases(scopeB)).toHaveLength(1);
    expect(await store.listCombos(scopeA)).toHaveLength(0);
    expect(await store.listCombos(scopeB)).toHaveLength(1);
  });

  it('uses a stable project pricing record id', () => {
    const store = createRuntimeStore(new InMemoryJsonDocStore());
    expect(store.pricingRecordId({ workspaceId: 'ws_default', projectId: 'proj_1' }))
      .toBe('runtime_pricing_ws_default_proj_1');
  });

  it('supports domain-specific finders for models, aliases, and combos', async () => {
    const store = createRuntimeStore(new InMemoryJsonDocStore());
    const scope = { workspaceId: 'ws_default', projectId: 'proj_1' };

    await store.upsertModel({
      id: store.createId('rmc'),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      provider: 'openai',
      model_id: 'gpt-4o',
      capabilities: ['chat'],
      created_at: store.nowIso(),
      updated_at: store.nowIso(),
    });
    await store.upsertAlias({
      id: store.createId('rma'),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      alias: 'assistant-main',
      target_provider: 'openai',
      target_model: 'gpt-4o',
      created_at: store.nowIso(),
      updated_at: store.nowIso(),
    });
    await store.upsertCombo({
      id: store.createId('rmco'),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      name: 'prod-chat',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
      fallback_policy: {
        max_hops: 1,
        retryable_error_classes: ['provider_retryable'],
      },
      created_at: store.nowIso(),
      updated_at: store.nowIso(),
    });

    expect((await store.findModel(scope, 'openai', 'gpt-4o'))?.provider).toBe('openai');
    expect((await store.findAlias(scope, 'assistant-main'))?.target_model).toBe('gpt-4o');
    expect((await store.findCombo(scope, 'prod-chat'))?.fallback_policy.max_hops).toBe(1);
  });
});
