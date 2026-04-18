import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '@/lib/api/types';
import { AuditPageContent } from '../AuditPageContent';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('../AuditOverviewCards', () => ({
  AuditOverviewCards: () => <div data-testid="audit__summary-line" />,
}));

vi.mock('../AuditFilters', () => ({
  AuditFilters: ({ compact }: { compact?: boolean }) => (
    <div data-testid="audit__filters-content" data-compact={String(Boolean(compact))} />
  ),
}));

vi.mock('../AuditTable', () => ({
  AuditTable: () => <div data-testid="audit__table" />,
}));

vi.mock('../AuditDetailDrawer', () => ({
  AuditDetailDrawer: () => null,
}));

vi.mock('../InvestigationAnchorBar', () => ({
  InvestigationAnchorBar: ({ compact }: { compact?: boolean }) => (
    <div data-testid="audit__investigation-anchor" data-compact={String(Boolean(compact))} />
  ),
}));

const sampleEvent = {
  id: 'audit_1',
  timestamp: '2026-03-08T00:00:00Z',
  actor_type: 'user',
  actor_id: 'user_1',
  action: 'project.update',
  result: 'ok',
} as AuditEvent;

describe('AuditPageContent', () => {
  it('renders a quiet single-surface shell without decorative page gradients', () => {
    render(
      <AuditPageContent
        auditItems={[sampleEvent]}
        basePath="/en-US/workspaces/ws_1/projects/proj_1"
        categoryFilter="all"
        commonT={(key) => key}
        drawerOpen={false}
        drilldownContext={null}
        filters={{ page: 1, page_size: 20, sort_by: 'timestamp', sort_order: 'desc', start_time: '2026-03-07T00:00:00.000Z', end_time: '2026-03-08T00:00:00.000Z' }}
        isLoading={false}
        onCategoryFilterChange={vi.fn()}
        onClearFilters={vi.fn()}
        onClearInvestigation={vi.fn()}
        onFiltersChange={vi.fn()}
        onNextPage={vi.fn()}
        onOpenChange={vi.fn()}
        onPrevPage={vi.fn()}
        onRefresh={vi.fn()}
        onViewDetails={vi.fn()}
        overviewSummary={{ eventCount: 1, changeCount: 1, anomalyCount: 0, affectedResourceCount: 1 }}
        selectedEvent={null}
        t={(key) => key}
        totalItems={1}
        totalPages={1}
        traceMatchStatus={null}
        currentPage={1}
        canGoNext={false}
        canGoPrev={false}
      />,
    );

    expect(screen.getByTestId('audit__page').className).not.toMatch(/radial-gradient/);
    expect(screen.getByTestId('audit__work-surface')).toBeInTheDocument();
    expect(screen.getByTestId('audit__work-surface').className).not.toMatch(/shadow-card/);
    expect(screen.getByTestId('audit__investigation-anchor')).toHaveAttribute('data-compact', 'true');
    expect(screen.getByTestId('audit__summary-line')).toBeInTheDocument();
    expect(screen.getByTestId('audit__query-strip')).toBeInTheDocument();
    expect(screen.getByTestId('audit__query-strip').className).not.toMatch(/shadow-card|rounded-xl/);
    expect(screen.getByTestId('audit__filters-content')).toHaveAttribute('data-compact', 'true');
    expect(screen.getByTestId('audit__list-surface').className).toMatch(/min-h-0 flex-1/);
    expect(screen.getByTestId('audit__table-region').className).not.toMatch(/rounded-md|border|bg-background/);
    expect(screen.getByTestId('audit__table')).toBeInTheDocument();
  });
});
