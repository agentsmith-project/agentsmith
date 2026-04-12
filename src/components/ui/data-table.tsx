import { flexRender, Table as TanStackTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';

interface DataTableProps<TData> {
  table: TanStackTable<TData>;
  /** Compact mode: smaller padding, 36px row height (Design 5.4) */
  compact?: boolean;
  /** Optional test ID for e2e testing */
  testId?: string;
  /** Optional row click handler */
  onRowClick?: (row: TData) => void;
  /** Optional row click predicate */
  isRowClickable?: (row: TData) => boolean;
}

export function DataTable<TData>({
  table,
  compact = false,
  testId,
  onRowClick,
  isRowClickable,
}: DataTableProps<TData>) {
  const cellPadding = compact ? 'px-3 py-2' : 'px-4 py-3';
  const headerPadding = compact ? 'px-3 py-2' : 'px-4 py-3';
  const selectedRowBg = 'bg-surface-high text-foreground';
  const unselectedRowBg = 'hover:bg-surface-low';

  return (
    <div
      className="overflow-hidden rounded-md border border-border/60 bg-surface shadow-ambient"
      data-testid={testId}
    >
      <div className="overflow-x-auto overflow-y-hidden">
      <table className="min-w-full border-collapse">
        <thead className="border-b border-subtle bg-surface-low">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  className={cn(
                    'text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary',
                    headerPadding,
                  )}
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const rowData = row.original as TData;
            const clickable = onRowClick
              ? (isRowClickable ? isRowClickable(rowData) : true)
              : false;
            return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-subtle last:border-b-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20',
                clickable && 'cursor-pointer',
                row.getIsSelected() ? selectedRowBg : unselectedRowBg,
              )}
              data-testid={testId ? `${testId}__row` : undefined}
              data-row-id={(row.original as Record<string, unknown>)?.id as string | undefined}
              onClick={clickable ? () => onRowClick?.(rowData) : undefined}
            >
              {row.getVisibleCells().map(cell => (
                <td
                  key={cell.id}
                  className={cn('text-sm text-primary', cellPadding)}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
