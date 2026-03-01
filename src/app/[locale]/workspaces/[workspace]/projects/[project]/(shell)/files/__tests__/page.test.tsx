import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';

vi.mock('@/components/files/FilesPage', () => ({
  FilesPage: ({ workspaceId, projectId, locale }: { workspaceId: string; projectId: string; locale?: string }) => (
    <div data-testid="files__route-page">
      {workspaceId}:{projectId}:{locale}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
}));

import FilesPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

describe('FilesPage route', () => {
  it('renders files page with validated params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <FilesPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('files__route-page')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1:en')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <FilesPage
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

  it('shows permission denied when user lacks files read permission', async () => {
    mockUseHasPermission.mockReturnValue(false);
    render(
      <FilesPage
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
