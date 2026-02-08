'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, ArrowLeft, Trash2, Loader2, Pencil } from 'lucide-react';
import { useDeleteRecipe } from '@/lib/hooks/use-recipe';
import type { Recipe, RecipeStatus } from '@/lib/types/recipe';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface RecipeHeaderProps {
  recipe: Recipe;
  workspaceId: string;
  projectId: string;
  canDeleteRecipe?: boolean;
  onCreateNew?: () => void;
  onEdit?: () => void;
  onDeleted?: () => void;
  onLeave?: () => void;
}

const getStatusConfig = (t: (key: string) => string): Record<RecipeStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> => ({
  active: { label: t('status.active'), variant: 'default' },
  closed: { label: t('status.closed'), variant: 'secondary' },
  archived: { label: t('status.archived'), variant: 'outline' },
});

export function RecipeHeader({
  recipe,
  workspaceId,
  projectId,
  canDeleteRecipe = true,
  onCreateNew,
  onEdit,
  onDeleted,
  onLeave,
}: RecipeHeaderProps) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const t = useTranslations('studio.recipe');
  const deleteRecipe = useDeleteRecipe();
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  const handleLeave = () => {
    if (onLeave) {
      onLeave();
    } else {
      // Default behavior: navigate to studio list
      router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/studio`);
    }
  };

  const handleDelete = async () => {
    if (!canDeleteRecipe) return;
    try {
      await deleteRecipe.mutateAsync({
        workspaceId,
        projectId,
        recipeId: recipe.id,
      });
      setDeleteDialogOpen(false);
      if (onDeleted) {
        onDeleted();
      }
    } catch {
      // Error is handled by the hook
    }
  };

  const statusConfig = getStatusConfig(t);
  const statusInfo = statusConfig[recipe.status];

  return (
    <div
      className="border-b border-border bg-surface px-6 py-4 flex items-center justify-between"
      data-testid="studio__recipe-header"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Leave Recipe Button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                onClick={handleLeave}
                aria-label={t('leave')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('leave')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Recipe Info */}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-foreground truncate">{recipe.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-tertiary">Agent: {recipe.agent_name}</span>
            <Badge variant={statusInfo.variant} className="text-xs">
              {statusInfo.label}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" />
            {t('edit')}
          </Button>
        )}
        {canDeleteRecipe && (
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-error hover:text-error">
                <Trash2 className="h-4 w-4 mr-2" />
                {t('delete')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('delete')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('delete_confirm_message')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('delete_cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void handleDelete();
                  }}
                  disabled={deleteRecipe.isPending}
                  variant="destructive"
                >
                  {deleteRecipe.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* New Recipe Button */}
        {onCreateNew && (
          <Button variant="default" size="sm" onClick={onCreateNew}>
            <Plus className="h-4 w-4 mr-2" />
            {t('new')}
          </Button>
        )}
      </div>
    </div>
  );
}
