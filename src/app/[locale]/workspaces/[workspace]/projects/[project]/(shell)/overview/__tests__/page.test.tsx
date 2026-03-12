import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';
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
}));

describe('OverviewPage', () => {
const mockUseHasPermission = vi.mocked(useHasPermission);

  beforeEach(() => {
    mockUseHasPermission.mockImplementation((permission: string) => {
      if (permission === 'project:endpoint:use') return true;
      if (permission === 'project:agent:manage') return true;
      if (permission === 'project:manage') return true;
      return false;
    });
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

    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__work-links')).toBeInTheDocument();
    expect(screen.queryByTestId('project-hub__governance-links')).not.toBeInTheDocument();
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
