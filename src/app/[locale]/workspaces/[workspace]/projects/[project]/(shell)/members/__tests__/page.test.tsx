import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';

vi.mock('@/components/members/MembersPage', () => ({
  MembersPage: ({ workspaceId, projectId, locale }: { workspaceId: string; projectId: string; locale?: string }) => (
    <div data-testid="members__route-page">
      {workspaceId}:{projectId}:{locale ?? 'missing'}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
}));

import MembersRoute from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

describe('MembersRoute', () => {
  it('renders members page with validated params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <MembersRoute
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('members__route-page')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1:en')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <MembersRoute
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

  it('shows permission denied when user lacks members permission', async () => {
    mockUseHasPermission.mockReturnValue(false);
    render(
      <MembersRoute
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

  it('checks membership update permission for page access', async () => {
    mockUseHasPermission.mockImplementation((permission: string) => permission === 'project:membership:update');

    render(
      <MembersRoute
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('members__route-page')).toBeInTheDocument();
    });
  });
});
