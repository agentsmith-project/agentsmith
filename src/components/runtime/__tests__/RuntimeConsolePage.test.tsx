/**
 * Runtime Console Page Component - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeConsolePage } from '../RuntimeConsolePage';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock next/navigation
let mockSearchParams = new URLSearchParams();
const mockRouterReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockRouterReplace, push: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en-US/workspaces/ws1/projects/proj1/runtime-console',
}));

// Mock use-permissions hook
const mockPermissions: Record<string, boolean> = {
  'project:usage:view': true,
  'project:alert:view': true,
  'project:settings:manage': true,
};

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockPermissions[permission] ?? false,
}));

// Mock child components
vi.mock('../RuntimeObservabilityConsole', () => ({
  RuntimeObservabilityConsole: ({ workspaceId, projectId }: any) => (
    <div data-testid="runtime-observability-console" data-workspace-id={workspaceId} data-project-id={projectId}>
      Runtime Observability Console
    </div>
  ),
}));

vi.mock('@/components/alerts/AlertCenterPage', () => ({
  AlertCenterPage: ({ workspaceId, projectId }: any) => (
    <div data-testid="alert-center-page" data-workspace-id={workspaceId} data-project-id={projectId}>
      Alert Center Page
    </div>
  ),
}));

vi.mock('@/components/runtime/ReleaseOpsDashboard', () => ({
  ReleaseOpsDashboard: () => <div data-testid="release-ops-dashboard">Release Ops Dashboard</div>,
}));

vi.mock('@/components/settings/RuntimeControlPlanePanel', () => ({
  RuntimeControlPlanePanel: () => <div data-testid="runtime-control-plane-panel">Runtime Control Plane Panel</div>,
}));

// Mock UI components
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ value, _onValueChange, children, className }: any) => (
    <div data-testid="tabs" data-value={value} className={className}>
      {children}
    </div>
  ),
  TabsList: ({ children }: any) => <div data-testid="tabs-list">{children}</div>,
  TabsTrigger: ({ value, children, onClick }: any) => (
    <button
      data-testid={`tabs-trigger-${value}`}
      data-value={value}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {children}
    </button>
  ),
  TabsContent: ({ value, children, className }: any) => (
    <div data-testid={`tabs-content-${value}`} className={className}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ header, children }: any) => (
    <div data-testid="page-layout">
      {header && <div data-testid="page-layout__header">{header}</div>}
      <div data-testid="page-layout__body">{children}</div>
    </div>
  ),
}));

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title, subtitle }: any) => (
    <div>
      <h1 data-testid="page-header__title">{title}</h1>
      {subtitle && <p data-testid="page-header__subtitle">{subtitle}</p>}
    </div>
  ),
}));

const TABS = ['overview', 'monitoring', 'alerts', 'control', 'reports'] as const;

describe('RuntimeConsolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to full permissions by default
    mockPermissions['project:usage:view'] = true;
    mockPermissions['project:alert:view'] = true;
    mockPermissions['project:settings:manage'] = true;
    // Reset mock search params and router
    mockSearchParams = new URLSearchParams();
    mockRouterReplace.mockReset();
  });

  describe('with full permissions', () => {
    it('renders page header with title and subtitle', () => {
      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const header = screen.getByTestId('page-layout__header');
      expect(within(header).getByTestId('page-header__title')).toBeInTheDocument();
      expect(within(header).getByTestId('page-header__subtitle')).toBeInTheDocument();
    });

    it('renders all 5 tabs', () => {
      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabsList = screen.getByTestId('tabs-list');
      expect(tabsList).toBeInTheDocument();

      TABS.forEach((tab) => {
        const trigger = within(tabsList).getByTestId(`tabs-trigger-${tab}`);
        expect(trigger).toBeInTheDocument();
        expect(trigger).toHaveAttribute('role', 'tab');
      });
    });

    it('renders overview tab as default', () => {
      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabs = screen.getByTestId('tabs');
      expect(tabs).toHaveAttribute('data-value', 'overview');
    });

    it('passes workspaceId and projectId to child components', () => {
      render(
        <RuntimeConsolePage
          workspaceId="test_ws"
          projectId="test_proj"
        />
      );

      const consoles = screen.getAllByTestId('runtime-observability-console');
      expect(consoles.length).toBeGreaterThan(0);
      expect(consoles[0]).toHaveAttribute('data-workspace-id', 'test_ws');
      expect(consoles[0]).toHaveAttribute('data-project-id', 'test_proj');
    });
  });

  describe('permission gating', () => {
    it('hides overview and monitoring tabs when user lacks project:usage:view', () => {
      mockPermissions['project:usage:view'] = false;
      mockPermissions['project:alert:view'] = true;
      mockPermissions['project:settings:manage'] = true;

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabsList = screen.getByTestId('tabs-list');
      expect(() => within(tabsList).getByTestId('tabs-trigger-overview')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-monitoring')).toThrow();
    });

    it('hides reports tab when user lacks project:usage:view', () => {
      mockPermissions['project:usage:view'] = false;
      mockPermissions['project:alert:view'] = true;
      mockPermissions['project:settings:manage'] = true;

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabsList = screen.getByTestId('tabs-list');
      expect(() => within(tabsList).getByTestId('tabs-trigger-reports')).toThrow();
    });

    it('hides alerts tab when user lacks project:alert:view', () => {
      mockPermissions['project:usage:view'] = true;
      mockPermissions['project:alert:view'] = false;
      mockPermissions['project:settings:manage'] = true;

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabsList = screen.getByTestId('tabs-list');
      expect(() => within(tabsList).getByTestId('tabs-trigger-alerts')).toThrow();
    });

    it('hides control tab when user lacks project:settings:manage', () => {
      mockPermissions['project:usage:view'] = true;
      mockPermissions['project:alert:view'] = true;
      mockPermissions['project:settings:manage'] = false;

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabsList = screen.getByTestId('tabs-list');
      expect(() => within(tabsList).getByTestId('tabs-trigger-control')).toThrow();
    });
  });

  describe('with partial permissions', () => {
    it('shows only tabs user has permission for (usage only)', () => {
      mockPermissions['project:usage:view'] = true;
      mockPermissions['project:alert:view'] = false;
      mockPermissions['project:settings:manage'] = false;

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabsList = screen.getByTestId('tabs-list');
      expect(within(tabsList).getByTestId('tabs-trigger-overview')).toBeInTheDocument();
      expect(within(tabsList).getByTestId('tabs-trigger-monitoring')).toBeInTheDocument();
      expect(within(tabsList).getByTestId('tabs-trigger-reports')).toBeInTheDocument();

      expect(() => within(tabsList).getByTestId('tabs-trigger-alerts')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-control')).toThrow();
    });

    it('shows only tabs user has permission for (alerts only)', () => {
      mockPermissions['project:usage:view'] = false;
      mockPermissions['project:alert:view'] = true;
      mockPermissions['project:settings:manage'] = false;

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabsList = screen.getByTestId('tabs-list');
      expect(within(tabsList).getByTestId('tabs-trigger-alerts')).toBeInTheDocument();

      expect(() => within(tabsList).getByTestId('tabs-trigger-overview')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-monitoring')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-control')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-reports')).toThrow();
    });

    it('shows only tabs user has permission for (settings only)', () => {
      mockPermissions['project:usage:view'] = false;
      mockPermissions['project:alert:view'] = false;
      mockPermissions['project:settings:manage'] = true;

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabsList = screen.getByTestId('tabs-list');
      expect(within(tabsList).getByTestId('tabs-trigger-control')).toBeInTheDocument();

      expect(() => within(tabsList).getByTestId('tabs-trigger-overview')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-monitoring')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-alerts')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-reports')).toThrow();
    });

    it('defaults to first accessible tab when current tab is not accessible', () => {
      mockPermissions['project:usage:view'] = false;
      mockPermissions['project:alert:view'] = true;
      mockPermissions['project:settings:manage'] = false;

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabs = screen.getByTestId('tabs');
      // Should default to alerts tab (first accessible)
      expect(tabs).toHaveAttribute('data-value', 'alerts');
    });
  });

  describe('with no permissions', () => {
    it('shows permission denied message when user has no accessible tabs', () => {
      mockPermissions['project:usage:view'] = false;
      mockPermissions['project:alert:view'] = false;
      mockPermissions['project:settings:manage'] = false;

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      // Should show permission denied (using i18n key)
      expect(screen.getByText('permission_denied.title')).toBeInTheDocument();
      expect(screen.getByText(/permission_denied.message/)).toBeInTheDocument();

      // Tabs should not be rendered
      expect(screen.queryByTestId('tabs')).not.toBeInTheDocument();
    });
  });

  describe('permission checks are independent (no short-circuiting)', () => {
    it('checks all three permission types independently', () => {
      // The implementation makes separate useHasPermission calls for:
      // - project:usage:view (for overview, monitoring, reports)
      // - project:alert:view (for alerts)
      // - project:settings:manage (for control)
      //
      // This test verifies the behavior: each permission type works independently.

      // Test with only usage:view permission
      mockPermissions['project:usage:view'] = true;
      mockPermissions['project:alert:view'] = false;
      mockPermissions['project:settings:manage'] = false;

      const { rerender } = render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      let tabsList = screen.getByTestId('tabs-list');
      expect(within(tabsList).getByTestId('tabs-trigger-overview')).toBeInTheDocument();
      expect(() => within(tabsList).getByTestId('tabs-trigger-alerts')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-control')).toThrow();

      // Now test with only alert:view permission
      mockPermissions['project:usage:view'] = false;
      mockPermissions['project:alert:view'] = true;
      mockPermissions['project:settings:manage'] = false;

      rerender(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      tabsList = screen.getByTestId('tabs-list');
      expect(() => within(tabsList).getByTestId('tabs-trigger-overview')).toThrow();
      expect(within(tabsList).getByTestId('tabs-trigger-alerts')).toBeInTheDocument();
      expect(() => within(tabsList).getByTestId('tabs-trigger-control')).toThrow();

      // Now test with only settings:manage permission
      mockPermissions['project:usage:view'] = false;
      mockPermissions['project:alert:view'] = false;
      mockPermissions['project:settings:manage'] = true;

      rerender(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      tabsList = screen.getByTestId('tabs-list');
      expect(() => within(tabsList).getByTestId('tabs-trigger-overview')).toThrow();
      expect(() => within(tabsList).getByTestId('tabs-trigger-alerts')).toThrow();
      expect(within(tabsList).getByTestId('tabs-trigger-control')).toBeInTheDocument();
    });
  });

  describe('URL correction for unauthorized tabs', () => {
    it('corrects URL via router.replace when user tries to access unauthorized tab', () => {
      // User only has usage:view permission (no control tab access)
      mockPermissions['project:usage:view'] = true;
      mockPermissions['project:alert:view'] = false;
      mockPermissions['project:settings:manage'] = false;

      // Simulate URL with ?tab=control (user doesn't have permission)
      mockSearchParams = new URLSearchParams('tab=control');

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      // User should be on overview tab (first accessible), not control tab
      const tabs = screen.getByTestId('tabs');
      expect(tabs).toHaveAttribute('data-value', 'overview');

      // Only accessible tabs should be visible
      const tabsList = screen.getByTestId('tabs-list');
      expect(within(tabsList).getByTestId('tabs-trigger-overview')).toBeInTheDocument();
      expect(() => within(tabsList).getByTestId('tabs-trigger-control')).toThrow();

      // Verify router.replace was called to correct the URL
      expect(mockRouterReplace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws1/projects/proj1/runtime-console',
        { scroll: false }
      );
    });

    it('corrects URL to specific tab when overview is not accessible', () => {
      // User only has alert:view permission (no usage:view, no settings:manage)
      mockPermissions['project:usage:view'] = false;
      mockPermissions['project:alert:view'] = true;
      mockPermissions['project:settings:manage'] = false;

      // Simulate URL with ?tab=overview (user doesn't have permission)
      mockSearchParams = new URLSearchParams('tab=overview');

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      // User should be on alerts tab (first accessible)
      const tabs = screen.getByTestId('tabs');
      expect(tabs).toHaveAttribute('data-value', 'alerts');

      // Verify router.replace was called to correct the URL to ?tab=alerts
      expect(mockRouterReplace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws1/projects/proj1/runtime-console?tab=alerts',
        { scroll: false }
      );
    });

    it('does not correct URL when user has permission for requested tab', () => {
      // User has usage:view permission
      mockPermissions['project:usage:view'] = true;
      mockPermissions['project:alert:view'] = false;
      mockPermissions['project:settings:manage'] = false;

      // Simulate URL with ?tab=monitoring (user has permission)
      mockSearchParams = new URLSearchParams('tab=monitoring');

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      // User should be on monitoring tab
      const tabs = screen.getByTestId('tabs');
      expect(tabs).toHaveAttribute('data-value', 'monitoring');

      // router.replace should NOT be called since user has permission
      expect(mockRouterReplace).not.toHaveBeenCalled();
    });
  });

  describe('URL normalization', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Reset to full permissions
      mockPermissions['project:usage:view'] = true;
      mockPermissions['project:alert:view'] = true;
      mockPermissions['project:settings:manage'] = true;
      mockSearchParams = new URLSearchParams();
      mockRouterReplace.mockReset();
    });

    it('removes tab parameter when tab=overview (overview is default)', () => {
      mockSearchParams = new URLSearchParams('tab=overview');

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      // User should be on overview tab
      const tabs = screen.getByTestId('tabs');
      expect(tabs).toHaveAttribute('data-value', 'overview');

      // router.replace should be called to remove the tab parameter
      expect(mockRouterReplace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws1/projects/proj1/runtime-console',
        { scroll: false }
      );
    });

    it('corrects URL when tab parameter is invalid (unknown tab)', () => {
      mockSearchParams = new URLSearchParams('tab=invalid');

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      // User should fall back to overview (default tab)
      const tabs = screen.getByTestId('tabs');
      expect(tabs).toHaveAttribute('data-value', 'overview');

      // router.replace should be called to remove the invalid parameter
      expect(mockRouterReplace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws1/projects/proj1/runtime-console',
        { scroll: false }
      );
    });

    it('corrects URL when tab parameter is invalid (unknown tab) with other params', () => {
      mockSearchParams = new URLSearchParams('tab=unknown&filter=error');

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      // User should fall back to overview (default tab)
      const tabs = screen.getByTestId('tabs');
      expect(tabs).toHaveAttribute('data-value', 'overview');

      // router.replace should be called to preserve other params but remove invalid tab
      expect(mockRouterReplace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws1/projects/proj1/runtime-console?filter=error',
        { scroll: false }
      );
    });

    it('preserves valid non-overview tab parameters', () => {
      mockSearchParams = new URLSearchParams('tab=monitoring');

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      const tabs = screen.getByTestId('tabs');
      expect(tabs).toHaveAttribute('data-value', 'monitoring');

      // router.replace should NOT be called since the URL is valid
      expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it('removes overview parameter and keeps other valid tabs unchanged', () => {
      // User requests overview explicitly, but it's the default - should clean up
      mockSearchParams = new URLSearchParams('tab=overview');

      render(
        <RuntimeConsolePage
          workspaceId="ws_1"
          projectId="proj_1"
        />
      );

      // router.replace should be called to clean up the redundant parameter
      expect(mockRouterReplace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws1/projects/proj1/runtime-console',
        { scroll: false }
      );
    });
  });
});
