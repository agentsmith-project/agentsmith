import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AppShellSidebar } from '../AppShellSidebar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useParams: () => ({
    workspace: 'ws_default',
    project: 'proj_001',
    locale: 'en-US',
  }),
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

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: () => true,
  useCanManageResourcePolicy: () => true,
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: () => ({
    data: {
      id: 'proj_001',
      name: 'Test Project',
      visibility: 'private',
    },
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
});
