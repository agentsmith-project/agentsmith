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
        notebook: 'Notebook',
        files: 'Files',
        usage: 'Usage',
        api_access_guide: 'API Access Guide',
        agents: 'Agents',
        endpoints: 'Endpoints',
        resource_policy: 'Resource Policy',
        credentials: 'Credentials',
        members: 'Members',
        audit: 'Audit',
        settings: 'Settings',
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
const mockUseHasPermission = vi.fn((_: string) => true);
const mockUseCanReadProjectSettings = vi.fn(() => true);
const mockUseCanReadAudit = vi.fn(() => true);

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockUseHasPermission(permission),
  useHasWorkspacePermission: (permission: string) => mockUseHasWorkspacePermission(permission),
  useCanReadProjectSettings: () => mockUseCanReadProjectSettings(),
  useCanReadAudit: () => mockUseCanReadAudit(),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: (_workspaceId: string, projectId: string) => ({
    data: projectId
      ? {
          id: 'proj_001',
          name: 'Test Project',
          visibility: 'private',
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
    mockUseHasPermission.mockReturnValue(true);
    mockUseCanReadProjectSettings.mockReturnValue(true);
    mockUseCanReadAudit.mockReturnValue(true);
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
    expect(within(useSection).getByTestId('sidebar__nav-item--notebook')).toBeInTheDocument();
    expect(within(useSection).getByTestId('sidebar__nav-item--files')).toBeInTheDocument();
    expect(within(useSection).getByTestId('sidebar__nav-item--usage')).toBeInTheDocument();
    expect(within(useSection).getByTestId('sidebar__nav-item--api_access_guide')).toBeInTheDocument();
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

  it('shows governance project links for project admins', () => {
    const wrapper = createWrapper();
    mockUseHasPermission.mockImplementation((permission: string) =>
      permission === 'project:endpoint:use'
      || permission === 'project:governance:update'
      || permission === 'project:membership:update'
      || permission === 'project:manage',
    );
    mockUseCanReadProjectSettings.mockReturnValue(true);

    render(<AppShellSidebar />, { wrapper });

    const governSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--govern');
    expect(within(governSection).getByTestId('sidebar__nav-item--resource_policy')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--credentials')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--members')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--audit')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--settings')).toBeInTheDocument();
  });

  it('shows only governance resource links for governance-only users', () => {
    const wrapper = createWrapper();
    mockUseHasPermission.mockImplementation((permission: string) =>
      permission === 'project:endpoint:use' || permission === 'project:governance:update',
    );
    mockUseCanReadProjectSettings.mockReturnValue(false);
    mockUseCanReadAudit.mockReturnValue(false);

    render(<AppShellSidebar />, { wrapper });

    const governSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--govern');
    expect(within(governSection).getByTestId('sidebar__nav-item--resource_policy')).toBeInTheDocument();
    expect(within(governSection).getByTestId('sidebar__nav-item--credentials')).toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--audit')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--members')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--settings')).not.toBeInTheDocument();
  });

  it('shows members for membership managers without owner-only settings', () => {
    const wrapper = createWrapper();
    mockUseHasPermission.mockImplementation((permission: string) =>
      permission === 'project:endpoint:use' || permission === 'project:membership:update',
    );
    mockUseCanReadProjectSettings.mockReturnValue(false);
    mockUseCanReadAudit.mockReturnValue(false);

    render(<AppShellSidebar />, { wrapper });

    const governSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--govern');
    expect(within(governSection).getByTestId('sidebar__nav-item--members')).toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--audit')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--resource_policy')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--credentials')).not.toBeInTheDocument();
    expect(within(governSection).queryByTestId('sidebar__nav-item--settings')).not.toBeInTheDocument();
  });

  it('shows audit only for users with project audit read permission', () => {
    const wrapper = createWrapper();
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:endpoint:use');
    mockUseCanReadProjectSettings.mockReturnValue(false);
    mockUseCanReadAudit.mockReturnValue(true);

    render(<AppShellSidebar />, { wrapper });

    const governSection = within(screen.getByTestId('sidebar')).getByTestId('sidebar__section--govern');
    expect(within(governSection).getByTestId('sidebar__nav-item--audit')).toBeInTheDocument();
  });
});
