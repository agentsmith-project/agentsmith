'use client';

import type { AuditOverviewSummary } from './audit-page-types';

interface AuditOverviewCardsProps {
  summary: AuditOverviewSummary;
  t: (key: string) => string;
}

export function AuditOverviewCards({ summary, t }: AuditOverviewCardsProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 text-xs text-tertiary"
      data-testid="audit__summary-line"
    >
      <span>
        <span className="text-foreground">{summary.changeCount}</span> {t('overview.changes')}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        <span className="text-foreground">{summary.anomalyCount}</span> {t('overview.anomalies')}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        <span className="text-foreground">{summary.affectedResourceCount}</span> {t('overview.resources')}
      </span>
    </div>
  );
}
