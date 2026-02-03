'use client';

import { useState, useEffect } from 'react';
import { AuditPage as AuditPageComponent } from '@/components/audit-usage/AuditPage';
import { useAuthStore } from '@/lib/stores/authStore';

interface AuditPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AuditPage({ params }: AuditPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string;
    project: string;
  } | null>(null);
  const currentUser = useAuthStore((s) => s.user);
  const currentProject = useAuthStore((s) => s.currentProject);

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({ workspace: p.workspace, project: p.project }),
    );
  }, [params]);

  if (!resolvedParams) {
    return <div className="p-6">Loading...</div>;
  }

  // project-user (user role) can only see own audit events; lock end_user_id filter
  const defaultEndUserId =
    currentProject?.role === 'user' ? currentUser?.id : undefined;

  return (
    <AuditPageComponent
      workspaceId={resolvedParams.workspace}
      projectId={resolvedParams.project}
      defaultEndUserId={defaultEndUserId}
    />
  );
}
