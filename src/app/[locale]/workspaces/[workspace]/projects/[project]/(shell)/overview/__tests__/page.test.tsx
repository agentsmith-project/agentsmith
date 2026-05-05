import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCurrentPermissions, useProjectOverviewCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';

import OverviewPage from '../page';
import { getOverviewSecondaryStepTestId, overviewTestIds } from '../overview-page-utils';

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
    'project:agent_task:use',
    'project:agent_runner:manage',
    'project:governance:update',
    'project:membership:update',
    'project:audit:read',
    'project:admins:update',
    'project:lifecycle:update',
  ]),
  useProjectOverviewCapabilities: vi.fn(() => ({
    canUseProject: true,
    canUseAgentTasks: true,
    canReadAudit: true,
    canManageGovernance: true,
    canManageMembership: true,
    canReadProjectSettings: true,
    canManageAgentRunners: true,
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
        agent_tasks: 'Agent Tasks',
        files: 'Files',
        usage: 'Usage',
        api_access_guide: 'Access guide',
        agent_runners: 'Agent Runners',
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
        'next_steps.agent_tasks_description': 'Open agent tasks',
        'next_steps.files_description': 'Open files',
        'next_steps.context_description': 'Review shared context',
        'next_steps.members_description': 'Review members',
        'next_steps.settings_description': 'Open settings',
        'next_steps.audit_description': 'Open audit',
        'next_steps.endpoints_description': 'Open endpoints',
        'next_steps.agent_runners_description': 'Open agent runners',
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
      'project:agent_task:use',
      'project:agent_runner:manage',
      'project:governance:update',
      'project:membership:update',
      'project:audit:read',
      'project:admins:update',
      'project:lifecycle:update',
    ]);
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canUseAgentTasks: true,
      canReadAudit: true,
      canManageGovernance: true,
      canManageMembership: true,
      canReadProjectSettings: true,
      canManageAgentRunners: true,
    });
    mockUseResolvedProjectRoute.mockReturnValue({
      workspace: 'ws_default',
      project: 'proj_001',
      locale: 'en-US',
      isReady: true,
      isValid: true,
    });
  });

  it('anchors the primary next step in the shared header and keeps workspace return quiet', () => {
    render(<OverviewPage />);

    expect(screen.getByTestId(overviewTestIds.page)).toBeInTheDocument();
    expect(screen.getByTestId(overviewTestIds.backToWorkspace)).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default',
    );

    expect(within(screen.getByTestId('page-layout__header')).getByTestId(overviewTestIds.primaryCta)).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/chat',
    );
    expect(screen.getByTestId(overviewTestIds.primaryTask)).toHaveTextContent('Chat');
    expect(screen.getByTestId(getOverviewSecondaryStepTestId('agent-tasks'))).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/agent-tasks',
    );
    expect(screen.getByTestId(getOverviewSecondaryStepTestId('files'))).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/files',
    );
    expect(screen.getByTestId(getOverviewSecondaryStepTestId('context'))).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/context',
    );
    expect(screen.getByTestId(overviewTestIds.availableSurfaces)).toBeInTheDocument();
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('use'))).toBeInTheDocument();
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('govern'))).toBeInTheDocument();
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('develop'))).toBeInTheDocument();
    expect(document.querySelector('[data-testid^="project-hub__"]')).toBeNull();
  });

  it('renders follow-up steps separately from the quieter grouped surface map', () => {
    render(<OverviewPage />);

    expect(screen.getByTestId(overviewTestIds.secondarySteps).querySelectorAll('a')).toHaveLength(3);

    expect(screen.getByTestId(overviewTestIds.surfaceGroup('use'))).toHaveTextContent('Usage');
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('use'))).toHaveTextContent('Access guide');
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('govern'))).toHaveTextContent('Policy');
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('govern'))).toHaveTextContent('Project secrets');
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('develop'))).toHaveTextContent('Agent Runners');

    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/usage',
    );
    expect(screen.getByRole('link', { name: 'Access guide' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/use-guide',
    );
    expect(screen.getByRole('link', { name: 'Agent Runners' })).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default/projects/proj_001/agent-runners',
    );
  });

  it('derives remaining summary groups from accessible surfaces', () => {
    render(<OverviewPage />);

    const useSummary = screen.getByTestId(overviewTestIds.surfaceGroup('use'));
    const governanceSummary = screen.getByTestId(overviewTestIds.surfaceGroup('govern'));
    const developSummary = screen.getByTestId(overviewTestIds.surfaceGroup('develop'));

    expect(useSummary).toHaveTextContent('Usage');
    expect(useSummary).toHaveTextContent('Access guide');
    expect(governanceSummary).toHaveTextContent('Endpoints');
    expect(governanceSummary).toHaveTextContent('Policy');
    expect(governanceSummary).toHaveTextContent('Project secrets');
    expect(governanceSummary).toHaveTextContent('Members');
    expect(governanceSummary).toHaveTextContent('Audit');
    expect(governanceSummary).toHaveTextContent('Settings');
    expect(developSummary).toHaveTextContent('Agent Runners');
  });

  it('keeps empty grouped sections quiet when only use surfaces are reachable', () => {
    mockUseCurrentPermissions.mockReturnValue(['project:endpoint:use']);

    render(<OverviewPage />);

    expect(screen.getByTestId(overviewTestIds.surfaceGroup('govern'))).toHaveTextContent('Governance reach');
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('govern'))).toHaveTextContent('Not available');
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('develop'))).toHaveTextContent('Develop surfaces');
    expect(screen.getByTestId(overviewTestIds.surfaceGroup('develop'))).toHaveTextContent('Not available');
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
      canUseAgentTasks: false,
      canReadAudit: false,
      canManageGovernance: false,
      canManageMembership: false,
      canReadProjectSettings: false,
      canManageAgentRunners: false,
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
  });
});
