/**
 * Members Page
 *
 * Manage project members, permissions, and quotas.
 */

'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { MembersPage } from '@/components/members/MembersPage';
import { FeatureAvailabilityBanner } from '@/components/ui/FeatureAvailabilityBanner';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { getFeatureAvailability, isFeatureBlockedInCurrentMode } from '@/lib/constants/feature-availability';

interface MembersPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function MembersRoute({ params }: MembersPageProps) {
  const tErrors = useTranslations('errors');
  const t = useTranslations('members');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const canProjectMemberRead = useHasPermission('project:member:view');
  const canProjectAdminGrant = useHasPermission('project:member:manage');
  const canProjectAdminRevoke = useHasPermission('project:member:manage');
  const canReadMembers = canProjectMemberRead || canProjectAdminGrant || canProjectAdminRevoke;
  const featureAvailability = getFeatureAvailability('members');
  const isFeatureBlocked = isFeatureBlockedInCurrentMode('members');

  useEffect(() => {
    params.then((p) => {
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        locale: p.locale,
      });
    });
  }, [params]);

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadMembers) {
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
        <PageLayout header={<PageHeader title={t('title')} subtitle={t('description')} />}>
          <div className="mx-auto w-full max-w-4xl p-4">
            <FeatureAvailabilityBanner availability={featureAvailability} />
          </div>
        </PageLayout>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <MembersPage
        workspaceId={resolvedParams.workspace}
        projectId={resolvedParams.project}
        locale={resolvedParams.locale}
      />
    </PageState>
  );
}
