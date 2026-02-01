import { flexRender, Table as TanStackTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';

interface DataTableProps<TData> {
  table: TanStackTable<TData>;
}

export function DataTable<TData>({ table }: DataTableProps<TData>) {
  return (
    <div
      className="rounded-lg overflow-hidden border border-border bg-surface shadow-sm"
    >
      <table className="w-full border-collapse">
        <thead className="bg-surface-high">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  className="px-4 py-4 text-left text-sm font-medium text-foreground-secondary"
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
          {table.getRowModel().rows.map(row => (
            <tr
              key={row.id}
              className="hover:bg-surface-hover transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {row.getVisibleCells().map(cell => (
                <td
                  key={cell.id}
                  className="px-4 py-4 text-sm text-foreground"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
