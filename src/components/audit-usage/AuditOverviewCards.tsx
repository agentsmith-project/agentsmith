'use client';

import type { AuditOverviewSummary } from './audit-page-types';

interface AuditOverviewCardsProps {
  summary: AuditOverviewSummary;
  t: (key: string) => string;
}

export function AuditOverviewCards({ summary, t }: AuditOverviewCardsProps) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2"
      data-testid="audit__summary"
    >
      <div
        className="inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-low px-3 py-1.5"
        data-testid="audit__summary-card--changes"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('overview.changes')}</p>
        <p className="text-sm font-semibold text-foreground">{summary.changeCount}</p>
      </div>
      <div
        className="inline-flex items-center gap-2 rounded-full border border-amber-400/15 bg-amber-400/[0.07] px-3 py-1.5"
        data-testid="audit__summary-card--anomalies"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('overview.anomalies')}</p>
        <p className="text-sm font-semibold text-foreground">{summary.anomalyCount}</p>
      </div>
      <div
        className="inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-low px-3 py-1.5"
        data-testid="audit__summary-card--resources"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('overview.resources')}</p>
        <p className="text-sm font-semibold text-foreground">{summary.affectedResourceCount}</p>
      </div>
    </div>
  );
}
