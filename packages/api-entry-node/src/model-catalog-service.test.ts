import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  ensureModelCatalogBootstrap,
  readActiveModelCatalogSnapshot,
  syncModelCatalogFromModelsDev,
  listModelCatalogJobs,
} from './model-catalog-service.js';
import { createModelConfigStore } from './model-config-store.js';

const originalFetch = globalThis.fetch;
const deniedProviderIds = ['github-copilot', 'github-models'];

describe('model-catalog-service', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('syncs models.dev payload into active catalog version with provider/model projections', async () => {
    const docStore = new InMemoryJsonDocStore();
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          openai: {
            id: 'openai',
            name: 'OpenAI',
            api: 'https://api.openai.com/v1',
            env: ['OPENAI_API_KEY'],
            npm: '@ai-sdk/openai',
            doc: 'https://platform.openai.com/docs/models',
            models: {
              'gpt-4o': {
                id: 'gpt-4o',
                name: 'GPT-4o',
                reasoning: true,
                tool_call: true,
                release_date: '2024-05-13',
                last_updated: '2024-05-13',
                modalities: { input: ['text', 'image'], output: ['text'] },
                limit: { context: 128000, output: 16384 },
                cost: { input: 5, output: 15 },
              },
            },
          },
        }),
        { status: 200, headers: { etag: 'W/"etag-1"' } },
      )) as typeof fetch;

    const version = await syncModelCatalogFromModelsDev(docStore, 'user_1');
    expect(version.status).toBe('active');

    const snapshot = await readActiveModelCatalogSnapshot(docStore);
    expect(snapshot.version?.id).toBe(version.id);
    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0]?.provider_key).toBe('openai');
    expect(snapshot.models).toHaveLength(1);
    expect(snapshot.models[0]?.model_id).toBe('gpt-4o');
    expect(snapshot.models[0]?.capabilities).toContain('chat_completion');
    expect(snapshot.models[0]?.capabilities).toContain('reasoning');
  });

  it('filters denied GitHub model providers from remote sync projections and raw document', async () => {
    const docStore = new InMemoryJsonDocStore();
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          openai: {
            id: 'openai',
            name: 'OpenAI',
            models: {
              'gpt-4o': {
                id: 'gpt-4o',
                name: 'GPT-4o',
                modalities: { input: ['text'], output: ['text'] },
              },
            },
          },
          'github-copilot': {
            id: 'github-copilot',
            name: 'GitHub Copilot',
            models: {
              'gpt-4o-copilot': {
                id: 'gpt-4o-copilot',
                name: 'GPT-4o Copilot',
                modalities: { input: ['text'], output: ['text'] },
              },
            },
          },
          'github-models': {
            id: 'github-models',
            name: 'GitHub Models',
            models: {
              'gpt-4o-mini-github': {
                id: 'gpt-4o-mini-github',
                name: 'GPT-4o mini GitHub',
                modalities: { input: ['text'], output: ['text'] },
              },
            },
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    const version = await syncModelCatalogFromModelsDev(docStore, 'user_1');
    const snapshot = await readActiveModelCatalogSnapshot(docStore);
    const store = createModelConfigStore(docStore);
    const rawDocument = await store.getCatalogRawDocument(version.id);
    const rawPayload = (rawDocument as { payload?: Record<string, unknown> } | null)?.payload ?? {};

    expect(snapshot.providers.map((provider) => provider.provider_id)).toEqual(['openai']);
    expect(snapshot.models.map((model) => model.provider_id)).toEqual(['openai']);
    for (const providerId of deniedProviderIds) {
      expect(rawPayload).not.toHaveProperty(providerId);
    }
  });

  it('filters denied GitHub model providers from normalized bootstrap payloads', async () => {
    const docStore = new InMemoryJsonDocStore();
    const originalCwd = process.cwd();
    const tempRoot = await mkdtemp(join(tmpdir(), 'agentsmith-model-catalog-'));

    try {
      const seedRoot = join(tempRoot, 'assets', 'models-catalog');
      await mkdir(seedRoot, { recursive: true });
      await writeFile(
        join(seedRoot, 'catalog.normalized.json'),
        `${JSON.stringify({
          source: 'test',
          provider_count: 3,
          model_count: 3,
          providers: [
            {
              provider_id: 'openai',
              key: 'openai',
              name: 'OpenAI',
              models: [{ model_id: 'gpt-4o', name: 'GPT-4o', capabilities: ['chat_completion'] }],
            },
            {
              provider_id: 'github-copilot',
              key: 'github-copilot',
              name: 'GitHub Copilot',
              models: [{ model_id: 'copilot-model', name: 'Copilot model', capabilities: ['chat_completion'] }],
            },
            {
              provider_id: 'github-models',
              key: 'github-models',
              name: 'GitHub Models',
              models: [{ model_id: 'github-model', name: 'GitHub model', capabilities: ['chat_completion'] }],
            },
          ],
        })}\n`,
        'utf-8',
      );

      process.chdir(tempRoot);
      await ensureModelCatalogBootstrap(docStore);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }

    const snapshot = await readActiveModelCatalogSnapshot(docStore);
    if (!snapshot.version) throw new Error('expected active catalog version');
    const store = createModelConfigStore(docStore);
    const rawDocument = await store.getCatalogRawDocument(snapshot.version.id);
    const rawPayload = (rawDocument as { payload?: Record<string, unknown> } | null)?.payload ?? {};

    expect(snapshot.providers.map((provider) => provider.provider_id)).toEqual(['openai']);
    expect(snapshot.models.map((model) => model.provider_id)).toEqual(['openai']);
    expect(snapshot.version.provider_count).toBe(1);
    expect(snapshot.version.model_count).toBe(1);
    expect(rawPayload.provider_count).toBe(1);
    expect(rawPayload.model_count).toBe(1);
  });

  it('filters denied GitHub model providers from existing active projections', async () => {
    const docStore = new InMemoryJsonDocStore();
    const store = createModelConfigStore(docStore);
    const versionId = 'catver_pre_filter';
    const createdAt = '2026-01-01T00:00:00.000Z';

    await store.upsertCatalogVersion({
      id: versionId,
      source: 'stale_active',
      schema_kind: 'models.dev.raw',
      provider_count: 3,
      model_count: 3,
      status: 'staged',
      created_at: createdAt,
    });
    for (const providerId of ['openai', ...deniedProviderIds]) {
      await store.upsertCatalogProvider({
        id: `${versionId}:${providerId}`,
        version_id: versionId,
        provider_key: providerId,
        provider_id: providerId,
        provider: providerId,
        family: providerId === 'openai' ? 'openai' : 'custom',
        name: providerId,
        model_count: 1,
        default_base_url: 'https://example.test/v1',
        upstream_protocol: 'openai_chat_completions',
      });
      await store.upsertCatalogModel({
        id: `${versionId}:${providerId}:model`,
        version_id: versionId,
        provider_key: providerId,
        provider_id: providerId,
        provider_name: providerId,
        provider: providerId,
        model_id: `${providerId}-model`,
        name: `${providerId} model`,
        capabilities: ['chat_completion'],
      });
    }
    await store.setActiveCatalogVersion(versionId);

    const snapshot = await readActiveModelCatalogSnapshot(docStore);
    const persistedActiveVersion = await store.getActiveCatalogVersion();

    expect(snapshot.providers.map((provider) => provider.provider_id)).toEqual(['openai']);
    expect(snapshot.models.map((model) => model.provider_id)).toEqual(['openai']);
    expect(snapshot.version?.provider_count).toBe(1);
    expect(snapshot.version?.model_count).toBe(1);
    expect(persistedActiveVersion?.provider_count).toBe(3);
    expect(persistedActiveVersion?.model_count).toBe(3);
  });

  it('records catalog sync jobs', async () => {
    const docStore = new InMemoryJsonDocStore();
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          anthropic: {
            id: 'anthropic',
            name: 'Anthropic',
            models: {
              'claude-sonnet': {
                id: 'claude-sonnet',
                name: 'Claude Sonnet',
                modalities: { input: ['text'], output: ['text'] },
              },
            },
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    await syncModelCatalogFromModelsDev(docStore, 'user_2');
    const jobs = await listModelCatalogJobs(docStore);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]?.status).toBe('succeeded');
    expect(jobs[0]?.trigger).toBe('manual');
  });
});
