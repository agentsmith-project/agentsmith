import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());
const mockListActivity = vi.hoisted(() => vi.fn());
const mockStartRun = vi.hoisted(() => vi.fn());
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
    listActivity = mockListActivity;
    startRun = mockStartRun;
  },
}));

import { useCreateTask, useDeleteTask, useStartTaskRun, useTaskActivity, useUpdateTask } from '../use-task';
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
    mockListActivity.mockResolvedValue([
      {
        id: 'activity-1',
        task_id: 'task-1',
        kind: 'user_intent',
        actor: 'user',
        content: 'Inspect the report',
        created_at: '2026-03-06T04:00:00.000Z',
      },
    ]);
    mockStartRun.mockResolvedValue({
      id: 'activity-runner-1',
      task_id: 'task-1',
      kind: 'runner_output',
      actor: 'runner',
      content: '',
      created_at: '2026-03-06T04:00:01.000Z',
      run_id: 'run-1',
    });
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
        },
      });
    });

    expect(mockCreate).toHaveBeenCalledWith(workspaceId, projectId, {
      title: 'New task',
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

  it('queries task activity instead of public task messages', async () => {
    const { result } = renderHook(
      () => useTaskActivity(workspaceId, projectId, 'task-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockListActivity).toHaveBeenCalledWith(workspaceId, projectId, 'task-1');
    expect(result.current.data).toEqual([
      expect.objectContaining({
        actor: 'user',
        kind: 'user_intent',
      }),
    ]);
  });

  it('marks activity and task detail stale after starting a run', async () => {
    const activityKey = queryKeys.tasks.activity(workspaceId, projectId, 'task-1');
    const detailKey = queryKeys.tasks.detail(workspaceId, projectId, 'task-1');
    queryClient.setQueryData(activityKey, [{ id: 'activity-1' }]);
    queryClient.setQueryData(detailKey, { id: 'task-1' });

    const { result } = renderHook(() => useStartTaskRun(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        taskId: 'task-1',
        data: {
          intent: 'Summarize the attached report',
          input_refs: [{ kind: 'url', url: 'https://example.com/report' }],
        },
      });
    });

    expect(mockStartRun).toHaveBeenCalledWith(workspaceId, projectId, 'task-1', {
      intent: 'Summarize the attached report',
      input_refs: [{ kind: 'url', url: 'https://example.com/report' }],
    });
    expect(queryClient.getQueryCache().find({ queryKey: activityKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: detailKey })?.isStale()).toBe(true);
  });
});
