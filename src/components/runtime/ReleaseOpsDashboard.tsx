'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import type {
  RuntimeObservabilityResponse,
  UsageOperationsSummaryResponse,
  UsageReportEvidence,
} from '@/lib/api/endpoints/audit-usage';

type ReleaseOpsDashboardProps = {
  runtime?: RuntimeObservabilityResponse;
  usageEvidence?: UsageReportEvidence;
  operationsSummary?: UsageOperationsSummaryResponse;
  loading?: boolean;
};

function formatPercent(value?: number): string {
  return `${(((value ?? 0) * 100)).toFixed(1)}%`;
}

function formatMs(value?: number): string {
  return typeof value === 'number' ? `${Math.round(value)}ms` : '--';
}

export function ReleaseOpsDashboard({
  runtime,
  usageEvidence,
  operationsSummary,
  loading = false,
}: ReleaseOpsDashboardProps) {
  const t = useTranslations('settings');
  const commonT = useTranslations('common');
  const usageT = useTranslations('usage');
  const destinations = operationsSummary?.webhook_destinations ?? [];

  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__dashboard">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('release_ops_title')}</h3>
          <p className="text-xs text-tertiary">{t('release_ops_subtitle')}</p>
        </div>
        {loading ? <div className="text-xs text-tertiary">{commonT('loading')}</div> : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__runtime-errors">
          <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('release_ops_runtime_error_rate')}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{formatPercent(runtime?.error_rate)}</div>
        </div>
        <div className="rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__runtime-recovered">
          <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('release_ops_runtime_recovered')}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{runtime?.health_summary.recovered_requests ?? 0}</div>
        </div>
        <div className="rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__usage-release">
          <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('release_ops_usage_release')}</div>
          <div className="mt-1">
            <StatusBadge status={usageEvidence?.release_readiness === 'ready' ? 'ready' : 'blocked'}>
              {usageEvidence ? usageT(`report_schedules.release_${usageEvidence.release_readiness}`) : '--'}
            </StatusBadge>
          </div>
        </div>
        <div className="rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__runner-status">
          <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('release_ops_runner_status')}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{usageEvidence?.runner_health?.last_status ?? '--'}</div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__webhook-health">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-tertiary">{t('release_ops_webhook_destinations')}</div>
        {destinations.length === 0 ? (
          <div className="text-sm text-tertiary">{t('release_ops_webhook_empty')}</div>
        ) : (
          <div className="space-y-2">
            {destinations.slice(0, 5).map((item, index) => (
              <div
                key={`${item.host}-${item.path ?? ''}-${index}`}
                className="rounded-md border border-subtle bg-surface px-3 py-2"
                data-testid={`release-ops__webhook-destination-${index}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm text-foreground">
                      {item.protocol ? `${item.protocol}://` : ''}{item.host}{item.path ?? ''}
                    </div>
                    <div className="text-xs text-tertiary">
                      {t('release_ops_webhook_counts', {
                        deliveries: item.deliveries,
                        failures: item.failures,
                      })}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.last_status === 'failed' ? 'blocked' : 'ready'}>
                      {item.last_status}
                    </StatusBadge>
                    <Badge variant="outline">{formatPercent(item.success_rate)}</Badge>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-tertiary">
                  <span>{t('release_ops_webhook_p95_latency')}: {formatMs(item.p95_latency_ms)}</span>
                  <span>{t('release_ops_webhook_timeout_failures')}: {item.timeout_failures}</span>
                  <span>{t('release_ops_webhook_network_failures')}: {item.network_failures}</span>
                  <span>{t('release_ops_webhook_server_failures')}: {item.server_failures}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
