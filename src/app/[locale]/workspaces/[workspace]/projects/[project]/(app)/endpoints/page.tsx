/**
 * Endpoints Page
 *
 * Manage LLM endpoints within the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Server, Plus, Trash2, Globe } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient, EndpointAPI } from '@/lib/api';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';
import { CreateEndpointDialog } from '@/components/endpoints/CreateEndpointDialog';

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
  status: 'active' | 'disabled';
  rate_limit?: number;
}

const columnHelper = createColumnHelper<Endpoint>();

type DeleteEndpointMutation = UseMutationResult<void, Error, string>;

function createEndpointColumns(
  t: (key: string) => string,
  deleteEndpointMutation: DeleteEndpointMutation
) {
  return [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center">
          <Server className="w-4 h-4 text-icon-default" />
        </div>
        <div className="flex flex-col">
          <span className="text-foreground font-medium">{info.getValue()}</span>
          {info.row.original.description && (
            <span className="text-xs text-tertiary line-clamp-1">
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
        <Globe className="w-4 h-4 text-icon-default flex-shrink-0" />
        <span className="text-tertiary text-sm font-mono truncate max-w-[200px]">
          {info.getValue()}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor('type', {
    header: 'Type',
    cell: (info) => (
      <span className="text-tertiary text-sm capitalize">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('openai_model', {
    header: 'Model',
    cell: (info) => (
      <span className="text-tertiary text-sm font-mono">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('rate_limit', {
    header: 'Rate Limit',
    cell: (info) => (
      <span className="text-tertiary text-sm">
        {info.getValue() ? `${info.getValue()}/min` : '-'}
      </span>
    ),
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue() === 'active' ? 'active' : 'paused'} />,
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <button
          onClick={() => deleteEndpointMutation.mutate(info.row.original.id)}
          disabled={deleteEndpointMutation.isPending}
          className="p-1.5 text-error hover:bg-hover rounded-sm transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    ),
  }),
  ];
}

export default function EndpointsPage({ params }: EndpointsPageProps) {
  const t = useTranslations('endpoints');
  const queryClient = useQueryClient();
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

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

  const deleteEndpointMutation = useMutation({
    mutationFn: (endpointId: string) => endpointAPI.delete(workspaceId, projectId, endpointId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints', workspaceId, projectId] });
    },
  });

  const invalidateEndpoints = () => {
    queryClient.invalidateQueries({ queryKey: ['endpoints', workspaceId, projectId] });
  };

  const endpoints = endpointsData?.items || [];

  const endpointColumns = createEndpointColumns(t, deleteEndpointMutation);

  const table = useReactTable({
    data: endpoints,
    columns: endpointColumns,
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-tertiary mt-1">Manage LLM endpoints</p>
        </div>
        <button
          onClick={() => setCreateDialogOpen(true)}
          className="flex items-center gap-2 px-4 h-10 bg-hover hover:bg-hover/80 text-foreground rounded-sm border border-subtle transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('create')}
        </button>
      </div>

      {endpointsLoading ? (
        <PageLoading />
      ) : endpoints.length === 0 ? (
        <EmptyState
          icon={Server}
          title={`No ${t('title').toLowerCase()} yet`}
          description={`Add your first LLM ${t('title').toLowerCase()} to get started`}
          action={{
            label: `Add ${t('title')}`,
            onClick: () => setCreateDialogOpen(true),
          }}
        />
      ) : (
        <DataTable table={table} />
      )}

      <CreateEndpointDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={invalidateEndpoints}
      />
    </div>
  );
}
