import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiClient } from '@/lib/api';
import {
  useAuthorizationCheck,
  useEffectiveAccessSnapshot,
  useQuotaCheck,
} from '@/lib/hooks/use-governance-explainability';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    getApiClient: vi.fn(),
  };
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('use-governance-explainability', () => {
  it('loads effective access snapshot', async () => {
    const client = {
      get: vi.fn()
        .mockResolvedValueOnce({
          project_id: 'proj_1',
          user_id: 'user_1',
          role: 'developer',
          permissions: [],
          status: 'active',
          joined_at: '2026-03-01T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          platform_permissions: ['project:endpoint:use'],
        })
        .mockResolvedValueOnce({
          overrides: { daily_tokens: 1000 },
        }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      setToken: vi.fn(),
      getToken: vi.fn(),
      clearToken: vi.fn(),
      connectSSE: vi.fn(),
    };
    vi.mocked(getApiClient).mockReturnValue(client);

    const { result } = renderHook(
      () => useEffectiveAccessSnapshot('ws_1', 'proj_1', 'user_1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.effective_permissions).toEqual(['project:endpoint:use']);
  });

  it('runs authorization checks through mutation', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({
        allowed: false,
        decision: { source: 'permission', reason: 'permission_not_granted' },
      }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      setToken: vi.fn(),
      getToken: vi.fn(),
      clearToken: vi.fn(),
      connectSSE: vi.fn(),
    };
    vi.mocked(getApiClient).mockReturnValue(client);

    const { result } = renderHook(
      () => useAuthorizationCheck('ws_1', 'proj_1'),
      { wrapper: createWrapper() },
    );

    result.current.mutate({
      subject: { type: 'user', id: 'user_1' },
      resource: { type: 'endpoint', id: 'ep_1' },
      action: 'invoke',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.post).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/authorize', {
      subject: { type: 'user', id: 'user_1' },
      resource: { type: 'endpoint', id: 'ep_1' },
      action: 'invoke',
    });
  });

  it('runs quota checks through mutation', async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({
        allowed: true,
        quota_remaining: 5,
        quota_limit: 10,
        quota_reset_at: '2026-03-02T00:00:00.000Z',
        policy_id: 'rp_1',
      }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      setToken: vi.fn(),
      getToken: vi.fn(),
      clearToken: vi.fn(),
      connectSSE: vi.fn(),
    };
    vi.mocked(getApiClient).mockReturnValue(client);

    const { result } = renderHook(
      () => useQuotaCheck('ws_1', 'proj_1'),
      { wrapper: createWrapper() },
    );

    result.current.mutate({
      subject_id: 'user_1',
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      operation: 'invoke',
      estimated_cost: 42,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.post).toHaveBeenCalledWith('/workspaces/ws_1/projects/proj_1/quota/check', {
      subject_id: 'user_1',
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      operation: 'invoke',
      estimated_cost: 42,
    });
  });
});
