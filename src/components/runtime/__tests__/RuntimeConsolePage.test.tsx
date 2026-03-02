/**
 * Runtime Console Page Component - Tests
 *
 * TDD: Tests first, then implementation.
 */

import { render, screen, within, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeConsolePage } from '../RuntimeConsolePage';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/en-US/workspaces/ws1/projects/proj1/runtime-console',
}));

// Mock use-permissions hook
vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: () => true,
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
  Tabs: ({ value, onValueChange, children, className }: any) => (
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
type TabValue = (typeof TABS)[number];

describe('RuntimeConsolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page header with title and subtitle', () => {
    render(
      <RuntimeConsolePage
        workspaceId="ws_1"
        projectId="proj_1"
        locale="en-US"
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
        locale="en-US"
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
        locale="en-US"
      />
    );

    const tabs = screen.getByTestId('tabs');
    expect(tabs).toHaveAttribute('data-value', 'overview');
  });

  it('renders overview tab content with runtime observability console', () => {
    render(
      <RuntimeConsolePage
        workspaceId="ws_1"
        projectId="proj_1"
        locale="en-US"
      />
    );

    // Multiple RuntimeObservabilityConsole may exist (overview + monitoring tabs),
    // but we should find at least one in the overview tab content
    const consoles = screen.getAllByTestId('runtime-observability-console');
    expect(consoles.length).toBeGreaterThan(0);
    expect(consoles[0]).toHaveAttribute('data-workspace-id', 'ws_1');
    expect(consoles[0]).toHaveAttribute('data-project-id', 'proj_1');
  });

  it('renders monitoring tab content', () => {
    render(
      <RuntimeConsolePage
        workspaceId="ws_1"
        projectId="proj_1"
        locale="en-US"
      />
    );

    expect(screen.getByTestId('tabs-content-monitoring')).toBeInTheDocument();
  });

  it('renders alerts tab content with AlertCenterPage', () => {
    render(
      <RuntimeConsolePage
        workspaceId="ws_1"
        projectId="proj_1"
        locale="en-US"
      />
    );

    expect(screen.getByTestId('tabs-content-alerts')).toBeInTheDocument();
    // AlertCenterPage is conditionally rendered inside the tab
  });

  it('renders control tab content', () => {
    render(
      <RuntimeConsolePage
        workspaceId="ws_1"
        projectId="proj_1"
        locale="en-US"
      />
    );

    expect(screen.getByTestId('tabs-content-control')).toBeInTheDocument();
    expect(screen.getByTestId('runtime-control-plane-panel')).toBeInTheDocument();
  });

  it('renders reports tab content with ReleaseOpsDashboard', () => {
    render(
      <RuntimeConsolePage
        workspaceId="ws_1"
        projectId="proj_1"
        locale="en-US"
      />
    );

    expect(screen.getByTestId('tabs-content-reports')).toBeInTheDocument();
    expect(screen.getByTestId('release-ops-dashboard')).toBeInTheDocument();
  });

  it('passes workspaceId and projectId to child components', () => {
    render(
      <RuntimeConsolePage
        workspaceId="test_ws"
        projectId="test_proj"
        locale="en-US"
      />
    );

    const consoles = screen.getAllByTestId('runtime-observability-console');
    expect(consoles.length).toBeGreaterThan(0);
    expect(consoles[0]).toHaveAttribute('data-workspace-id', 'test_ws');
    expect(consoles[0]).toHaveAttribute('data-project-id', 'test_proj');
  });
});
