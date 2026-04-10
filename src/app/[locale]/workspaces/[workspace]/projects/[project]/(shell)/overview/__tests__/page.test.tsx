import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProjectOverviewCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import OverviewPage from '../page';

vi.mock('next/navigation', () => ({
  useParams: () => ({
    workspace: 'ws_default',
    project: 'proj_001',
    locale: 'en-US',
  }),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useProjectOverviewCapabilities: vi.fn(() => ({
    canUseProject: true,
    canUseAgents: true,
    canReadAudit: true,
    canManageGovernance: true,
    canManageMembership: true,
    canReadProjectSettings: true,
    canManageAgents: true,
  })),
}));

vi.mock('@/lib/hooks/use-resolved-project-route', () => ({
  useResolvedProjectRoute: vi.fn(() => ({
    workspace: 'ws_default',
    project: 'proj_001',
    locale: 'en-US',
    isReady: true,
    isValid: true,
  })),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      nav: {
        resource_policy: 'Policy',
        credentials: 'Project secrets',
      },
      context_store: {
        project_title: 'Shared context',
      },
    };
    return translations[namespace]?.[key] || key;
  },
}));

describe('OverviewPage', () => {
const mockUseProjectOverviewCapabilities = vi.mocked(useProjectOverviewCapabilities);
const mockUseResolvedProjectRoute = vi.mocked(useResolvedProjectRoute);

  beforeEach(() => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canUseAgents: true,
      canReadAudit: true,
      canManageGovernance: true,
      canManageMembership: true,
      canReadProjectSettings: true,
      canManageAgents: true,
    });
    mockUseResolvedProjectRoute.mockReturnValue({
      workspace: 'ws_default',
      project: 'proj_001',
      locale: 'en-US',
      isReady: true,
      isValid: true,
    });
  });

  it('renders project health summary and workspace return link', () => {
    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__page')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__back-to-workspace')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default',
    );
    expect(screen.getByTestId('project-hub__summary')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__use-summary')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__governance-summary')).toBeInTheDocument();
  });

  it('shows an empty governance summary when management surfaces are unavailable', () => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canUseAgents: false,
      canReadAudit: false,
      canManageGovernance: false,
      canManageMembership: false,
      canReadProjectSettings: false,
      canManageAgents: false,
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__use-summary')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__governance-summary')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'resource_policy' })).not.toBeInTheDocument();
  });

  it('shows governance resource summary for governance managers without ownership actions', () => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canUseAgents: false,
      canReadAudit: false,
      canManageGovernance: true,
      canManageMembership: false,
      canReadProjectSettings: false,
      canManageAgents: false,
    });

    render(<OverviewPage />);

    const governance = screen.getByTestId('project-hub__governance-summary');
    expect(governance).toBeInTheDocument();
    expect(governance).toHaveTextContent('Policy');
    expect(governance).toHaveTextContent('Shared context');
    expect(governance).toHaveTextContent('Project secrets');
    expect(governance).not.toHaveTextContent('audit');
    expect(governance).not.toHaveTextContent('members');
    expect(governance).not.toHaveTextContent('settings');
  });

  it('shows members in governance summary for membership managers without owner-only settings', () => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canUseAgents: false,
      canReadAudit: false,
      canManageGovernance: false,
      canManageMembership: true,
      canReadProjectSettings: false,
      canManageAgents: false,
    });

    render(<OverviewPage />);

    const governance = screen.getByTestId('project-hub__governance-summary');
    expect(governance).toBeInTheDocument();
    expect(governance).toHaveTextContent('members');
    expect(governance).not.toHaveTextContent('audit');
    expect(governance).not.toHaveTextContent('resource_policy');
    expect(governance).not.toHaveTextContent('credentials');
    expect(governance).not.toHaveTextContent('settings');
  });

  it('shows audit in the governance summary for users with audit read permission', () => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canUseAgents: false,
      canReadAudit: true,
      canManageGovernance: false,
      canManageMembership: false,
      canReadProjectSettings: false,
      canManageAgents: false,
    });

    render(<OverviewPage />);

    const governance = screen.getByTestId('project-hub__governance-summary');
    expect(governance).toBeInTheDocument();
    expect(governance).toHaveTextContent('audit');
  });

  it('shows invalid parameter error for unsafe route params', () => {
    mockUseResolvedProjectRoute.mockReturnValue({
      workspace: null,
      project: 'proj_001',
      locale: 'en-US',
      isReady: true,
      isValid: false,
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks project read permission', () => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: false,
      canUseAgents: false,
      canReadAudit: false,
      canManageGovernance: false,
      canManageMembership: false,
      canReadProjectSettings: false,
      canManageAgents: false,
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
