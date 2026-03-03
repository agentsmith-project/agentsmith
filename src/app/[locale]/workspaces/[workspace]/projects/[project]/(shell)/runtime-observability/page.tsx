'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageLoading } from '@/components/ui/loading';
import { PageState } from '@/components/layout/PageState';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { RuntimeObservabilityConsole } from '@/components/runtime/RuntimeObservabilityConsole';
import { buildSharedOpsFilterQuery, parseSharedOpsFilterContext } from '@/lib/ops-filter-context';
import { cn } from '@/lib/utils';

interface RuntimeObservabilityPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function RuntimeObservabilityPage({ params }: RuntimeObservabilityPageProps) {
  const tErrors = useTranslations('errors');
  const settingsT = useTranslations('settings');
  const commonT = useTranslations('common');
  const searchParams = useSearchParams();
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const canReadUsage = useHasPermission('project:endpoint:invoke');
  const initialFilters = parseSharedOpsFilterContext(searchParams);

  useEffect(() => {
    params.then((p) => setResolvedParams({
      workspace: validateWorkspaceParam(p.workspace),
      project: validateProjectParam(p.project),
      locale: p.locale,
    }));
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

  if (!canReadUsage) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  const locale = resolvedParams.locale ?? 'en-US';
  const basePath = `/${locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}`;
  const runtimeControlPlaneHref = `${basePath}/settings?tab=runtime`;
  const usageHref = `${basePath}/usage${buildSharedOpsFilterQuery(initialFilters, { panel: 'usage' })}`;
  const releaseOpsHref = `${basePath}/release-ops${buildSharedOpsFilterQuery(initialFilters)}`;

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={settingsT('runtime_observability_console_title')}
            subtitle={settingsT('runtime_observability_console_subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={runtimeControlPlaneHref}
                  className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                  data-testid="runtime-observability__open-control-plane"
                >
                  {settingsT('runtime_observability_open_control_plane')}
                </Link>
                <Link
                  href={usageHref}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="runtime-observability__open-usage"
                >
                  {commonT('open_usage')}
                </Link>
                <Link
                  href={releaseOpsHref}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="runtime-observability__open-release-ops"
                >
                  {commonT('open_release_ops')}
                </Link>
              </div>
            )}
          />
        )}
      >
        <RuntimeObservabilityConsole
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
          initialFilters={initialFilters}
        />
      </PageLayout>
    </PageState>
  );
}
