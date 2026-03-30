'use client';

import { useTranslations } from 'next-intl';
import { EndpointsPageView, type EndpointsPageProps } from '@/components/endpoints/EndpointsPage';
import { PageState } from '@/components/layout/PageState';
import { useEndpointPageCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';

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
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!capabilities.canRead) {
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
