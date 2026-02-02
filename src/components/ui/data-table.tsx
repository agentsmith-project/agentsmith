import { flexRender, Table as TanStackTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';

interface DataTableProps<TData> {
  table: TanStackTable<TData>;
}

export function DataTable<TData>({ table }: DataTableProps<TData>) {
  return (
    <div
      className="rounded-md overflow-hidden border border-border bg-surface"
    >
      <table className="w-full border-collapse">
        <thead className="bg-transparent border-b border-border">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th
                  key={header.id}
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-tertiary"
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
              className={cn(
                "border-b border-border last:border-b-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                row.getIsSelected() 
                  ? "bg-primary/10 hover:bg-primary/15" 
                  : "hover:bg-hover"
              )}
            >
              {row.getVisibleCells().map(cell => (
                <td
                  key={cell.id}
                  className="px-4 py-3 text-sm text-primary"
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
