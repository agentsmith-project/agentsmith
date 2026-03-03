import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  readActiveCatalogSnapshot,
  syncRuntimeCatalogFromModelsDev,
  listRuntimeCatalogJobs,
} from './runtime-catalog-service.js';

const originalFetch = globalThis.fetch;

describe('runtime-catalog-service', () => {
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

    const version = await syncRuntimeCatalogFromModelsDev(docStore, 'user_1');
    expect(version.status).toBe('active');

    const snapshot = await readActiveCatalogSnapshot(docStore);
    expect(snapshot.version?.id).toBe(version.id);
    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0]?.provider_key).toBe('openai');
    expect(snapshot.models).toHaveLength(1);
    expect(snapshot.models[0]?.model_id).toBe('gpt-4o');
    expect(snapshot.models[0]?.capabilities).toContain('chat_completion');
    expect(snapshot.models[0]?.capabilities).toContain('reasoning');
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

    await syncRuntimeCatalogFromModelsDev(docStore, 'user_2');
    const jobs = await listRuntimeCatalogJobs(docStore);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]?.status).toBe('succeeded');
    expect(jobs[0]?.trigger).toBe('manual');
  });
});
