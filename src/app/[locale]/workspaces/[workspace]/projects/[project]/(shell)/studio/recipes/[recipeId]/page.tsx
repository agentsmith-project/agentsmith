'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { RecipePage } from '@/components/workbench/RecipePage';
import {
  useCanAccessStudio,
} from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

interface RecipePageParams {
  params: Promise<{ workspace: string; project: string; recipeId: string; locale: string }>;
}

const RECIPE_ID_SCHEMA = /^[a-zA-Z0-9_-]+$/;

function validateRecipeId(recipeId: string): string | undefined {
  const trimmed = recipeId.trim();
  if (!trimmed || !RECIPE_ID_SCHEMA.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export default function RecipeDetailPage({ params }: RecipePageParams) {
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
    recipeId?: string;
  } | null>(null);
  const canAccessStudio = useCanAccessStudio();

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        recipeId: validateRecipeId(p.recipeId),
      }),
    );
  }, [params]);

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.workspace || !resolvedParams.project || !resolvedParams.recipeId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canAccessStudio) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout density="immersive" contentWidth="full">
        <RecipePage
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
          recipeId={resolvedParams.recipeId}
          canCreateRecipe={canAccessStudio}
          canUpdateRecipe={canAccessStudio}
          canDeleteRecipe={canAccessStudio}
        />
      </PageLayout>
    </PageState>
  );
}
