import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseWorkspaces = vi.fn();
const mockRefetchWorkspaces = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaces: () => mockUseWorkspaces(),
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
    expect(screen.getByTestId('workspace-overview__summary')).toHaveTextContent('2');
    expect(screen.getByTestId('workspace-overview__search')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__list')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__card--ws_1')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-overview__open-workspace--ws_1')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_1',
    );
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
