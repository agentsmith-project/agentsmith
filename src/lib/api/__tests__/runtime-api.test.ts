import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { RuntimeAPI } from '@/lib/api/endpoints/runtime';

function createClient() {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function toApiClient(mock: ReturnType<typeof createClient>): ApiClient {
  return {
    setToken: () => undefined,
    getToken: () => null,
    clearToken: () => undefined,
    get: mock.get,
    post: mock.post,
    put: mock.put,
    patch: mock.patch,
    delete: mock.delete,
    connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
  };
}

describe('RuntimeAPI', () => {
  it('calls model item endpoints', async () => {
    const mock = createClient();
    const api = new RuntimeAPI(toApiClient(mock));

    await api.getModel('ws_1', 'proj_1', 'openai', 'gpt-4o');
    await api.updateModel('ws_1', 'proj_1', 'openai', 'gpt-4o', { display_name: 'GPT-4o Main' });
    await api.deleteModel('ws_1', 'proj_1', 'openai', 'gpt-4o');

    expect(mock.get).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/runtime/providers/openai/models/gpt-4o');
    expect(mock.put).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/runtime/providers/openai/models/gpt-4o', {
      display_name: 'GPT-4o Main',
    });
    expect(mock.delete).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/runtime/providers/openai/models/gpt-4o');
  });

  it('calls alias and combo item endpoints', async () => {
    const mock = createClient();
    const api = new RuntimeAPI(toApiClient(mock));

    await api.getAlias('ws_1', 'proj_1', 'assistant-main');
    await api.updateAlias('ws_1', 'proj_1', 'assistant-main', { target_model: 'gpt-4.1' });
    await api.deleteAlias('ws_1', 'proj_1', 'assistant-main');

    await api.getCombo('ws_1', 'proj_1', 'prod-chat');
    await api.updateCombo('ws_1', 'proj_1', 'prod-chat', {
      fallback_policy: { max_hops: 2, retryable_error_classes: ['provider_retryable'] },
    });
    await api.deleteCombo('ws_1', 'proj_1', 'prod-chat');

    expect(mock.get).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/runtime/routing/aliases/assistant-main');
    expect(mock.put).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/runtime/routing/aliases/assistant-main',
      { target_model: 'gpt-4.1' },
    );
    expect(mock.delete).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/runtime/routing/aliases/assistant-main');

    expect(mock.get).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/runtime/routing/combos/prod-chat');
    expect(mock.put).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/runtime/routing/combos/prod-chat',
      { fallback_policy: { max_hops: 2, retryable_error_classes: ['provider_retryable'] } },
    );
    expect(mock.delete).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/runtime/routing/combos/prod-chat');
  });

  it('calls runtime routing dry-run endpoint', async () => {
    const mock = createClient();
    const api = new RuntimeAPI(toApiClient(mock));

    await api.dryRunRouting('ws_1', 'proj_1', { model: 'combo:prod-chat' });

    expect(mock.post).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/runtime/routing/dry-run', {
      model: 'combo:prod-chat',
    });
  });

  it('probes unified chat and preserves non-2xx runtime payloads', async () => {
    const mock = createClient();
    const api = new RuntimeAPI(toApiClient(mock));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'chatcmpl_1',
        object: 'chat.completion',
        choices: [],
        runtime: { provider: 'openai', resolved_model: 'gpt-4o', fallback_hops: 0 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error_code: 'RUNTIME_PROVIDER_CONNECTION_NOT_FOUND',
        message: 'runtime_provider_connection_not_found',
        runtime: { attempts: [{ index: 0, provider: 'openai', model: 'gpt-4o', outcome: 'provider_connection_missing', reason: 'runtime_provider_connection_not_found' }] },
      }), { status: 502, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    try {
      const success = await api.probeUnifiedChat('ws_1', 'proj_1', {
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const failure = await api.probeUnifiedChat('ws_1', 'proj_1', {
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
      });

      expect(success.ok).toBe(true);
      expect(success.statusCode).toBe(200);
      expect(failure.ok).toBe(false);
      expect(failure.statusCode).toBe(502);
      expect((failure.data as { runtime?: { attempts?: Array<{ outcome?: string }> } }).runtime?.attempts?.[0]?.outcome).toBe('provider_connection_missing');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
