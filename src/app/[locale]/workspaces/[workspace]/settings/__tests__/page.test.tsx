import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { APIError } from '@/lib/api/errors';

const STABLE_WORKSPACE = { id: 'ws_1', name: 'Corp Workspace' };
const STABLE_MEMBERS = [
  {
    id: 'wm_1',
    user_id: 'u_1',
    name: 'Dev One',
    email: 'dev1@example.com',
    groups: [{ id: 'grp_workspace_members', name: 'Workspace Members', permission_template_id: 'tpl_workspace_member', built_in: true, system_key: 'members' }],
    status: 'active',
    joined_at: '2026-02-01T00:00:00Z',
  },
  {
    id: 'wm_2',
    user_id: 'u_2',
    name: 'Proj Admin',
    email: 'admin@example.com',
    groups: [{ id: 'grp_workspace_project_creators', name: 'Project Creators', permission_template_id: 'tpl_workspace_project_creator', built_in: true, system_key: 'project_creators' }],
    status: 'active',
    joined_at: '2026-02-01T00:00:00Z',
  },
];
const STABLE_PROJECTS = [
  {
    id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Open Project',
    owner_id: 'u_1',
    visibility: 'public',
    join_policy: 'open',
    status: 'active',
    admin_member_ids: ['u_2'],
    governance_json: {},
    execution_preferences_json: {},
    limits_json: {},
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
  {
    id: 'proj_2',
    workspace_id: 'ws_1',
    name: 'Archived Project',
    owner_id: 'u_2',
    visibility: 'private',
    join_policy: 'approval_required',
    status: 'archived',
    governance_json: {},
    execution_preferences_json: {},
    limits_json: {},
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  },
];

const mockUseParams = vi.fn(() => ({ workspace: 'ws_1', locale: 'en' }));
const mockProjectCreate = vi.fn();
const mockProjectUpdate = vi.fn();
const mockListProjectCreators = vi.fn();
const mockUpdateProjectCreators = vi.fn();
const mockSearchDirectoryUsers = vi.fn();
const mockUseWorkspace = vi.fn<
  () => {
    data: { id: string; name: string } | undefined;
    isFetched: boolean;
  }
>(() => ({
  data: STABLE_WORKSPACE,
  isFetched: true,
}));
const mockUseProjects = vi.fn<
  () => {
    data: typeof STABLE_PROJECTS;
    isError: boolean;
    error: APIError | null;
  }
>(() => ({
  data: STABLE_PROJECTS,
  isError: false,
  error: null,
}));

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

vi.mock('@/lib/hooks/use-sync-auth-from-url', () => ({
  useSyncAuthFromUrl: () => undefined,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: vi.fn((permission: string) => permission === 'workspace:read' || permission === 'workspace:project:create'),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspace: () => mockUseWorkspace(),
  useWorkspaceMembers: () => ({
    data: STABLE_MEMBERS,
  }),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProjects: () => mockUseProjects(),
}));

vi.mock('@/components/app-shell/Topbar', () => ({
  Topbar: () => <div data-testid="topbar" />,
}));

vi.mock('@/lib/api', () => ({
  getApiClient: () => ({}),
  handleErrorForToast: vi.fn(),
  ProjectAPI: class {
    create = mockProjectCreate;
    update = mockProjectUpdate;
  },
  WorkspaceAPI: class {
    listProjectCreators = mockListProjectCreators;
    updateProjectCreators = mockUpdateProjectCreators;
    searchDirectoryUsers = mockSearchDirectoryUsers;
  },
}));

import WorkspaceSettingsPage from '../page';

const mockUseHasWorkspacePermission = vi.mocked(useHasWorkspacePermission);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSettingsPage />
    </QueryClientProvider>,
  );
}

describe('WorkspaceSettingsPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    mockUseParams.mockReturnValue({ workspace: 'ws_1', locale: 'en' });
    mockUseHasWorkspacePermission.mockImplementation(
      (permission: string) => permission === 'workspace:read' || permission === 'workspace:governance:update',
    );
    mockProjectCreate.mockResolvedValue({
      id: 'proj_created',
    });
    mockProjectUpdate.mockResolvedValue(undefined);
    mockListProjectCreators.mockResolvedValue([{ id: 'u_1', user_id: 'u_1', name: 'Dev One', email: 'dev1@example.com' }]);
    mockUpdateProjectCreators.mockResolvedValue([
      { id: 'u_2', user_id: 'u_2', name: 'Proj Admin', email: 'admin@example.com' },
      { id: 'u_3', user_id: 'u_3', name: 'Dev Three', email: 'dev3@example.com' },
    ]);
    mockSearchDirectoryUsers.mockImplementation(async (_workspaceId: string, query: string) => {
      if (query.includes('admin')) {
        return [{ user_id: 'u_2', email: 'admin@example.com', name: 'Proj Admin' }];
      }
      if (query.includes('dev3')) {
        return [{ user_id: 'u_3', email: 'dev3@example.com', name: 'Dev Three' }];
      }
      return [];
    });
    mockUseWorkspace.mockReturnValue({
      data: STABLE_WORKSPACE,
      isFetched: true,
    });
    mockUseProjects.mockReturnValue({
      data: STABLE_PROJECTS,
      isError: false,
      error: null,
    });
  });

  it('renders workspace administration summary', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__workspace')).toBeInTheDocument();
    });

    expect(screen.queryByText('workspace_admin_subtitle')).not.toBeInTheDocument();
    expect(screen.getByTestId('ws-settings__name')).toHaveTextContent('ws_1');
    expect(screen.getByTestId('ws-settings__open-projects')).toHaveAttribute(
      'href',
      '/en/workspaces/ws_1/projects',
    );
    expect(screen.getByTestId('ws-settings__open-feishu')).toHaveAttribute(
      'href',
      '/en/workspaces/ws_1/settings/feishu',
    );
    expect(screen.queryByText('workspace_can_create_projects')).not.toBeInTheDocument();
  });

  it('renders project administration list', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__projects')).toBeInTheDocument();
    });

    const projectCard = screen.getByTestId('ws-settings__project--proj_1');
    expect(within(projectCard).getByText('workspace_open_project')).toBeInTheDocument();
    expect(within(projectCard).getByText('Proj Admin, Dev One')).toBeInTheDocument();
    expect(screen.getByTestId('ws-settings__project-open-overview--proj_1')).toHaveAttribute(
      'href',
      '/en/workspaces/ws_1/projects/proj_1/overview',
    );
    expect(screen.getByTestId('ws-settings__project-open-members--proj_1')).toHaveAttribute(
      'href',
      '/en/workspaces/ws_1/projects/proj_1/members',
    );
    expect(screen.getByTestId('ws-settings__project-open-settings--proj_1')).toHaveAttribute(
      'href',
      '/en/workspaces/ws_1/projects/proj_1/settings',
    );
    expect(screen.getByTestId('ws-settings__create-project')).toBeInTheDocument();
    expect(screen.getByTestId('ws-settings__project-creators')).toBeInTheDocument();
    expect(screen.getByTestId('ws-settings__project-owner-select--proj_1')).toBeInTheDocument();
  });

  it('opens create project dialog and creates a project', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__create-project')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('ws-settings__create-project'));
    await user.type(screen.getByLabelText('name'), 'New Admin Project');
    await user.click(screen.getByRole('button', { name: 'create' }));

    await waitFor(() => {
      expect(mockProjectCreate).toHaveBeenCalledWith('ws_1', {
        workspace_id: 'ws_1',
        name: 'New Admin Project',
        description: undefined,
        visibility: 'private',
        join_policy: 'approval_required',
      });
    });
  });

  it('shows validation_error for invalid workspace param', async () => {
    mockUseParams.mockReturnValue({ workspace: '<script>', locale: 'en' });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('validation_error')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks workspace:read', async () => {
    mockUseHasWorkspacePermission.mockReturnValue(false);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks workspace:governance:update', async () => {
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => permission === 'workspace:read');
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    });
  });

  it('shows workspace unavailable state when workspace can no longer be loaded', async () => {
    mockUseWorkspace.mockReturnValue({
      data: undefined,
      isFetched: true,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('workspace_unavailable_title')).toBeInTheDocument();
    });
    expect(screen.getByText('workspace_unavailable_description')).toBeInTheDocument();
  });

  it('shows workspace unavailable state when project lookup returns not found', async () => {
    mockUseProjects.mockReturnValue({
      data: [],
      isError: true,
      error: new APIError('RESOURCE_NOT_FOUND', 'workspace_not_found', undefined, 404),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('workspace_unavailable_title')).toBeInTheDocument();
    });
  });

  it('loads and saves project creators for workspace admins', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__project-creators-selected')).toHaveTextContent('Dev One');
    });

    await user.type(screen.getByTestId('ws-settings__project-creators-input'), 'admin');
    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__project-creator-option--u_2')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('ws-settings__project-creator-option--u_2'));

    await user.type(screen.getByTestId('ws-settings__project-creators-input'), 'dev3');
    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__project-creator-option--u_3')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('ws-settings__project-creator-option--u_3'));
    await user.click(screen.getByTestId('ws-settings__project-creator-remove--u_1'));
    await user.click(screen.getByTestId('ws-settings__project-creators-save'));

    await waitFor(() => {
      expect(mockUpdateProjectCreators).toHaveBeenCalledWith('ws_1', ['u_2', 'u_3']);
    });
  });

  it('shows a repair warning when project creators still look like historical bindings', async () => {
    mockListProjectCreators.mockResolvedValue([
      { id: 'legacy@example.com', user_id: 'legacy@example.com', name: 'legacy@example.com', email: 'legacy@example.com' },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__project-creators-binding-warning')).toBeInTheDocument();
    });
    expect(screen.getByTestId('ws-settings__project-creators-binding-warning')).toHaveTextContent(
      'workspace_project_creators_binding_warning_title',
    );
  });

  it('lets workspace admins transfer project ownership', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__project-owner-select--proj_1')).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByTestId('ws-settings__project-owner-select--proj_1'), 'u_2');
    await user.click(screen.getByTestId('ws-settings__project-owner-save--proj_1'));

    await waitFor(() => {
      expect(mockProjectUpdate).toHaveBeenCalledWith('ws_1', 'proj_1', { owner_id: 'u_2' });
    });
  });
});
