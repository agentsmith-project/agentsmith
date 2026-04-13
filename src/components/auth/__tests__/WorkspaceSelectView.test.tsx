import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from '@/lib/api/errors';

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

import { WorkspaceSelectView } from '../WorkspaceSelectView';

describe('WorkspaceSelectView', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockRefetch.mockClear();
    mockClearAuth.mockClear();
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    vi.stubGlobal('sessionStorage', ({
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown) as Storage);
  });

  it('keeps project continuation when selecting a workspace from query params', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('project_id=proj_alpha'));
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: 'ws_1', name: 'Workspace One' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    render(<WorkspaceSelectView />);

    fireEvent.click(screen.getByTestId('workspace-select__item--ws_1'));

    expect(mockPush).toHaveBeenCalledWith('/workspaces/ws_1/login?project_id=proj_alpha');
  });

  it('keeps project continuation when selecting a workspace from invite handoff session state', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
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
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: 'ws_1', name: 'Workspace One' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    render(<WorkspaceSelectView />);

    fireEvent.click(screen.getByRole('button', { name: /workspace one/i }));

    expect(mockPush).toHaveBeenCalledWith('/workspaces/ws_1/login?project_id=proj_alpha');
  });

  it('returns to invite selection with project continuation when relogging', () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('desktop_auth_request_id=req_123&project_id=proj_alpha'));
    mockUseWorkspaces.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new APIError('UNAUTHORIZED', 'Unauthorized', 'req-1', 401),
      refetch: mockRefetch,
    });

    render(<WorkspaceSelectView />);

    fireEvent.click(screen.getByTestId('workspace-select__relogin-btn'));

    expect(mockClearAuth).toHaveBeenCalledTimes(1);
    const [href] = mockReplace.mock.calls[0] as [string];
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/login/workspace');
    expect(url.searchParams.get('project_id')).toBe('proj_alpha');
    expect(url.searchParams.get('desktop_auth_request_id')).toBe('req_123');
  });
});
