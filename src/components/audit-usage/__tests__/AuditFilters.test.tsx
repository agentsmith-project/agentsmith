import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuditFilters } from '../AuditFilters';
import type { AuditListParams } from '@/lib/api/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <div data-value={value}>
      {children}
      <button type="button" onClick={() => onValueChange?.('anomaly')}>select-anomaly</button>
    </div>
  ),
  SelectTrigger: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../TimeRangePicker', () => ({
  TimeRangePicker: () => <div data-testid="time-range-picker" />,
}));

function buildFilters(overrides: Partial<AuditListParams> = {}): AuditListParams {
  return {
    start_time: '2026-03-07T00:00:00.000Z',
    end_time: '2026-03-08T00:00:00.000Z',
    page: 1,
    page_size: 25,
    sort_by: 'timestamp',
    sort_order: 'desc',
    ...overrides,
  };
}

describe('AuditFilters', () => {
  it('keeps advanced query controls collapsed by default', () => {
    render(
      <AuditFilters
        filters={buildFilters()}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByTestId('audit-filters__actions')).toBeInTheDocument();
    expect(screen.getByTestId('audit-filters__toggle-advanced')).toHaveTextContent('expand');
    expect(screen.queryByLabelText('filters.action')).not.toBeInTheDocument();
    expect(screen.getByLabelText('filters.resource_id')).toBeInTheDocument();
    expect(screen.queryByLabelText('filters.actor_type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('filters.request_id')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-filters__active-tokens')).not.toBeInTheDocument();
  });

  it('auto-expands advanced query controls when trace fields are active', () => {
    render(
      <AuditFilters
        filters={buildFilters({ trace_ref: 'trace_1' })}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByTestId('audit-filters__toggle-advanced')).toHaveTextContent('collapse');
    expect(screen.getByTestId('audit-filters__advanced')).toBeInTheDocument();
    expect(screen.getByLabelText('filters.action')).toBeInTheDocument();
    expect(screen.getByLabelText('filters.trace_ref')).toBeInTheDocument();
    expect(screen.getByLabelText('filters.trace_incident_id')).toBeInTheDocument();
  });

  it('applies trace run filter via debounced change', () => {
    vi.useFakeTimers();
    const handleChange = vi.fn();

    render(
      <AuditFilters
        filters={buildFilters({ request_id: 'req_1' })}
        onChange={handleChange}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByTestId('audit-filters__toggle-advanced')).toHaveTextContent('collapse');
    const input = screen.getByLabelText('filters.trace_run_id');
    fireEvent.change(input, { target: { value: 'run_1' } });

    expect(handleChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(handleChange).toHaveBeenCalledWith(expect.objectContaining({ trace_run_id: 'run_1' }));
    vi.useRealTimers();
  });

  it('applies category filter immediately', () => {
    const handleCategoryChange = vi.fn();

    render(
      <AuditFilters
        filters={buildFilters()}
        onChange={vi.fn()}
        onClear={vi.fn()}
        categoryFilter="all"
        onCategoryFilterChange={handleCategoryChange}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'select-anomaly' })[0]!);
    expect(handleCategoryChange).toHaveBeenCalledWith('anomaly');
  });

  it('renders compact embedded chrome without boxed surfaces', () => {
    render(
      <AuditFilters
        filters={buildFilters({ resource_id: 'resource_1', trace_ref: 'trace_1', actor_id: 'actor_1' })}
        onChange={vi.fn()}
        onClear={vi.fn()}
        compact
      />
    );

    expect(screen.getByTestId('audit-filters__surface').className).not.toMatch(/rounded-md|border|bg-surface/);
    expect(screen.getByTestId('audit-filters__actions')).toBeInTheDocument();
    expect(screen.getByTestId('audit-filters__toggle-advanced')).toHaveTextContent('collapse');
    expect(screen.getByTestId('audit-filters__primary-controls').className).toMatch(/flex-wrap/);
    expect(screen.getByTestId('audit-filters__primary-controls').className).not.toMatch(/grid-cols-|lg:grid-cols-/);
    expect(screen.getByLabelText('filters.resource_id')).toHaveValue('resource_1');
    expect(screen.getByTestId('audit-filters__advanced-controls').className).toMatch(/flex-wrap/);
    expect(screen.getByTestId('audit-filters__active-tokens')).toHaveTextContent('filters.actor_id');
    expect(screen.getByTestId('audit-filters__active-tokens')).toHaveTextContent('actor_1');
    expect(screen.getByTestId('audit-filters__investigation-controls').className).toMatch(/flex-wrap/);
    expect(screen.getByTestId('audit-filters__investigation-controls').className).not.toMatch(/grid-cols-|lg:grid-cols-/);
  });
});
