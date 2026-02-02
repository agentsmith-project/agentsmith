'use client';

import { useState, useEffect } from 'react';
import { UsagePage as UsagePageComponent } from '@/components/audit-usage/UsagePage';

interface UsagePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UsagePage({ params }: UsagePageProps) {
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
    <UsagePageComponent
      workspaceId={resolvedParams.workspace}
      projectId={resolvedParams.project}
    />
  );
}
