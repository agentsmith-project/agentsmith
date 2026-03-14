'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import type { AuditEvent, AuditListParams } from '@/lib/api/types';

import { AuditDetailDrawer } from './AuditDetailDrawer';
import { AuditFilters } from './AuditFilters';
import { AuditOverviewCards } from './AuditOverviewCards';
import { AuditTable } from './AuditTable';
import { InvestigationAnchorBar } from './InvestigationAnchorBar';
import type { AuditOverviewSummary } from './audit-page-types';

interface AuditPageContentProps {
  auditItems: AuditEvent[];
  basePath: string;
  categoryFilter: React.ComponentProps<typeof AuditFilters>['categoryFilter'];
  commonT: (key: string, values?: Record<string, string>) => string;
  defaultEndUserId?: string;
  drawerOpen: boolean;
  drilldownContext: React.ReactNode;
  filters: AuditListParams;
  isLoading: boolean;
  onCategoryFilterChange: React.ComponentProps<typeof AuditFilters>['onCategoryFilterChange'];
  onClearFilters: () => void;
  onClearInvestigation: () => void;
  onFiltersChange: React.ComponentProps<typeof AuditFilters>['onChange'];
  onNextPage: () => void;
  onOpenChange: (open: boolean) => void;
  onPrevPage: () => void;
  onRefresh: () => void;
  onViewDetails: (event: AuditEvent) => void;
  overviewSummary: AuditOverviewSummary;
  selectedEvent: AuditEvent | null;
  t: (key: string) => string;
  totalItems: number;
  totalPages: number;
  traceMatchStatus: 'matched' | 'unmatched' | null;
  traceSource?: string;
  currentPage: number;
  canGoNext: boolean;
  canGoPrev: boolean;
}

export function AuditPageContent({
  auditItems,
  basePath,
  categoryFilter,
  commonT,
  defaultEndUserId,
  drawerOpen,
  drilldownContext,
  filters,
  isLoading,
  onCategoryFilterChange,
  onClearFilters,
  onClearInvestigation,
  onFiltersChange,
  onNextPage,
  onOpenChange,
  onPrevPage,
  onRefresh,
  onViewDetails,
  overviewSummary,
  selectedEvent,
  t,
  totalItems,
  totalPages,
  traceMatchStatus,
  traceSource,
  currentPage,
  canGoNext,
  canGoPrev,
}: AuditPageContentProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="audit__page">
      {drilldownContext}
      <AuditOverviewCards summary={overviewSummary} t={t} />
      <div className="mb-3 rounded-[20px] border border-white/6 bg-white/[0.025] p-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
        <InvestigationAnchorBar
          traceSource={traceSource}
          requestId={filters.request_id}
          decisionId={filters.decision_id}
          traceRef={filters.trace_ref}
          traceIncidentId={filters.trace_incident_id}
          traceEscalationId={filters.trace_escalation_id}
          traceRunId={filters.trace_run_id}
          onClear={onClearInvestigation}
        />
        {traceMatchStatus ? (
          <p className="mt-1 text-xs text-tertiary" data-testid="audit__trace-match-status">
            {traceMatchStatus === 'matched'
              ? commonT('trace_context_match_found')
              : commonT('trace_context_match_missing')}
          </p>
        ) : null}
      </div>
      <div
        data-testid="audit__filters"
        className="rounded-[22px] border border-subtle bg-surface/95 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
      >
        <AuditFilters
          filters={filters}
          onChange={onFiltersChange}
          onClear={onClearFilters}
          defaultEndUserId={defaultEndUserId}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={onCategoryFilterChange}
        />
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-[22px] border border-subtle bg-surface/95 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
        <AuditTable
          data={auditItems}
          loading={isLoading}
          onViewDetails={onViewDetails}
          onClearFilters={onClearFilters}
          onRefresh={onRefresh}
        />
        <div className="mt-4 flex items-center justify-between rounded-[18px] border border-white/6 bg-white/[0.025] px-4 py-3">
          <p className="text-xs text-tertiary">
            {commonT('total_items', { count: String(totalItems) })}
            {totalPages > 1 ? (
              <>
                {' · '}
                {commonT('page_of', { page: String(currentPage), total: String(totalPages) })}
              </>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoPrev || isLoading}
              onClick={onPrevPage}
            >
              {commonT('previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canGoNext || isLoading}
              onClick={onNextPage}
            >
              {commonT('next')}
            </Button>
          </div>
        </div>
      </div>

      <AuditDetailDrawer
        open={drawerOpen}
        onOpenChange={onOpenChange}
        event={selectedEvent}
        basePath={basePath}
      />
    </div>
  );
}
