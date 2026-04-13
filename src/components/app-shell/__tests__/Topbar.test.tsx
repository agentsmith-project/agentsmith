import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Topbar } from '../Topbar';

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockUserMenu = vi.fn();
const mockClearLoginContinuationState = vi.fn();
const mockPersistLogoutIntent = vi.fn();
const mockClearAuth = vi.fn();

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
let renderQueryClient: QueryClient;

let canManageWorkspaceGovernance = false;
let mockParams: { locale: string; workspace?: string; project?: string } = {
  locale: 'en-US',
  workspace: 'ws_1',
  project: 'proj_chat',
};
let mockPathname = '/en-US/workspaces/ws_1/projects/proj_chat/overview';

vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
}));

vi.mock('@/lib/i18n/routing', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  usePathname: () => mockPathname,
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
  UserMenu: (props: unknown) => {
    mockUserMenu(props);
    return <div data-testid="user-menu" />;
  },
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector?: (state: { currentUser: { name: string; email: string } | null; clearAuth: () => void }) => unknown) => {
    const state = {
      currentUser: { name: 'Alice', email: 'alice@example.com' },
      clearAuth: mockClearAuth,
    };
    return selector ? selector(state) : state;
  },
  selectCurrentUser: (state: { currentUser: { name: string; email: string } | null }) => state.currentUser,
}));

vi.mock('@/lib/auth/invite-handoff', () => ({
  buildWorkspaceSelectionPath: () => '/login/workspace',
  clearLoginContinuationState: () => mockClearLoginContinuationState(),
  persistLogoutIntent: () => mockPersistLogoutIntent(),
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

function renderTopbar(props?: { workspaceId?: string; projectId?: string }) {
  renderQueryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={renderQueryClient}>
      <Topbar {...props} />
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
    mockParams = {
      locale: 'en-US',
      workspace: 'ws_1',
      project: 'proj_chat',
    };
    mockPathname = '/en-US/workspaces/ws_1/projects/proj_chat/overview';
    mockUserMenu.mockReset();
    mockClearLoginContinuationState.mockReset();
    mockClearAuth.mockReset();
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

    const switcher = screen.getByTestId('topbar__project-switcher');
    fireEvent.pointerDown(switcher, { button: 0 });
    fireEvent.click(switcher);
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

    const switcher = screen.getByTestId('topbar__project-switcher');
    fireEvent.pointerDown(switcher, { button: 0 });
    fireEvent.click(switcher);

    expect(screen.getAllByText('Governance Project').length).toBeGreaterThan(1);
  });

  it('uses a single project trigger instead of split navigation and menu controls', () => {
    renderTopbar();

    expect(screen.getByTestId('topbar__project-switcher')).toBeInTheDocument();
    expect(screen.queryByTestId('topbar__project-switcher-menu')).not.toBeInTheDocument();
  });

  it('routes the logo to the workspace overview on user surfaces without workspace context', () => {
    mockParams = { locale: 'en-US' };
    mockPathname = '/en-US/user/api-keys';
    mockCurrentProject = null;

    renderTopbar();

    fireEvent.click(screen.getByLabelText('go_to_projects'));

    expect(mockPush).toHaveBeenCalledWith('/workspaces/overview');
  });

  it('keeps the topbar shell quiet instead of relying on floating blur', () => {
    renderTopbar();

    const shell = screen.getByTestId('topbar');
    expect(shell.className).not.toMatch(/shadow-|backdrop-blur/);
  });

  it('keeps system logo navigation on system surfaces without workspace context', () => {
    mockParams = { locale: 'en-US' };
    mockPathname = '/en-US/system/workspaces';
    mockCurrentProject = null;

    renderTopbar();

    fireEvent.click(screen.getByLabelText('go_to_projects'));

    expect(mockPush).toHaveBeenCalledWith('/system/workspaces');
  });

  it('routes workspace and project personal context entry actions through the user menu', () => {
    renderTopbar();

    const userMenuProps = mockUserMenu.mock.calls.at(-1)?.[0] as {
      onWorkspacePersonalContext?: () => void;
      onProjectPersonalContext?: () => void;
    };

    expect(userMenuProps?.onWorkspacePersonalContext).toEqual(expect.any(Function));
    expect(userMenuProps?.onProjectPersonalContext).toEqual(expect.any(Function));

    userMenuProps?.onWorkspacePersonalContext?.();
    userMenuProps?.onProjectPersonalContext?.();

    expect(mockPush).toHaveBeenNthCalledWith(1, '/workspaces/ws_1/context');
    expect(mockPush).toHaveBeenNthCalledWith(2, '/workspaces/ws_1/projects/proj_chat/my-context');
  });

  it('prefers explicit workspace and project route ids when route params are not ready', () => {
    mockParams = { locale: 'en-US' };
    mockPathname = '/en-US/workspaces/ws_1/projects/proj_chat/overview';

    renderTopbar({ workspaceId: 'ws_1', projectId: 'proj_chat' });

    const userMenuProps = mockUserMenu.mock.calls.at(-1)?.[0] as {
      onWorkspacePersonalContext?: () => void;
      onProjectPersonalContext?: () => void;
    };

    expect(userMenuProps?.onWorkspacePersonalContext).toEqual(expect.any(Function));
    expect(userMenuProps?.onProjectPersonalContext).toEqual(expect.any(Function));
  });

  it('logout clears query state, tears down auth, and navigates to workspace selection once', () => {
    renderTopbar();

    const cancelSpy = vi.spyOn(renderQueryClient, 'cancelQueries');
    const clearSpy = vi.spyOn(renderQueryClient, 'clear');
    const userMenuProps = mockUserMenu.mock.calls.at(-1)?.[0] as {
      onLogout?: () => void;
    };

    expect(userMenuProps?.onLogout).toEqual(expect.any(Function));
    userMenuProps?.onLogout?.();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(mockPersistLogoutIntent).toHaveBeenCalledTimes(1);
    expect(mockClearLoginContinuationState).toHaveBeenCalledTimes(1);
    expect(mockClearAuth).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/login/workspace');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('expands the switcher with governable projects only when they have a reachable surface', () => {
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
        permissions: [],
      },
    ];
    mockCurrentProject = {
      id: 'proj_govern',
      name: 'Governance Project',
      permissions: ['project:governance:update'],
    };

    renderTopbar();

    const switcher = screen.getByTestId('topbar__project-switcher');
    fireEvent.pointerDown(switcher, { button: 0 });
    fireEvent.click(switcher);

    expect(screen.getByText('Visible Project')).toBeInTheDocument();
    expect(screen.queryByText('Private Governable Project')).not.toBeInTheDocument();
  });
});
