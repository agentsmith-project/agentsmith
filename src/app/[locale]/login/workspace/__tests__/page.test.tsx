import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from '@/lib/api/errors';

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefetch = vi.fn();
const mockClearAuth = vi.fn();
const mockUseWorkspaces = vi.fn();
const mockUseOrganizationGovernanceRollup = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaces: () => mockUseWorkspaces(),
}));

vi.mock('@/lib/hooks/use-organization-governance-rollup', () => ({
  useOrganizationGovernanceRollup: () => mockUseOrganizationGovernanceRollup(),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ clearAuth: mockClearAuth }),
}));

import WorkspaceSelectPage from '../page';

describe('WorkspaceSelectPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockRefetch.mockClear();
    mockClearAuth.mockClear();
    mockUseOrganizationGovernanceRollup.mockReturnValue({
      isLoading: false,
      isError: false,
      rollup: null,
      refetch: vi.fn(),
    });
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

    expect(screen.getByTestId('workspace-select__card--ws_1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-select__card--ws_1'));
    expect(mockPush).toHaveBeenCalledWith('/en-US/workspaces/ws_1/projects');
  });

  it('renders organization governance overview when rollup is available', () => {
    mockUseWorkspaces.mockReturnValue({
      data: [{ id: 'ws_1', name: 'Workspace One' }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });
    mockUseOrganizationGovernanceRollup.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      rollup: {
        summary: {
          readiness: 'warning',
          totalWorkspaces: 1,
          blockedWorkspaces: 0,
          warningWorkspaces: 1,
          riskyWorkspaces: 1,
          totalRiskyProjects: 2,
        },
        workspaceRanking: [
          {
            workspaceId: 'ws_1',
            workspaceName: 'Workspace One',
            readiness: 'warning',
            riskScore: 12,
            blockedItems: 0,
            warningItems: 1,
            riskyProjects: 2,
            totalProjects: 3,
          },
        ],
        attention: [],
      },
    });

    render(<WorkspaceSelectPage />);

    expect(screen.getByTestId('workspace-select__org-governance-overview')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-select__org-governance-rank--ws_1')).toBeInTheDocument();
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
    expect(mockReplace).toHaveBeenCalledWith('/en-US/login');
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
