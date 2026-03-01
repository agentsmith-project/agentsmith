'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageLoading } from '@/components/ui/loading';
import { PageState } from '@/components/layout/PageState';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { RuntimeObservabilityConsole } from '@/components/runtime/RuntimeObservabilityConsole';
import { parseSharedOpsFilterContext } from '@/lib/ops-filter-context';

interface RuntimeObservabilityPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function RuntimeObservabilityPage({ params }: RuntimeObservabilityPageProps) {
  const tErrors = useTranslations('errors');
  const settingsT = useTranslations('settings');
  const searchParams = useSearchParams();
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const canReadUsage = useHasPermission('project:usage:view');
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

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={settingsT('runtime_observability_console_title')}
            subtitle={settingsT('runtime_observability_console_subtitle')}
          />
        )}
      >
        <RuntimeObservabilityConsole
          workspaceId={resolvedParams.workspace}
          projectId={resolvedParams.project}
          locale={resolvedParams.locale}
          initialFilters={initialFilters}
        />
      </PageLayout>
    </PageState>
  );
}
