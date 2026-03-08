'use client';
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AuditFilters } from './AuditFilters';
import { AuditTable } from './AuditTable';
import { AuditDetailDrawer } from './AuditDetailDrawer';
import { useAuditEvents } from '@/lib/hooks/use-audit-usage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { ErrorState } from '@/components/ui/error-state';
import type { AuditEvent, AuditListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { parseGovernanceDrilldownContext } from '@/lib/governance-drilldown-context';
import { GovernanceDrilldownBanner } from '@/components/ui/GovernanceDrilldownBanner';
import { InvestigationAnchorBar } from './InvestigationAnchorBar';

export interface AuditPageProps {
  workspaceId: string;
  projectId: string;
  defaultEndUserId?: string;
  locale?: string;
}

function getDefaultTimeRange() {
  return {
    start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
  };
}

function asValidIsoTimestamp(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function asPositiveInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function metadataContainsString(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    return value === expected;
  }
  if (Array.isArray(value)) {
    return value.some((item) => metadataContainsString(item, expected));
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => metadataContainsString(item, expected));
  }
  return false;
}

function matchesAuditInvestigationFilters(event: AuditEvent, filters: AuditListParams): boolean {
  const metadata = event.metadata_json ?? {};
  const decisionId = typeof metadata.decision_id === 'string' ? metadata.decision_id : undefined;
  const traceCandidates = [
    event.trace_ref,
    event.trace_incident_id,
    event.trace_escalation_id,
    event.trace_run_id,
    typeof metadata.trace_ref === 'string' ? metadata.trace_ref : undefined,
    typeof metadata.trace_incident_id === 'string' ? metadata.trace_incident_id : undefined,
    typeof metadata.trace_escalation_id === 'string' ? metadata.trace_escalation_id : undefined,
    typeof metadata.trace_run_id === 'string' ? metadata.trace_run_id : undefined,
  ].filter((value): value is string => !!value && value.trim().length > 0);

  if (filters.request_id && event.request_id !== filters.request_id) {
    return false;
  }
  if (filters.decision_id && event.decision_id !== filters.decision_id && decisionId !== filters.decision_id) {
    return false;
  }
  if (filters.trace_ref && !traceCandidates.includes(filters.trace_ref) && !metadataContainsString(metadata, filters.trace_ref)) {
    return false;
  }
  if (
    filters.trace_incident_id
    && event.trace_incident_id !== filters.trace_incident_id
    && !metadataContainsString(metadata, filters.trace_incident_id)
  ) {
    return false;
  }
  if (
    filters.trace_escalation_id
    && event.trace_escalation_id !== filters.trace_escalation_id
    && !metadataContainsString(metadata, filters.trace_escalation_id)
  ) {
    return false;
  }
  if (
    filters.trace_run_id
    && event.trace_run_id !== filters.trace_run_id
    && !metadataContainsString(metadata, filters.trace_run_id)
  ) {
    return false;
  }
  return true;
}

function findTraceMatchedAuditEvent(
  events: AuditEvent[],
  trace: {
    ref?: string;
    incidentId?: string;
    escalationId?: string;
    runId?: string;
  },
): AuditEvent | null {
  if (!trace.ref && !trace.incidentId && !trace.escalationId && !trace.runId) {
    return null;
  }
  const candidates = [trace.ref, trace.incidentId, trace.escalationId, trace.runId].filter(
    (value): value is string => !!value && value.trim().length > 0,
  );
  for (const event of events) {
    const metadata = event.metadata_json ?? {};
    const normalizedRefs = [
      event.trace_ref,
      event.trace_incident_id,
      event.trace_escalation_id,
      event.trace_run_id,
    ].filter((value): value is string => !!value && value.trim().length > 0);
    const matched = candidates.some((candidate) =>
      event.id === candidate
      || event.request_id === candidate
      || event.resource_id === candidate
      || normalizedRefs.includes(candidate)
      || metadataContainsString(metadata, candidate),
    );
    if (matched) {
      return event;
    }
  }
  return null;
}

function buildAuditFiltersFromSearchParams(
  searchParams: URLSearchParams,
  defaultEndUserId?: string,
): AuditListParams {
  const defaults = getDefaultTimeRange();
  const actorTypeRaw = searchParams.get('actor_type');
  const resultRaw = searchParams.get('result');
  const sortByRaw = searchParams.get('sort_by');
  const sortOrderRaw = searchParams.get('sort_order');
  const actorType =
    actorTypeRaw === 'user' || actorTypeRaw === 'agent' || actorTypeRaw === 'plugin'
      ? actorTypeRaw
      : undefined;
  const result = resultRaw === 'ok' || resultRaw === 'error' ? resultRaw : undefined;
  const sortBy = sortByRaw === 'timestamp' ? sortByRaw : 'timestamp';
  const sortOrder = sortOrderRaw === 'asc' || sortOrderRaw === 'desc' ? sortOrderRaw : 'desc';
  const requestId = searchParams.get('request_id') ?? undefined;
  const decisionId = searchParams.get('decision_id') ?? undefined;
  const traceRef = searchParams.get('trace_ref') ?? undefined;
  const traceIncidentId = searchParams.get('trace_incident_id') ?? undefined;
  const traceEscalationId = searchParams.get('trace_escalation_id') ?? undefined;
  const traceRunId = searchParams.get('trace_run_id') ?? undefined;
  const investigationMode = !!(
    requestId
    || decisionId
    || traceRef
    || traceIncidentId
    || traceEscalationId
    || traceRunId
  );
  return {
    start_time: asValidIsoTimestamp(searchParams.get('start_time')) ?? defaults.start_time,
    end_time: asValidIsoTimestamp(searchParams.get('end_time')) ?? defaults.end_time,
    action: searchParams.get('action') ?? undefined,
    actor_type: actorType,
    actor_id: searchParams.get('actor_id') ?? undefined,
    end_user_id: searchParams.get('end_user_id') ?? defaultEndUserId,
    resource_type: searchParams.get('resource_type') ?? undefined,
    resource_id: searchParams.get('resource_id') ?? undefined,
    request_id: requestId,
    decision_id: decisionId,
    trace_ref: traceRef,
    trace_incident_id: traceIncidentId,
    trace_escalation_id: traceEscalationId,
    trace_run_id: traceRunId,
    result,
    page: asPositiveInt(searchParams.get('page')) ?? 1,
    page_size: asPositiveInt(searchParams.get('page_size')) ?? (investigationMode ? 200 : 25),
    sort_by: sortBy,
    sort_order: sortOrder,
  };
}

export function AuditPage({ workspaceId, projectId, defaultEndUserId, locale = 'en-US' }: AuditPageProps) {
  const t = useTranslations('audit');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const canReadAudit = useHasPermission('project:manage');
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const searchParams = useSearchParams();
  const drilldownContext = React.useMemo(() => parseGovernanceDrilldownContext(searchParams), [searchParams]);
  const searchParamsKey = searchParams.toString();
  const traceSource = searchParams.get('trace_source') ?? undefined;
  const traceRef = searchParams.get('trace_ref') ?? undefined;
  const traceIncidentId = searchParams.get('trace_incident_id') ?? undefined;
  const traceEscalationId = searchParams.get('trace_escalation_id') ?? undefined;
  const traceRunId = searchParams.get('trace_run_id') ?? undefined;

  const [filters, setFilters] = React.useState<AuditListParams>(() =>
    buildAuditFiltersFromSearchParams(searchParams, defaultEndUserId),
  );
  const [selectedEvent, setSelectedEvent] = React.useState<AuditEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [traceMatchStatus, setTraceMatchStatus] = React.useState<'matched' | 'unmatched' | null>(null);
  const lastAutoOpenedTraceRef = React.useRef<string | null>(null);

  const { data, isLoading, error } = useAuditEvents(workspaceId, projectId, filters, {
    enabled: canReadAudit,
  });
  const auditItems = React.useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((event) => matchesAuditInvestigationFilters(event, filters));
  }, [data?.items, filters]);

  React.useEffect(() => {
    setFilters(buildAuditFiltersFromSearchParams(searchParams, defaultEndUserId));
  }, [defaultEndUserId, searchParams, searchParamsKey]);

  React.useEffect(() => {
    if (!traceRef || auditItems.length === 0) {
      setTraceMatchStatus(traceRef ? 'unmatched' : null);
      return;
    }
    if (lastAutoOpenedTraceRef.current === traceRef) {
      return;
    }
    const matched = findTraceMatchedAuditEvent(auditItems, {
      ref: traceRef,
      incidentId: traceIncidentId,
      escalationId: traceEscalationId,
      runId: traceRunId,
    });
    if (matched) {
      setSelectedEvent(matched);
      setDrawerOpen(true);
      setTraceMatchStatus('matched');
      lastAutoOpenedTraceRef.current = traceRef;
      return;
    }
    setTraceMatchStatus('unmatched');
  }, [auditItems, traceEscalationId, traceIncidentId, traceRef, traceRunId]);

  if (!canReadAudit) {
    return (
      <PageLayout
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/members`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-members"
                >
                  {t('open_members')}
                </Link>
                <Link
                  href={`${basePath}/resource-policy`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-resource-policy"
                >
                  {t('open_resource_policy')}
                </Link>
                <Link
                  href={`${basePath}/usage`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-usage"
                >
                  {t('open_usage')}
                </Link>
              </div>
            )}
          />
        )}
      >
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="rounded-xl border border-border bg-surface p-8 text-center max-w-md">
            <p className="text-sm text-tertiary">{t('permission_denied')}</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: ['audit', workspaceId, projectId],
    });
    toast.success(commonT('refreshed_data') || 'Refreshed audit events');
  };

  const handleViewDetails = (event: AuditEvent) => {
    setSelectedEvent(event);
    setDrawerOpen(true);
  };

  const handleClearFilters = () => {
    const defaults = getDefaultTimeRange();
    setFilters({
      start_time: defaults.start_time,
      end_time: defaults.end_time,
      page: 1,
      page_size: 25,
      sort_by: 'timestamp',
      sort_order: 'desc',
      ...(defaultEndUserId && { end_user_id: defaultEndUserId }),
    });
  };
  const handleClearInvestigation = () => {
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
    setTraceMatchStatus(null);
    lastAutoOpenedTraceRef.current = null;
  };

  const currentPage = data?.page ?? filters.page ?? 1;
  const pageSize = data?.page_size ?? filters.page_size ?? 25;
  const totalItems = auditItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const hasInvestigationFilter = !!(
    filters.request_id
    || filters.decision_id
    || filters.trace_ref
    || filters.trace_incident_id
    || filters.trace_escalation_id
    || filters.trace_run_id
  );
  const canGoPrev = currentPage > 1;
  const canGoNext = !hasInvestigationFilter && (!!data?.has_more || currentPage < totalPages);

  if (error) {
    return (
      <PageLayout
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/members`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-members"
                >
                  {t('open_members')}
                </Link>
                <Link
                  href={`${basePath}/resource-policy`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-resource-policy"
                >
                  {t('open_resource_policy')}
                </Link>
                <Link
                  href={`${basePath}/usage`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="audit__open-usage"
                >
                  {t('open_usage')}
                </Link>
              </div>
            )}
          />
        )}
      >
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
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`${basePath}/members`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="audit__open-members"
              >
                {t('open_members')}
              </Link>
              <Link
                href={`${basePath}/resource-policy`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="audit__open-resource-policy"
              >
                {t('open_resource_policy')}
              </Link>
              <Link
                href={`${basePath}/usage`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="audit__open-usage"
              >
                {t('open_usage')}
              </Link>
            </div>
          )}
        />
      )}
      toolbar={(
        <PageToolbar>
          <Button variant="outline" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {commonT('refresh')}
          </Button>
        </PageToolbar>
      )}
    >
      {drilldownContext ? (
        <GovernanceDrilldownBanner context={drilldownContext} locale={locale} />
      ) : null}
      <div className="mb-3">
        <InvestigationAnchorBar
          traceSource={traceSource}
          requestId={filters.request_id}
          decisionId={filters.decision_id}
          traceRef={filters.trace_ref}
          traceIncidentId={filters.trace_incident_id}
          traceEscalationId={filters.trace_escalation_id}
          traceRunId={filters.trace_run_id}
          onClear={handleClearInvestigation}
        />
        {traceMatchStatus ? (
          <p className="mt-1 text-xs text-tertiary" data-testid="audit__trace-match-status">
            {traceMatchStatus === 'matched'
              ? commonT('trace_context_match_found')
              : commonT('trace_context_match_missing')}
          </p>
        ) : null}
      </div>
      <div data-testid="audit__filters">
        <AuditFilters
          filters={filters}
          onChange={setFilters}
          onClear={handleClearFilters}
          defaultEndUserId={defaultEndUserId}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <AuditTable
          data={auditItems}
          loading={isLoading}
          onViewDetails={handleViewDetails}
          onClearFilters={handleClearFilters}
        />
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-tertiary">
            {commonT('page_of', { page: String(currentPage), total: String(totalPages) })} ·
            {' '}
            {commonT('total_items', { count: String(totalItems) })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoPrev || isLoading}
              onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page ?? 1) - 1) }))}
            >
              {commonT('previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoNext || isLoading}
              onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
            >
              {commonT('next')}
            </Button>
          </div>
        </div>
      </div>

      <AuditDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        event={selectedEvent}
        basePath={basePath}
      />
    </PageLayout>
  );
}
