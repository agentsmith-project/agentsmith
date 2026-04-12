'use client';

import { useTranslations } from 'next-intl';
import { EndpointsPageView, type EndpointsPageProps } from '@/components/endpoints/EndpointsPage';
import { PageState } from '@/components/layout/PageState';
import { useEndpointPageCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { ProjectRecoveryState } from '../_components/ProjectRecoveryState';

interface EndpointsRouteProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function EndpointsPage({ params }: EndpointsRouteProps) {
  const tErrors = useTranslations('errors');
  const resolved = useResolvedProjectRoute(params);
  const capabilities = useEndpointPageCapabilities();

  if (!resolved.isReady) {
    return <PageState state="loading" />;
  }

  if (!resolved.isValid || !resolved.workspace || !resolved.project) {
    return (
      <PageState state="error">
        <ProjectRecoveryState
          title={tErrors('validation_error')}
          description={tErrors('badRequest.description')}
          locale={resolved.locale}
          workspaceId={resolved.workspace}
        />
      </PageState>
    );
  }

  if (!capabilities.canRead) {
    return (
      <PageState state="error">
        <ProjectRecoveryState
          title={tErrors('permission_denied_title')}
          description={tErrors('permission_denied_hint')}
          locale={resolved.locale}
          workspaceId={resolved.workspace}
        />
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
