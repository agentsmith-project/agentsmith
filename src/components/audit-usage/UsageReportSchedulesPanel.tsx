'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { UsageListParams } from '@/lib/api/types';
import type {
  UsageReportDelivery,
  UsageReportEvidence,
  UsageReportSchedule,
  UsageReportScheduleDeliveryResult,
} from '@/lib/api/endpoints/audit-usage';

type UsageReportSchedulesPanelProps = {
  schedules: UsageReportSchedule[];
  loading?: boolean;
  evidence?: UsageReportEvidence;
  evidenceLoading?: boolean;
  canManage: boolean;
  currentFilters: UsageListParams;
  onCreate: (payload: {
    name: string;
    cadence: 'daily' | 'weekly' | 'monthly';
    status: 'active' | 'paused';
    format: 'csv' | 'json';
    time_window: 'last_24h' | 'last_7d' | 'last_30d';
    delivery_channel: 'in_app' | 'webhook';
    delivery_config?: {
      webhook_url?: string;
      credential_ref?: string;
      secret_header_name?: string;
      signature_header_name?: string;
      timeout_seconds?: number;
      retry_attempts?: number;
      retry_backoff_ms?: number;
    };
    filters?: UsageReportSchedule['filters'];
    release_evidence_required: boolean;
    empty_result_policy: 'deliver' | 'fail';
  }) => Promise<void>;
  onUpdateStatus: (schedule: UsageReportSchedule, status: 'active' | 'paused') => Promise<void>;
  onDelete: (schedule: UsageReportSchedule) => Promise<void>;
  onTestDelivery: (schedule: UsageReportSchedule) => Promise<UsageReportScheduleDeliveryResult | null>;
  onRunNow: (schedule: UsageReportSchedule) => Promise<UsageReportScheduleDeliveryResult | null>;
  onRetryDelivery: (schedule: UsageReportSchedule, delivery: UsageReportDelivery) => Promise<UsageReportScheduleDeliveryResult | null>;
  onAcknowledgeDelivery: (schedule: UsageReportSchedule, delivery: UsageReportDelivery) => Promise<void>;
  onRunDue: () => Promise<void>;
};

type DraftState = {
  name: string;
  cadence: 'daily' | 'weekly' | 'monthly';
  format: 'csv' | 'json';
  time_window: 'last_24h' | 'last_7d' | 'last_30d';
  delivery_channel: 'in_app' | 'webhook';
  webhook_url: string;
  credential_ref: string;
  secret_header_name: string;
  signature_header_name: string;
  timeout_seconds: string;
  retry_attempts: string;
  retry_backoff_ms: string;
  provider?: string;
  model?: string;
  result?: 'ok' | 'error';
  release_evidence_required: boolean;
  empty_result_policy: 'deliver' | 'fail';
};

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatIso(value?: string): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function formatDeliveryMetadataValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function buildInitialDraft(filters: UsageListParams): DraftState {
  return {
    name: '',
    cadence: 'daily',
    format: 'json',
    time_window: 'last_7d',
    delivery_channel: 'in_app',
    webhook_url: '',
    credential_ref: '',
    secret_header_name: '',
    signature_header_name: '',
    timeout_seconds: '10',
    retry_attempts: '2',
    retry_backoff_ms: '250',
    provider: filters.provider,
    model: filters.model,
    result: filters.result,
    release_evidence_required: true,
    empty_result_policy: 'deliver',
  };
}

function parseTimeoutSeconds(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasValidTimeout(value: string): boolean {
  const parsed = parseTimeoutSeconds(value);
  return parsed == null || (parsed >= 1 && parsed <= 120);
}

function parsePositiveInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasValidRetryAttempts(value: string): boolean {
  const parsed = parsePositiveInt(value);
  return parsed == null || (parsed >= 1 && parsed <= 4);
}

function hasValidRetryBackoff(value: string): boolean {
  const parsed = parsePositiveInt(value);
  return parsed == null || (parsed >= 100 && parsed <= 5000);
}

export function UsageReportSchedulesPanel({
  schedules,
  loading = false,
  evidence,
  evidenceLoading = false,
  canManage,
  currentFilters,
  onCreate,
  onUpdateStatus,
  onDelete,
  onTestDelivery,
  onRunNow,
  onRetryDelivery,
  onAcknowledgeDelivery,
  onRunDue,
}: UsageReportSchedulesPanelProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DraftState>(() => buildInitialDraft(currentFilters));
  const [submitting, setSubmitting] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const [runningDue, setRunningDue] = React.useState(false);
  const [statusId, setStatusId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [retryDeliveryId, setRetryDeliveryId] = React.useState<string | null>(null);
  const [ackDeliveryId, setAckDeliveryId] = React.useState<string | null>(null);
  const [lastResult, setLastResult] = React.useState<UsageReportScheduleDeliveryResult | null>(null);

  React.useEffect(() => {
    if (!createOpen) {
      setDraft(buildInitialDraft(currentFilters));
    }
  }, [createOpen, currentFilters]);

  const handleCreate = React.useCallback(async () => {
    if (!draft.name.trim()) return;
    if (draft.delivery_channel === 'webhook' && !draft.webhook_url.trim()) return;
    if (draft.delivery_channel === 'webhook' && draft.credential_ref.trim() && !draft.secret_header_name.trim() && !draft.signature_header_name.trim()) return;
    if (draft.delivery_channel === 'webhook' && !draft.credential_ref.trim() && (draft.secret_header_name.trim() || draft.signature_header_name.trim())) return;
    if (draft.delivery_channel === 'webhook' && !hasValidTimeout(draft.timeout_seconds)) return;
    if (draft.delivery_channel === 'webhook' && !hasValidRetryAttempts(draft.retry_attempts)) return;
    if (draft.delivery_channel === 'webhook' && !hasValidRetryBackoff(draft.retry_backoff_ms)) return;
    setSubmitting(true);
    try {
      await onCreate({
        name: draft.name.trim(),
        cadence: draft.cadence,
        status: 'active',
        format: draft.format,
        time_window: draft.time_window,
        delivery_channel: draft.delivery_channel,
        delivery_config: draft.delivery_channel === 'webhook'
          ? {
            webhook_url: draft.webhook_url.trim(),
            credential_ref: draft.credential_ref.trim() || undefined,
            secret_header_name: draft.secret_header_name.trim() || undefined,
            signature_header_name: draft.signature_header_name.trim() || undefined,
            timeout_seconds: parseTimeoutSeconds(draft.timeout_seconds),
            retry_attempts: parsePositiveInt(draft.retry_attempts),
            retry_backoff_ms: parsePositiveInt(draft.retry_backoff_ms),
          }
          : undefined,
        filters: {
          provider: draft.provider?.trim() || undefined,
          model: draft.model?.trim() || undefined,
          result: draft.result,
        },
        release_evidence_required: draft.release_evidence_required,
        empty_result_policy: draft.empty_result_policy,
      });
      setCreateOpen(false);
    } finally {
      setSubmitting(false);
    }
  }, [draft, onCreate]);

  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid="usage__report-schedules">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('report_schedules.title')}</h2>
            <p className="text-xs text-tertiary">{t('report_schedules.subtitle')}</p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={runningDue}
                onClick={async () => {
                  setRunningDue(true);
                  try {
                    await onRunDue();
                  } finally {
                    setRunningDue(false);
                  }
                }}
                data-testid="usage__report-schedules-run-due"
              >
                {t('report_schedules.run_due')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
                data-testid="usage__report-schedules-create"
              >
                {t('report_schedules.create')}
              </Button>
            </div>
          ) : null}
        </div>

        <div
          className="rounded-lg border border-subtle bg-bg-base/40 p-3"
          data-testid="usage__report-evidence"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">{t('report_schedules.evidence_title')}</div>
              <div className="text-xs text-tertiary">{t('report_schedules.evidence_subtitle')}</div>
            </div>
            {evidenceLoading ? (
              <div className="text-xs text-tertiary">{commonT('loading')}</div>
            ) : evidence ? (
              <StatusBadge status={evidence.release_readiness === 'ready' ? 'ready' : 'blocked'}>
                {t(`report_schedules.release_${evidence.release_readiness}`)}
              </StatusBadge>
            ) : (
              <StatusBadge status="warning">{t('report_schedules.evidence_unavailable')}</StatusBadge>
            )}
          </div>

          {evidence ? (
            <div className="mt-3 grid gap-3 md:grid-cols-5">
              <div className="rounded-md border border-subtle bg-surface px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('report_schedules.evidence_active')}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{evidence.active_schedules}</div>
              </div>
              <div className="rounded-md border border-subtle bg-surface px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('report_schedules.evidence_required')}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{evidence.required_schedules}</div>
              </div>
              <div className="rounded-md border border-subtle bg-surface px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('report_schedules.evidence_success')}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{evidence.successful_deliveries_last_7d}</div>
              </div>
              <div className="rounded-md border border-subtle bg-surface px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('report_schedules.evidence_failed')}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{evidence.failed_deliveries_last_7d}</div>
              </div>
              <div className="rounded-md border border-subtle bg-surface px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-tertiary">{t('report_schedules.evidence_unacknowledged')}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{evidence.unacknowledged_required_deliveries}</div>
              </div>
            </div>
          ) : null}

          {evidence?.runner_health ? (
            <div className="mt-3 rounded-md border border-subtle bg-surface px-3 py-3" data-testid="usage__report-evidence-runner-health">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs font-medium text-foreground">{t('report_schedules.runner_health_title')}</div>
                <StatusBadge status={evidence.runner_health.last_status === 'failed' ? 'blocked' : evidence.runner_health.last_status === 'idle' ? 'warning' : 'ready'}>
                  {t(`report_schedules.runner_status_${evidence.runner_health.last_status}`)}
                </StatusBadge>
                <StatusBadge status={evidence.runner_health.enabled ? 'active' : 'paused'}>
                  {evidence.runner_health.enabled
                    ? t('report_schedules.runner_enabled')
                    : t('report_schedules.runner_disabled')}
                </StatusBadge>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-tertiary">
                <span>{t('report_schedules.runner_runs')}: {evidence.runner_health.run_count}</span>
                <span>{t('report_schedules.runner_interval')}: {Math.round(evidence.runner_health.interval_ms / 1000)}s</span>
                {evidence.runner_health.last_completed_at ? (
                  <span>{t('report_schedules.runner_last_completed')}: {formatDateTime(evidence.runner_health.last_completed_at)}</span>
                ) : null}
              </div>
              {evidence.runner_health.last_error ? (
                <div className="mt-2 text-xs text-tertiary">{evidence.runner_health.last_error}</div>
              ) : null}
            </div>
          ) : null}

          {evidence?.blockers?.length ? (
            <div className="mt-3" data-testid="usage__report-evidence-blockers">
              <div className="text-xs font-medium text-foreground">{t('report_schedules.evidence_blockers')}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {evidence.blockers.map((blocker) => (
                  <StatusBadge key={blocker} status="blocked">{blocker}</StatusBadge>
                ))}
              </div>
            </div>
          ) : null}

          {evidence?.warnings?.length ? (
            <div className="mt-3" data-testid="usage__report-evidence-warnings">
              <div className="text-xs font-medium text-foreground">{t('report_schedules.evidence_warnings')}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {evidence.warnings.map((warning) => (
                  <StatusBadge key={warning} status="warning">{warning}</StatusBadge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-bg-base/40 px-4 py-6 text-sm text-tertiary">
          {commonT('loading')}
        </div>
      ) : schedules.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-bg-base/40 px-4 py-6 text-sm text-tertiary" data-testid="usage__report-schedules-empty">
          {t('report_schedules.empty')}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {schedules.map((schedule) => (
            <article
              key={schedule.id}
              className="rounded-lg border border-subtle bg-bg-base/40 p-4"
              data-testid={`usage__report-schedule-${schedule.id}`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-foreground">{schedule.name}</div>
                    <StatusBadge status={schedule.status === 'active' ? 'active' : 'paused'}>
                      {t(`report_schedules.status_${schedule.status}`)}
                    </StatusBadge>
                    <Badge variant="secondary">{t(`report_schedules.cadence_${schedule.cadence}`)}</Badge>
                    <Badge variant="secondary">{schedule.format.toUpperCase()}</Badge>
                    <Badge variant={schedule.release_evidence_required ? 'outline' : 'secondary'}>
                      {schedule.release_evidence_required
                        ? t('report_schedules.evidence_required_badge')
                        : t('report_schedules.evidence_optional_badge')}
                    </Badge>
                    <Badge variant="outline">
                      {t(`report_schedules.empty_policy_${schedule.empty_result_policy}`)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-tertiary">
                    <span>{t('report_schedules.time_window_label')}: {t(`report_schedules.window_${schedule.time_window}`)}</span>
                    <span>{t('report_schedules.next_run_label')}: {formatIso(schedule.next_run_at)}</span>
                    <span>{t('report_schedules.last_delivery_label')}: {formatIso(schedule.last_delivery_at)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-tertiary">
                    {schedule.filters?.provider ? <Badge variant="outline">provider:{schedule.filters.provider}</Badge> : null}
                    {schedule.filters?.model ? <Badge variant="outline">model:{schedule.filters.model}</Badge> : null}
                    {schedule.filters?.result ? <Badge variant="outline">result:{schedule.filters.result}</Badge> : null}
                  </div>
                  {schedule.last_delivery_error ? (
                    <div className="text-xs text-error">{schedule.last_delivery_error}</div>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={runningId === schedule.id}
                      onClick={async () => {
                        setRunningId(schedule.id);
                        try {
                          setLastResult(await onRunNow(schedule));
                        } finally {
                          setRunningId(null);
                        }
                      }}
                      data-testid={`usage__report-schedule-run-${schedule.id}`}
                    >
                      {t('report_schedules.run_now')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={testingId === schedule.id}
                      onClick={async () => {
                        setTestingId(schedule.id);
                        try {
                          setLastResult(await onTestDelivery(schedule));
                        } finally {
                          setTestingId(null);
                        }
                      }}
                      data-testid={`usage__report-schedule-test-${schedule.id}`}
                    >
                      {t('report_schedules.test_delivery')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={statusId === schedule.id}
                      onClick={async () => {
                        setStatusId(schedule.id);
                        try {
                          await onUpdateStatus(schedule, schedule.status === 'active' ? 'paused' : 'active');
                        } finally {
                          setStatusId(null);
                        }
                      }}
                      data-testid={`usage__report-schedule-toggle-${schedule.id}`}
                    >
                      {schedule.status === 'active' ? t('report_schedules.pause') : t('report_schedules.resume')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={deleteId === schedule.id}
                      onClick={async () => {
                        setDeleteId(schedule.id);
                        try {
                          await onDelete(schedule);
                        } finally {
                          setDeleteId(null);
                        }
                      }}
                      data-testid={`usage__report-schedule-delete-${schedule.id}`}
                    >
                      {commonT('delete')}
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="mt-4" data-testid={`usage__report-schedule-deliveries-${schedule.id}`}>
                <div className="text-xs font-medium text-foreground">{t('report_schedules.recent_deliveries')}</div>
                {schedule.recent_deliveries?.length ? (
                  <div className="mt-2 space-y-2">
                    {schedule.recent_deliveries.map((delivery) => (
                      <div
                        key={delivery.id}
                        className="flex flex-col gap-2 rounded-md border border-subtle bg-surface px-3 py-2"
                        data-testid={`usage__report-delivery-${delivery.id}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={delivery.status === 'failed' ? 'blocked' : 'ready'}>
                            {t(`report_schedules.delivery_status_${delivery.status}`)}
                          </StatusBadge>
                          <Badge variant="outline">{t(`report_schedules.delivery_trigger_${delivery.trigger}`)}</Badge>
                          <span className="text-xs text-tertiary">{formatIso(delivery.completed_at)}</span>
                          {delivery.acknowledged_at ? (
                            <Badge variant="outline">{t('report_schedules.delivery_acknowledged')}</Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-tertiary">
                          <span>{t('report_schedules.delivery_requests')}: {delivery.summary.requests}</span>
                          <span>{t('report_schedules.delivery_errors')}: {delivery.summary.errors}</span>
                          <span>{t('report_schedules.delivery_attempt')}: {delivery.attempt_count}</span>
                          <span>{t('report_schedules.delivery_file')}: {delivery.preview_filename ?? '--'}</span>
                          {formatDeliveryMetadataValue(delivery.delivery_metadata?.response_status) ? (
                            <span>{t('report_schedules.delivery_response_status')}: {formatDeliveryMetadataValue(delivery.delivery_metadata?.response_status)}</span>
                          ) : null}
                          {formatDeliveryMetadataValue(delivery.delivery_metadata?.duration_ms) ? (
                            <span>{t('report_schedules.delivery_latency')}: {formatDeliveryMetadataValue(delivery.delivery_metadata?.duration_ms)}ms</span>
                          ) : null}
                        </div>
                        {delivery.error ? <div className="text-xs text-error">{delivery.error}</div> : null}
                        {formatDeliveryMetadataValue(delivery.delivery_metadata?.response_body_snippet) ? (
                          <div className="rounded border border-subtle bg-bg-base/60 px-2 py-1 text-xs text-tertiary" data-testid={`usage__report-delivery-response-snippet-${delivery.id}`}>
                            <span className="font-medium text-foreground">{t('report_schedules.delivery_response_snippet')}:</span>{' '}
                            {formatDeliveryMetadataValue(delivery.delivery_metadata?.response_body_snippet)}
                          </div>
                        ) : null}
                        {delivery.delivery_metadata?.response_headers && typeof delivery.delivery_metadata.response_headers === 'object' ? (
                          <div className="flex flex-wrap gap-2 text-xs text-tertiary" data-testid={`usage__report-delivery-response-headers-${delivery.id}`}>
                            <span className="font-medium text-foreground">{t('report_schedules.delivery_response_headers')}:</span>
                            {Object.entries(delivery.delivery_metadata.response_headers as Record<string, unknown>).map(([key, value]) => {
                              const formatted = formatDeliveryMetadataValue(value);
                              if (!formatted) return null;
                              return <Badge key={key} variant="outline">{key}:{formatted}</Badge>;
                            })}
                          </div>
                        ) : null}
                        {canManage ? (
                          <div className="flex flex-wrap gap-2">
                            {delivery.status === 'failed' ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={retryDeliveryId === delivery.id}
                                onClick={async () => {
                                  setRetryDeliveryId(delivery.id);
                                  try {
                                    setLastResult(await onRetryDelivery(schedule, delivery));
                                  } finally {
                                    setRetryDeliveryId(null);
                                  }
                                }}
                                data-testid={`usage__report-delivery-retry-${delivery.id}`}
                              >
                                {t('report_schedules.retry_delivery')}
                              </Button>
                            ) : null}
                            {!delivery.acknowledged_at ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={ackDeliveryId === delivery.id}
                                onClick={async () => {
                                  setAckDeliveryId(delivery.id);
                                  try {
                                    await onAcknowledgeDelivery(schedule, delivery);
                                  } finally {
                                    setAckDeliveryId(null);
                                  }
                                }}
                                data-testid={`usage__report-delivery-ack-${delivery.id}`}
                              >
                                {t('report_schedules.acknowledge_delivery')}
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-tertiary">{t('report_schedules.no_deliveries')}</div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {lastResult ? (
        <div className="mt-4 rounded-lg border border-border bg-surface-high/50 p-3 text-xs text-tertiary" data-testid="usage__report-schedules-last-test">
          <div className="font-medium text-foreground">{t('report_schedules.test_result_title')}</div>
          <div className="mt-1 flex flex-wrap gap-3">
            <span>{t('report_schedules.test_result_status')}: {lastResult.status}</span>
            <span>{t('report_schedules.test_result_file')}: {lastResult.preview_filename || '--'}</span>
            <span>{t('report_schedules.test_result_requests')}: {lastResult.summary.requests}</span>
            <span>{t('report_schedules.test_result_errors')}: {lastResult.summary.errors}</span>
            <span>{t('report_schedules.test_result_provider')}: {lastResult.summary.top_provider ?? '--'}</span>
          </div>
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('report_schedules.create_title')}</DialogTitle>
            <DialogDescription>{t('report_schedules.create_description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="usage-report-name">{t('report_schedules.name')}</Label>
              <Input
                id="usage-report-name"
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                data-testid="usage__report-schedules-form-name"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <Label>{t('report_schedules.cadence')}</Label>
                <Select value={draft.cadence} onValueChange={(value) => setDraft((prev) => ({ ...prev, cadence: value as DraftState['cadence'] }))}>
                  <SelectTrigger data-testid="usage__report-schedules-form-cadence"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">{t('report_schedules.cadence_daily')}</SelectItem>
                    <SelectItem value="weekly">{t('report_schedules.cadence_weekly')}</SelectItem>
                    <SelectItem value="monthly">{t('report_schedules.cadence_monthly')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('report_schedules.format')}</Label>
                <Select value={draft.format} onValueChange={(value) => setDraft((prev) => ({ ...prev, format: value as DraftState['format'] }))}>
                  <SelectTrigger data-testid="usage__report-schedules-form-format"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('report_schedules.time_window')}</Label>
                <Select value={draft.time_window} onValueChange={(value) => setDraft((prev) => ({ ...prev, time_window: value as DraftState['time_window'] }))}>
                  <SelectTrigger data-testid="usage__report-schedules-form-window"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="last_24h">{t('report_schedules.window_last_24h')}</SelectItem>
                    <SelectItem value="last_7d">{t('report_schedules.window_last_7d')}</SelectItem>
                    <SelectItem value="last_30d">{t('report_schedules.window_last_30d')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>{t('report_schedules.delivery_channel')}</Label>
                <Select
                  value={draft.delivery_channel}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, delivery_channel: value as DraftState['delivery_channel'] }))}
                >
                  <SelectTrigger data-testid="usage__report-schedules-form-delivery-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_app">{t('report_schedules.delivery_channel_in_app')}</SelectItem>
                    <SelectItem value="webhook">{t('report_schedules.delivery_channel_webhook')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.delivery_channel === 'webhook' ? (
                <div className="grid gap-3">
                  <Label htmlFor="usage-report-webhook-url">{t('report_schedules.webhook_url')}</Label>
                  <Input
                    id="usage-report-webhook-url"
                    value={draft.webhook_url}
                    onChange={(event) => setDraft((prev) => ({ ...prev, webhook_url: event.target.value }))}
                    data-testid="usage__report-schedules-form-webhook-url"
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="usage-report-webhook-credential-ref">{t('report_schedules.webhook_credential_ref')}</Label>
                      <Input
                        id="usage-report-webhook-credential-ref"
                        value={draft.credential_ref}
                        onChange={(event) => setDraft((prev) => ({ ...prev, credential_ref: event.target.value }))}
                        data-testid="usage__report-schedules-form-webhook-credential-ref"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="usage-report-webhook-secret-header">{t('report_schedules.webhook_secret_header_name')}</Label>
                      <Input
                        id="usage-report-webhook-secret-header"
                        value={draft.secret_header_name}
                        onChange={(event) => setDraft((prev) => ({ ...prev, secret_header_name: event.target.value }))}
                        data-testid="usage__report-schedules-form-webhook-secret-header"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="usage-report-webhook-signature-header">{t('report_schedules.webhook_signature_header_name')}</Label>
                    <Input
                      id="usage-report-webhook-signature-header"
                      value={draft.signature_header_name}
                      onChange={(event) => setDraft((prev) => ({ ...prev, signature_header_name: event.target.value }))}
                      data-testid="usage__report-schedules-form-webhook-signature-header"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label htmlFor="usage-report-webhook-timeout">{t('report_schedules.webhook_timeout_seconds')}</Label>
                      <Input
                        id="usage-report-webhook-timeout"
                        value={draft.timeout_seconds}
                        onChange={(event) => setDraft((prev) => ({ ...prev, timeout_seconds: event.target.value }))}
                        data-testid="usage__report-schedules-form-webhook-timeout"
                        inputMode="numeric"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="usage-report-webhook-retry-attempts">{t('report_schedules.webhook_retry_attempts')}</Label>
                      <Input
                        id="usage-report-webhook-retry-attempts"
                        value={draft.retry_attempts}
                        onChange={(event) => setDraft((prev) => ({ ...prev, retry_attempts: event.target.value }))}
                        data-testid="usage__report-schedules-form-webhook-retry-attempts"
                        inputMode="numeric"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="usage-report-webhook-retry-backoff">{t('report_schedules.webhook_retry_backoff_ms')}</Label>
                      <Input
                        id="usage-report-webhook-retry-backoff"
                        value={draft.retry_backoff_ms}
                        onChange={(event) => setDraft((prev) => ({ ...prev, retry_backoff_ms: event.target.value }))}
                        data-testid="usage__report-schedules-form-webhook-retry-backoff"
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="usage-report-provider">{t('filters.provider')}</Label>
                <Input id="usage-report-provider" value={draft.provider ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, provider: event.target.value }))} data-testid="usage__report-schedules-form-provider" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="usage-report-model">{t('filters.model')}</Label>
                <Input id="usage-report-model" value={draft.model ?? ''} onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))} data-testid="usage__report-schedules-form-model" />
              </div>
              <div className="grid gap-2">
                <Label>{t('filters.result')}</Label>
                <Select value={draft.result ?? 'all'} onValueChange={(value) => setDraft((prev) => ({ ...prev, result: value === 'all' ? undefined : value as DraftState['result'] }))}>
                  <SelectTrigger data-testid="usage__report-schedules-form-result"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{commonT('all')}</SelectItem>
                    <SelectItem value="ok">{t('filters.result_ok')}</SelectItem>
                    <SelectItem value="error">{t('filters.result_error')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>{t('report_schedules.release_evidence_required')}</Label>
                <Select
                  value={draft.release_evidence_required ? 'required' : 'optional'}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, release_evidence_required: value === 'required' }))}
                >
                  <SelectTrigger data-testid="usage__report-schedules-form-release-evidence"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="required">{t('report_schedules.evidence_required_badge')}</SelectItem>
                    <SelectItem value="optional">{t('report_schedules.evidence_optional_badge')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t('report_schedules.empty_result_policy')}</Label>
                <Select
                  value={draft.empty_result_policy}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, empty_result_policy: value as DraftState['empty_result_policy'] }))}
                >
                  <SelectTrigger data-testid="usage__report-schedules-form-empty-policy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deliver">{t('report_schedules.empty_policy_deliver')}</SelectItem>
                    <SelectItem value="fail">{t('report_schedules.empty_policy_fail')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{commonT('cancel')}</Button>
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={
                !draft.name.trim()
                || (draft.delivery_channel === 'webhook' && (
                  !draft.webhook_url.trim()
                  || (draft.credential_ref.trim() && !draft.secret_header_name.trim() && !draft.signature_header_name.trim())
                  || (!draft.credential_ref.trim() && (draft.secret_header_name.trim() || draft.signature_header_name.trim()))
                  || !hasValidTimeout(draft.timeout_seconds)
                  || !hasValidRetryAttempts(draft.retry_attempts)
                  || !hasValidRetryBackoff(draft.retry_backoff_ms)
                ))
                || submitting
              }
              data-testid="usage__report-schedules-form-submit"
            >
              {t('report_schedules.create_submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
