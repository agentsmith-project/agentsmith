import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PublicWorkspaceSummary } from '@/lib/api/types';

vi.mock('@/lib/api/client', () => ({
  getApiClient: vi.fn(() => ({
    setToken: vi.fn(),
    clearToken: vi.fn(),
  })),
}));

vi.mock('@/lib/api/endpoints/workspaces', () => {
  class MockWorkspaceAPI {
    listMembers = vi.fn().mockResolvedValue([{ id: 'wm_1' }]);
  }
  return { WorkspaceAPI: MockWorkspaceAPI };
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { token: string | null }) => unknown) => selector({ token: 'test-token' }),
}));

import { usePublicWorkspaces, useWorkspaceMembers, useWorkspaces } from '../use-workspaces';

const mockFetch = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePublicWorkspaces', () => {
  it('exposes public workspace records as a compact contract without timestamp fields', () => {
    type TimestampKeys = Extract<keyof PublicWorkspaceSummary, 'created_at' | 'updated_at'>;

    mockFetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 })));

    const { result } = renderHook(() => usePublicWorkspaces(), {
      wrapper: createWrapper(),
    });
    const { result: legacyResult } = renderHook(() => useWorkspaces({ public: true }), {
      wrapper: createWrapper(),
    });

    expectTypeOf<TimestampKeys>().toEqualTypeOf<never>();
    expectTypeOf(result.current.data).toEqualTypeOf<PublicWorkspaceSummary[] | undefined>();
    expectTypeOf(legacyResult.current.data).toEqualTypeOf<PublicWorkspaceSummary[] | undefined>();
  });

  it('normalizes public directory payloads to id and name only', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [
        {
          id: 'ws_public',
          name: 'Public Workspace',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: 'not-a-date',
        },
      ],
      total: 1,
    }), { status: 200 }));

    const { result } = renderHook(() => usePublicWorkspaces(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'ws_public', name: 'Public Workspace' }]);
    expect(result.current.data?.[0]).not.toHaveProperty('created_at');
    expect(result.current.data?.[0]).not.toHaveProperty('updated_at');
  });
});

describe('useWorkspaceMembers', () => {
  it('returns members list', async () => {
    const { result } = renderHook(() => useWorkspaceMembers('ws_1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'wm_1' }]);
  });
});
