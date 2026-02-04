import type { ApiClient } from '@/lib/api/client';
import { refreshAuth } from '@/lib/api/auth';

describe('refreshAuth', () => {
  it('returns access_token', async () => {
    const mockClient: ApiClient = {
      setToken: () => undefined,
      getToken: () => null,
      clearToken: () => undefined,
      get: async () => ({}),
      post: async () => ({ access_token: 'atk_mock' }),
      put: async () => ({}),
      patch: async () => ({}),
      delete: async () => ({}),
      connectSSE: () => new EventSource('http://localhost'),
    };

    const res = await refreshAuth('rtk_mock', mockClient);
    expect(res.access_token).toBeTruthy();
  });
});
