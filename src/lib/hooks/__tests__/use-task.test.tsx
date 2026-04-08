import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/api/errors', () => ({
  handleErrorForToast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  TaskAPI: class MockTaskAPI {
    create = mockCreate;
    update = mockUpdate;
    delete = mockDelete;
  },
}));

import { useCreateTask, useDeleteTask, useUpdateTask } from '../use-task';
import { queryKeys } from '@/lib/query-keys';

describe('task mutation cache invalidation', () => {
  const workspaceId = 'ws_default';
  const projectId = 'proj_001';
  const sortedListKey = queryKeys.tasks.list(workspaceId, projectId, {
    sort_by: 'last_activity_at',
    sort_order: 'desc',
  });

  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    queryClient.setQueryData(sortedListKey, { items: [{ id: 'task-1' }] });
    mockCreate.mockResolvedValue({ id: 'task-new' });
    mockUpdate.mockResolvedValue({ id: 'task-1' });
    mockDelete.mockResolvedValue({ success: true });
  });

  const createWrapper = () => {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    };
  };

  it('marks sorted task list queries stale after create', async () => {
    const { result } = renderHook(() => useCreateTask(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        data: {
          title: 'New task',
          agent_id: 'agent-1',
        },
      });
    });

    expect(queryClient.getQueryCache().find({ queryKey: sortedListKey })?.isStale()).toBe(true);
  });

  it('marks sorted task list queries stale after update', async () => {
    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        taskId: 'task-1',
        data: {
          title: 'Renamed task',
        },
      });
    });

    expect(queryClient.getQueryCache().find({ queryKey: sortedListKey })?.isStale()).toBe(true);
  });

  it('marks sorted task list queries stale after delete', async () => {
    const { result } = renderHook(() => useDeleteTask(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        taskId: 'task-1',
      });
    });

    expect(queryClient.getQueryCache().find({ queryKey: sortedListKey })?.isStale()).toBe(true);
  });
});
