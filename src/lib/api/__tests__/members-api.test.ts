import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '@/lib/api/client';
import { MemberAPI } from '@/lib/api/endpoints/members';

function createClient(mockGet: ReturnType<typeof vi.fn>): ApiClient {
  return {
    setToken: () => undefined,
    getToken: () => null,
    clearToken: () => undefined,
    get: mockGet,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    connectSSE: () => new EventSource('http://localhost'),
  };
}

describe('MemberAPI', () => {
  it('defaults platform_permissions to empty array when missing', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      resource_permissions: {
        endpoint: ['endpoint:use'],
      },
    });
    const api = new MemberAPI(createClient(mockGet));

    const result = await api.getPermissions('ws_1', 'proj_1', 'u_1');

    expect(result).toEqual({
      platform_permissions: [],
      resource_permissions: {
        endpoint: ['endpoint:use'],
      },
    });
  });

  it('keeps canonical platform_permissions payload unchanged', async () => {
    const mockGet = vi.fn().mockResolvedValue({
      platform_permissions: ['project:read'],
      resource_permissions: {
        endpoint: ['endpoint:use'],
      },
    });
    const api = new MemberAPI(createClient(mockGet));

    const result = await api.getPermissions('ws_1', 'proj_1', 'u_1');

    expect(result).toEqual({
      platform_permissions: ['project:read'],
      resource_permissions: {
        endpoint: ['endpoint:use'],
      },
    });
  });
});
