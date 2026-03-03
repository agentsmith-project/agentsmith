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
  const selectedRowBg = 'bg-accent/15 hover:bg-accent/20 border-l-2 border-l-accent';
  const unselectedRowBg = 'border-l-2 border-l-transparent hover:bg-hover';

  return (
    <div
      className="rounded-md border border-border bg-surface"
      data-testid={testId}
    >
      <div className="overflow-x-auto overflow-y-hidden">
      <table className="min-w-full border-collapse">
        <thead className="bg-transparent border-b border-subtle">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  className={cn(
                    'text-left text-xs font-medium uppercase tracking-wide text-tertiary',
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
                'border-b border-border last:border-b-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
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
