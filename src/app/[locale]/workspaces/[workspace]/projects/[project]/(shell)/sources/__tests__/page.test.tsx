import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';

vi.mock('@/components/sources/SourcesPage', () => ({
  SourcesPage: ({ workspaceId, projectId }: { workspaceId: string; projectId: string }) => (
    <div data-testid="sources__route-page">
      {workspaceId}:{projectId}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
}));

import SourcesPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

describe('SourcesPage route', () => {
  it('renders sources page with validated params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <SourcesPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('sources__route-page')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <SourcesPage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks source read permission', async () => {
    mockUseHasPermission.mockReturnValue(false);
    render(
      <SourcesPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
