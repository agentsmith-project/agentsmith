import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';

vi.mock('@/components/studio/RecipeList', () => ({
  RecipeList: ({ workspaceId, projectId, canCreateRecipe }: { workspaceId: string; projectId: string; canCreateRecipe: boolean }) => (
    <div data-testid="studio__recipe-list-route">
      {workspaceId}:{projectId}:{String(canCreateRecipe)}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn((permission: string) => permission === 'project:studio:access'),
}));

import WorkbenchPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

describe('WorkbenchPage route', () => {
  it('renders recipe list when params and permission are valid', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <WorkbenchPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('studio__recipe-list-route')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1:true')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe workspace/project', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <WorkbenchPage
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

  it('shows permission denied when user lacks studio access', async () => {
    mockUseHasPermission.mockReturnValue(false);
    render(
      <WorkbenchPage
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
