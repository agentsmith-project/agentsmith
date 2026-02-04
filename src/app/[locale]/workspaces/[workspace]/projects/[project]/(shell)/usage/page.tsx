'use client';

import { useState, useEffect } from 'react';
import { UsagePage as UsagePageComponent } from '@/components/audit-usage/UsagePage';
import { useAuthStore } from '@/lib/stores/authStore';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { validateProjectWithMembership } from '@/lib/utils/validation-zod';

interface UsagePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UsagePage({ params }: UsagePageProps) {
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
    <UsagePageComponent
      workspaceId={workspaceId}
      projectId={projectId}
      defaultEndUserId={defaultEndUserId}
      currentUserId={currentUser?.id}
    />
  );
}
