'use client';
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { UsageKPICards } from './UsageKPICards';
import { UsageFilters } from './UsageFilters';
import { UsageFactDetailDrawer } from './UsageFactDetailDrawer';
import { UsageTable } from './UsageTable';
import { UsageFactsTable } from './UsageFactsTable';
import { useUsageFacts, useUsageKPI, useUsageRecords } from '@/lib/hooks/use-audit-usage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { ErrorState } from '@/components/ui/error-state';
import type { UsageListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';
import type { UsageRecord } from '@/lib/api/types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getApiClient, UsageAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { InvestigationAnchorBar } from './InvestigationAnchorBar';
import type { UsageFactRecord } from '@/lib/api/types';

export interface UsagePageProps {
  workspaceId: string;
  projectId: string;
  locale?: string;
  defaultEndUserId?: string;
  currentUserId?: string;
  initialFilters?: Partial<UsageListParams>;
  initialPanel?: 'usage' | 'dashboard';
}

function getDefaultTimeRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };
}

function getBucketRange(timeBucket: string, groupBy: 'day' | 'hour' | 'minute'): { start: string; end: string } | null {
  if (groupBy === 'day') {
    const start = new Date(`${timeBucket}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (groupBy === 'hour') {
    const normalized = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(timeBucket)
      ? `${timeBucket.replace(' ', 'T')}:00.000Z`
      : timeBucket;
    const start = new Date(normalized);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + 60 * 60 * 1000 - 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  const normalized = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(timeBucket)
    ? `${timeBucket.replace(' ', 'T')}:00.000Z`
    : timeBucket;
  const start = new Date(normalized);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 60 * 1000 - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function asValidIsoTimestamp(value: string | null): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function matchesUsageInvestigation(
  item: { request_id?: string; decision_id?: string; metadata_json?: Record<string, unknown> },
  filters: Pick<UsageListParams, 'request_id' | 'decision_id' | 'trace_ref' | 'trace_incident_id' | 'trace_escalation_id' | 'trace_run_id'>,
): boolean {
  const metadata = item.metadata_json ?? {};
  const traceRef = typeof metadata.trace_ref === 'string' ? metadata.trace_ref : undefined;
  const traceIncidentId = typeof metadata.trace_incident_id === 'string' ? metadata.trace_incident_id : undefined;
  const traceEscalationId = typeof metadata.trace_escalation_id === 'string' ? metadata.trace_escalation_id : undefined;
  const traceRunId = typeof metadata.trace_run_id === 'string' ? metadata.trace_run_id : undefined;

  if (filters.request_id && item.request_id !== filters.request_id) return false;
  if (filters.decision_id && item.decision_id !== filters.decision_id) return false;
  if (filters.trace_ref && traceRef !== filters.trace_ref) return false;
  if (filters.trace_incident_id && traceIncidentId !== filters.trace_incident_id) return false;
  if (filters.trace_escalation_id && traceEscalationId !== filters.trace_escalation_id) return false;
  if (filters.trace_run_id && traceRunId !== filters.trace_run_id) return false;
  return true;
}

function buildUsageFiltersFromSearchParams(searchParams: URLSearchParams): Partial<UsageListParams> {
  const resultRaw = searchParams.get('result');
  const errorClassRaw = searchParams.get('error_class');
  return {
    start_time: asValidIsoTimestamp(searchParams.get('start_time')),
    end_time: asValidIsoTimestamp(searchParams.get('end_time')),
    resource_type: searchParams.get('resource_type') ?? undefined,
    resource_id: searchParams.get('resource_id') ?? undefined,
    end_user_id: searchParams.get('end_user_id') ?? undefined,
    provider: searchParams.get('provider') ?? undefined,
    model: searchParams.get('model') ?? undefined,
    request_id: searchParams.get('request_id') ?? undefined,
    decision_id: searchParams.get('decision_id') ?? undefined,
    trace_ref: searchParams.get('trace_ref') ?? undefined,
    trace_incident_id: searchParams.get('trace_incident_id') ?? undefined,
    trace_escalation_id: searchParams.get('trace_escalation_id') ?? undefined,
    trace_run_id: searchParams.get('trace_run_id') ?? undefined,
    result: resultRaw === 'ok' || resultRaw === 'error' ? resultRaw : undefined,
    error_class:
      errorClassRaw === 'provider_retryable'
      || errorClassRaw === 'provider_non_retryable'
      || errorClassRaw === 'system_error'
        ? errorClassRaw
        : undefined,
  };
}

function deriveUsageViewMode(searchParams: URLSearchParams): 'aggregate' | 'facts' {
  const explicit = searchParams.get('usage_view');
  if (explicit === 'facts') return 'facts';
  if (explicit === 'aggregate') return 'aggregate';
  const hasInvestigationAnchors = !!(
    searchParams.get('request_id')
    || searchParams.get('decision_id')
    || searchParams.get('trace_ref')
    || searchParams.get('trace_incident_id')
    || searchParams.get('trace_escalation_id')
    || searchParams.get('trace_run_id')
  );
  return hasInvestigationAnchors ? 'facts' : 'aggregate';
}

export function UsagePage({
  workspaceId,
  projectId,
  locale = 'en-US',
  defaultEndUserId,
  currentUserId,
  initialFilters,
}: UsagePageProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const traceSource = searchParams.get('trace_source') ?? undefined;
  const traceRef = searchParams.get('trace_ref') ?? undefined;
  const traceIncidentId = searchParams.get('trace_incident_id') ?? undefined;
  const traceEscalationId = searchParams.get('trace_escalation_id') ?? undefined;
  const traceRunId = searchParams.get('trace_run_id') ?? undefined;
  const queryClient = useQueryClient();
  const canReadUsage = useHasPermission('project:endpoint:use');
  const canExportUsage = useHasPermission('project:manage');
  const usageApi = React.useMemo(() => new UsageAPI(getApiClient()), []);
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  const effectiveEndUserId = defaultEndUserId ?? currentUserId;
  const searchParamsKey = searchParams.toString();
  const [selectedUsageRecord, setSelectedUsageRecord] = React.useState<UsageRecord | null>(null);
  const [selectedFactId, setSelectedFactId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [exportingFormat, setExportingFormat] = React.useState<'csv' | 'json' | null>(null);
  const [viewMode, setViewMode] = React.useState<'aggregate' | 'facts'>(() =>
    deriveUsageViewMode(new URLSearchParams(searchParamsKey)),
  );
  const [filters, setFilters] = React.useState<UsageListParams>(() => {
    const searchFilters = buildUsageFiltersFromSearchParams(new URLSearchParams(searchParamsKey));
    const hasInvestigationFromSearch = !!(
      searchFilters.request_id
      || searchFilters.decision_id
      || searchFilters.trace_ref
      || searchFilters.trace_incident_id
      || searchFilters.trace_escalation_id
      || searchFilters.trace_run_id
    );
    return {
      ...getDefaultTimeRange(),
      page: 1,
      sort_by: 'time_bucket',
      sort_order: 'desc',
      group_by: 'minute',
      ...initialFilters,
      ...searchFilters,
      page_size: hasInvestigationFromSearch ? 200 : 25,
      ...(effectiveEndUserId && { end_user_id: effectiveEndUserId }),
    };
  });

  const apiFilters = React.useMemo(
    () => ({ ...filters, end_user_id: effectiveEndUserId }),
    [filters, effectiveEndUserId],
  );
  const hasInvestigationFilters = !!(
    apiFilters.request_id
    || apiFilters.decision_id
    || apiFilters.trace_ref
    || apiFilters.trace_incident_id
    || apiFilters.trace_escalation_id
    || apiFilters.trace_run_id
  );

  React.useEffect(() => {
    const searchFilters = buildUsageFiltersFromSearchParams(new URLSearchParams(searchParamsKey));
    const hasInvestigationFromSearch = !!(
      searchFilters.request_id
      || searchFilters.decision_id
      || searchFilters.trace_ref
      || searchFilters.trace_incident_id
      || searchFilters.trace_escalation_id
      || searchFilters.trace_run_id
    );
    setFilters((prev) => ({
      ...prev,
      ...searchFilters,
      start_time: searchFilters.start_time ?? prev.start_time,
      end_time: searchFilters.end_time ?? prev.end_time,
      page: 1,
      page_size: hasInvestigationFromSearch ? 200 : 25,
      ...(effectiveEndUserId && { end_user_id: effectiveEndUserId }),
    }));
  }, [effectiveEndUserId, searchParamsKey]);

  React.useEffect(() => {
    const parsed = new URLSearchParams(searchParamsKey);
    const mode = deriveUsageViewMode(parsed);
    setViewMode((prev) => (prev === mode ? prev : mode));
  }, [searchParamsKey]);

  React.useEffect(() => {
    const next = new URLSearchParams(searchParamsKey);
    const entries: Array<[keyof Pick<UsageListParams, 'request_id' | 'decision_id' | 'trace_ref' | 'trace_incident_id' | 'trace_escalation_id' | 'trace_run_id'>, string | undefined]> = [
      ['request_id', filters.request_id],
      ['decision_id', filters.decision_id],
      ['trace_ref', filters.trace_ref],
      ['trace_incident_id', filters.trace_incident_id],
      ['trace_escalation_id', filters.trace_escalation_id],
      ['trace_run_id', filters.trace_run_id],
    ];
    let changed = false;
    for (const [key, value] of entries) {
      const current = searchParams.get(key);
      if (value) {
        if (current !== value) {
          next.set(key, value);
          changed = true;
        }
      } else if (current) {
        next.delete(key);
        changed = true;
      }
    }
    const currentMode = searchParams.get('usage_view');
    if (viewMode === 'facts') {
      if (currentMode !== 'facts') {
        next.set('usage_view', 'facts');
        changed = true;
      }
    } else if (currentMode) {
      next.delete('usage_view');
      changed = true;
    }
    if (!changed) return;
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [
    filters.decision_id,
    filters.request_id,
    filters.trace_escalation_id,
    filters.trace_incident_id,
    filters.trace_ref,
    filters.trace_run_id,
    viewMode,
    pathname,
    router,
    searchParams,
    searchParamsKey,
  ]);

  const { data: kpiData, isLoading: kpiLoading } = useUsageKPI(
    workspaceId,
    projectId,
    apiFilters.start_time,
    apiFilters.end_time,
    apiFilters.end_user_id,
    { enabled: canReadUsage },
  );

  const { data, isLoading, error } = useUsageRecords(workspaceId, projectId, apiFilters, {
    enabled: canReadUsage,
  });

  const usageDetailRange = React.useMemo(
    () =>
      selectedUsageRecord
        ? getBucketRange(
            selectedUsageRecord.time_bucket,
            apiFilters.group_by === 'day' || apiFilters.group_by === 'hour'
              ? apiFilters.group_by
              : 'minute',
          )
        : hasInvestigationFilters
          ? { start: apiFilters.start_time, end: apiFilters.end_time }
          : null,
    [selectedUsageRecord, hasInvestigationFilters, apiFilters.group_by, apiFilters.start_time, apiFilters.end_time],
  );

  const usageFactsQuery = useUsageFacts(
    workspaceId,
    projectId,
    {
      start_time: usageDetailRange?.start ?? '',
      end_time: usageDetailRange?.end ?? '',
      resource_type: selectedUsageRecord?.resource_type,
      resource_id: selectedUsageRecord?.resource_id,
      end_user_id: selectedUsageRecord?.end_user_id,
      result: apiFilters.result,
      provider: apiFilters.provider,
      model: apiFilters.model,
      request_id: apiFilters.request_id,
      decision_id: apiFilters.decision_id,
      trace_ref: apiFilters.trace_ref,
      trace_incident_id: apiFilters.trace_incident_id,
      trace_escalation_id: apiFilters.trace_escalation_id,
      trace_run_id: apiFilters.trace_run_id,
      error_class: apiFilters.error_class,
      page: 1,
      page_size: hasInvestigationFilters ? 200 : 20,
      sort_order: 'desc',
    },
    { enabled: canReadUsage && detailOpen && !!usageDetailRange },
  );
  const usageFactsListQuery = useUsageFacts(
    workspaceId,
    projectId,
    {
      start_time: apiFilters.start_time,
      end_time: apiFilters.end_time,
      resource_type: apiFilters.resource_type,
      resource_id: apiFilters.resource_id,
      end_user_id: apiFilters.end_user_id,
      result: apiFilters.result,
      provider: apiFilters.provider,
      model: apiFilters.model,
      request_id: apiFilters.request_id,
      decision_id: apiFilters.decision_id,
      trace_ref: apiFilters.trace_ref,
      trace_incident_id: apiFilters.trace_incident_id,
      trace_escalation_id: apiFilters.trace_escalation_id,
      trace_run_id: apiFilters.trace_run_id,
      error_class: apiFilters.error_class,
      page: filters.page ?? 1,
      page_size: filters.page_size ?? 25,
      sort_order: 'desc',
    },
    { enabled: canReadUsage && viewMode === 'facts' },
  );
  const filteredUsageFacts = React.useMemo(
    () => (usageFactsQuery.data?.items ?? []).filter((item) => matchesUsageInvestigation(item, apiFilters)),
    [usageFactsQuery.data?.items, apiFilters],
  );
  const filteredUsageFactsList = React.useMemo(
    () => (usageFactsListQuery.data?.items ?? []).filter((item) => matchesUsageInvestigation(item, apiFilters)),
    [usageFactsListQuery.data?.items, apiFilters],
  );
  const factsSummary = React.useMemo(() => {
    const facts = filteredUsageFactsList;
    const total = facts.length;
    const errors = facts.filter((item) => item.result === 'error').length;
    const resources = new Set(
      facts
        .map((item) => item.resource_id ?? item.resource_type)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ).size;
    return { total, errors, resources };
  }, [filteredUsageFactsList]);

  React.useEffect(() => {
    if (!hasInvestigationFilters || viewMode !== 'aggregate') return;
    setDetailOpen(true);
  }, [hasInvestigationFilters, viewMode]);

  const handleRefresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.usage._def });
    toast.success(commonT('refreshed_data') || 'Refreshed usage data');
  }, [queryClient, commonT]);

  const handleExport = React.useCallback(
    async (format: 'csv' | 'json') => {
      setExportingFormat(format);
      try {
        const exportResult = await usageApi.exportReport(workspaceId, projectId, {
          start_time: apiFilters.start_time,
          end_time: apiFilters.end_time,
          format,
          resource_type: apiFilters.resource_type,
          resource_id: apiFilters.resource_id,
          end_user_id: apiFilters.end_user_id,
          provider: apiFilters.provider,
          model: apiFilters.model,
          result: apiFilters.result,
          error_class: apiFilters.error_class,
        });
        const url = window.URL.createObjectURL(exportResult.blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = exportResult.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(url);
        toast.success(t('export.success'));
      } catch (err) {
        toast.error(
          t('export.failed_with_reason', {
            reason: err instanceof Error ? err.message : commonT('unknown_error'),
          }),
        );
      } finally {
        setExportingFormat(null);
      }
    },
    [usageApi, workspaceId, projectId, apiFilters, t, commonT],
  );

  const handleClearFilters = React.useCallback(() => {
    setFilters({
      ...getDefaultTimeRange(),
      page: 1,
      page_size: 25,
      sort_by: 'time_bucket',
      sort_order: 'desc',
      group_by: 'minute',
      ...(effectiveEndUserId && { end_user_id: effectiveEndUserId }),
    });
  }, [effectiveEndUserId]);
  const handleClearInvestigation = React.useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      request_id: undefined,
      decision_id: undefined,
      trace_ref: undefined,
      trace_incident_id: undefined,
      trace_escalation_id: undefined,
      trace_run_id: undefined,
      page: 1,
      page_size: 25,
    }));
    setSelectedFactId(null);
    const next = new URLSearchParams(searchParamsKey);
    next.delete('request_id');
    next.delete('decision_id');
    next.delete('trace_ref');
    next.delete('trace_incident_id');
    next.delete('trace_escalation_id');
    next.delete('trace_run_id');
    next.delete('trace_source');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParamsKey]);

  const handleFiltersChange = React.useCallback(
    (newFilters: UsageListParams) => {
      setFilters((prev) => ({
        ...prev,
        ...newFilters,
        page: 1,
        ...(effectiveEndUserId && { end_user_id: effectiveEndUserId }),
      }));
    },
    [effectiveEndUserId],
  );

  const currentPage = (viewMode === 'facts' ? usageFactsListQuery.data?.page : data?.page) ?? filters.page ?? 1;
  const pageSize = (viewMode === 'facts' ? usageFactsListQuery.data?.page_size : data?.page_size) ?? filters.page_size ?? 25;
  const totalItems = (viewMode === 'facts' ? usageFactsListQuery.data?.total : data?.total) ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const canGoPrev = currentPage > 1;
  const canGoNext = (viewMode === 'facts' ? !!usageFactsListQuery.data?.has_more : !!data?.has_more) || currentPage < totalPages;
  const hasActiveFilters = !!apiFilters.resource_type
    || !!apiFilters.resource_id
    || !!apiFilters.end_user_id
      || !!apiFilters.provider
      || !!apiFilters.model
      || !!apiFilters.request_id
      || !!apiFilters.decision_id
      || !!apiFilters.trace_ref
      || !!apiFilters.trace_incident_id
      || !!apiFilters.trace_escalation_id
      || !!apiFilters.trace_run_id
      || !!apiFilters.result
      || !!apiFilters.error_class;

  const handleSelectUsageRecord = React.useCallback((record: UsageRecord) => {
    setSelectedFactId(null);
    setSelectedUsageRecord(record);
    setDetailOpen(true);
  }, []);
  const handleSelectUsageFact = React.useCallback((fact: UsageFactRecord) => {
    setSelectedUsageRecord(null);
    setSelectedFactId(fact.id);
    setDetailOpen(true);
  }, []);
  const drawerFacts = React.useMemo(() => {
    if (!selectedFactId) return filteredUsageFacts;
    return filteredUsageFactsList.filter((item) => item.id === selectedFactId);
  }, [filteredUsageFacts, filteredUsageFactsList, selectedFactId]);

  if (!canReadUsage) {
    return (
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="rounded-xl border border-border bg-surface p-8 text-center max-w-md">
            <p className="text-sm text-tertiary">{t('permission_denied')}</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <ErrorState
          title={commonT('something_went_wrong')}
          message={t('load_failed_with_reason', {
            reason: error instanceof Error ? error.message : commonT('unknown_error'),
          })}
          onRetry={handleRefresh}
          retryLabel={commonT('retry')}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={(
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex items-center gap-2">
              {canExportUsage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="action" disabled={exportingFormat !== null} data-testid="usage__export-trigger">
                      <Download className="h-4 w-4 mr-2" />
                      {t('export.label')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void handleExport('csv')} data-testid="usage__export-option-csv">
                      {t('export.csv')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleExport('json')} data-testid="usage__export-option-json">
                      {t('export.json')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="outline" onClick={handleRefresh} disabled={isLoading || kpiLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || kpiLoading ? 'animate-spin' : ''}`} />
                {commonT('refresh')}
              </Button>
            </div>
          )}
        />
      )}
      toolbar={(
        <PageToolbar className="w-full">
          <div className="rounded-md border border-subtle bg-bg-base/20 px-3 py-2 text-xs text-tertiary" data-testid="usage__my-scope-badge">
            {t('scope_my_usage')}
          </div>
        </PageToolbar>
      )}
    >
      <div className="w-full space-y-3 min-h-0 flex-1 flex flex-col">
        <InvestigationAnchorBar
          traceSource={traceSource}
          requestId={apiFilters.request_id}
          decisionId={apiFilters.decision_id}
          traceRef={apiFilters.trace_ref}
          traceIncidentId={apiFilters.trace_incident_id}
          traceEscalationId={apiFilters.trace_escalation_id}
          traceRunId={apiFilters.trace_run_id}
          onClear={handleClearInvestigation}
        />

        <UsageKPICards kpi={kpiData} loading={kpiLoading} />

        <div data-testid="usage__filters">
          <UsageFilters
            filters={apiFilters}
            onChange={handleFiltersChange}
            onClear={handleClearFilters}
            defaultEndUserId={effectiveEndUserId}
          />
        </div>

        <div className="flex items-center gap-2" data-testid="usage__view-mode">
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'aggregate' ? 'default' : 'outline'}
            onClick={() => setViewMode('aggregate')}
            data-testid="usage__view-aggregate"
          >
            {t('view_mode.aggregate')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'facts' ? 'default' : 'outline'}
            onClick={() => setViewMode('facts')}
            data-testid="usage__view-facts"
          >
            {t('view_mode.facts')}
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="rounded-xl border border-border bg-surface p-3">
            {viewMode === 'facts' ? (
              <div className="mb-3 grid gap-2 md:grid-cols-3" data-testid="usage-facts__summary">
                <div className="rounded-md border border-subtle bg-bg-base/20 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">{t('facts_summary.total')}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground" data-testid="usage-facts__summary-total">
                    {factsSummary.total}
                  </p>
                </div>
                <div className="rounded-md border border-subtle bg-bg-base/20 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">{t('facts_summary.errors')}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground" data-testid="usage-facts__summary-errors">
                    {factsSummary.errors}
                  </p>
                </div>
                <div className="rounded-md border border-subtle bg-bg-base/20 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">{t('facts_summary.resources')}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground" data-testid="usage-facts__summary-resources">
                    {factsSummary.resources}
                  </p>
                </div>
              </div>
            ) : null}
            {viewMode === 'facts' ? (
              <UsageFactsTable
                data={filteredUsageFactsList}
                loading={usageFactsListQuery.isLoading}
                onClearFilters={handleClearFilters}
                onRefresh={handleRefresh}
                hasActiveFilters={hasActiveFilters}
                onSelectFact={handleSelectUsageFact}
              />
            ) : (
              <UsageTable
                data={data?.items || []}
                loading={isLoading}
                onClearFilters={handleClearFilters}
                onRefresh={handleRefresh}
                hasActiveFilters={hasActiveFilters}
                onSelectRecord={handleSelectUsageRecord}
              />
            )}
            <div className="mt-3 flex items-center justify-between border-t border-subtle pt-3">
              <p className="text-xs text-tertiary">
                {commonT('page_of', { page: String(currentPage), total: String(totalPages) })} ·{' '}
                {commonT('total_items', { count: String(totalItems) })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canGoPrev || isLoading || usageFactsListQuery.isLoading}
                  onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page ?? 1) - 1) }))}
                >
                  {commonT('previous')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canGoNext || isLoading || usageFactsListQuery.isLoading}
                  onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
                >
                  {commonT('next')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <UsageFactDetailDrawer
          open={detailOpen}
          onOpenChange={setDetailOpen}
          facts={drawerFacts}
          loading={selectedFactId ? usageFactsListQuery.isLoading : usageFactsQuery.isLoading}
          aggregateLabel={selectedUsageRecord?.time_bucket}
          basePath={basePath}
        />
      </div>
    </PageLayout>
  );
}
