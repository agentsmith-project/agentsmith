'use client';

import { useTranslations } from 'next-intl';
import { AuditPage as AuditPageComponent } from '@/components/audit-usage/AuditPage';
import { FeatureAvailabilityBanner } from '@/components/ui/FeatureAvailabilityBanner';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useCanReadAudit } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { getFeatureAvailability, isFeatureBlockedInCurrentMode } from '@/lib/constants/feature-availability';

interface AuditPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AuditPage({ params }: AuditPageProps) {
  const tErrors = useTranslations('errors');
  const t = useTranslations('audit');
  const resolvedParams = useResolvedProjectRoute(params);
  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const canViewAudit = useCanReadAudit();
  const { isLoading: permissionLoading } = useProject(workspaceId, projectId);
  const featureAvailability = getFeatureAvailability('audit');
  const isFeatureBlocked = isFeatureBlockedInCurrentMode('audit');

  if (!resolvedParams.isReady) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.isValid || !workspaceId || !projectId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (permissionLoading && !canViewAudit) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!canViewAudit) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  if (isFeatureBlocked) {
    return (
      <PageState state="success">
        <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} variant="compact" />}>
          <div className="mx-auto w-full max-w-4xl p-4">
            <FeatureAvailabilityBanner availability={featureAvailability} />
          </div>
        </PageLayout>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <AuditPageComponent
        workspaceId={workspaceId}
        projectId={projectId}
        locale={resolvedParams.locale}
      />
    </PageState>
  );
}
