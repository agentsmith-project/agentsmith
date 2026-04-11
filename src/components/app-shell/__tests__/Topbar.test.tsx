import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Topbar } from '../Topbar';

const mockPush = vi.fn();
const mockReplace = vi.fn();

let mockProjects = [
  {
    id: 'proj_chat',
    name: 'Chat Project',
    permissions: ['project:endpoint:use'],
  },
];

let mockGovernableProjects = [
  {
    id: 'proj_chat',
    name: 'Chat Project',
    permissions: ['project:endpoint:use'],
  },
];

let mockCurrentProject: { id: string; name: string; permissions: string[] } | null = {
  id: 'proj_chat',
  name: 'Chat Project',
  permissions: ['project:endpoint:use'],
};

let canManageWorkspaceGovernance = false;

vi.mock('next/navigation', () => ({
  useParams: () => ({
    locale: 'en-US',
    workspace: 'ws_1',
    project: 'proj_chat',
  }),
}));

vi.mock('@/lib/i18n/routing', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  usePathname: () => '/en-US/workspaces/ws_1/projects/proj_chat/overview',
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/notifications/NotificationCenter', () => ({
  NotificationCenter: () => <div data-testid="notification-center" />,
}));

vi.mock('../Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock('../UserMenu', () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector?: (state: { currentUser: { name: string; email: string } | null; clearAuth: () => void }) => unknown) => {
    const state = {
      currentUser: { name: 'Alice', email: 'alice@example.com' },
      clearAuth: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
  selectCurrentUser: (state: { currentUser: { name: string; email: string } | null }) => state.currentUser,
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaces: () => ({
    data: [{ id: 'ws_1', name: 'Workspace One' }],
  }),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProjects: () => ({
    data: mockProjects,
  }),
  useGovernableProjects: () => ({
    data: mockGovernableProjects,
  }),
  useProject: () => ({
    data: mockCurrentProject,
  }),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: () => canManageWorkspaceGovernance,
}));

vi.mock('@/lib/hooks/use-project-layout-mode', () => ({
  useProjectLayoutMode: () => ({
    layoutMode: 'standard',
    showLayoutToggle: false,
  }),
  broadcastProjectLayoutMode: vi.fn(),
}));

function renderTopbar() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Topbar />
    </QueryClientProvider>,
  );
}

describe('Topbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManageWorkspaceGovernance = false;
    mockProjects = [
      {
        id: 'proj_chat',
        name: 'Chat Project',
        permissions: ['project:endpoint:use'],
      },
    ];
    mockGovernableProjects = [...mockProjects];
    mockCurrentProject = {
      id: 'proj_chat',
      name: 'Chat Project',
      permissions: ['project:endpoint:use'],
    };
  });

  it('navigates to the first reachable surface instead of assuming overview', () => {
    mockProjects = [
      {
        id: 'proj_members',
        name: 'Members Project',
        permissions: ['project:membership:update'],
      },
    ];
    mockGovernableProjects = mockProjects;
    mockCurrentProject = {
      id: 'proj_chat',
      name: 'Chat Project',
      permissions: ['project:endpoint:use'],
    };

    renderTopbar();

    const menuTrigger = screen.getByTestId('topbar__project-switcher-menu');
    fireEvent.pointerDown(menuTrigger, { button: 0 });
    fireEvent.click(menuTrigger);
    fireEvent.click(screen.getByText('Members Project'));

    expect(mockPush).toHaveBeenCalledWith('/en-US/workspaces/ws_1/projects/proj_members/members');
  });

  it('keeps the current project available in the switcher even when it is not in the discoverable list', () => {
    mockProjects = [];
    mockGovernableProjects = [];
    mockCurrentProject = {
      id: 'proj_govern',
      name: 'Governance Project',
      permissions: ['project:governance:update'],
    };

    renderTopbar();

    const menuTrigger = screen.getByTestId('topbar__project-switcher-menu');
    fireEvent.pointerDown(menuTrigger, { button: 0 });
    fireEvent.click(menuTrigger);

    expect(screen.getAllByText('Governance Project').length).toBeGreaterThan(1);
  });

  it('expands the switcher with governable projects only for governance-only project contexts', () => {
    canManageWorkspaceGovernance = true;
    mockProjects = [
      {
        id: 'proj_visible',
        name: 'Visible Project',
        permissions: ['project:endpoint:use'],
      },
    ];
    mockGovernableProjects = [
      {
        id: 'proj_govern',
        name: 'Governance Project',
        permissions: ['project:governance:update'],
      },
      {
        id: 'proj_private_2',
        name: 'Private Governable Project',
        permissions: ['project:membership:update'],
      },
    ];
    mockCurrentProject = {
      id: 'proj_govern',
      name: 'Governance Project',
      permissions: ['project:governance:update'],
    };

    renderTopbar();

    const menuTrigger = screen.getByTestId('topbar__project-switcher-menu');
    fireEvent.pointerDown(menuTrigger, { button: 0 });
    fireEvent.click(menuTrigger);

    expect(screen.getByText('Visible Project')).toBeInTheDocument();
    expect(screen.getByText('Private Governable Project')).toBeInTheDocument();
  });
});
