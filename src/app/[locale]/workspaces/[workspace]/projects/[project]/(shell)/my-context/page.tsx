'use client';

import { useTranslations } from 'next-intl';
import { ContextManager } from '@/components/context/ContextManager';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { validateProjectWithMembership } from '@/lib/utils/validation-zod';

interface ProjectPersonalContextPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function ProjectPersonalContextPage({ params }: ProjectPersonalContextPageProps) {
  const resolvedParams = useResolvedProjectRoute(params);
  const t = useTranslations('context_store');
  const tErrors = useTranslations('errors');
  const canReadWorkspace = useHasWorkspacePermission('workspace:read');
  const { data: currentProject, isLoading: isProjectLoading } = useProject(
    resolvedParams.workspace ?? '',
    resolvedParams.project ?? '',
  );
  const validatedProject = currentProject ? validateProjectWithMembership(currentProject) : null;
  const hasActiveProjectMembership = validatedProject?.membership_status === 'active';

  if (!resolvedParams.isReady) {
    return <PageState state="loading" />;
  }

  if (!resolvedParams.isValid || !resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadWorkspace) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  if (isProjectLoading) {
    return <PageState state="loading" />;
  }

  if (!hasActiveProjectMembership) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{t('member_project_forbidden_description')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={t('member_project_title')}
            subtitle={t('member_project_subtitle')}
            variant="compact"
          />
        )}
      >
        <div className="mb-4 max-w-3xl text-sm leading-6 text-tertiary" data-testid="context-store__scope-note">{t('member_project_scope_note')}</div>
        <ContextManager
          scope="project_member"
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
          surface="project"
        />
      </PageLayout>
    </PageState>
  );
}
