import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCurrentPermissions, useProjectOverviewCapabilities } from '@/lib/hooks/use-permissions';
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
  useCurrentPermissions: vi.fn(() => [
    'project:endpoint:use',
    'project:agent:use',
    'project:agent:manage',
    'project:governance:update',
    'project:membership:update',
    'project:audit:read',
    'project:admins:update',
    'project:lifecycle:update',
  ]),
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
        overview: 'Overview',
        chat: 'Chat',
        notebook: 'Notebook',
        files: 'Files',
        usage: 'Usage',
        api_access_guide: 'Access guide',
        agents: 'Agents',
        endpoints: 'Endpoints',
        audit: 'Audit',
        members: 'Members',
        settings: 'Settings',
        resource_policy: 'Policy',
        credentials: 'Project secrets',
      },
      context_store: {
        project_title: 'Shared context',
      },
      overview: {
        title: 'Project readiness',
        subtitle: 'Project surface summary',
        'signals.execution_title': 'Execution readiness',
        'signals.governance_title': 'Governance reach',
        'signals.develop_title': 'Develop surfaces',
        'signals.ready': 'Ready',
        'signals.available': 'Available',
        'signals.limited': 'Limited',
        'signals.not_available': 'Not available',
      },
      workspace: {
        workspace_home_next_steps_description: 'Next steps',
      },
      projects: {
        back_to_workspace: 'Back to workspace',
      },
      errors: {
        validation_error: 'Validation error',
        'badRequest.description': 'Bad request description',
        permission_denied_title: 'Permission denied',
        permission_denied_hint: 'Permission denied hint',
      },
    };
    return translations[namespace]?.[key] ?? key;
  },
}));

describe('OverviewPage', () => {
  const mockUseCurrentPermissions = vi.mocked(useCurrentPermissions);
  const mockUseProjectOverviewCapabilities = vi.mocked(useProjectOverviewCapabilities);
  const mockUseResolvedProjectRoute = vi.mocked(useResolvedProjectRoute);

  beforeEach(() => {
    mockUseCurrentPermissions.mockReturnValue([
      'project:endpoint:use',
      'project:agent:use',
      'project:agent:manage',
      'project:governance:update',
      'project:membership:update',
      'project:audit:read',
      'project:admins:update',
      'project:lifecycle:update',
    ]);
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

  it('renders readiness summaries and the workspace return link', () => {
    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__page')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__back-to-workspace')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default',
    );
    expect(screen.getByTestId('project-hub__summary')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__use-summary')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__governance-summary')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__develop-summary')).toBeInTheDocument();
  });

  it('derives use, governance, and develop summaries from accessible surfaces', () => {
    render(<OverviewPage />);

    const useSummary = screen.getByTestId('project-hub__use-summary');
    const governanceSummary = screen.getByTestId('project-hub__governance-summary');
    const developSummary = screen.getByTestId('project-hub__develop-summary');

    expect(useSummary).toHaveTextContent('Chat');
    expect(useSummary).toHaveTextContent('Notebook');
    expect(useSummary).toHaveTextContent('Files');
    expect(governanceSummary).toHaveTextContent('Endpoints');
    expect(governanceSummary).toHaveTextContent('Policy');
    expect(governanceSummary).toHaveTextContent('Shared context');
    expect(governanceSummary).toHaveTextContent('Project secrets');
    expect(governanceSummary).toHaveTextContent('Members');
    expect(governanceSummary).toHaveTextContent('Audit');
    expect(governanceSummary).toHaveTextContent('Settings');
    expect(developSummary).toHaveTextContent('Agents');
  });

  it('shows empty governance and develop readiness chips when only use surfaces are reachable', () => {
    mockUseCurrentPermissions.mockReturnValue(['project:endpoint:use']);

    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__governance-summary')).toHaveTextContent('Governance reach');
    expect(screen.getByTestId('project-hub__develop-summary')).toHaveTextContent('Develop surfaces');
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
    expect(screen.getByText('Validation error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks project use permission', () => {
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
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
  });
});
