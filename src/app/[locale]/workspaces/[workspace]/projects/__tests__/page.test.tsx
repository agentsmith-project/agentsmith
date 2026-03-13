import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { APIError } from '@/lib/api/errors';

let mockProjectsData = [
  {
    id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Project One',
    visibility: 'private',
    owner_id: 'owner_1',
    role: 'admin',
    permissions: ['project:endpoint:use', 'project:governance:update'],
    status: 'active' as const,
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
];
const emptyProjects: typeof mockProjectsData = [];
const mockWorkspaceData = { id: 'ws_1', name: 'Workspace One' };

const mockUseWorkspace = vi.fn<
  () => {
    data: { id: string; name: string } | undefined;
    isFetched: boolean;
  }
>(() => ({ data: mockWorkspaceData, isFetched: true }));
const mockUseAuthStore = vi.fn(() => ({ isAuthenticated: true }));
const mockUseProjects = vi.fn<
  () => {
    data: typeof mockProjectsData;
    isLoading: boolean;
    isError: boolean;
    error: APIError | null;
    refetch: ReturnType<typeof vi.fn>;
  }
>(() => ({
  data: mockProjectsData,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));

const mockPush = vi.fn();
const mockUseParams = vi.fn(() => ({
  workspace: 'ws_1',
  locale: 'en',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => mockUseParams(),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: vi.fn(() => true),
}));

vi.mock('@/components/app-shell/Topbar', () => ({
  Topbar: () => <div data-testid="topbar" />,
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => mockUseAuthStore(),
  useAuthStoreHydration: () => true,
}));

vi.mock('@/lib/hooks/use-sync-auth-from-url', () => ({
  useSyncAuthFromUrl: () => undefined,
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspace: () => mockUseWorkspace(),
  useWorkspaceMembers: () => ({
    data: [
      {
        id: 'wm_1',
        user_id: 'user_1',
        name: 'Test User',
        email: 'test@example.com',
        role: 'admin',
        governance_group: 'wheel',
        status: 'active',
        joined_at: '2026-02-01T00:00:00Z',
      },
    ],
  }),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProjects: () => mockUseProjects(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock('@/components/projects/CreateProjectDialog', () => ({
  CreateProjectDialog: () => null,
}));

vi.mock('@/components/projects/DeleteProjectDialog', () => ({
  DeleteProjectDialog: () => null,
}));

import ProjectsPage from '../page';

const mockUseHasWorkspacePermission = vi.mocked(useHasWorkspacePermission);

describe('ProjectsPage route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectsData = [
      {
        id: 'proj_1',
        workspace_id: 'ws_1',
        name: 'Project One',
        visibility: 'private',
        owner_id: 'owner_1',
        role: 'admin',
        permissions: ['project:endpoint:use', 'project:governance:update'],
        status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];
    mockPush.mockClear();
    mockUseParams.mockReturnValue({ workspace: 'ws_1', locale: 'en' });
    mockUseHasWorkspacePermission.mockReturnValue(true);
    mockUseWorkspace.mockImplementation(() => ({ data: mockWorkspaceData, isFetched: true }));
    mockUseAuthStore.mockImplementation(() => ({ isAuthenticated: true }));
    mockUseProjects.mockImplementation(() => ({
      data: mockProjectsData,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }));
  });

  it('renders projects list when params and permissions are valid', async () => {
    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('projects__create-btn')).toBeInTheDocument();
    });
    expect(screen.getByTestId('projects__back-to-workspace')).toHaveAttribute('href', '/en/workspaces/ws_1');
    expect(screen.getByText('table.project_admin')).toBeInTheDocument();
  });

  it('navigates to overview when clicking a project table row', async () => {
    render(<ProjectsPage />);

    const row = await screen.findByTestId('projects__table__row');
    fireEvent.click(row);

    expect(mockPush).toHaveBeenCalledWith('/en/workspaces/ws_1/projects/proj_1/overview');
  });

  it('hides settings action when project lacks settings manage permission', async () => {
    mockProjectsData = [
      {
        id: 'proj_1',
        workspace_id: 'ws_1',
        name: 'Project One',
        visibility: 'private',
        owner_id: 'owner_1',
        role: 'admin',
        permissions: ['project:endpoint:use'],
        status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];

    render(<ProjectsPage />);
    await screen.findByTestId('projects__table__row');
    expect(screen.queryByTestId('projects__settings-btn')).not.toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe workspace param', async () => {
    mockUseParams.mockReturnValue({ workspace: '<script>', locale: 'en' });
    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks project list permissions', async () => {
    mockUseWorkspace.mockImplementation(() => ({ data: mockWorkspaceData, isFetched: true }));
    mockUseAuthStore.mockImplementation(() => ({ isAuthenticated: false }));
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => {
      if (permission === 'workspace:read') {
        return false;
      }
      return true;
    });

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('shows workspace unavailable state when the workspace is no longer accessible', async () => {
    mockUseWorkspace.mockImplementation(() => ({ data: undefined, isFetched: true }));

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('workspace_unavailable_title')).toBeInTheDocument();
    expect(screen.getByText('workspace_unavailable_description')).toBeInTheDocument();
  });

  it('shows workspace unavailable state when project list lookup returns not found', async () => {
    mockUseProjects.mockImplementation(() => ({
      data: emptyProjects,
      isLoading: false,
      isError: true,
      error: new APIError('RESOURCE_NOT_FOUND', 'workspace_not_found', undefined, 404),
      refetch: vi.fn(),
    }));

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('workspace_unavailable_title')).toBeInTheDocument();
  });

  it('shows a create-first empty state for users with project creation permission', async () => {
    mockProjectsData = [];

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText('empty.title')).toBeInTheDocument();
    });
    expect(screen.getByText('empty.description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'empty.create_first' })).toBeInTheDocument();
  });

  it('shows a read-only empty state for workspace users without project creation permission', async () => {
    mockProjectsData = [];
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => permission === 'workspace:read');

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText('empty.title')).toBeInTheDocument();
    });
    expect(screen.getByText('empty.read_only_description')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'empty.create_first' })).not.toBeInTheDocument();
  });
});
