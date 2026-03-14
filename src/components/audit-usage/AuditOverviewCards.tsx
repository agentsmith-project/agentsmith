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
      <div
        className="rounded-[20px] border border-white/6 bg-white/[0.035] px-4 py-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
        data-testid="audit__summary-card--changes"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('overview.changes')}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{summary.changeCount}</p>
        <p className="mt-1 text-sm text-secondary">{t('subtitle')}</p>
      </div>
      <div
        className="rounded-[20px] border border-amber-400/15 bg-amber-400/[0.07] px-4 py-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
        data-testid="audit__summary-card--anomalies"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('overview.anomalies')}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{summary.anomalyCount}</p>
        <p className="mt-1 text-sm text-secondary">{t('overview_title')}</p>
      </div>
      <div
        className="rounded-[20px] border border-white/6 bg-white/[0.035] px-4 py-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
        data-testid="audit__summary-card--resources"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('overview.resources')}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{summary.affectedResourceCount}</p>
        <p className="mt-1 text-sm text-secondary">{t('summary.resource_label')}</p>
      </div>
    </div>
  );
}
