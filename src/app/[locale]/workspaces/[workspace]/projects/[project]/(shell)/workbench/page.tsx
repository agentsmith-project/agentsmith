/**
 * Workbench Page
 *
 * Recipe list view - displays all Recipes and allows navigation to individual Recipe details.
 */

'use client';

import { useEffect, useState } from 'react';
import { RecipeList } from '@/components/workbench/RecipeList';

interface WorkbenchPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function WorkbenchPage({ params }: WorkbenchPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string;
    project: string;
  } | null>(null);

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: p.workspace,
        project: p.project,
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
    <RecipeList
      workspaceId={resolvedParams.workspace}
      projectId={resolvedParams.project}
    />
  );
}
