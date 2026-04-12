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
    <div
      className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.04),_transparent_38%)]"
      data-testid="audit__page"
    >
      {drilldownContext}
      <AuditOverviewCards summary={overviewSummary} t={t} />
      <div className="mb-3 rounded-md border border-subtle bg-surface-low p-4 shadow-ambient">
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
        className="rounded-md border border-subtle bg-surface/95 p-4 shadow-card"
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

      <div className="mt-4 min-h-0 flex-1 rounded-md border border-subtle bg-surface/95 p-4 shadow-card">
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-subtle bg-surface-low px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">{t('title')}</p>
            <p className="mt-1 text-sm text-secondary">
              {commonT('total_items', { count: String(totalItems) })}
              {totalPages > 1 ? (
                <>
                  {' · '}
                  {commonT('page_of', { page: String(currentPage), total: String(totalPages) })}
                </>
              ) : null}
            </p>
          </div>
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
        <div className="min-h-0 overflow-y-auto rounded-md border border-subtle bg-background/35 p-3">
          <AuditTable
            data={auditItems}
            loading={isLoading}
            onViewDetails={onViewDetails}
            onClearFilters={onClearFilters}
            onRefresh={onRefresh}
          />
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
