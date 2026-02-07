import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCanAccessStudio } from '@/lib/hooks/use-permissions';

vi.mock('@/components/workbench/RecipeList', () => ({
  RecipeList: ({ workspaceId, projectId, canCreateRecipe }: { workspaceId: string; projectId: string; canCreateRecipe: boolean }) => (
    <div data-testid="workbench__recipe-list-route">
      {workspaceId}:{projectId}:{String(canCreateRecipe)}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanAccessStudio: vi.fn(() => true),
}));

import WorkbenchPage from '../page';

const mockUseCanAccessStudio = vi.mocked(useCanAccessStudio);

describe('WorkbenchPage route', () => {
  it('renders recipe list when params and permission are valid', async () => {
    mockUseCanAccessStudio.mockReturnValue(true);
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
      expect(screen.getByTestId('workbench__recipe-list-route')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1:true')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe workspace/project', async () => {
    mockUseCanAccessStudio.mockReturnValue(true);
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
    mockUseCanAccessStudio.mockReturnValue(false);
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
