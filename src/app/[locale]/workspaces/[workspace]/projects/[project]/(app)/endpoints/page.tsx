/**
 * Endpoints Page
 *
 * Manage LLM endpoints within the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';
import { Server, Plus, Edit, Trash2, Globe } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient, EndpointAPI } from '@/lib/api';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';

interface EndpointsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

interface Endpoint {
  id: string;
  name: string;
  description?: string;
  base_url: string;
  openai_model: string;
  type: string;
  status: 'active' | 'inactive';
  rate_limit?: number;
}

const columnHelper = createColumnHelper<Endpoint>();

const endpointColumns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-surface-high flex items-center justify-center">
          <Server className="w-4 h-4 text-foreground-secondary" />
        </div>
        <div className="flex flex-col">
          <span className="text-foreground font-medium">{info.getValue()}</span>
          {info.row.original.description && (
            <span className="text-xs text-foreground-secondary line-clamp-1">
              {info.row.original.description}
            </span>
          )}
        </div>
      </div>
    ),
  }),
  columnHelper.accessor('base_url', {
    header: 'URL',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-foreground-secondary flex-shrink-0" />
        <span className="text-foreground-secondary text-sm font-mono truncate max-w-[200px]">
          {info.getValue()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('type', {
    header: 'Type',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm capitalize">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('openai_model', {
    header: 'Model',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm font-mono">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('rate_limit', {
    header: 'Rate Limit',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm">
        {info.getValue() ? `${info.getValue()}/min` : '-'}
      </span>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue() === 'active' ? 'active' : 'error'} />,
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <button
          onClick={() => deleteEndpointMutation.mutate(info.row.original.id)}
          disabled={deleteEndpointMutation.isPending}
          className="p-1.5 text-error hover:bg-error/10 rounded transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    ),
  }),
];

let deleteEndpointMutation: any;

export default function EndpointsPage({ params }: EndpointsPageProps) {
  const queryClient = useQueryClient();
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);

  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const endpointAPI = new EndpointAPI(getApiClient());

  const { data: endpointsData, isLoading: endpointsLoading } = useQuery({
    queryKey: ['endpoints', workspaceId, projectId],
    queryFn: () => endpointAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });

  deleteEndpointMutation = useMutation({
    mutationFn: (endpointId: string) => endpointAPI.delete(workspaceId, projectId, endpointId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints', workspaceId, projectId] });
    },
  });

  const endpoints = endpointsData?.items || [];

  const table = useReactTable({
    data: endpoints,
    columns: endpointColumns,
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Endpoints</h1>
          <p className="text-sm text-foreground-secondary mt-1">Manage LLM endpoints within the project</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />
          New Endpoint
        </button>
      </div>

      {endpointsLoading ? (
        <PageLoading />
      ) : endpoints.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No endpoints yet"
          description="Add your first LLM endpoint to get started"
          action={{
            label: 'Add Endpoint',
            onClick: () => {},
          }}
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
