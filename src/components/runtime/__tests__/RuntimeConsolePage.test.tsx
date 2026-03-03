/**
 * Runtime Console Page Component - Tests
 */

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeConsolePage } from '../RuntimeConsolePage';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

let mockSearchParams = new URLSearchParams();
const mockRouterReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockRouterReplace, push: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en-US/workspaces/ws1/projects/proj1/runtime-console',
}));

const mockPermissions: Record<string, boolean> = {
  'project:endpoint:use': true,
  'project:manage': true,
};

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockPermissions[permission] ?? false,
}));

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

describe('RuntimeConsolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions['project:endpoint:use'] = true;
    mockPermissions['project:manage'] = true;
    mockSearchParams = new URLSearchParams();
    mockRouterReplace.mockReset();
  });

  it('renders all tabs when user has full permissions', () => {
    render(<RuntimeConsolePage workspaceId="ws_1" projectId="proj_1" />);

    const tabsList = screen.getByTestId('tabs-list');
    ['overview', 'monitoring', 'alerts', 'control', 'reports'].forEach((tab) => {
      expect(within(tabsList).getByTestId(`tabs-trigger-${tab}`)).toBeInTheDocument();
    });
  });

  it('hides endpoint-use tabs when user lacks project:endpoint:use', () => {
    mockPermissions['project:endpoint:use'] = false;
    mockPermissions['project:manage'] = true;

    render(<RuntimeConsolePage workspaceId="ws_1" projectId="proj_1" />);

    const tabsList = screen.getByTestId('tabs-list');
    expect(() => within(tabsList).getByTestId('tabs-trigger-overview')).toThrow();
    expect(() => within(tabsList).getByTestId('tabs-trigger-monitoring')).toThrow();
    expect(() => within(tabsList).getByTestId('tabs-trigger-alerts')).toThrow();
    expect(() => within(tabsList).getByTestId('tabs-trigger-reports')).toThrow();
    expect(within(tabsList).getByTestId('tabs-trigger-control')).toBeInTheDocument();
  });

  it('hides control tab when user lacks project:manage', () => {
    mockPermissions['project:endpoint:use'] = true;
    mockPermissions['project:manage'] = false;

    render(<RuntimeConsolePage workspaceId="ws_1" projectId="proj_1" />);

    const tabsList = screen.getByTestId('tabs-list');
    expect(() => within(tabsList).getByTestId('tabs-trigger-control')).toThrow();
    expect(within(tabsList).getByTestId('tabs-trigger-overview')).toBeInTheDocument();
    expect(within(tabsList).getByTestId('tabs-trigger-alerts')).toBeInTheDocument();
  });

  it('shows permission denied when user has no accessible tabs', () => {
    mockPermissions['project:endpoint:use'] = false;
    mockPermissions['project:manage'] = false;

    render(<RuntimeConsolePage workspaceId="ws_1" projectId="proj_1" />);

    expect(screen.getByText('permission_denied.title')).toBeInTheDocument();
    expect(screen.getByText(/permission_denied.message/)).toBeInTheDocument();
    expect(screen.queryByTestId('tabs')).not.toBeInTheDocument();
  });

  it('corrects unauthorized tab in URL to first accessible tab', () => {
    mockPermissions['project:endpoint:use'] = false;
    mockPermissions['project:manage'] = true;
    mockSearchParams = new URLSearchParams('tab=overview');

    render(<RuntimeConsolePage workspaceId="ws_1" projectId="proj_1" />);

    const tabs = screen.getByTestId('tabs');
    expect(tabs).toHaveAttribute('data-value', 'control');
    expect(mockRouterReplace).toHaveBeenCalledWith(
      '/en-US/workspaces/ws1/projects/proj1/runtime-console?tab=control',
      { scroll: false }
    );
  });
});
