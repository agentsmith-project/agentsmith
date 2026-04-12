import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from '@/lib/api/errors';

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefetch = vi.fn();
const mockClearAuth = vi.fn();
const mockUseWorkspaces = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({ locale: 'en-US' }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaces: () => mockUseWorkspaces(),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ clearAuth: mockClearAuth }),
}));

vi.mock('@/components/theme/PublicThemeToggle', () => ({
  PublicThemeToggle: () => <div data-testid="public-theme-toggle" />,
}));

vi.mock('@/components/app-shell/Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}));

import WorkspaceSelectPage from '../page';

describe('WorkspaceSelectPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockRefetch.mockClear();
    mockClearAuth.mockClear();
  });

  it('renders workspace cards when data is available', () => {
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: 'ws_1', name: 'Workspace One' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    render(<WorkspaceSelectPage />);

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'narrow');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'single');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-family', 'public-auth');
    expect(screen.getByTestId('workspace-select__list')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-select__item--ws_1')).toBeInTheDocument();
    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getByTestId('public-theme-toggle')).toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-select__meta')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-select__item--ws_1'));
    expect(mockPush).toHaveBeenCalledWith('/en-US/workspaces/ws_1/login');
    expect(screen.queryByTestId('workspace-select__card--ws_1')).not.toBeInTheDocument();
  });

  it('keeps the system 管理侧入口 as a low-emphasis footer link', () => {
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: 'ws_1', name: 'Workspace One' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    render(<WorkspaceSelectPage />);
    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'narrow');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'single');
    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-select__system-link')).toHaveAttribute('href', '/en-US/system/login');
  });

  it('shows session-expired state on 401 and can clear auth then redirect', () => {
    mockUseWorkspaces.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new APIError('UNAUTHORIZED', 'Unauthorized', 'req-1', 401),
      refetch: mockRefetch,
    });

    render(<WorkspaceSelectPage />);

    expect(screen.getByTestId('workspace-select__session-expired')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-select__relogin-btn'));
    expect(mockClearAuth).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/en-US/login/workspace');
  });

  it('shows retry state on non-401 errors', () => {
    mockUseWorkspaces.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new APIError('INTERNAL_ERROR', 'Internal error', 'req-2', 500),
      refetch: mockRefetch,
    });

    render(<WorkspaceSelectPage />);

    expect(screen.getByTestId('workspace-select__error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-select__retry-btn'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when user has no accessible workspaces', () => {
    mockUseWorkspaces.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    render(<WorkspaceSelectPage />);

    expect(screen.getByTestId('workspace-select__empty')).toBeInTheDocument();
  });
});
