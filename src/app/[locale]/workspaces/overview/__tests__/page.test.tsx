import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseWorkspaces = vi.fn();
const mockRefetchWorkspaces = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  usePublicWorkspaces: () => mockUseWorkspaces(),
}));

import WorkspacesOverviewPage from '../page';

describe('WorkspacesOverviewPage', () => {
  beforeEach(() => {
    mockRefetchWorkspaces.mockClear();
    mockUseWorkspaces.mockReturnValue({
      data: [
        { id: 'ws_1', name: 'Workspace One', created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-10T00:00:00.000Z' },
        { id: 'ws_2', name: 'Workspace Two', created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-11T00:00:00.000Z' },
      ],
      isLoading: false,
      isError: false,
      refetch: mockRefetchWorkspaces,
    });
  });

  it('renders workspace entry page with search and cards', () => {
    render(<WorkspacesOverviewPage />);

    expect(screen.getByTestId('workspace-overview__heading')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__summary')).toHaveTextContent('2 · overview_summary_label');
    expect(screen.getByText('2 · overview_summary_label')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__search')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__list')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__card--ws_1')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__open-workspace--ws_1')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_1/login',
    );
  });

  it('keeps compact public workspace records from rendering invalid updated dates', () => {
    mockUseWorkspaces.mockReturnValue({
      data: [
        { id: 'ws_public', name: 'Public Workspace' },
      ],
      isLoading: false,
      isError: false,
      refetch: mockRefetchWorkspaces,
    });

    render(<WorkspacesOverviewPage />);

    expect(screen.getByTestId('workspace-overview__summary')).toHaveTextContent('1 · overview_summary_label');
    expect(screen.getByTestId('workspace-overview__card--ws_public')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/overview_updated_at/i)).not.toBeInTheDocument();
  });

  it.each([
    ['invalid timestamp', { id: 'ws_invalid', name: 'Invalid Timestamp Workspace', updated_at: 'not-a-date' }],
    ['empty timestamp', { id: 'ws_empty', name: 'Empty Timestamp Workspace', updated_at: '' }],
    ['missing timestamp', { id: 'ws_missing', name: 'Missing Timestamp Workspace' }],
  ])('does not render corrupt updated-at metadata for public records with %s', (_caseName, workspace) => {
    mockUseWorkspaces.mockReturnValue({
      data: [workspace],
      isLoading: false,
      isError: false,
      refetch: mockRefetchWorkspaces,
    });

    render(<WorkspacesOverviewPage />);

    expect(screen.getByTestId(`workspace-overview__card--${workspace.id}`)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/overview_updated_at/i)).not.toBeInTheDocument();
  });

  it('filters workspace cards by search query', () => {
    render(<WorkspacesOverviewPage />);

    fireEvent.change(screen.getByTestId('workspace-overview__search'), { target: { value: 'two' } });

    expect(screen.queryByTestId('workspace-overview__card--ws_1')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__card--ws_2')).toBeInTheDocument();
  });

  it('shows filtered empty state when no workspace matches', () => {
    render(<WorkspacesOverviewPage />);

    fireEvent.change(screen.getByTestId('workspace-overview__search'), { target: { value: 'missing' } });

    expect(screen.getByTestId('workspace-overview__empty-filtered')).toBeInTheDocument();
  });

  it('lets users clear the search from the filtered empty state', () => {
    render(<WorkspacesOverviewPage />);

    fireEvent.change(screen.getByTestId('workspace-overview__search'), { target: { value: 'missing' } });
    fireEvent.click(screen.getByRole('button', { name: 'overview_clear_search' }));

    expect(screen.getByTestId('workspace-overview__card--ws_1')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__card--ws_2')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockUseWorkspaces.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetchWorkspaces,
    });

    render(<WorkspacesOverviewPage />);

    expect(screen.getByTestId('workspace-overview__loading')).toBeInTheDocument();
  });

  it('shows retry state and triggers refetch', () => {
    mockUseWorkspaces.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetchWorkspaces,
    });

    render(<WorkspacesOverviewPage />);

    expect(screen.getByTestId('workspace-overview__error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-overview__retry'));
    expect(mockRefetchWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no workspace is available', () => {
    mockUseWorkspaces.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetchWorkspaces,
    });

    render(<WorkspacesOverviewPage />);

    expect(screen.getByTestId('workspace-overview__empty')).toBeInTheDocument();
  });
});
