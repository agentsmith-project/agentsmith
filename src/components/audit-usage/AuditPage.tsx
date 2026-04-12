'use client';
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuditEvents } from '@/lib/hooks/use-audit-usage';
import { useCanReadAudit } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState } from '@/components/ui/error-state';
import type { AuditEvent, AuditListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';
import { parseGovernanceDrilldownContext } from '@/lib/governance-drilldown-context';
import { GovernanceDrilldownBanner } from '@/components/ui/GovernanceDrilldownBanner';
import type { AuditEventCategoryFilter } from './AuditFilters';
import { getAuditEventCategory } from './audit-event-presenter';
import { AuditPageContent } from './AuditPageContent';
import { AuditPageToolbar } from './AuditPageToolbar';
import {
  buildAuditFiltersFromSearchParams,
  buildAuditOverviewSummary,
  findTraceMatchedAuditEvent,
  getDefaultTimeRange,
  matchesAuditInvestigationFilters,
} from './audit-page-utils';

export interface AuditPageProps {
  workspaceId: string;
  projectId: string;
  defaultEndUserId?: string;
  locale?: string;
}

export function AuditPage({ workspaceId, projectId, defaultEndUserId, locale = 'en-US' }: AuditPageProps) {
  const t = useTranslations('audit');
  const commonT = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const canReadAudit = useCanReadAudit();
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
  const [categoryFilter, setCategoryFilter] = React.useState<AuditEventCategoryFilter>('all');
  const [selectedEvent, setSelectedEvent] = React.useState<AuditEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [traceMatchStatus, setTraceMatchStatus] = React.useState<'matched' | 'unmatched' | null>(null);
  const lastAutoOpenedTraceRef = React.useRef<string | null>(null);

  const { data, isLoading, error } = useAuditEvents(workspaceId, projectId, filters, {
    enabled: canReadAudit,
  });
  const auditItems = React.useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((event) => {
      if (!matchesAuditInvestigationFilters(event, filters)) {
        return false;
      }
      if (categoryFilter === 'all') {
        return true;
      }
      return getAuditEventCategory(event) === categoryFilter;
    });
  }, [categoryFilter, data?.items, filters]);
  const overviewSummary = React.useMemo(() => buildAuditOverviewSummary(auditItems), [auditItems]);

  React.useEffect(() => {
    setFilters(buildAuditFiltersFromSearchParams(searchParams, defaultEndUserId));
  }, [defaultEndUserId, searchParams, searchParamsKey]);

  React.useEffect(() => {
    const next = new URLSearchParams(searchParamsKey);
    const entries: Array<[keyof Pick<AuditListParams, 'request_id' | 'decision_id' | 'trace_ref' | 'trace_incident_id' | 'trace_escalation_id' | 'trace_run_id'>, string | undefined]> = [
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
    pathname,
    router,
    searchParams,
    searchParamsKey,
  ]);

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
            variant="compact"
          />
        )}
      >
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="rounded-md border border-border bg-surface p-8 text-center max-w-md">
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
    setCategoryFilter('all');
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
            variant="compact"
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
        />
      )}
      toolbar={<AuditPageToolbar isLoading={isLoading} label={commonT('refresh')} onRefresh={handleRefresh} />}
    >
      <AuditPageContent
        auditItems={auditItems}
        basePath={basePath}
        canGoNext={canGoNext}
        canGoPrev={canGoPrev}
        categoryFilter={categoryFilter}
        commonT={commonT}
        currentPage={currentPage}
        defaultEndUserId={defaultEndUserId}
        drawerOpen={drawerOpen}
        drilldownContext={drilldownContext ? <GovernanceDrilldownBanner context={drilldownContext} locale={locale} /> : null}
        filters={filters}
        isLoading={isLoading}
        onCategoryFilterChange={setCategoryFilter}
        onClearFilters={handleClearFilters}
        onClearInvestigation={handleClearInvestigation}
        onFiltersChange={setFilters}
        onNextPage={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
        onOpenChange={setDrawerOpen}
        onPrevPage={() => setFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page ?? 1) - 1) }))}
        onRefresh={handleRefresh}
        onViewDetails={handleViewDetails}
        overviewSummary={overviewSummary}
        selectedEvent={selectedEvent}
        t={t}
        totalItems={totalItems}
        totalPages={totalPages}
        traceMatchStatus={traceMatchStatus}
        traceSource={traceSource}
      />
    </PageLayout>
  );
}
