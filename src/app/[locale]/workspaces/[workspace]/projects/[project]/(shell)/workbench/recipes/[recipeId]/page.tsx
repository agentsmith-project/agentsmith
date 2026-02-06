'use client';
import { useEffect, useState } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { RecipePage } from '@/components/workbench/RecipePage';

interface RecipePageParams {
  params: Promise<{ workspace: string; project: string; recipeId: string; locale: string }>;
}

export default function RecipeDetailPage({ params }: RecipePageParams) {
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string;
    project: string;
    recipeId: string;
  } | null>(null);

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: p.workspace,
        project: p.project,
        recipeId: p.recipeId,
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

  return (
    <PageState state="success">
      <PageLayout density="immersive">
        <RecipePage
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
          recipeId={resolvedParams.recipeId}
        />
      </PageLayout>
    </PageState>
  );
}
