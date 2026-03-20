import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  created_at: string;
  updated_at: string;
};

const mockUseParams = vi.fn(() => ({ workspace: 'ws_alpha', locale: 'en-US' }));
const mockUseHasWorkspacePermission = vi.fn(
  (permission: string) =>
    permission === 'workspace:read' ||
    permission === 'workspace:governance:update' ||
    permission === 'workspace:project:create',
);
const mockUseWorkspace = vi.fn<
  () => {
    data: { id: string; name: string } | undefined;
    isFetched: boolean;
  }
>(() => ({
  data: { id: 'ws_alpha', name: 'Alpha Workspace' },
  isFetched: true,
}));
const mockUseProjects = vi.fn<
  () => {
    data: MockProject[];
    isLoading: boolean;
    isError: boolean;
    error: null;
    refetch: ReturnType<typeof vi.fn>;
  }
>(() => ({
  data: [
    {
      id: 'proj_alpha',
      workspace_id: 'ws_alpha',
      name: 'Alpha Project',
      visibility: 'private',
      join_policy: 'approval_required',
      owner_id: 'owner_1',
      permissions: ['project:endpoint:use', 'project:governance:update'],
      status: 'active',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
  ],
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-sync-auth-from-url', () => ({
  useSyncAuthFromUrl: () => undefined,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: (permission: string) => mockUseHasWorkspacePermission(permission),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspace: () => mockUseWorkspace(),
  useWorkspaceMembers: () => ({ data: [] }),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProjects: () => mockUseProjects(),
}));

vi.mock('@/lib/hooks/use-join-requests', () => ({
  useCreateJoinRequest: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/components/app-shell/Topbar', () => ({
  Topbar: () => <div data-testid="topbar" />,
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ isAuthenticated: true }),
  useAuthStoreHydration: () => true,
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

import WorkspacePage from '../page';

describe('WorkspacePage', () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ workspace: 'ws_alpha', locale: 'en-US' });
    mockUseHasWorkspacePermission.mockImplementation(
      (permission: string) =>
        permission === 'workspace:read' ||
        permission === 'workspace:governance:update' ||
        permission === 'workspace:project:create',
    );
    mockUseWorkspace.mockReturnValue({
      data: { id: 'ws_alpha', name: 'Alpha Workspace' },
      isFetched: true,
    });
    mockUseProjects.mockReturnValue({
      data: [
        {
          id: 'proj_alpha',
          workspace_id: 'ws_alpha',
          name: 'Alpha Project',
          visibility: 'private',
          join_policy: 'approval_required',
          owner_id: 'owner_1',
          permissions: ['project:endpoint:use', 'project:governance:update'],
          status: 'active',
          created_at: '2026-02-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('renders the project entry content directly at the workspace root', async () => {
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId('projects__create-btn')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'title' })).toBeInTheDocument();
    expect(screen.getByTestId('projects__table__row')).toBeInTheDocument();
    expect(screen.queryByTestId('projects__back-to-workspace')).not.toBeInTheDocument();
    expect(screen.getByTestId('projects__workspace-settings-btn')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_alpha/settings',
    );
  });

  it('shows permission denied when workspace read is missing', async () => {
    mockUseHasWorkspacePermission.mockReturnValue(false);
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    });
  });

  it('hides the workspace settings shortcut for non-admin workspace users', async () => {
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => permission === 'workspace:read');
    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId('projects__create-btn')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('projects__workspace-settings-btn')).not.toBeInTheDocument();
  });

  it('shows unavailable state when workspace can no longer be loaded', async () => {
    mockUseWorkspace.mockReturnValue({
      data: undefined,
      isFetched: true,
    });

    render(<WorkspacePage />);

    await waitFor(() => {
      expect(screen.getByText('workspace_unavailable_title')).toBeInTheDocument();
    });
    expect(screen.getByText('workspace_unavailable_description')).toBeInTheDocument();
  });
});
