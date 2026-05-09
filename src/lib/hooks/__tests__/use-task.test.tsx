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
  error: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    const translations: Record<string, string> = {
      'errors.conflict.title': 'Conflict',
      'errors.agent_task_delete_blocked.description':
        'Delete is blocked because this task still has an active run, terminal session, or task workspace in use. Finish those blockers and try again.',
      'errors.agent_task_workspace_binding_conflict.description':
        'That task workspace changed while you were working. Refresh and try again.',
    };
    return translations[fullKey] ?? key;
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/api/errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/errors')>('@/lib/api/errors');
  return {
    ...actual,
    handleErrorForToast: vi.fn(),
  };
});

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
import { APIError, handleErrorForToast } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';

describe('task mutation cache invalidation', () => {
  const workspaceId = 'ws_default';
  const projectId = 'proj_001';
  const sortedListKey = queryKeys.tasks.list(workspaceId, projectId, {
    sort_by: 'last_activity_at',
    sort_order: 'desc',
  });
  const fileLibrariesKey = queryKeys.fileLibraries.list(workspaceId, projectId);

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
    queryClient.setQueryData(fileLibrariesKey, { items: [{ id: 'lib_a' }] });
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
    expect(queryClient.getQueryCache().find({ queryKey: fileLibrariesKey })?.isStale()).toBe(true);
  });

  it('marks task and file library queries stale after update or archive', async () => {
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
    expect(queryClient.getQueryCache().find({ queryKey: fileLibrariesKey })?.isStale()).toBe(true);
  });

  it('marks task and file library queries stale after delete releases a task workspace binding', async () => {
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
    expect(queryClient.getQueryCache().find({ queryKey: fileLibrariesKey })?.isStale()).toBe(true);
  });

  it('shows an i18n toast instead of silently swallowing backend delete blockers', async () => {
    mockDelete.mockRejectedValueOnce(new APIError(
      'AGENT_TASK_DELETE_BLOCKED',
      'agent_task_delete_blocked',
      'req-delete-blocked',
      409,
      { task_id: 'task-1', blockers: ['active_run'] },
    ));

    const { result } = renderHook(() => useDeleteTask(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync({
      workspaceId,
      projectId,
      taskId: 'task-1',
    })).rejects.toBeInstanceOf(APIError);

    expect(queryClient.getQueryCache().find({ queryKey: sortedListKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: fileLibrariesKey })?.isStale()).toBe(true);
    expect(mockToast.error).toHaveBeenCalledWith(
      'Conflict: Delete is blocked because this task still has an active run, terminal session, or task workspace in use. Finish those blockers and try again.',
    );
    expect(handleErrorForToast).not.toHaveBeenCalled();
  });

  it('routes backend delete blockers to the caller when the screen owns inline error copy', async () => {
    mockDelete.mockRejectedValueOnce(new APIError(
      'AGENT_TASK_DELETE_BLOCKED',
      'agent_task_delete_blocked',
      'req-delete-blocked',
      409,
      { task_id: 'task-1', blockers: ['terminal_session'] },
    ));
    const onDeleteBlocked = vi.fn();

    const { result } = renderHook(() => useDeleteTask({ onDeleteBlocked }), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync({
      workspaceId,
      projectId,
      taskId: 'task-1',
    })).rejects.toBeInstanceOf(APIError);

    expect(onDeleteBlocked).toHaveBeenCalledWith(
      'Delete is blocked because this task still has an active run, terminal session, or task workspace in use. Finish those blockers and try again.',
      expect.any(APIError),
    );
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(handleErrorForToast).not.toHaveBeenCalled();
  });

  it('routes workspace binding conflicts through the delete blocked inline path', async () => {
    mockDelete.mockRejectedValueOnce(new APIError(
      'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
      'agent_task_workspace_binding_conflict',
      'req-binding-conflict',
      409,
      { task_id: 'task-1', file_library_id: 'lib_a' },
    ));
    const onDeleteBlocked = vi.fn();

    const { result } = renderHook(() => useDeleteTask({ onDeleteBlocked }), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync({
      workspaceId,
      projectId,
      taskId: 'task-1',
    })).rejects.toBeInstanceOf(APIError);

    expect(queryClient.getQueryCache().find({ queryKey: sortedListKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: fileLibrariesKey })?.isStale()).toBe(true);
    expect(onDeleteBlocked).toHaveBeenCalledWith(
      'That task workspace changed while you were working. Refresh and try again.',
      expect.any(APIError),
    );
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(handleErrorForToast).not.toHaveBeenCalled();
  });

  it('marks task and file library queries stale after binding-related create conflicts', async () => {
    mockCreate.mockRejectedValueOnce(new APIError(
      'AGENT_TASK_FILE_LIBRARY_IN_USE',
      'workspace_file_library_in_use',
      undefined,
      409,
      { file_library_id: 'lib_a', field: 'workspace_file_library_id' },
    ));

    const { result } = renderHook(() => useCreateTask(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync({
      workspaceId,
      projectId,
      data: {
        title: 'Reuse busy workspace',
        workspace_mode: 'use_existing',
        workspace_file_library_id: 'lib_a',
      },
    })).rejects.toBeInstanceOf(APIError);

    expect(queryClient.getQueryCache().find({ queryKey: sortedListKey })?.isStale()).toBe(true);
    expect(queryClient.getQueryCache().find({ queryKey: fileLibrariesKey })?.isStale()).toBe(true);
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
