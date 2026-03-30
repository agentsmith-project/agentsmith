import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useFilesPageCapabilities } from '@/lib/hooks/use-permissions';

vi.mock('@/components/files/FilesPage', () => ({
  FilesPage: ({ workspaceId, projectId, locale }: { workspaceId: string; projectId: string; locale?: string }) => (
    <div data-testid="files__route-page">
      {workspaceId}:{projectId}:{locale}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useFilesPageCapabilities: vi.fn(() => ({ canRead: true, canManage: true, canExchangeCredentials: true })),
}));

import FilesPage from '../page';

const mockUseFilesPageCapabilities = vi.mocked(useFilesPageCapabilities);

describe('FilesPage route', () => {
  it('renders files page with validated params', async () => {
    mockUseFilesPageCapabilities.mockReturnValue({ canRead: true, canManage: true, canExchangeCredentials: true });
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
    mockUseFilesPageCapabilities.mockReturnValue({ canRead: true, canManage: true, canExchangeCredentials: true });
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
    mockUseFilesPageCapabilities.mockReturnValue({ canRead: false, canManage: false, canExchangeCredentials: false });
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
