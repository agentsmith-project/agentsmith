'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { JSONViewer } from '@/components/audit-usage/JSONViewer';
import type { UsageFactRecord } from '@/lib/api/types';
import { getGovernanceEvidenceDetails } from '@/lib/api/endpoints/governance-explainability';
import { buildSharedOpsFilterQuery } from '@/lib/ops-filter-context';

type AttemptTrace = {
  index?: number;
  provider?: string;
  model?: string;
  outcome?: string;
  statusCode?: number;
  errorClass?: string;
  reason?: string;
  durationMs?: number;
};

export interface RuntimeFactDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facts: UsageFactRecord[];
  loading?: boolean;
  aggregateLabel?: string;
  basePath?: string;
}

function formatUsd(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `$${value.toFixed(6)}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function getAttempts(fact: UsageFactRecord): AttemptTrace[] {
  return Array.isArray(fact.runtime?.attempts)
    ? fact.runtime.attempts.filter((item) => item && typeof item === 'object') as AttemptTrace[]
    : [];
}

function formatGovernanceValue(value?: number | string | null): string {
  if (value === undefined || value === null || value === '') return '--';
  return String(value);
}

function getDefaultGovernanceAction(resourceType?: string): string {
  if (resourceType === 'source_library') return 'upload';
  if (resourceType === 'project') return 'read';
  return 'invoke';
}

function getEvidenceWindow(timestamp: string): { start_time: string; end_time: string } {
  const center = new Date(timestamp);
  if (Number.isNaN(center.getTime())) {
    const now = new Date();
    return {
      start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      end_time: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    };
  }
  return {
    start_time: new Date(center.getTime() - 30 * 60 * 1000).toISOString(),
    end_time: new Date(center.getTime() + 30 * 60 * 1000).toISOString(),
  };
}

export function RuntimeFactDetailDrawer({
  open,
  onOpenChange,
  facts,
  loading = false,
  aggregateLabel,
  basePath,
}: RuntimeFactDetailDrawerProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');

  const totalCost = React.useMemo(
    () => facts.reduce((sum, fact) => sum + (typeof fact.runtime?.estimated_cost === 'number' ? fact.runtime.estimated_cost : 0), 0),
    [facts],
  );
  const recoveredCount = React.useMemo(
    () => facts.filter((fact) => (fact.runtime?.fallback_hops ?? 0) > 0).length,
    [facts],
  );
  const errorCount = React.useMemo(
    () => facts.filter((fact) => fact.result === 'error').length,
    [facts],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right-wide" className="flex h-full flex-col gap-0 overflow-hidden p-0">
        <SheetHeader className="border-b border-subtle px-6 py-4">
          <SheetTitle>{t('detail.title')}</SheetTitle>
          <SheetDescription>
            {aggregateLabel ? t('detail.aggregate_bucket', { bucket: aggregateLabel }) : t('detail.subtitle')}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-4" data-testid="runtime__detail-summary__requests">
              <div className="text-xs uppercase tracking-[0.14em] text-tertiary">{t('detail.requests')}</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{facts.length}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4" data-testid="runtime__detail-summary__recovered">
              <div className="text-xs uppercase tracking-[0.14em] text-tertiary">{t('detail.recovered')}</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{recoveredCount}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4" data-testid="runtime__detail-summary__cost">
              <div className="text-xs uppercase tracking-[0.14em] text-tertiary">{t('detail.cost')}</div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{formatUsd(totalCost)}</div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-tertiary">
            <Badge variant="secondary">{t('detail.errors_badge', { count: errorCount })}</Badge>
            <Badge variant="secondary">{t('detail.recovered_badge', { count: recoveredCount })}</Badge>
            {aggregateLabel ? <Badge variant="outline">{aggregateLabel}</Badge> : null}
          </div>

          {loading ? (
            <div className="mt-6 rounded-xl border border-border border-dashed bg-surface p-6 text-sm text-tertiary">
              {commonT('loading')}
            </div>
          ) : facts.length === 0 ? (
            <div className="mt-6 rounded-xl border border-border border-dashed bg-surface p-6 text-sm text-tertiary" data-testid="runtime__detail-empty">
              {t('detail.empty')}
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {facts.map((fact) => {
                const attempts = getAttempts(fact);
                const governance = getGovernanceEvidenceDetails({
                  error_code: fact.error_code,
                  ...(fact.metadata_json ?? {}),
                });
                const membersHref = basePath && fact.end_user_id
                  ? `${basePath}/members${buildSharedOpsFilterQuery({}, {
                    member_tab: 'people',
                    member_id: fact.end_user_id,
                    authorize_resource_type: fact.resource_type,
                    authorize_resource_id: fact.resource_id,
                    authorize_action: getDefaultGovernanceAction(fact.resource_type),
                  })}`
                  : null;
                const resourcePolicyHref = basePath && fact.resource_id
                  && (fact.resource_type === 'endpoint' || fact.resource_type === 'source_library' || fact.resource_type === 'agent')
                  ? `${basePath}/resource-policy${buildSharedOpsFilterQuery({}, {
                    resource_type: fact.resource_type,
                    resource_id: fact.resource_id,
                    explain_subject_type: fact.end_user_id ? 'user' : undefined,
                    explain_subject_id: fact.end_user_id,
                    explain_action: getDefaultGovernanceAction(fact.resource_type),
                  })}`
                  : null;
                const metadata = fact.metadata_json ?? {};
                const traceRef = typeof metadata.trace_ref === 'string' ? metadata.trace_ref : undefined;
                const traceIncidentId = typeof metadata.trace_incident_id === 'string' ? metadata.trace_incident_id : undefined;
                const traceEscalationId = typeof metadata.trace_escalation_id === 'string' ? metadata.trace_escalation_id : undefined;
                const traceRunId = typeof metadata.trace_run_id === 'string' ? metadata.trace_run_id : undefined;
                const auditHref = basePath
                  ? `${basePath}/audit${buildSharedOpsFilterQuery(getEvidenceWindow(fact.timestamp), {
                    resource_type: fact.resource_type,
                    resource_id: fact.resource_id,
                    end_user_id: fact.end_user_id,
                    result: fact.result,
                    request_id: fact.request_id,
                    decision_id: fact.decision_id,
                    trace_ref: traceRef,
                    trace_incident_id: traceIncidentId,
                    trace_escalation_id: traceEscalationId,
                    trace_run_id: traceRunId,
                  })}`
                  : null;
                return (
                  <section
                    key={fact.id}
                    className="rounded-2xl border border-border bg-surface shadow-sm"
                    data-testid={`runtime__detail-fact-${fact.id}`}
                  >
                    <div className="border-b border-subtle px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="text-sm font-semibold text-foreground">{formatTimestamp(fact.timestamp)}</div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
                            <code className="rounded bg-surface-high px-2 py-1 text-foreground">{fact.request_id ?? fact.id}</code>
                            {fact.resource_id ? <Badge variant="outline">{fact.resource_id}</Badge> : null}
                            {fact.end_user_id ? <Badge variant="outline">{fact.end_user_id}</Badge> : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={fact.result === 'ok' ? 'outline' : 'destructive'}>
                            {fact.result === 'ok' ? commonT('success') : commonT('error')}
                          </Badge>
                          {(fact.runtime?.fallback_hops ?? 0) > 0 ? <Badge>{t('detail.recovered_status')}</Badge> : null}
                          {fact.runtime?.missing_price ? <Badge variant="secondary">{t('detail.missing_price')}</Badge> : null}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 px-5 py-4 md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.provider')}</div>
                        <div className="mt-2 font-mono text-sm text-foreground">{fact.runtime?.provider ?? '--'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.model')}</div>
                        <div className="mt-2 font-mono text-sm text-foreground">{fact.runtime?.resolved_model ?? '--'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.tokens')}</div>
                        <div className="mt-2 text-sm text-foreground">{fact.tokens_total ?? '--'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.estimated_cost')}</div>
                        <div className="mt-2 text-sm text-foreground">{formatUsd(fact.runtime?.estimated_cost)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.decision_id')}</div>
                        <div className="mt-2 font-mono text-sm text-foreground" data-testid={`runtime__detail-decision-id-${fact.id}`}>
                          {fact.decision_id ?? '--'}
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-subtle px-5 py-4">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.error_class')}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="rounded bg-surface-high px-2 py-1 text-xs text-foreground">
                          {fact.runtime?.error_class ?? '--'}
                        </code>
                        {fact.error_code ? <Badge variant="outline">{fact.error_code}</Badge> : null}
                      </div>
                    </div>

                    <div className="border-t border-subtle px-5 py-4">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.pricing_version')}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2" data-testid={`runtime__detail-pricing-version-${fact.id}`}>
                        <code className="rounded bg-surface-high px-2 py-1 text-xs text-foreground">
                          {fact.runtime?.pricing_version ?? '--'}
                        </code>
                        {fact.runtime?.missing_price ? <Badge variant="secondary">{t('detail.missing_price')}</Badge> : null}
                      </div>
                    </div>

                    {governance ? (
                      <div className="border-t border-subtle px-5 py-4" data-testid={`runtime__detail-governance-${fact.id}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-medium uppercase tracking-[0.14em] text-tertiary">{t('detail.governance_title')}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            {membersHref ? (
                              <Link
                                href={membersHref}
                                className="text-xs text-primary underline-offset-2 hover:underline"
                                data-testid={`runtime__detail-open-member-${fact.id}`}
                              >
                                {t('detail.open_member_access')}
                              </Link>
                            ) : null}
                            {resourcePolicyHref ? (
                              <Link
                                href={resourcePolicyHref}
                                className="text-xs text-primary underline-offset-2 hover:underline"
                                data-testid={`runtime__detail-open-resource-policy-${fact.id}`}
                              >
                                {t('detail.open_resource_policy')}
                              </Link>
                            ) : null}
                            {auditHref ? (
                              <Link
                                href={auditHref}
                                className="text-xs text-primary underline-offset-2 hover:underline"
                                data-testid={`runtime__detail-open-audit-${fact.id}`}
                              >
                                {t('detail.open_audit')}
                              </Link>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.governance_kind')}</div>
                            <div className="mt-2 text-sm text-foreground">{formatGovernanceValue(governance.governance_kind)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.enforcement_kind')}</div>
                            <div className="mt-2 text-sm text-foreground">{formatGovernanceValue(governance.enforcement_kind)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.limit_key')}</div>
                            <div className="mt-2 font-mono text-sm text-foreground">{formatGovernanceValue(governance.limit_key)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.scope')}</div>
                            <div className="mt-2 text-sm text-foreground">{formatGovernanceValue(governance.scope)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.effective_limit')}</div>
                            <div className="mt-2 text-sm text-foreground">{formatGovernanceValue(governance.effective_limit)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.current_usage')}</div>
                            <div className="mt-2 text-sm text-foreground">{formatGovernanceValue(governance.current_usage)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.usage_unit')}</div>
                            <div className="mt-2 text-sm text-foreground">{formatGovernanceValue(governance.usage_unit)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.reason_label')}</div>
                            <div className="mt-2 text-sm text-foreground">{formatGovernanceValue(governance.reason)}</div>
                          </div>
                        </div>
                        {governance.authz_decision?.membership_status || (governance.missing_permissions?.length ?? 0) > 0 ? (
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.membership_status')}</div>
                              <div className="mt-2 text-sm text-foreground">
                                {formatGovernanceValue(governance.authz_decision?.membership_status)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('detail.missing_permissions')}</div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {(governance.missing_permissions ?? []).length > 0 ? (
                                  governance.missing_permissions?.map((permission) => (
                                    <code key={permission} className="rounded bg-surface-high px-2 py-1 text-xs text-foreground">
                                      {permission}
                                    </code>
                                  ))
                                ) : (
                                  <span className="text-sm text-foreground">--</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="border-t border-subtle px-5 py-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-tertiary">{t('detail.timeline_title')}</div>
                      {attempts.length > 0 ? (
                        <div className="mt-3 space-y-3" data-testid={`runtime__detail-timeline-${fact.id}`}>
                          {attempts.map((attempt, index) => (
                            <div key={`${fact.id}-${index}`} className="rounded-xl border border-border/70 bg-surface-high/60 p-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-xs uppercase tracking-[0.14em] text-tertiary">
                                    {t('detail.attempt_label', { index: (attempt.index ?? index) + 1 })}
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-foreground">
                                    <code className="rounded bg-surface px-2 py-1">{attempt.provider ?? '--'}</code>
                                    <span className="text-tertiary">/</span>
                                    <code className="rounded bg-surface px-2 py-1">{attempt.model ?? '--'}</code>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {attempt.outcome ? <Badge variant="secondary">{attempt.outcome}</Badge> : null}
                                  {typeof attempt.statusCode === 'number' ? <Badge variant="outline">HTTP {attempt.statusCode}</Badge> : null}
                                  {typeof attempt.durationMs === 'number' ? <Badge variant="outline">{attempt.durationMs}ms</Badge> : null}
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-tertiary">
                                {attempt.errorClass ? <code className="rounded bg-surface px-2 py-1">{attempt.errorClass}</code> : null}
                                {attempt.reason ? <span>{attempt.reason}</span> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-xl border border-dashed border-border bg-surface-high/40 p-4 text-sm text-tertiary">
                          {t('detail.timeline_empty')}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-subtle px-5 py-4">
                      <JSONViewer data={fact.metadata_json ?? {}} />
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
