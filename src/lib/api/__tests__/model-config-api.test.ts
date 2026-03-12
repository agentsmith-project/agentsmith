import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { ModelConfigAPI } from '@/lib/api/endpoints/model-config';

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

describe('ModelConfigAPI', () => {
  it('calls retained project pricing endpoints', async () => {
    const mock = createClient();
    const api = new ModelConfigAPI(toApiClient(mock));

    await api.getProjectPricing('ws_1', 'proj_1');
    await api.patchProjectPricing('ws_1', 'proj_1', {
      openai: {
        'gpt-4o': { input: 2, output: 10 },
      },
    });

    expect(mock.get).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/project-pricing');
    expect(mock.patch).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/project-pricing', {
      openai: {
        'gpt-4o': { input: 2, output: 10 },
      },
    });
  });

  it('calls retained model catalog endpoints', async () => {
    const mock = createClient();
    const api = new ModelConfigAPI(toApiClient(mock));

    await api.listModelCatalogProviders('ws_1', 'proj_1');
    await api.listModelCatalogModels('ws_1', 'proj_1', { provider: 'openai', capability: 'reasoning', q: 'gpt' });
    await api.syncModelCatalog('ws_1', 'proj_1');

    expect(mock.get).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/model-catalog/providers');
    expect(mock.get).toHaveBeenCalledWith(
      '/workspaces/ws_1/projects/proj_1/model-catalog/models?provider=openai&capability=reasoning&q=gpt',
    );
    expect(mock.post).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/model-catalog/sync', {});
  });
});
