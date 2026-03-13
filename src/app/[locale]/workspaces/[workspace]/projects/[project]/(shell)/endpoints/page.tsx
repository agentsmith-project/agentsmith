'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { EndpointsPageView, type EndpointsPageProps } from '@/components/endpoints/EndpointsPage';
import { PageState } from '@/components/layout/PageState';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

interface EndpointsRouteProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function EndpointsPage({ params }: EndpointsRouteProps) {
  const tErrors = useTranslations('errors');
  const [resolved, setResolved] = useState<{ workspace: string | null; project: string | null; locale: string } | null>(null);
  const canUse = useHasPermission('project:endpoint:use');
  const canManage = useHasPermission('project:governance:update');
  const canRead = canUse || canManage;

  useEffect(() => {
    params.then((p) => {
      const nextParams = {
        workspace: validateWorkspaceParam(p.workspace) ?? null,
        project: validateProjectParam(p.project) ?? null,
        locale: p.locale ?? 'en-US',
      };
      setResolved((previous) =>
        previous &&
        previous.workspace === nextParams.workspace &&
        previous.project === nextParams.project &&
        previous.locale === nextParams.locale
          ? previous
          : nextParams,
      );
    });
  }, [params]);

  if (!resolved) {
    return <PageState state="loading" />;
  }

  if (!resolved.workspace || !resolved.project) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canRead) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  const viewParams: EndpointsPageProps['params'] = Promise.resolve({
    workspace: resolved.workspace,
    project: resolved.project,
    locale: resolved.locale,
  });

  return <EndpointsPageView params={viewParams} />;
}
