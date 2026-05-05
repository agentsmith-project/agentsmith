import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AppShellSidebar } from '../AppShellSidebar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseParams = vi.fn<() => { workspace: string; project?: string; locale: string }>(() => ({
  workspace: 'ws_default',
  project: 'proj_001',
  locale: 'en-US',
}));

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  usePathname: () => '/en-US/workspaces/ws_default/projects/proj_001/overview',
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      nav: {
        overview: 'Overview',
        chat: 'Chat',
        agent_tasks: 'Agent Tasks',
        files: 'Files',
        usage: 'Usage',
        api_access_guide: 'Access guide',
        agent_runners: 'Agent Runners',
        endpoints: 'Endpoints',
        resource_policy: 'Policy',
        credentials: 'Project secrets',
        members: 'Members',
        audit: 'Audit',
        settings: 'Settings',
      },
      context_store: {
        project_title: 'Shared context',
      },
      sidebar: {
        home: 'Home',
        workspace_home: 'Workspace',
        use: 'Use',
        develop: 'Develop',
        govern: 'Govern',
        operate: 'Operate',
        collapse: 'Collapse',
        expand: 'Expand',
        projects: 'Projects',
      },
    };
    return translations[namespace]?.[key] || key;
  },
}));

const mockUseHasWorkspacePermission = vi.fn(
  (permission: string) => permission === 'workspace:read' || permission === 'workspace:governance:update',
);
const mockProjectPermissions = vi.fn<() => string[]>(() => [
  'project:endpoint:use',
  'project:agent_task:use',
  'project:agent_runner:manage',
  'project:governance:update',
  'project:membership:update',
  'project:audit:read',
  'project:admins:update',
  'project:lifecycle:update',
]);

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: (permission: string) => mockUseHasWorkspacePermission(permission),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: (_workspaceId: string, projectId: string) => ({
    data: projectId
      ? {
          id: 'proj_001',
          name: 'Test Project',
          visibility: 'private',
          permissions: mockProjectPermissions(),
        }
      : null,
  }),
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function QueryClientWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

describe('AppShellSidebar (simplified MVP navigation)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({
      workspace: 'ws_default',
      project: 'proj_001',
      locale: 'en-US',
    });
    mockProjectPermissions.mockReturnValue([
      'project:endpoint:use',
      'project:agent_task:use',
      'project:agent_runner:manage',
      'project:governance:update',
      'project:membership:update',
      'project:audit:read',
      'project:admins:update',
      'project:lifecycle:update',
    ]);
    mockUseHasWorkspacePermission.mockImplementation(
      (permission: string) => permission === 'workspace:read' || permission === 'workspace:governance:update',
    );
  });

  it('renders core sections without operate section', () => {
    const wrapper = createWrapper();
    render(<AppShellSidebar />, { wrapper });

    const sidebar = screen.getByTestId('sidebar');
    expect(within(sidebar).getByTestId('sidebar__section--home')).toBeInTheDocument();
    expect(within(sidebar).getByTestId('sidebar__section--use')).toBeInTheDocument();
    expect(within(sidebar).getByTestId('sidebar__section--develop')).toBeInTheDocument();
    expect(within(sidebar).getByTestId('sidebar__section--govern')).toBeInTheDocument();
    expect(within(sidebar).queryByTestId('sidebar__section--operate')).not.toBeInTheDocument();
  });

  it('places usage and api access guide under Use section', () => {
    const wrapper = createWrapper();
    render(<AppShellSidebar />, { wrapper });

    const useSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--use');
    expect(within(useSection).getByTestId('sidebar__nav-item--chat')).toBeInTheDocument();
    expect(within(useSection).getByTestId('sidebar__nav-item--agent-tasks')).toBeInTheDocument();
    expect(within(useSection).getByTestId('sidebar__nav-item--files')).toBeInTheDocument();
    expect(within(useSection).getByTestId('sidebar__nav-item--usage')).toBeInTheDocument();
    expect(within(useSection).getByTestId('sidebar__nav-item--use-guide')).toBeInTheDocument();
    expect(within(useSection).getByText('Access guide')).toBeInTheDocument();
  });

  it('does not place usage in Govern section', () => {
    const wrapper = createWrapper();
    render(<AppShellSidebar />, { wrapper });

    const governSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--govern');
    expect(within(governSection).queryByTestId('sidebar__nav-item--usage')).not.toBeInTheDocument();
  });

  it('shows workspace settings only for workspace admins in workspace scope', () => {
    const wrapper = createWrapper();
    mockUseParams.mockReturnValue({
      workspace: 'ws_default',
      locale: 'en-US',
    });
    render(<AppShellSidebar />, { wrapper });

    const sidebar = within(screen.getByTestId('sidebar'));
    expect(sidebar.getByTestId('sidebar__nav-item--workspace_home')).toBeInTheDocument();
    expect(sidebar.getByTestId('sidebar__nav-item--projects')).toBeInTheDocument();
    expect(sidebar.getByTestId('sidebar__nav-item--settings')).toBeInTheDocument();
  });

  it('hides workspace settings for non-admin workspace users', () => {
    const wrapper = createWrapper();
    mockUseParams.mockReturnValue({
      workspace: 'ws_default',
      locale: 'en-US',
    });
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => permission === 'workspace:read');
    render(<AppShellSidebar />, { wrapper });

    const sidebar = within(screen.getByTestId('sidebar'));
    expect(sidebar.getByTestId('sidebar__nav-item--workspace_home')).toBeInTheDocument();
    expect(sidebar.getByTestId('sidebar__nav-item--projects')).toBeInTheDocument();
    expect(sidebar.queryByTestId('sidebar__nav-item--settings')).not.toBeInTheDocument();
  });

  it('shows workspace projects but not workspace settings for project creators', () => {
    const wrapper = createWrapper();
    mockUseParams.mockReturnValue({
      workspace: 'ws_default',
      locale: 'en-US',
    });
    mockUseHasWorkspacePermission.mockImplementation(
      (permission: string) => permission === 'workspace:read' || permission === 'workspace:project:create',
    );
    render(<AppShellSidebar />, { wrapper });

    const sidebar = within(screen.getByTestId('sidebar'));
    expect(sidebar.getByTestId('sidebar__nav-item--workspace_home')).toBeInTheDocument();
    expect(sidebar.getByTestId('sidebar__nav-item--projects')).toBeInTheDocument();
    expect(sidebar.queryByTestId('sidebar__nav-item--settings')).not.toBeInTheDocument();
  });

  it('shows governance project links for project admins', () => {
    const wrapper = createWrapper();
    mockProjectPermissions.mockReturnValue([
      'project:endpoint:use',
      'project:governance:update',
      'project:membership:update',
      'project:audit:read',
      'project:admins:update',
      'project:lifecycle:update',
    ]);

    render(<AppShellSidebar />, { wrapper });

    const governSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--govern');
    expect(within(governSection).getByTestId('sidebar__nav-item--resource-policy')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--context')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--credentials')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--members')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--audit')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--settings')).toBeInTheDocument();
    expect(within(governSection).getByText('Policy')).toBeInTheDocument();
    expect(within(governSection).getByText('Shared context')).toBeInTheDocument();
    expect(within(governSection).getByText('Project secrets')).toBeInTheDocument();
  });

  it('shows agent runner management under Develop when reachable', () => {
    const wrapper = createWrapper();
    render(<AppShellSidebar />, { wrapper });

    const developSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--develop');
    expect(within(developSection).getByTestId('sidebar__nav-item--agent-runners')).toBeInTheDocument();
    expect(within(developSection).getByText('Agent Runners')).toBeInTheDocument();
  });

  it('shows governance links according to the reachable sidebar surfaces', () => {
    const wrapper = createWrapper();
    mockProjectPermissions.mockReturnValue([
      'project:endpoint:use',
      'project:governance:update',
    ]);

    render(<AppShellSidebar />, { wrapper });

    const governSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--govern');
    expect(within(governSection).getByTestId('sidebar__nav-item--resource-policy')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--context')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--credentials')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--settings')).toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--audit')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--members')).not.toBeInTheDocument();
  });

  it('shows members but not settings for membership managers', () => {
    const wrapper = createWrapper();
    mockProjectPermissions.mockReturnValue([
      'project:endpoint:use',
      'project:membership:update',
    ]);

    render(<AppShellSidebar />, { wrapper });

    const governSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--govern');
    expect(within(governSection).getByTestId('sidebar__nav-item--members')).toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--settings')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--audit')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--resource-policy')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--context')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--credentials')).not.toBeInTheDocument();
  });

  it('shows audit but not settings for audit readers', () => {
    const wrapper = createWrapper();
    mockProjectPermissions.mockReturnValue([
      'project:endpoint:use',
      'project:audit:read',
    ]);

    render(<AppShellSidebar />, { wrapper });

    const governSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--govern');
    expect(within(governSection).getByTestId('sidebar__nav-item--audit')).toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--settings')).not.toBeInTheDocument();
  });
});
