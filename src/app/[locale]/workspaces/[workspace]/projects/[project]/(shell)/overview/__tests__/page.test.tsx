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
        'next_steps.chat_description': 'Jump into chat',
        'next_steps.notebook_description': 'Open notebook',
        'next_steps.files_description': 'Open files',
        'next_steps.context_description': 'Review shared context',
        'next_steps.members_description': 'Review members',
        'next_steps.settings_description': 'Open settings',
        'next_steps.audit_description': 'Open audit',
        'next_steps.endpoints_description': 'Open endpoints',
        'next_steps.agents_description': 'Open agents',
        'next_steps.primary_badge': 'Start here',
        'next_steps.secondary_badge': 'Next step',
        'next_steps.open': 'Open',
      },
      workspace: {
        workspace_home_next_steps_title: 'What you can do here',
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
    expect(screen.getByTestId('project-hub__next-steps')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__next-step--chat')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/chat',
    );
    expect(screen.getByTestId('project-hub__next-step--notebook')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/notebook',
    );
    expect(screen.getByTestId('project-hub__next-step--files')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/files',
    );
    expect(screen.getByTestId('project-hub__next-step--context')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/context',
    );
    expect(screen.getByTestId('project-hub__use-summary')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__governance-summary')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__develop-summary')).toBeInTheDocument();
  });

  it('renders the remaining reachable surfaces as quiet grouped links', () => {
    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__next-steps').querySelectorAll('a')).toHaveLength(4);

    expect(screen.getByTestId('project-hub__use-summary')).toHaveTextContent('Usage');
    expect(screen.getByTestId('project-hub__use-summary')).toHaveTextContent('Access guide');
    expect(screen.getByTestId('project-hub__governance-summary')).toHaveTextContent('Policy');
    expect(screen.getByTestId('project-hub__governance-summary')).toHaveTextContent('Project secrets');
    expect(screen.getByTestId('project-hub__develop-summary')).toHaveTextContent('Agents');

    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/usage',
    );
    expect(screen.getByRole('link', { name: 'Access guide' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/use-guide',
    );
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/agents',
    );
  });

  it('derives remaining summary groups from accessible surfaces', () => {
    render(<OverviewPage />);

    const useSummary = screen.getByTestId('project-hub__use-summary');
    const governanceSummary = screen.getByTestId('project-hub__governance-summary');
    const developSummary = screen.getByTestId('project-hub__develop-summary');

    expect(useSummary).toHaveTextContent('Usage');
    expect(useSummary).toHaveTextContent('Access guide');
    expect(governanceSummary).toHaveTextContent('Endpoints');
    expect(governanceSummary).toHaveTextContent('Policy');
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
