'use client';
import { useEffect, useState } from 'react';
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
      <div className="h-full flex items-center justify-center">
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  return (
    <RecipePage
      workspaceId={resolvedParams.workspace}
      projectId={resolvedParams.project}
      recipeId={resolvedParams.recipeId}
    />
  );
}
