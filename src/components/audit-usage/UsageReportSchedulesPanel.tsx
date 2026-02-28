'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
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
import type { UsageReportSchedule, UsageReportScheduleDeliveryResult } from '@/lib/api/endpoints/audit-usage';

type UsageReportSchedulesPanelProps = {
  schedules: UsageReportSchedule[];
  loading?: boolean;
  canManage: boolean;
  currentFilters: UsageListParams;
  onCreate: (payload: {
    name: string;
    cadence: 'daily' | 'weekly' | 'monthly';
    status: 'active' | 'paused';
    format: 'csv' | 'json';
    time_window: 'last_24h' | 'last_7d' | 'last_30d';
    delivery_channel: 'in_app';
    filters?: UsageReportSchedule['filters'];
  }) => Promise<void>;
  onUpdateStatus: (schedule: UsageReportSchedule, status: 'active' | 'paused') => Promise<void>;
  onDelete: (schedule: UsageReportSchedule) => Promise<void>;
  onTestDelivery: (schedule: UsageReportSchedule) => Promise<UsageReportScheduleDeliveryResult | null>;
};

type DraftState = {
  name: string;
  cadence: 'daily' | 'weekly' | 'monthly';
  format: 'csv' | 'json';
  time_window: 'last_24h' | 'last_7d' | 'last_30d';
  provider?: string;
  model?: string;
  result?: 'ok' | 'error';
};

function formatIso(value?: string): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function buildInitialDraft(filters: UsageListParams): DraftState {
  return {
    name: '',
    cadence: 'daily',
    format: 'json',
    time_window: 'last_7d',
    provider: filters.provider,
    model: filters.model,
    result: filters.result,
  };
}

export function UsageReportSchedulesPanel({
  schedules,
  loading = false,
  canManage,
  currentFilters,
  onCreate,
  onUpdateStatus,
  onDelete,
  onTestDelivery,
}: UsageReportSchedulesPanelProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DraftState>(() => buildInitialDraft(currentFilters));
  const [submitting, setSubmitting] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [statusId, setStatusId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [lastTestResult, setLastTestResult] = React.useState<UsageReportScheduleDeliveryResult | null>(null);

  React.useEffect(() => {
    if (!createOpen) {
      setDraft(buildInitialDraft(currentFilters));
    }
  }, [createOpen, currentFilters]);

  const handleCreate = React.useCallback(async () => {
    if (!draft.name.trim()) return;
    setSubmitting(true);
    try {
      await onCreate({
        name: draft.name.trim(),
        cadence: draft.cadence,
        status: 'active',
        format: draft.format,
        time_window: draft.time_window,
        delivery_channel: 'in_app',
        filters: {
          provider: draft.provider?.trim() || undefined,
          model: draft.model?.trim() || undefined,
          result: draft.result,
        },
      });
      setCreateOpen(false);
    } finally {
      setSubmitting(false);
    }
  }, [draft, onCreate]);

  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid="usage__report-schedules">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('report_schedules.title')}</h2>
          <p className="text-xs text-tertiary">{t('report_schedules.subtitle')}</p>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCreateOpen(true)}
            data-testid="usage__report-schedules-create"
          >
            {t('report_schedules.create')}
          </Button>
        ) : null}
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
                    <Badge variant={schedule.status === 'active' ? 'outline' : 'secondary'}>
                      {t(`report_schedules.status_${schedule.status}`)}
                    </Badge>
                    <Badge variant="secondary">{t(`report_schedules.cadence_${schedule.cadence}`)}</Badge>
                    <Badge variant="secondary">{schedule.format.toUpperCase()}</Badge>
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
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={testingId === schedule.id}
                      onClick={async () => {
                        setTestingId(schedule.id);
                        try {
                          setLastTestResult(await onTestDelivery(schedule));
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
            </article>
          ))}
        </div>
      )}

      {lastTestResult ? (
        <div className="mt-4 rounded-lg border border-border bg-surface-high/50 p-3 text-xs text-tertiary" data-testid="usage__report-schedules-last-test">
          <div className="font-medium text-foreground">{t('report_schedules.test_result_title')}</div>
          <div className="mt-1 flex flex-wrap gap-3">
            <span>{t('report_schedules.test_result_file')}: {lastTestResult.preview_filename}</span>
            <span>{t('report_schedules.test_result_requests')}: {lastTestResult.summary.requests}</span>
            <span>{t('report_schedules.test_result_errors')}: {lastTestResult.summary.errors}</span>
            <span>{t('report_schedules.test_result_provider')}: {lastTestResult.summary.top_provider ?? '--'}</span>
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{commonT('cancel')}</Button>
            <Button type="button" onClick={() => void handleCreate()} disabled={!draft.name.trim() || submitting} data-testid="usage__report-schedules-form-submit">
              {t('report_schedules.create_submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
