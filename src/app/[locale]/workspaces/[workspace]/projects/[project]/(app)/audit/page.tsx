/**
 * Audit Page
 *
 * View audit logs for the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper } from '@tanstack/react-table';
import { FileSearch, Clock, User, FileText } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';

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
        <Clock className="w-4 h-4 text-icon-default flex-shrink-0" />
        <span className="text-tertiary text-sm">
          {new Date(info.getValue()).toLocaleString()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('actor_type', {
    header: 'User',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <User className="w-4 h-4 text-icon-default flex-shrink-0" />
        <span className="text-primary text-sm">
          {info.getValue()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('action', {
    header: 'Action',
    cell: (info) => (
      <span className="text-primary text-sm font-medium">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('resource_type', {
    header: 'Resource',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-icon-default flex-shrink-0" />
        <span className="text-tertiary text-sm">
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
      <span className="text-tertiary text-sm truncate max-w-[200px] block">
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
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Audit Logs</h1>
        <p className="text-sm text-tertiary mt-1">Track all activity within the project</p>
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
        <DataTable table={table} />
      )}
    </div>
  );
}
