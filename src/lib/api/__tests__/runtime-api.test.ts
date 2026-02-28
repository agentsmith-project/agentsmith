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
});
