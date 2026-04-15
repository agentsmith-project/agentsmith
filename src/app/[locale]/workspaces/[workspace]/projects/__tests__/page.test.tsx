import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { APIError } from '@/lib/api/errors';

type MockProject = {
  id: string;
  workspace_id: string;
  name: string;
  visibility: string;
  join_policy?: 'approval_required' | 'open';
  owner_id: string;
  groups?: Array<{ id: string; name: string; permission_template_id?: string; built_in?: boolean; system_key?: string }>;
  permissions: string[];
  admin_member_ids?: string[];
  status: 'active';
  membership_status: 'active' | 'pending' | 'suspended' | 'none';
  created_at: string;
  updated_at: string;
};

let mockProjectsData: MockProject[] = [
  {
    id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Project One',
    visibility: 'private',
    join_policy: 'approval_required' as const,
    owner_id: 'owner_1',
    groups: [{ id: 'grp_project_admins', name: 'Project Admins', permission_template_id: 'tpl_project_admin', built_in: true, system_key: 'admins' }],
    permissions: ['project:endpoint:use', 'project:governance:update'],
    admin_member_ids: ['user_1'],
    status: 'active' as const,
    membership_status: 'active' as const,
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
const mockUseAuthStore = vi.fn<
  () => {
    isAuthenticated: boolean;
    token: string | null;
  }
>(() => ({ isAuthenticated: true, token: 'token-1' }));
const mockUseWorkspaceMembers = vi.fn(() => ({
  data: [
    {
      id: 'wm_1',
      user_id: 'user_1',
      name: 'Test User',
      email: 'test@example.com',
      groups: [{ id: 'grp_workspace_project_creators', name: 'Project Creators', permission_template_id: 'tpl_workspace_project_creator', built_in: true, system_key: 'project_creators' }],
      status: 'active',
      joined_at: '2026-02-01T00:00:00Z',
    },
  ],
  isFetched: true,
}));
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
  refetch: vi.fn(async () => ({ data: mockProjectsData })),
  }));
const mockCreateJoinRequestMutateAsync = vi.fn().mockResolvedValue({ outcome: 'pending' });

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
  useWorkspaceMembers: () => mockUseWorkspaceMembers(),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProjects: () => mockUseProjects(),
}));

vi.mock('@/lib/hooks/use-join-requests', () => ({
  useCreateJoinRequest: () => ({
    mutateAsync: mockCreateJoinRequestMutateAsync,
  }),
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
    window.localStorage.clear();
    mockProjectsData = [
      {
        id: 'proj_1',
        workspace_id: 'ws_1',
        name: 'Project One',
        visibility: 'private',
        join_policy: 'approval_required' as const,
        owner_id: 'owner_1',
        groups: [{ id: 'grp_project_admins', name: 'Project Admins', permission_template_id: 'tpl_project_admin', built_in: true, system_key: 'admins' }],
        permissions: ['project:endpoint:use', 'project:governance:update'],
        admin_member_ids: ['user_1'],
        status: 'active' as const,
        membership_status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];
    mockPush.mockClear();
    mockUseParams.mockReturnValue({ workspace: 'ws_1', locale: 'en' });
    mockCreateJoinRequestMutateAsync.mockReset();
    mockCreateJoinRequestMutateAsync.mockResolvedValue({ outcome: 'pending' });
    mockUseHasWorkspacePermission.mockReturnValue(true);
    mockUseWorkspace.mockImplementation(() => ({ data: mockWorkspaceData, isFetched: true }));
    mockUseAuthStore.mockImplementation(() => ({ isAuthenticated: true, token: 'token-1' }));
    mockUseWorkspaceMembers.mockImplementation(() => ({
      data: [
        {
          id: 'wm_1',
          user_id: 'user_1',
          name: 'Test User',
          email: 'test@example.com',
          groups: [{ id: 'grp_workspace_project_creators', name: 'Project Creators', permission_template_id: 'tpl_workspace_project_creator', built_in: true, system_key: 'project_creators' }],
          status: 'active',
          joined_at: '2026-02-01T00:00:00Z',
        },
      ],
      isFetched: true,
    }));
    mockUseProjects.mockImplementation(() => ({
      data: mockProjectsData,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(async () => ({ data: mockProjectsData })),
    }));
  });

  it('renders projects list when params and permissions are valid', async () => {
    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('projects__create-btn')).toBeInTheDocument();
    });
    expect(screen.getByTestId('projects__back-to-workspace')).toHaveAttribute('href', '/en/workspaces/ws_1');
    expect(screen.getByTestId('projects__table__row')).toBeInTheDocument();
  });

  it('navigates to overview when clicking a project table row', async () => {
    render(<ProjectsPage />);

    const row = await screen.findByTestId('projects__table__row');
    fireEvent.click(row);

    expect(mockPush).toHaveBeenCalledWith('/en/workspaces/ws_1/projects/proj_1/overview');
  });

  it('navigates to the first reachable governance surface when overview is not reachable', async () => {
    mockProjectsData = [
      {
        id: 'proj_members',
        workspace_id: 'ws_1',
        name: 'Project Members Only',
        visibility: 'private',
        join_policy: 'approval_required' as const,
        owner_id: 'owner_1',
        groups: [],
        permissions: ['project:membership:update'],
        admin_member_ids: ['user_1'],
        status: 'active' as const,
        membership_status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];

    render(<ProjectsPage />);

    const row = await screen.findByTestId('projects__table__row');
    fireEvent.click(row);

    expect(mockPush).toHaveBeenCalledWith('/en/workspaces/ws_1/projects/proj_members/members');
  });

  it('keeps pinned projects actionable and lets users unpin them from the entry page', async () => {
    window.localStorage.setItem('mbos:projects:pinned:ws_1', JSON.stringify(['proj_1']));

    render(<ProjectsPage />);

    expect(await screen.findByTestId('projects__pinned-link--proj_1')).toBeInTheDocument();
    expect(screen.getByTestId('projects__pinned-open-btn--proj_1')).toBeInTheDocument();
    expect(screen.getByTestId('projects__pinned-settings-btn--proj_1')).toBeInTheDocument();
    expect(screen.getByTestId('projects__pinned-more-btn--proj_1')).toBeInTheDocument();
    expect(screen.getByTestId('projects__unpin-btn--proj_1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('projects__unpin-btn--proj_1'));

    await waitFor(() => {
      expect(screen.queryByTestId('projects__pinned-link--proj_1')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('projects__table__row')).toBeInTheDocument();
    expect(window.localStorage.getItem('mbos:projects:pinned:ws_1')).toBe('[]');
  });

  it('keeps pinned public projects joinable from the entry page', async () => {
    mockProjectsData = [
      {
        id: 'proj_request',
        workspace_id: 'ws_1',
        name: 'Needs Approval',
        visibility: 'public',
        join_policy: 'approval_required',
        owner_id: 'owner_1',
        permissions: [],
        membership_status: 'none' as const,
        status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];
    window.localStorage.setItem('mbos:projects:pinned:ws_1', JSON.stringify(['proj_request']));

    render(<ProjectsPage />);

    const requestButton = await screen.findByTestId('projects__join-request-btn--proj_request');
    expect(requestButton).toHaveTextContent('join_request.action');

    fireEvent.click(requestButton);

    await waitFor(() => {
      expect(mockCreateJoinRequestMutateAsync).toHaveBeenCalledWith({ projectId: 'proj_request' });
    });
  });

  it('falls back to the project overview when a project has no reachable default surface', async () => {
    mockProjectsData = [
      {
        id: 'proj_unreachable',
        workspace_id: 'ws_1',
        name: 'Project Without Surface',
        visibility: 'private',
        join_policy: 'approval_required' as const,
        owner_id: 'owner_1',
        groups: [],
        permissions: [],
        admin_member_ids: ['user_1'],
        status: 'active' as const,
        membership_status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];
    window.localStorage.setItem('mbos:projects:pinned:ws_1', JSON.stringify(['proj_unreachable']));

    render(<ProjectsPage />);

    await screen.findByTestId('projects__pinned-link--proj_unreachable');
    fireEvent.click(screen.getByTestId('projects__pinned-open-btn--proj_unreachable'));

    expect(mockPush).toHaveBeenCalledWith('/en/workspaces/ws_1/projects/proj_unreachable/overview');
  });

  it('hides settings action when project lacks settings manage permission', async () => {
    mockProjectsData = [
      {
        id: 'proj_1',
        workspace_id: 'ws_1',
        name: 'Project One',
        visibility: 'private',
        join_policy: 'approval_required' as const,
        owner_id: 'owner_1',
        groups: [{ id: 'grp_project_admins', name: 'Project Admins', permission_template_id: 'tpl_project_admin', built_in: true, system_key: 'admins' }],
        permissions: ['project:endpoint:use'],
        admin_member_ids: ['user_1'],
        status: 'active' as const,
        membership_status: 'active' as const,
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
    mockUseAuthStore.mockImplementation(() => ({ isAuthenticated: false, token: null }));
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
    expect(screen.getAllByText('empty.description').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'empty.create_first' })).toBeInTheDocument();
  });

  it('shows a read-only empty state for workspace users without project creation permission', async () => {
    mockProjectsData = [];
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => permission === 'workspace:read');

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText('empty.title')).toBeInTheDocument();
    });
    expect(screen.getAllByText('empty.read_only_description').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'empty.create_first' })).not.toBeInTheDocument();
  });

  it('shows request access action for public approval-required projects without membership', async () => {
    mockProjectsData = [
      {
        id: 'proj_request',
        workspace_id: 'ws_1',
        name: 'Needs Approval',
        visibility: 'public',
        join_policy: 'approval_required',
        owner_id: 'owner_1',
        permissions: [],
        membership_status: 'none' as const,
        status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];

    render(<ProjectsPage />);

    const requestButton = await screen.findByTestId('projects__join-request-btn--proj_request');
    expect(requestButton).toHaveTextContent('join_request.action');

    fireEvent.click(requestButton);

    await waitFor(() => {
      expect(mockCreateJoinRequestMutateAsync).toHaveBeenCalledWith({ projectId: 'proj_request' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('projects__join-request-btn--proj_request')).toHaveTextContent('join_request.pending');
    });
  });

  it('asks before sending a join request when opening a public approval-required project', async () => {
    mockProjectsData = [
      {
        id: 'proj_request',
        workspace_id: 'ws_1',
        name: 'Needs Approval',
        visibility: 'public',
        join_policy: 'approval_required',
        owner_id: 'owner_1',
        permissions: [],
        membership_status: 'none' as const,
        status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];

    render(<ProjectsPage />);

    const row = await screen.findByTestId('projects__table__row');
    fireEvent.click(row);

    expect(await screen.findByText('join_request.confirm_title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'join_request.action' }));

    await waitFor(() => {
      expect(mockCreateJoinRequestMutateAsync).toHaveBeenCalledWith({ projectId: 'proj_request' });
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('lets users directly join public open projects and then navigates in', async () => {
    mockCreateJoinRequestMutateAsync.mockResolvedValue({ outcome: 'joined' });
    mockProjectsData = [
      {
        id: 'proj_open',
        workspace_id: 'ws_1',
        name: 'Open Project',
        visibility: 'public',
        join_policy: 'open',
        owner_id: 'owner_1',
        permissions: [],
        membership_status: 'none' as const,
        status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];
    mockUseProjects.mockImplementation(() => ({
      data: mockProjectsData,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(async () => ({
        data: [
          {
            ...mockProjectsData[0],
            permissions: ['project:endpoint:use'],
            membership_status: 'active' as const,
          },
        ],
      })),
    }));

    render(<ProjectsPage />);

    const row = await screen.findByTestId('projects__table__row');
    fireEvent.click(row);

    expect(await screen.findByText('join_request.join_now_title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'join_request.join_now' }));

    await waitFor(() => {
      expect(mockCreateJoinRequestMutateAsync).toHaveBeenCalledWith({ projectId: 'proj_open' });
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/en/workspaces/ws_1/projects/proj_open/overview');
    });
  });

  it('shows pending join state for public approval-required projects with pending membership', async () => {
    mockProjectsData = [
      {
        id: 'proj_pending',
        workspace_id: 'ws_1',
        name: 'Pending Access',
        visibility: 'public',
        join_policy: 'approval_required',
        owner_id: 'owner_1',
        permissions: [],
        membership_status: 'pending',
        status: 'active' as const,
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
      },
    ];

    render(<ProjectsPage />);

    const pendingButton = await screen.findByTestId('projects__join-request-btn--proj_pending');
    expect(pendingButton).toHaveTextContent('join_request.pending');
    expect(pendingButton).toBeDisabled();

    const row = await screen.findByTestId('projects__table__row');
    fireEvent.click(row);

    expect(await screen.findByText('join_request.confirm_title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'join_request.pending' })).toBeDisabled();
    expect(mockCreateJoinRequestMutateAsync).not.toHaveBeenCalled();
  });

  it('does not spin when logout temporarily clears project data on the projects entry page', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let currentProjects: MockProject[] | undefined = mockProjectsData;
    const freshEmptyProjects = () => [] as MockProject[];
    mockUseProjects.mockImplementation(() => ({
      data: currentProjects ?? freshEmptyProjects(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(async () => ({ data: currentProjects ?? freshEmptyProjects() })),
    }));

    try {
      const { rerender } = render(<ProjectsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('projects__create-btn')).toBeInTheDocument();
      });

      mockUseAuthStore.mockImplementation(() => ({ isAuthenticated: false, token: null }));
      currentProjects = undefined;

      rerender(<ProjectsPage />);

      await waitFor(() => {
        expect(screen.getByTestId('projects__page')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('page-state__error')).not.toBeInTheDocument();
      expect(mockUseProjects.mock.calls.length).toBeLessThan(20);
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Maximum update depth exceeded'));
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });


  it('keeps loading while authenticated workspace membership is still resolving', async () => {
    mockUseHasWorkspacePermission.mockReturnValue(false);
    mockUseWorkspaceMembers.mockImplementation(() => ({
      data: [],
      isFetched: false,
    }));

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('page-state__loading')).toBeInTheDocument();
    });
    expect(screen.queryByText('permission_denied_title')).not.toBeInTheDocument();
  });
});
