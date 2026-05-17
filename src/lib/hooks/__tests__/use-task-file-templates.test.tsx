import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockListTaskFileTemplates,
  mockCreateTaskFileTemplate,
  mockPublishTaskFileTemplate,
  mockUnpublishTaskFileTemplate,
  mockDeleteTaskFileTemplate,
} = vi.hoisted(() => ({
  mockListTaskFileTemplates: vi.fn().mockResolvedValue({ items: [] }),
  mockCreateTaskFileTemplate: vi.fn().mockResolvedValue({
    id: 'tmpl_new',
    workspace_id: 'ws_test',
    project_id: 'proj_test',
    source_library_id: 'lib_1',
    name: 'Starter',
    status: 'unpublished',
    created_by_user_id: 'user_1',
    created_at: '2026-05-09T12:00:00.000Z',
    updated_at: '2026-05-09T12:00:00.000Z',
  }),
  mockPublishTaskFileTemplate: vi.fn().mockResolvedValue({
    id: 'tmpl_new',
    workspace_id: 'ws_test',
    project_id: 'proj_test',
    source_library_id: 'lib_1',
    name: 'Starter',
    status: 'published',
    created_by_user_id: 'user_1',
    created_at: '2026-05-09T12:00:00.000Z',
    updated_at: '2026-05-09T12:01:00.000Z',
  }),
  mockUnpublishTaskFileTemplate: vi.fn().mockResolvedValue({
    id: 'tmpl_new',
    workspace_id: 'ws_test',
    project_id: 'proj_test',
    source_library_id: 'lib_1',
    name: 'Starter',
    status: 'unpublished',
    created_by_user_id: 'user_1',
    created_at: '2026-05-09T12:00:00.000Z',
    updated_at: '2026-05-09T12:02:00.000Z',
  }),
  mockDeleteTaskFileTemplate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  FilesAPI: vi.fn().mockImplementation(function FilesAPIMock() {
    return {
      listTaskFileTemplates: mockListTaskFileTemplates,
      createTaskFileTemplate: mockCreateTaskFileTemplate,
      publishTaskFileTemplate: mockPublishTaskFileTemplate,
      unpublishTaskFileTemplate: mockUnpublishTaskFileTemplate,
      deleteTaskFileTemplate: mockDeleteTaskFileTemplate,
    };
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/api/errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/errors')>('@/lib/api/errors');
  return {
    ...actual,
    handleErrorForToast: vi.fn(),
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import {
  useCreateTaskFileTemplate,
  useDeleteTaskFileTemplate,
  usePublishTaskFileTemplate,
  useTaskFileTemplates,
  useUnpublishTaskFileTemplate,
} from '../use-task-file-templates';

const workspaceId = 'ws_test';
const projectId = 'proj_test';

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
}

describe('task file template hooks', () => {
  it('lists project task file templates', async () => {
    mockListTaskFileTemplates.mockResolvedValueOnce({
      items: [
        {
          id: 'tmpl_1',
          workspace_id: workspaceId,
          project_id: projectId,
          source_library_id: 'lib_1',
          name: 'Published starter',
          status: 'published',
          created_by_user_id: 'user_1',
          created_at: '2026-05-09T12:00:00.000Z',
          updated_at: '2026-05-09T12:00:00.000Z',
        },
      ],
    });

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(() => useTaskFileTemplates(workspaceId, projectId), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListTaskFileTemplates).toHaveBeenCalledWith(workspaceId, projectId);
    expect(result.current.data?.items[0]).toMatchObject({
      id: 'tmpl_1',
      status: 'published',
    });
  });

  it('creates, publishes, unpublishes, and deletes templates while invalidating the project list', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const templatesKey = ['task-file-templates', workspaceId, projectId];
    queryClient.setQueryData(templatesKey, { items: [] });

    const { result: createResult } = renderHook(() => useCreateTaskFileTemplate(), {
      wrapper: Wrapper,
    });
    const { result: publishResult } = renderHook(() => usePublishTaskFileTemplate(), {
      wrapper: Wrapper,
    });
    const { result: unpublishResult } = renderHook(() => useUnpublishTaskFileTemplate(), {
      wrapper: Wrapper,
    });
    const { result: deleteResult } = renderHook(() => useDeleteTaskFileTemplate(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await createResult.current.mutateAsync({
        workspaceId,
        projectId,
        sourceLibraryId: 'lib_1',
        name: 'Starter',
        description: 'Baseline files',
      });
      await publishResult.current.mutateAsync({
        workspaceId,
        projectId,
        templateId: 'tmpl_new',
      });
      await unpublishResult.current.mutateAsync({
        workspaceId,
        projectId,
        templateId: 'tmpl_new',
      });
      await deleteResult.current.mutateAsync({
        workspaceId,
        projectId,
        templateId: 'tmpl_new',
      });
    });

    expect(mockCreateTaskFileTemplate).toHaveBeenCalledWith(workspaceId, projectId, {
      source_library_id: 'lib_1',
      name: 'Starter',
      description: 'Baseline files',
    }, {
      idempotencyKey: expect.stringMatching(/^task_file_template_/),
    });
    expect(mockPublishTaskFileTemplate).toHaveBeenCalledWith(workspaceId, projectId, 'tmpl_new');
    expect(mockUnpublishTaskFileTemplate).toHaveBeenCalledWith(workspaceId, projectId, 'tmpl_new');
    expect(mockDeleteTaskFileTemplate).toHaveBeenCalledWith(workspaceId, projectId, 'tmpl_new');
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: templatesKey })?.isStale()).toBe(true);
    });
  });
});
