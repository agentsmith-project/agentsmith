import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import WorkspaceSettingsPage from '../page';

const mockUseHasWorkspacePermission = vi.mocked(useHasWorkspacePermission);

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ workspace: 'ws_1', locale: 'en' });
    mockUseHasWorkspacePermission.mockImplementation(
      (permission: string) => permission === 'workspace:read' || permission === 'workspace:project:create',
    );
  });

  it('renders workspace administration summary', async () => {
    render(<WorkspaceSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__workspace')).toBeInTheDocument();
    });

    expect(screen.getByText('workspace_admin_subtitle')).toBeInTheDocument();
    expect(screen.getByTestId('ws-settings__name')).toHaveTextContent('ws_1');
    expect(screen.getByTestId('ws-settings__open-projects')).toHaveAttribute(
      'href',
      '/en/workspaces/ws_1/projects',
    );
    expect(screen.getByText('workspace_can_create_projects')).toBeInTheDocument();
  });

  it('renders project administration list', async () => {
    render(<WorkspaceSettingsPage />);

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
  });

  it('shows validation_error for invalid workspace param', async () => {
    mockUseParams.mockReturnValue({ workspace: '<script>', locale: 'en' });
    render(<WorkspaceSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('validation_error')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks workspace:read', async () => {
    mockUseHasWorkspacePermission.mockReturnValue(false);
    render(<WorkspaceSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    });
  });

  it('shows create-project restriction notice when user lacks workspace:project:create', async () => {
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => permission === 'workspace:read');
    render(<WorkspaceSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('ws-settings__workspace')).toBeInTheDocument();
    });

    expect(screen.getByText('workspace_cannot_create_projects')).toBeInTheDocument();
  });
});
