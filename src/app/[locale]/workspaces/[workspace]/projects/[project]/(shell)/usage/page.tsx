'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { UsagePage as UsagePageComponent } from '@/components/audit-usage/UsagePage';
import { FeatureAvailabilityBanner } from '@/components/ui/FeatureAvailabilityBanner';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useAuthStore } from '@/lib/stores/authStore';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { getFeatureAvailability, isFeatureBlockedInCurrentMode } from '@/lib/constants/feature-availability';

interface UsagePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UsagePage({ params }: UsagePageProps) {
  const tErrors = useTranslations('errors');
  const t = useTranslations('usage');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
    locale?: string;
  } | null>(null);
  const currentUser = useAuthStore((s) => s.user);
  const canViewUsage = useHasPermission('project:endpoint:use');
  const featureAvailability = getFeatureAvailability('usage');
  const isFeatureBlocked = isFeatureBlockedInCurrentMode('usage');
  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        locale: p.locale,
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

  if (!canViewUsage) {
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
