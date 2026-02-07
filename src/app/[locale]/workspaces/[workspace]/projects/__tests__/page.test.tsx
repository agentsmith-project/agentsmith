import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';

const mockProjectsData = [
  {
    id: 'proj_1',
    workspace_id: 'ws_1',
    name: 'Project One',
    visibility: 'private',
    owner_id: 'owner_1',
    role: 'admin',
    permissions: ['project:*'],
    status: 'active' as const,
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
];
const mockWorkspaceData = { id: 'ws_1', name: 'Workspace One' };

const mockUseWorkspace = vi.fn(() => ({ data: mockWorkspaceData }));
const mockUseAuthStore = vi.fn(() => ({ isAuthenticated: true }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
  useProjects: () => ({
    data: mockProjectsData,
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
    mockUseHasWorkspacePermission.mockReturnValue(true);
    mockUseWorkspace.mockImplementation(() => ({ data: mockWorkspaceData }));
    mockUseAuthStore.mockImplementation(() => ({ isAuthenticated: true }));
  });

  it('renders projects list when params and permissions are valid', async () => {
    render(
      <ProjectsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('projects__create-btn')).toBeInTheDocument();
    });
  });

  it('shows invalid parameter error for unsafe workspace param', async () => {
    render(
      <ProjectsPage
        params={Promise.resolve({
          workspace: '<script>',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks project list permissions', async () => {
    mockUseWorkspace.mockImplementation(() => ({ data: undefined }));
    mockUseAuthStore.mockImplementation(() => ({ isAuthenticated: false }));
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => {
      if (permission === 'workspace:read' || permission === 'project:read') {
        return false;
      }
      return true;
    });

    render(
      <ProjectsPage
        params={Promise.resolve({
          workspace: 'ws_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
