import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from '@/lib/api/errors';
import type { ContextEntry } from '@/lib/api/types';
import { ContextManager } from '../ContextManager';

const mockList = vi.fn();
const mockPut = vi.fn();
const mockRemove = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

vi.mock('@/lib/api', () => {
  class MockContextAPI {
    list(...args: unknown[]) {
      return mockList(...args);
    }

    put(...args: unknown[]) {
      return mockPut(...args);
    }

    remove(...args: unknown[]) {
      return mockRemove(...args);
    }
  }

  return {
    getApiClient: vi.fn(() => ({})),
    ContextAPI: MockContextAPI,
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function createEntry(overrides: Partial<ContextEntry> = {}): ContextEntry {
  return {
    id: 'ctx_1',
    scope: 'workspace',
    key: 'shared.runbook',
    content: '# Guide',
    content_type: 'markdown',
    workspace_id: 'ws_default',
    project_id: null,
    task_id: null,
    user_id: null,
    read_only: false,
    updated_at: '2026-04-08T00:00:00.000Z',
    updated_by: 'user_001',
    ...overrides,
  };
}

describe('ContextManager', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockPut.mockReset();
    mockRemove.mockReset();
    mockToastSuccess.mockReset();
  });

  it('renders empty state when no entries exist', async () => {
    mockList.mockResolvedValueOnce([]);

    renderWithQueryClient(<ContextManager scope="workspace" workspaceId="ws_default" />);

    expect(await screen.findByTestId('context-store__list-card')).toBeInTheDocument();
    expect(screen.getByText('empty_title')).toBeInTheDocument();
  });

  it('creates a new workspace entry and refreshes the list', async () => {
    const saved = createEntry({
      key: 'shared.new_policy',
      content: 'Keep responses concise.',
      content_type: 'text',
    });
    mockList
      .mockResolvedValueOnce([])
      .mockResolvedValue([saved]);
    mockPut.mockResolvedValueOnce(saved);

    renderWithQueryClient(<ContextManager scope="workspace" workspaceId="ws_default" />);

    await screen.findByTestId('context-store__editor-card');
    fireEvent.change(screen.getByTestId('context-store__key'), { target: { value: 'shared.new_policy' } });
    fireEvent.change(screen.getByTestId('context-store__content'), { target: { value: 'Keep responses concise.' } });
    fireEvent.click(screen.getByTestId('context-store__save'));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(expect.objectContaining({
        scope: 'workspace',
        key: 'shared.new_policy',
        content: 'Keep responses concise.',
        workspace_id: 'ws_default',
      }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('context-store__item--shared.new_policy')).toBeInTheDocument();
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('refreshed_data');
  });

  it('deletes the selected project entry and refreshes the list', async () => {
    const existing = createEntry({
      id: 'ctx_project_1',
      scope: 'project',
      key: 'shared.schema',
      project_id: 'proj_001',
      content: 'orders(id, total)',
      content_type: 'text',
    });
    mockList
      .mockResolvedValueOnce([existing])
      .mockResolvedValue([]);
    mockRemove.mockResolvedValueOnce(undefined);

    renderWithQueryClient(<ContextManager scope="project" workspaceId="ws_default" projectId="proj_001" />);

    await screen.findByTestId('context-store__item--shared.schema');
    fireEvent.click(screen.getByTestId('context-store__delete'));

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith({
        scope: 'project',
        key: 'shared.schema',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
      });
    });
    await waitFor(() => {
      expect(screen.getByText('empty_title')).toBeInTheDocument();
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('refreshed_data');
  });

  it('shows API error text when save fails', async () => {
    mockList.mockResolvedValueOnce([]);
    mockPut.mockRejectedValueOnce(new APIError('FORBIDDEN', 'context_write_forbidden', undefined, 403));

    renderWithQueryClient(<ContextManager scope="workspace" workspaceId="ws_default" />);

    await screen.findByTestId('context-store__editor-card');
    fireEvent.change(screen.getByTestId('context-store__key'), { target: { value: 'shared.locked' } });
    fireEvent.change(screen.getByTestId('context-store__content'), { target: { value: 'Locked.' } });
    fireEvent.click(screen.getByTestId('context-store__save'));

    expect(await screen.findByText('context_write_forbidden')).toBeInTheDocument();
  });

  it('uses the workspace-personal scope without project id', async () => {
    const existing = createEntry({
      id: 'ctx_member_1',
      scope: 'member',
      key: 'personal.review_style',
      content: 'Focus on correctness first.',
      content_type: 'text',
      user_id: 'user_123',
      workspace_id: 'ws_default',
      project_id: null,
    });
    mockList
      .mockResolvedValueOnce([existing])
      .mockResolvedValue([existing]);
    mockPut.mockResolvedValueOnce(existing);
    mockRemove.mockResolvedValueOnce(undefined);

    renderWithQueryClient(
      <ContextManager
        scope="member"
        workspaceId="ws_default"
        surface="workspace"
      />,
    );

    await screen.findByTestId('context-store__item--personal.review_style');

    expect(mockList).toHaveBeenCalledWith({
      scope: 'member',
      workspace_id: 'ws_default',
    });

    fireEvent.click(screen.getByTestId('context-store__save'));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith({
        scope: 'member',
        key: 'personal.review_style',
        content: 'Focus on correctness first.',
        content_type: 'text',
        workspace_id: 'ws_default',
      });
    });

    fireEvent.click(screen.getByTestId('context-store__delete'));

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith({
        scope: 'member',
        key: 'personal.review_style',
        workspace_id: 'ws_default',
      });
    });
  });

  it('uses the project-personal scope with project id for project entries', async () => {
    const existing = createEntry({
      id: 'ctx_project_member_1',
      scope: 'project_member',
      key: 'personal.bindings.tools',
      content: 'uec_project_123',
      content_type: 'text',
      user_id: 'user_123',
      workspace_id: 'ws_default',
      project_id: 'proj_001',
    });
    mockList
      .mockResolvedValueOnce([existing])
      .mockResolvedValue([existing]);
    mockPut.mockResolvedValueOnce(existing);
    mockRemove.mockResolvedValueOnce(undefined);

    renderWithQueryClient(
      <ContextManager
        scope="project_member"
        workspaceId="ws_default"
        projectId="proj_001"
        surface="project"
      />,
    );

    await screen.findByTestId('context-store__item--personal.bindings.tools');

    expect(mockList).toHaveBeenCalledWith({
      scope: 'project_member',
      workspace_id: 'ws_default',
      project_id: 'proj_001',
    });

    fireEvent.click(screen.getByTestId('context-store__save'));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith({
        scope: 'project_member',
        key: 'personal.bindings.tools',
        content: 'uec_project_123',
        content_type: 'text',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
      });
    });

    fireEvent.click(screen.getByTestId('context-store__delete'));

    await waitFor(() => {
      expect(mockRemove).toHaveBeenCalledWith({
        scope: 'project_member',
        key: 'personal.bindings.tools',
        workspace_id: 'ws_default',
        project_id: 'proj_001',
      });
    });
  });
});
