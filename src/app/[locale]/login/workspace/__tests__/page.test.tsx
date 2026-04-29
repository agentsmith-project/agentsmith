import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from '@/lib/api/errors';
import { clearInviteHandoff } from '@/lib/auth/invite-handoff';

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefetch = vi.fn();
const mockClearAuth = vi.fn();
const mockUseWorkspaces = vi.fn();
const mockUseSearchParams = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('@/lib/i18n/routing', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
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
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    clearInviteHandoff();
    vi.stubGlobal('sessionStorage', ({
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown) as Storage);
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
    const list = screen.getByRole('list');
    const workspaceLink = within(list).getByRole('link', { name: /workspace one/i });
    expect(workspaceLink).toHaveAttribute('data-testid', 'workspace-select__item--ws_1');
    expect(workspaceLink).toHaveAttribute('href', '/en-US/workspaces/ws_1/login');
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByTestId('workspace-select__card--ws_1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /workspace one/i })).not.toBeInTheDocument();
  });


  it('keeps invited project continuation when the selection page gets the project_id from the query string', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('project_id=proj_alpha'));
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: 'ws_1', name: 'Workspace One' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    render(<WorkspaceSelectPage />);

    expect(screen.getByTestId('workspace-select__item--ws_1')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_1/login?project_id=proj_alpha',
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('preserves invited project continuation when the selection page falls back to invite handoff session state', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: 'ws_1', name: 'Workspace One' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });
    vi.stubGlobal(
      'sessionStorage',
      ({
        getItem: vi.fn((key: string) => (key === 'agentsmith:invite-handoff'
          ? JSON.stringify({ workspaceId: 'ws_1', projectId: 'proj_alpha', storedAt: Date.now() })
          : null)),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      } as unknown) as Storage,
    );

    render(<WorkspaceSelectPage />);

    expect(screen.getByRole('link', { name: /workspace one/i })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_1/login?project_id=proj_alpha',
    );
    expect(mockPush).not.toHaveBeenCalled();
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
    expect(mockReplace).toHaveBeenCalledWith('/login/workspace');
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
