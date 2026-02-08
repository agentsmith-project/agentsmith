import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';

vi.mock('@/components/workbench/RecipePage', () => ({
  RecipePage: ({
    workspaceId,
    projectId,
    recipeId,
    canCreateRecipe,
    canUpdateRecipe,
    canDeleteRecipe,
  }: {
    workspaceId: string;
    projectId: string;
    recipeId: string;
    canCreateRecipe: boolean;
    canUpdateRecipe: boolean;
    canDeleteRecipe: boolean;
  }) => (
    <div data-testid="workbench__recipe-detail-route">
      {workspaceId}:{projectId}:{recipeId}:{String(canCreateRecipe)}:{String(canUpdateRecipe)}:{String(canDeleteRecipe)}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn((permission: string) => permission === 'project:studio:access'),
}));

import RecipeDetailPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

describe('RecipeDetailPage route', () => {
  it('renders recipe page with validated params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <RecipeDetailPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          recipeId: 'recipe_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('workbench__recipe-detail-route')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1:recipe_1:true:true:true')).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe recipeId', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <RecipeDetailPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          recipeId: '<script>',
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
      <RecipeDetailPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          recipeId: 'recipe_1',
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
