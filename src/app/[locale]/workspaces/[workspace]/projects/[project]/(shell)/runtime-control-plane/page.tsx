'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { RuntimeControlPlanePanel } from '@/components/settings/RuntimeControlPlanePanel';
import { RuntimeObservabilityConsole } from '@/components/runtime/RuntimeObservabilityConsole';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RuntimeControlPlanePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function RuntimeControlPlanePage({ params }: RuntimeControlPlanePageProps) {
  const tErrors = useTranslations('errors');
  const settingsT = useTranslations('settings');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const canManage = useHasPermission('project:manage');

  useEffect(() => {
    params.then((p) => setResolvedParams({
      workspace: validateWorkspaceParam(p.workspace),
      project: validateProjectParam(p.project),
      locale: p.locale,
    }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

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
        header={
          <PageHeader
            title={settingsT('runtime_control_plane_title')}
            subtitle={settingsT('runtime_control_plane_subtitle')}
            actions={(
              <Link
                href={`/${resolvedParams.locale}/workspaces/${resolvedParams.workspace}/projects/${resolvedParams.project}/runtime-observability`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="runtime-cp__open-observability"
              >
                {settingsT('runtime_observability_open_console')}
              </Link>
            )}
          />
        }
      >
        <div className="space-y-4">
          <RuntimeObservabilityConsole
            workspaceId={workspaceId}
            projectId={projectId}
          />
          <RuntimeControlPlanePanel workspaceId={workspaceId} projectId={projectId} />
        </div>
      </PageLayout>
    </PageState>
  );
}
