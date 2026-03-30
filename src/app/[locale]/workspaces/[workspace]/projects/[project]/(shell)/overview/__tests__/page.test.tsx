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

describe('OverviewPage', () => {
const mockUseProjectOverviewCapabilities = vi.mocked(useProjectOverviewCapabilities);
const mockUseResolvedProjectRoute = vi.mocked(useResolvedProjectRoute);

  beforeEach(() => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
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

  it('renders project hub quick links and workspace return link', () => {
    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__page')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__back-to-workspace')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_default',
    );
    expect(screen.getByTestId('project-hub__quick-links')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__work-links')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__governance-links')).toBeInTheDocument();
    expect(screen.queryByTestId('project-hub__getting-started')).not.toBeInTheDocument();
  });

  it('hides governance links that require project management permissions', () => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canReadAudit: false,
      canManageGovernance: false,
      canManageMembership: false,
      canReadProjectSettings: false,
      canManageAgents: false,
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__work-links')).toBeInTheDocument();
    expect(screen.queryByTestId('project-hub__governance-links')).not.toBeInTheDocument();
  });

  it('shows governance resource links for governance managers without ownership actions', () => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canReadAudit: false,
      canManageGovernance: true,
      canManageMembership: false,
      canReadProjectSettings: false,
      canManageAgents: false,
    });

    render(<OverviewPage />);

    const governance = screen.getByTestId('project-hub__governance-links');
    expect(governance).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'resource_policy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'credentials' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'audit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'members' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'settings' })).not.toBeInTheDocument();
  });

  it('shows members link for membership managers without owner-only settings', () => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canReadAudit: false,
      canManageGovernance: false,
      canManageMembership: true,
      canReadProjectSettings: false,
      canManageAgents: false,
    });

    render(<OverviewPage />);

    const governance = screen.getByTestId('project-hub__governance-links');
    expect(governance).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'members' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'audit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'resource_policy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'credentials' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'settings' })).not.toBeInTheDocument();
  });

  it('shows audit link only for users with audit read permission', () => {
    mockUseProjectOverviewCapabilities.mockReturnValue({
      canUseProject: true,
      canReadAudit: true,
      canManageGovernance: false,
      canManageMembership: false,
      canReadProjectSettings: false,
      canManageAgents: false,
    });

    render(<OverviewPage />);

    const governance = screen.getByTestId('project-hub__governance-links');
    expect(governance).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'audit' })).toBeInTheDocument();
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
