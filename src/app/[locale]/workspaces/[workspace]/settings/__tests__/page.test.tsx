import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';

const STABLE_WORKSPACE = { id: 'ws_1', name: 'Corp Workspace' };
const STABLE_MEMBERS = [
  {
    id: 'wm_1',
    user_id: 'u_1',
    name: 'Dev One',
    email: 'dev1@example.com',
    role: 'developer',
    status: 'active',
    joined_at: '2026-02-01T00:00:00Z',
  },
  {
    id: 'wm_2',
    user_id: 'u_2',
    name: 'Proj Admin',
    email: 'admin@example.com',
    role: 'admin',
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
    governance_json: {
      project_admins: ['u_2'],
    },
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
const mockFetch = vi.fn<typeof fetch>();

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
  useWorkspace: () => ({
    data: STABLE_WORKSPACE,
  }),
  useWorkspaceMembers: () => ({
    data: STABLE_MEMBERS,
  }),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProjects: () => ({
    data: STABLE_PROJECTS,
  }),
}));

vi.mock('@/components/app-shell/Topbar', () => ({
  Topbar: () => <div data-testid="topbar" />,
}));

vi.mock('@/lib/api', () => ({
  getApiClient: () => ({}),
  handleErrorForToast: vi.fn(),
  ProjectAPI: class {
    create = mockProjectCreate;
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
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mockUseParams.mockReturnValue({ workspace: 'ws_1', locale: 'en' });
    mockUseHasWorkspacePermission.mockImplementation(
      (permission: string) => permission === 'workspace:read' || permission === 'workspace:governance:update',
    );
    mockProjectCreate.mockResolvedValue({
      id: 'proj_created',
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ id: 'u_1', user_id: 'u_1', name: 'Dev One', email: 'dev1@example.com' }],
      }),
    } as Response);
    vi.stubGlobal('fetch', mockFetch);
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

  it('loads and saves project creators for workspace admins', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__project-creators-input')).toHaveValue('u_1');
    });

    await user.clear(screen.getByTestId('ws-settings__project-creators-input'));
    await user.type(screen.getByTestId('ws-settings__project-creators-input'), 'u_2{enter}dev3@example.com');
    await user.click(screen.getByTestId('ws-settings__project-creators-save'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/workspaces/ws_1/project-creators', expect.objectContaining({
        method: 'PATCH',
      }));
    });

    const patchCall = mockFetch.mock.calls.find((call) => call[0] === '/api/v1/workspaces/ws_1/project-creators' && (call[1] as RequestInit | undefined)?.method === 'PATCH');
    expect(patchCall).toBeTruthy();
    expect((patchCall?.[1] as RequestInit).body).toBe(JSON.stringify({ project_creators: ['u_2', 'dev3@example.com'] }));
  });
});
