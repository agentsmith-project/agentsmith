import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockReject = vi.fn().mockResolvedValue(undefined);
const mockCreate = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  MemberAPI: vi.fn().mockImplementation(function () {
    return {
      createJoinRequest: mockCreate,
      rejectJoinRequest: mockReject,
      approveJoinRequest: vi.fn().mockResolvedValue(undefined),
      listJoinRequests: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/lib/query-keys', () => ({
  queryKeys: {
    joinRequests: {
      list: vi.fn((ws: string, prj: string) => ['join-requests', ws, prj]),
    },
    projects: {
      list: vi.fn((ws: string) => ['projects', ws]),
    },
    members: {
      list: vi.fn((ws: string, prj: string) => ['members', ws, prj]),
    },
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api/errors', () => ({
  handleErrorForToast: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { useCreateJoinRequest, useRejectJoinRequest } from '../use-join-requests';

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

describe('useRejectJoinRequest', () => {
  it('creates join request for the selected project', async () => {
    const { result } = renderHook(() => useCreateJoinRequest('ws_1'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ projectId: 'prj_2', reason: 'Need access' });
    });

    expect(mockCreate).toHaveBeenCalledWith('ws_1', 'prj_2', { reason: 'Need access' });
  });

  it('passes reject reason to API', async () => {
    const { result } = renderHook(() => useRejectJoinRequest('ws_1', 'prj_1'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ requestId: 'jr_1', reason: 'Not in scope' });
    });

    expect(mockReject).toHaveBeenCalledWith('ws_1', 'prj_1', 'jr_1', { reason: 'Not in scope' });
  });
});
