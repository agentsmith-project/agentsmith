/**
 * Unit tests for AppShellSidebar component
 * Tests for the new navigation structure (WP-01)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AppShellSidebar } from '../AppShellSidebar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({
    workspace: 'ws_default',
    project: 'proj_001',
    locale: 'en-US',
  }),
  usePathname: () => '/en-US/workspaces/ws_default/projects/proj_001/overview',
}));

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      nav: {
        overview: 'Overview',
        chat: 'Chat',
        notebook: 'Notebook',
        files: 'Files',
        agents: 'Agents',
        endpoints: 'Endpoints',
        resource_policy: 'Resource Policy',
        credentials: 'Credentials',
        members: 'Members',
        usage: 'Usage',
        audit: 'Audit',
        settings: 'Settings',
        runtime_console: 'Runtime Console',
        runtime: 'Runtime',
        runtime_observability: 'Runtime Observability',
        release_ops: 'Release Ops',
        alerts: 'Alerts',
      },
      sidebar: {
        home: 'Home',
        use: 'Use',
        develop: 'Develop',
        govern: 'Govern',
        operate: 'Operate',
        build: 'Build',
        collapse: 'Collapse',
        expand: 'Expand',
        projects: 'Projects',
      },
    };
    return translations[namespace]?.[key] || key;
  },
}));

// Mock hooks
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

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
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

describe('AppShellSidebar - Navigation Structure (WP-01)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('Navigation sections', () => {
    it('should render 5 navigation sections: home, use, develop, govern, operate', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar).toBeInTheDocument();

      // Check for all 5 sections
      expect(within(sidebar).getByTestId('sidebar__section--home')).toBeInTheDocument();
      expect(within(sidebar).getByTestId('sidebar__section--use')).toBeInTheDocument();
      expect(within(sidebar).getByTestId('sidebar__section--develop')).toBeInTheDocument();
      expect(within(sidebar).getByTestId('sidebar__section--govern')).toBeInTheDocument();
      expect(within(sidebar).getByTestId('sidebar__section--operate')).toBeInTheDocument();
    });

    it('should not render the old "build" section', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      expect(within(sidebar).queryByTestId('sidebar__section--build')).not.toBeInTheDocument();
    });
  });

  describe('Use section items', () => {
    it('should contain Chat, Notebook, and Files in the Use section', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const useSection = within(sidebar).getByTestId('sidebar__section--use');

      expect(within(useSection).getByTestId('sidebar__nav-item--chat')).toBeInTheDocument();
      expect(within(useSection).getByTestId('sidebar__nav-item--notebook')).toBeInTheDocument();
      expect(within(useSection).getByTestId('sidebar__nav-item--files')).toBeInTheDocument();
    });

    it('should not contain Agents in the Use section', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const useSection = within(sidebar).getByTestId('sidebar__section--use');

      expect(within(useSection).queryByTestId('sidebar__nav-item--agents')).not.toBeInTheDocument();
    });
  });

  describe('Develop section items', () => {
    it('should contain Agents in the Develop section', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const developSection = within(sidebar).getByTestId('sidebar__section--develop');

      expect(within(developSection).getByTestId('sidebar__nav-item--agents')).toBeInTheDocument();
    });
  });

  describe('Govern section items', () => {
    it('should contain Endpoints, Resource Policy, Credentials, Members, Usage, Audit, and Settings', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const governSection = within(sidebar).getByTestId('sidebar__section--govern');

      expect(within(governSection).getByTestId('sidebar__nav-item--endpoints')).toBeInTheDocument();
      expect(within(governSection).getByTestId('sidebar__nav-item--resource_policy')).toBeInTheDocument();
      expect(within(governSection).getByTestId('sidebar__nav-item--credentials')).toBeInTheDocument();
      expect(within(governSection).getByTestId('sidebar__nav-item--members')).toBeInTheDocument();
      expect(within(governSection).getByTestId('sidebar__nav-item--usage')).toBeInTheDocument();
      expect(within(governSection).getByTestId('sidebar__nav-item--audit')).toBeInTheDocument();
      expect(within(governSection).getByTestId('sidebar__nav-item--settings')).toBeInTheDocument();
    });

    it('should not contain runtime-related items in the Govern section', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const governSection = within(sidebar).getByTestId('sidebar__section--govern');

      expect(within(governSection).queryByTestId('sidebar__nav-item--runtime')).not.toBeInTheDocument();
      expect(within(governSection).queryByTestId('sidebar__nav-item--runtime_observability')).not.toBeInTheDocument();
      expect(within(governSection).queryByTestId('sidebar__nav-item--release_ops')).not.toBeInTheDocument();
      expect(within(governSection).queryByTestId('sidebar__nav-item--alerts')).not.toBeInTheDocument();
    });
  });

  describe('Operate section items', () => {
    it('should contain only Runtime Console in the Operate section', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const operateSection = within(sidebar).getByTestId('sidebar__section--operate');

      expect(within(operateSection).getByTestId('sidebar__nav-item--runtime_console')).toBeInTheDocument();
    });

    it('should not contain the old runtime pages (runtime-control-plane, runtime-observability, release-ops, alerts)', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const operateSection = within(sidebar).getByTestId('sidebar__section--operate');

      expect(within(operateSection).queryByTestId('sidebar__nav-item--runtime')).not.toBeInTheDocument();
      expect(within(operateSection).queryByTestId('sidebar__nav-item--runtime_observability')).not.toBeInTheDocument();
      expect(within(operateSection).queryByTestId('sidebar__nav-item--release_ops')).not.toBeInTheDocument();
      expect(within(operateSection).queryByTestId('sidebar__nav-item--alerts')).not.toBeInTheDocument();
    });

    it('should not contain Settings in the Operate section', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const operateSection = within(sidebar).getByTestId('sidebar__section--operate');

      expect(within(operateSection).queryByTestId('sidebar__nav-item--settings')).not.toBeInTheDocument();
    });
  });

  describe('Home section items', () => {
    it('should contain Overview in the Home section', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const homeSection = within(sidebar).getByTestId('sidebar__section--home');

      expect(within(homeSection).getByTestId('sidebar__nav-item--overview')).toBeInTheDocument();
    });
  });

  describe('Navigation links', () => {
    it('should have correct href for Runtime Console', () => {
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const runtimeConsoleLink = screen.getByTestId('sidebar__nav-item--runtime_console');
      expect(runtimeConsoleLink).toHaveAttribute('href', expect.stringContaining('/runtime-console'));
    });
  });

  describe('Runtime Console permission logic', () => {
    it('should show Runtime Console when user has settings:manage permission', () => {
      // Mock: user has settings:manage (default in mock setup)
      const wrapper = createWrapper();
      render(<AppShellSidebar />, { wrapper });

      const sidebar = screen.getByTestId('sidebar');
      const operateSection = within(sidebar).getByTestId('sidebar__section--operate');
      expect(within(operateSection).getByTestId('sidebar__nav-item--runtime_console')).toBeInTheDocument();
    });

    // Note: Testing with different permission combinations would require more complex mocking
    // The current mock setup returns true for all permissions, so Runtime Console is shown.
    // In a real scenario with permission mocking, Runtime Console should be shown if user has
    // ANY of: usage:view, alert:view, or settings:manage
  });
});
