'use client';

import { useState, useEffect } from 'react';
import { SourcesPage as SourcesPageComponent } from '@/components/sources/SourcesPage';

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
    return <div className="p-6">Loading...</div>;
  }

  return (
    <SourcesPageComponent
      workspaceId={resolvedParams.workspace}
      projectId={resolvedParams.project}
    />
  );
}
