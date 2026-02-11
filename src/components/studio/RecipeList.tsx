'use client';
import * as React from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Loader2, ChevronRight, Clock3, Bot } from 'lucide-react';
import { useRecipes } from '@/lib/hooks/use-recipe';
import { RecipeCreateDialog } from './RecipeCreateDialog';
import { EmptyState } from '@/components/ui/loading';
import type { Recipe } from '@/lib/types/recipe';

export interface RecipeListProps {
  workspaceId: string;
  projectId: string;
  canCreateRecipe: boolean;
}

const statusConfig: Record<Recipe['status'], { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  active: { label: 'Active', variant: 'default' },
  closed: { label: 'Closed', variant: 'secondary' },
  archived: { label: 'Archived', variant: 'outline' },
};

export function RecipeList({
  workspaceId,
  projectId,
  canCreateRecipe,
}: RecipeListProps) {
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
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/studio/recipes/${recipeId}`);
  };

  const handleRecipeClick = (recipeId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/studio/recipes/${recipeId}`);
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
    <div className="h-full flex flex-col bg-background" data-testid="studio__recipe-list">
      <div className="px-4 py-3 md:px-5 border-b border-subtle flex items-center justify-between gap-3">
        <h1 className="text-[28px] font-semibold leading-none text-foreground">AI Studio</h1>
        <Button
          onClick={() => setCreateDialogOpen(true)}
          disabled={!canCreateRecipe}
          data-testid="studio__create-recipe-btn"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Task
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 md:px-5 md:py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-tertiary" />
          </div>
        ) : recipes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              title="No recipes yet"
              description="Create your first task to start working with an agent"
              action={{
                label: 'Create Task',
                onClick: () => {
                  if (!canCreateRecipe) return;
                  setCreateDialogOpen(true);
                },
              }}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            {recipes.map((recipe) => {
              const statusInfo = statusConfig[recipe.status];
              return (
                <div
                  key={recipe.id}
                  onClick={() => handleRecipeClick(recipe.id)}
                  className="rounded-md border border-border bg-surface hover:bg-hover transition-colors cursor-pointer"
                  data-testid="studio__recipe-card"
                  data-recipe-id={recipe.id}
                >
                  <div className="px-4 py-2.5 md:px-5 md:py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-sm md:text-[15px] font-semibold text-foreground truncate">{recipe.title}</h3>
                        <Badge variant={statusInfo.variant} className="text-xs shrink-0">
                          {statusInfo.label}
                        </Badge>
                      </div>
                      <div className="text-xs text-tertiary flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1">
                          <Bot className="h-3.5 w-3.5" />
                          {recipe.agent_name}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatTime(recipe.last_activity_at)}
                        </span>
                        <span>{recipe.attached_source_ids.length} source(s)</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-tertiary shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RecipeCreateDialog
        open={canCreateRecipe && createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
