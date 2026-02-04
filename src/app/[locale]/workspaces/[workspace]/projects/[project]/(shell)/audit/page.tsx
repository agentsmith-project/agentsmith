'use client';

import { useState, useEffect } from 'react';
import { AuditPage as AuditPageComponent } from '@/components/audit-usage/AuditPage';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { useAuthStore } from '@/lib/stores/authStore';
import { validateProjectWithMembership } from '@/lib/utils/validation-zod';

interface AuditPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AuditPage({ params }: AuditPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string;
    project: string;
  } | null>(null);
  const currentUser = useAuthStore((s) => s.user);
  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const { data: currentProject } = useProject(workspaceId, projectId);

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({ workspace: p.workspace, project: p.project }),
    );
  }, [params]);

  if (!resolvedParams) {
    return <div className="p-6">Loading...</div>;
  }

  const validatedProject = currentProject
    ? validateProjectWithMembership(currentProject)
    : null;
  const defaultEndUserId =
    validatedProject?.role === 'user' ? currentUser?.id : undefined;

  return (
    <AuditPageComponent
      workspaceId={workspaceId}
      projectId={projectId}
      defaultEndUserId={defaultEndUserId}
    />
  );
}
