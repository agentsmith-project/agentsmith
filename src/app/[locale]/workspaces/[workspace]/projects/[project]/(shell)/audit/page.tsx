'use client';

import { useState, useEffect } from 'react';
import { AuditPage as AuditPageComponent } from '@/components/audit-usage/AuditPage';

interface AuditPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AuditPage({ params }: AuditPageProps) {
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

  // TODO: Lock end_user_id filter for user role when membership API is integrated
  const defaultEndUserId = undefined;

  return (
    <AuditPageComponent
      workspaceId={resolvedParams.workspace}
      projectId={resolvedParams.project}
      defaultEndUserId={defaultEndUserId}
    />
  );
}
