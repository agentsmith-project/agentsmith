'use client';

import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { ContextManager } from '@/components/context/ContextManager';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';

interface ProjectContextPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function ProjectContextPage({ params }: ProjectContextPageProps) {
  const resolvedParams = useResolvedProjectRoute(params);
  const t = useTranslations('context_store');
  const tErrors = useTranslations('errors');
  const canManage = useHasPermission('project:governance:update');

  if (!resolvedParams.isReady) {
    return <PageState state="loading" />;
  }

  if (!resolvedParams.isValid || !resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canManage) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={t('project_title')}
            subtitle={t('project_subtitle')}
            variant="compact"
          />
        )}
      >
        <ContextManager
          scope="project"
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
        />
      </PageLayout>
    </PageState>
  );
}
