import type { ApiClient } from '@/lib/api/client';
import { refreshAuth } from '@/lib/api/auth';

describe('refreshAuth', () => {
  it('returns access_token', async () => {
    const mockClient: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: async <T>() => ({} as T),
      getBlob: async () => new Blob(),
      postMultipart: async <T>() => ({} as T),
      post: async <T>() => ({ access_token: 'atk_mock' } as T),
      put: async <T>() => ({} as T),
      patch: async <T>() => ({} as T),
      delete: async <T>() => ({} as T),
      connectSSE: () => Promise.resolve(new EventSource('http://localhost')),
    };

    const res = await refreshAuth('rtk_mock', mockClient);
    expect(res.access_token).toBeTruthy();
  });
});
