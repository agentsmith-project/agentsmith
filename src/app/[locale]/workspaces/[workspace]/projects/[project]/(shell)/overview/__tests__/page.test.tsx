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
    mockUseHasPermission.mockReturnValue(true);
    mockUseParams.mockReturnValue({
      workspace: 'ws_default',
      project: 'proj_001',
      locale: 'en-US',
    });
  });

  it('renders project hub quick links and getting started card', () => {
    render(<OverviewPage />);

    expect(screen.getByTestId('project-hub__page')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__quick-links')).toBeInTheDocument();
    expect(screen.getByTestId('project-hub__getting-started')).toBeInTheDocument();
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
