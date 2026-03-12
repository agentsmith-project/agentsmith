import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { createModelConfigStore } from './model-config-store.js';

describe('model-config-store', () => {
  it('scopes provider and model records by workspace and project', async () => {
    const store = createModelConfigStore(new InMemoryJsonDocStore());
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

    expect(await store.listProviders(scopeA)).toHaveLength(1);
    expect(await store.listProviders(scopeB)).toHaveLength(0);
    expect(await store.listModels(scopeA)).toHaveLength(1);
    expect(await store.listModels(scopeB)).toHaveLength(0);
  });

  it('uses a stable project pricing record id and resolves project pricing', async () => {
    const store = createModelConfigStore(new InMemoryJsonDocStore());
    const scope = { workspaceId: 'ws_default', projectId: 'proj_1' };
    expect(store.pricingRecordId(scope)).toBe('project_pricing_ws_default_proj_1');

    await store.upsertPricing({
      id: store.pricingRecordId(scope),
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      pricing_map: { openai: { 'gpt-4o': { input: 2, output: 10 } } },
      updated_at: store.nowIso(),
    });

    const resolved = await store.resolvePricing(scope);
    expect(resolved.source).toBe('project');
    expect(resolved.pricing_source_id).toBe('project_pricing_ws_default_proj_1');
  });

  it('supports model finders and catalog metadata', async () => {
    const store = createModelConfigStore(new InMemoryJsonDocStore());
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

    expect((await store.findModel(scope, 'openai', 'gpt-4o'))?.provider).toBe('openai');

    const versionA = {
      id: 'catver_a',
      source: 'seed',
      source_hash: 'hash_a',
      schema_kind: 'models.dev.normalized' as const,
      provider_count: 1,
      model_count: 1,
      status: 'staged' as const,
      created_by: 'system',
      created_at: store.nowIso(),
    };
    const versionB = { ...versionA, id: 'catver_b', source_hash: 'hash_b' };
    await store.upsertCatalogVersion(versionA);
    await store.upsertCatalogVersion(versionB);
    await store.setActiveCatalogVersion(versionB.id);

    const active = await store.getActiveCatalogVersion();
    expect(active?.id).toBe('catver_b');

    const versions = await store.listCatalogVersions();
    const statusMap = new Map(versions.map((item) => [item.id, item.status]));
    expect(statusMap.get('catver_a')).toBe('staged');
    expect(statusMap.get('catver_b')).toBe('active');

    const metadata = await store.getCatalogMetadata();
    expect(metadata?.active_version_id).toBe('catver_b');
  });
});
