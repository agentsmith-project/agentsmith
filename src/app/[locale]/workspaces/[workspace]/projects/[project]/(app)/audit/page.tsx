/**
 * Audit Page
 *
 * View audit logs for the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';
import { FileSearch, Clock, User, FileText } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';

interface AuditPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

interface AuditEvent {
  id: string;
  timestamp: string;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string;
  result: 'ok' | 'error';
  details?: string;
}

const columnHelper = createColumnHelper<AuditEvent>();

const auditColumns = [
  columnHelper.accessor('timestamp', {
    header: 'Timestamp',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-foreground-secondary flex-shrink-0" />
        <span className="text-foreground-secondary text-sm">
          {new Date(info.getValue()).toLocaleString()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('actor_type', {
    header: 'User',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <User className="w-4 h-4 text-foreground-secondary flex-shrink-0" />
        <span className="text-foreground text-sm">
          {info.getValue()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('action', {
    header: 'Action',
    cell: (info) => (
      <span className="text-foreground text-sm font-medium">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('resource_type', {
    header: 'Resource',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-foreground-secondary flex-shrink-0" />
        <span className="text-foreground-secondary text-sm">
          {info.getValue()}:{info.row.original.resource_id}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('result', {
    header: 'Status',
    cell: (info) => (
      <StatusBadge status={info.getValue() === 'ok' ? 'success' : 'error'} />
    ),
  }),
  columnHelper.accessor('details', {
    header: 'Details',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm truncate max-w-[200px] block">
        {info.getValue() || '-'}
      </span>
    ),
  }),
];

export default function AuditPage({ params }: AuditPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['audit', workspaceId, projectId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/audit`);
      return response.json();
    },
    enabled: !!workspaceId && !!projectId,
  });

  const events = auditData?.items || [];

  const table = useReactTable({
    data: events,
    columns: auditColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-foreground-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Audit Logs</h1>
        <p className="text-sm text-foreground-secondary mt-1">Track all activity within the project</p>
      </div>

      {auditLoading ? (
        <PageLoading />
      ) : events.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No audit events"
          description="Audit logs will appear here once activity occurs"
        />
      ) : (
        <div className="rounded-lg overflow-hidden border border-border bg-surface shadow-sm">
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
                  className="hover:bg-surface-hover transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 border-b border-border last:border-b-0"
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
      )}
    </div>
  );
}
