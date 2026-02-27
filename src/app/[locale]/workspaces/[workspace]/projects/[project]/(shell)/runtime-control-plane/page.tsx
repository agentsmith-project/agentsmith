'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { RuntimeControlPlanePanel } from '@/components/settings/RuntimeControlPlanePanel';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { useRuntimeObservability } from '@/lib/hooks/use-audit-usage';

interface RuntimeControlPlanePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

function toISOTime(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

export default function RuntimeControlPlanePage({ params }: RuntimeControlPlanePageProps) {
  const tErrors = useTranslations('errors');
  const settingsT = useTranslations('settings');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string } | null>(null);
  const canManage = useHasPermission('project:settings:manage');

  useEffect(() => {
    params.then((p) => setResolvedParams({
      workspace: validateWorkspaceParam(p.workspace),
      project: validateProjectParam(p.project),
    }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const range = useMemo(() => ({
    start_time: toISOTime(24 * 60 * 60 * 1000),
    end_time: new Date().toISOString(),
  }), []);

  const observabilityQuery = useRuntimeObservability(workspaceId, projectId, range, {
    enabled: !!workspaceId && !!projectId && canManage,
  });

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

  const observability = observabilityQuery.data;
  const fallbackRatio = observability && observability.total_requests > 0
    ? 1 - ((observability.fallback_hops_histogram['0'] ?? 0) / observability.total_requests)
    : 0;
  const fallbackAlert = fallbackRatio > 0.2;
  const errorRateAlert = (observability?.error_rate ?? 0) > 0.05;

  return (
    <PageState state="success">
      <PageLayout
        header={
          <PageHeader
            title={settingsT('runtime_control_plane_title')}
            subtitle={settingsT('runtime_control_plane_subtitle')}
          />
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div
              className={`rounded-lg border p-3 ${fallbackAlert ? 'border-error/60 bg-error/5' : 'border-border bg-surface'}`}
              data-testid="runtime-cp__alert-fallback"
            >
              <div className="text-xs font-medium text-foreground">{settingsT('runtime_observability_alert_fallback_title')}</div>
              <div className="text-xs text-tertiary">
                {fallbackAlert
                  ? settingsT('runtime_observability_alert_fallback_high')
                  : settingsT('runtime_observability_alert_fallback_normal')}
              </div>
            </div>
            <div
              className={`rounded-lg border p-3 ${errorRateAlert ? 'border-error/60 bg-error/5' : 'border-border bg-surface'}`}
              data-testid="runtime-cp__alert-error-rate"
            >
              <div className="text-xs font-medium text-foreground">{settingsT('runtime_observability_alert_error_rate_title')}</div>
              <div className="text-xs text-tertiary">
                {errorRateAlert
                  ? settingsT('runtime_observability_alert_error_rate_high')
                  : settingsT('runtime_observability_alert_error_rate_normal')}
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-cp__kpi-total-requests">
              <div className="text-xs text-tertiary">{settingsT('runtime_observability_total_requests')}</div>
              <div className="text-xl font-semibold text-foreground">{observability?.total_requests ?? 0}</div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-cp__kpi-error-rate">
              <div className="text-xs text-tertiary">{settingsT('runtime_observability_error_rate')}</div>
              <div className="text-xl font-semibold text-foreground">{((observability?.error_rate ?? 0) * 100).toFixed(2)}%</div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-cp__kpi-fallback-rate">
              <div className="text-xs text-tertiary">{settingsT('runtime_observability_fallback_rate')}</div>
              <div className="text-xl font-semibold text-foreground">{(fallbackRatio * 100).toFixed(2)}%</div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-cp__kpi-p95-cost">
              <div className="text-xs text-tertiary">{settingsT('runtime_observability_p95_cost')}</div>
              <div className="text-xl font-semibold text-foreground">${(observability?.p95_estimated_cost ?? 0).toFixed(6)}</div>
            </div>
          </div>
          <RuntimeControlPlanePanel workspaceId={workspaceId} projectId={projectId} />
        </div>
      </PageLayout>
    </PageState>
  );
}
