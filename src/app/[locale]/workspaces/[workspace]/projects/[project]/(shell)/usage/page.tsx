'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { UsagePage as UsagePageComponent } from '@/components/audit-usage/UsagePage';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useAuthStore } from '@/lib/stores/authStore';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { validateProjectWithMembership } from '@/lib/utils/validation-zod';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

interface UsagePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UsagePage({ params }: UsagePageProps) {
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
  } | null>(null);
  const currentUser = useAuthStore((s) => s.user);
  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const { data: currentProject } = useProject(workspaceId, projectId);

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
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

  if (!workspaceId || !projectId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  const validatedProject = currentProject
    ? validateProjectWithMembership(currentProject)
    : null;
  const defaultEndUserId =
    validatedProject?.role === 'user' ? currentUser?.id : undefined;

  return (
    <PageState state="success">
      <UsagePageComponent
        workspaceId={workspaceId}
        projectId={projectId}
        defaultEndUserId={defaultEndUserId}
        currentUserId={currentUser?.id}
      />
    </PageState>
  );
}
