'use client';

import type { AuditOverviewSummary } from './audit-page-types';

interface AuditOverviewCardsProps {
  summary: AuditOverviewSummary;
  t: (key: string) => string;
}

export function AuditOverviewCards({ summary, t }: AuditOverviewCardsProps) {
  return (
    <div
      className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      data-testid="audit__summary"
    >
      <div className="rounded-xl border border-subtle bg-surface px-4 py-3" data-testid="audit__summary-card--changes">
        <p className="text-xs font-medium uppercase tracking-wide text-tertiary">{t('overview.changes')}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{summary.changeCount}</p>
      </div>
      <div className="rounded-xl border border-subtle bg-surface px-4 py-3" data-testid="audit__summary-card--anomalies">
        <p className="text-xs font-medium uppercase tracking-wide text-tertiary">{t('overview.anomalies')}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{summary.anomalyCount}</p>
      </div>
      <div className="rounded-xl border border-subtle bg-surface px-4 py-3" data-testid="audit__summary-card--resources">
        <p className="text-xs font-medium uppercase tracking-wide text-tertiary">{t('overview.resources')}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{summary.affectedResourceCount}</p>
      </div>
    </div>
  );
}
