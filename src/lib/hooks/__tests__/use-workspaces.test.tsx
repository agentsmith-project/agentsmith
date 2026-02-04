import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  getApiClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/api/endpoints/workspaces', () => {
  class MockWorkspaceAPI {
    listMembers = vi.fn().mockResolvedValue([{ id: 'wm_1' }]);
  }
  return { WorkspaceAPI: MockWorkspaceAPI };
});

import { useWorkspaceMembers } from '../use-workspaces';

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

describe('useWorkspaceMembers', () => {
  it('returns members list', async () => {
    const { result } = renderHook(() => useWorkspaceMembers('ws_1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'wm_1' }]);
  });
});
