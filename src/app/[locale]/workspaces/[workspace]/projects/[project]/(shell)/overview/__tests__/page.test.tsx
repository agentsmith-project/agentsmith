import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCanReadAudit, useCanReadProjectSettings, useHasPermission } from '@/lib/hooks/use-permissions';
import OverviewPage from '../page';

const mockUseParams = vi.fn(() => ({
  workspace: 'ws_default',
  project: 'proj_001',
  locale: 'en-US',
}));

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
  useCanReadProjectSettings: vi.fn(() => true),
  useCanReadAudit: vi.fn(() => true),
}));

describe('OverviewPage', () => {
const mockUseHasPermission = vi.mocked(useHasPermission);
const mockUseCanReadProjectSettings = vi.mocked(useCanReadProjectSettings);
const mockUseCanReadAudit = vi.mocked(useCanReadAudit);

  beforeEach(() => {
    mockUseHasPermission.mockImplementation((permission: string) => {
      if (permission === 'project:endpoint:use') return true;
      if (permission === 'project:agent:manage') return true;
      if (permission === 'project:governance:update') return true;
      if (permission === 'project:membership:update') return true;
      return false;
    });
    mockUseCanReadProjectSettings.mockReturnValue(true);
    mockUseCanReadAudit.mockReturnValue(true);
    mockUseParams.mockReturnValue({
      workspace: 'ws_default',
      project: 'proj_001',
      locale: 'en-US',
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
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:endpoint:use');
    mockUseCanReadProjectSettings.mockReturnValue(false);
    mockUseCanReadAudit.mockReturnValue(false);

    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__work-links')).toBeInTheDocument();
    expect(screen.queryByTestId('project-hub__governance-links')).not.toBeInTheDocument();
  });

  it('shows governance resource links for governance managers without ownership actions', () => {
    mockUseHasPermission.mockImplementation((permission: string) => {
      if (permission === 'project:endpoint:use') return true;
      if (permission === 'project:governance:update') return true;
      return false;
    });
    mockUseCanReadProjectSettings.mockReturnValue(false);
    mockUseCanReadAudit.mockReturnValue(false);

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
    mockUseHasPermission.mockImplementation((permission: string) => {
      if (permission === 'project:endpoint:use') return true;
      if (permission === 'project:membership:update') return true;
      return false;
    });
    mockUseCanReadProjectSettings.mockReturnValue(false);
    mockUseCanReadAudit.mockReturnValue(false);

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
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:endpoint:use');
    mockUseCanReadProjectSettings.mockReturnValue(false);
    mockUseCanReadAudit.mockReturnValue(true);

    render(<OverviewPage />);

    const governance = screen.getByTestId('project-hub__governance-links');
    expect(governance).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'audit' })).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe route params', () => {
    mockUseParams.mockReturnValue({
      workspace: '<script>',
      project: 'proj_001',
      locale: 'en-US',
    });

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks project read permission', () => {
    mockUseHasPermission.mockReturnValue(false);

    render(<OverviewPage />);

    expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
