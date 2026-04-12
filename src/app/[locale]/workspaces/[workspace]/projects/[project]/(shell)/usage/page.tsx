'use client';

import { useTranslations } from 'next-intl';
import { UsagePage as UsagePageComponent } from '@/components/audit-usage/UsagePage';
import { FeatureAvailabilityBanner } from '@/components/ui/FeatureAvailabilityBanner';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useAuthStore } from '@/lib/stores/authStore';
import { useUsagePageCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { useProject } from '@/lib/hooks/use-projects-queries';
import { getFeatureAvailability, isFeatureBlockedInCurrentMode } from '@/lib/constants/feature-availability';
import { ProjectRecoveryState } from '../_components/ProjectRecoveryState';

interface UsagePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UsagePage({ params }: UsagePageProps) {
  const tErrors = useTranslations('errors');
  const t = useTranslations('usage');
  const resolvedParams = useResolvedProjectRoute(params);
  const currentUser = useAuthStore((s) => s.user);
  const { canRead: canViewUsage } = useUsagePageCapabilities();
  const featureAvailability = getFeatureAvailability('usage');
  const isFeatureBlocked = isFeatureBlockedInCurrentMode('usage');
  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const { isLoading: permissionLoading } = useProject(workspaceId, projectId);

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
        <ProjectRecoveryState
          title={tErrors('validation_error')}
          description={tErrors('badRequest.description')}
          locale={resolvedParams.locale}
          workspaceId={workspaceId}
        />
      </PageState>
    );
  }

  if (permissionLoading && !canViewUsage) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!canViewUsage) {
    return (
      <PageState state="error">
        <ProjectRecoveryState
          title={tErrors('permission_denied_title')}
          description={tErrors('permission_denied_hint')}
          locale={resolvedParams.locale}
          workspaceId={workspaceId}
        />
      </PageState>
    );
  }

  if (isFeatureBlocked) {
    return (
      <PageState state="success">
        <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
          <div className="mx-auto w-full max-w-4xl p-4">
            <FeatureAvailabilityBanner availability={featureAvailability} />
          </div>
        </PageLayout>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <UsagePageComponent
        workspaceId={workspaceId}
        projectId={projectId}
        locale={resolvedParams.locale}
        defaultEndUserId={currentUser?.id}
        currentUserId={currentUser?.id}
      />
    </PageState>
  );
}
