'use client';
import * as React from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2 } from 'lucide-react';
import { useRecipes } from '@/lib/hooks/use-recipe';
import { RecipeCreateDialog } from './RecipeCreateDialog';
import { EmptyState } from '@/components/ui/loading';
import type { Recipe } from '@/lib/types/recipe';

export interface RecipeListProps {
  workspaceId: string;
  projectId: string;
}

const statusConfig: Record<Recipe['status'], { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  active: { label: 'Active', variant: 'default' },
  closed: { label: 'Closed', variant: 'secondary' },
  archived: { label: 'Archived', variant: 'outline' },
};

export function RecipeList({ workspaceId, projectId }: RecipeListProps) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const { data: recipesData, isLoading } = useRecipes(workspaceId, projectId, {
    sort_by: 'last_activity_at',
    sort_order: 'desc',
  });

  const recipes = recipesData?.items || [];

  const handleCreateSuccess = (recipeId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/workbench/recipes/${recipeId}`);
  };

  const handleRecipeClick = (recipeId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/workbench/recipes/${recipeId}`);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="h-full flex flex-col bg-background" data-testid="workbench__recipe-list">
      <div className="p-6 border-b border-subtle flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Workbench</h1>
          <p className="text-sm text-tertiary mt-1">Manage your Recipes and collaborate with agents</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} data-testid="workbench__create-recipe-btn">
          <Plus className="h-4 w-4 mr-2" />
          New Recipe
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-tertiary" />
          </div>
        ) : recipes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              title="No recipes yet"
              description="Create your first Recipe to start working with an agent"
              action={{
                label: 'Create Recipe',
                onClick: () => setCreateDialogOpen(true),
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recipes.map((recipe) => {
              const statusInfo = statusConfig[recipe.status];
              return (
                <div
                  key={recipe.id}
                  onClick={() => handleRecipeClick(recipe.id)}
                  className="p-4 rounded-md border border-border bg-surface hover:bg-hover transition-colors cursor-pointer"
                  data-testid="workbench__recipe-card"
                  data-recipe-id={recipe.id}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-base font-semibold text-foreground truncate flex-1">{recipe.title}</h3>
                    <Badge variant={statusInfo.variant} className="ml-2 text-xs">
                      {statusInfo.label}
                    </Badge>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="text-tertiary">
                      <span className="font-medium text-foreground">Agent:</span> {recipe.agent_name}
                    </div>
                    <div className="text-tertiary">
                      Last activity: {formatTime(recipe.last_activity_at)}
                    </div>
                    {recipe.attached_source_ids.length > 0 && (
                      <div className="text-tertiary">
                        {recipe.attached_source_ids.length} source(s) attached
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RecipeCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
