'use client';

import { useState, useEffect } from 'react';
import { SourcesPage as SourcesPageComponent } from '@/components/sources/SourcesPage';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';

interface SourcesPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function SourcesPage({ params }: SourcesPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string;
    project: string;
  } | null>(null);

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({ workspace: p.workspace, project: p.project }),
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
      <SourcesPageComponent
        workspaceId={resolvedParams.workspace}
        projectId={resolvedParams.project}
      />
    </PageState>
  );
}
