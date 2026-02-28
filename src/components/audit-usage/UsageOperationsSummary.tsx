'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { UsageOperationsSummaryResponse } from '@/lib/api/endpoints/audit-usage';

type UsageOperationsSummaryProps = {
  summary?: UsageOperationsSummaryResponse;
  loading?: boolean;
};

function formatUsd(value?: number): string {
  return `$${(value ?? 0).toFixed(6)}`;
}

function severityVariant(severity: 'medium' | 'high'): 'outline' | 'destructive' {
  return severity === 'high' ? 'destructive' : 'outline';
}

export function UsageOperationsSummary({ summary, loading = false }: UsageOperationsSummaryProps) {
  const t = useTranslations('usage');

  const topProviders = summary?.top_providers ?? [];
  const topModels = summary?.top_models ?? [];
  const topEndUsers = summary?.top_end_users ?? [];
  const anomalyPeaks = summary?.anomaly_peaks ?? [];
  const recentRequests = summary?.recent_requests ?? [];

  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid="usage__operations-summary">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('operations.title')}</h3>
          <p className="text-xs text-tertiary">{t('operations.subtitle')}</p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="usage__operations-top-providers">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-tertiary">{t('operations.top_providers')}</h4>
          <div className="space-y-2">
            {topProviders.length === 0 ? (
              <p className="text-sm text-tertiary">{loading ? t('operations.loading') : t('operations.empty')}</p>
            ) : topProviders.map((item) => (
              <div key={item.provider} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-foreground">{item.provider}</div>
                  <div className="text-xs text-tertiary">{t('operations.requests_errors', { requests: item.requests, errors: item.errors })}</div>
                </div>
                <div className="text-sm font-medium text-foreground">{formatUsd(item.estimated_cost)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="usage__operations-top-models">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-tertiary">{t('operations.top_models')}</h4>
          <div className="space-y-2">
            {topModels.length === 0 ? (
              <p className="text-sm text-tertiary">{loading ? t('operations.loading') : t('operations.empty')}</p>
            ) : topModels.map((item) => (
              <div key={`${item.provider}:${item.model}`} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-foreground">{item.provider}/{item.model}</div>
                  <div className="text-xs text-tertiary">{t('operations.requests_errors', { requests: item.requests, errors: item.errors })}</div>
                </div>
                <div className="text-sm font-medium text-foreground">{formatUsd(item.estimated_cost)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="usage__operations-top-end-users">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-tertiary">{t('operations.top_end_users')}</h4>
          <div className="space-y-2">
            {topEndUsers.length === 0 ? (
              <p className="text-sm text-tertiary">{loading ? t('operations.loading') : t('operations.empty')}</p>
            ) : topEndUsers.map((item) => (
              <div key={item.end_user_id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-foreground">{item.end_user_id}</div>
                  <div className="text-xs text-tertiary">{t('operations.requests_errors', { requests: item.requests, errors: item.errors })}</div>
                </div>
                <div className="text-sm font-medium text-foreground">{formatUsd(item.estimated_cost)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="usage__operations-anomalies">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-tertiary">{t('operations.anomaly_peaks')}</h4>
          <div className="space-y-2">
            {anomalyPeaks.length === 0 ? (
              <p className="text-sm text-tertiary">{loading ? t('operations.loading') : t('operations.no_anomalies')}</p>
            ) : anomalyPeaks.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-subtle px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-foreground">{t(`operations.metric_${item.metric}`)}</div>
                  <div className="text-xs text-tertiary">
                    {item.time_bucket}
                    {' · '}
                    {t('operations.baseline_value', { baseline: item.baseline, value: item.value })}
                  </div>
                </div>
                <Badge variant={severityVariant(item.severity)}>{t(`operations.severity_${item.severity}`)}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="usage__operations-recent-requests">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-tertiary">{t('operations.recent_requests')}</h4>
        <div className="space-y-2">
          {recentRequests.length === 0 ? (
            <p className="text-sm text-tertiary">{loading ? t('operations.loading') : t('operations.empty')}</p>
          ) : recentRequests.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle py-2 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <div className="font-mono text-sm text-foreground">{item.provider ?? '-'}{item.model ? `/${item.model}` : ''}</div>
                <div className="text-xs text-tertiary">
                  {item.request_id ?? item.id}
                  {item.end_user_id ? ` · ${item.end_user_id}` : ''}
                  {item.error_class ? ` · ${item.error_class}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={item.result === 'error' ? 'destructive' : 'secondary'}>
                  {item.result === 'error' ? t('operations.result_error') : t('operations.result_ok')}
                </Badge>
                <div className="text-sm text-foreground">{formatUsd(item.estimated_cost)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-subtle bg-bg-base/40 p-3" data-testid="usage__operations-webhook-destinations">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-tertiary">{t('operations.webhook_destinations')}</h4>
        <div className="space-y-2">
          {(summary?.webhook_destinations ?? []).length === 0 ? (
            <p className="text-sm text-tertiary">{loading ? t('operations.loading') : t('operations.empty')}</p>
          ) : (summary?.webhook_destinations ?? []).map((item) => (
            <div key={`${item.host}:${item.path ?? ''}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle py-2 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <div className="truncate font-mono text-sm text-foreground">
                  {item.protocol ? `${item.protocol}://` : ''}{item.host}{item.path ?? ''}
                </div>
                <div className="text-xs text-tertiary">
                  {t('operations.webhook_delivery_counts', { deliveries: item.deliveries, failures: item.failures })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
                <Badge variant={item.last_status === 'failed' ? 'destructive' : 'outline'}>{item.last_status}</Badge>
                <span>{t('operations.webhook_success_rate', { rate: (item.success_rate * 100).toFixed(1) })}</span>
                <span>{t('operations.webhook_p95_latency', { latency: item.p95_latency_ms ? Math.round(item.p95_latency_ms) : '--' })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
