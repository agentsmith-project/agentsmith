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
import { Server, Plus, Trash2, Globe, Pencil, Power, PowerOff } from 'lucide-react';
import { getApiClient, EndpointAPI } from '@/lib/api';
import type { Endpoint } from '@/lib/api/types';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';
import { CreateEndpointDialog } from '@/components/endpoints/CreateEndpointDialog';
import { EditEndpointDialog } from '@/components/endpoints/EditEndpointDialog';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface EndpointsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

const columnHelper = createColumnHelper<Endpoint>();

type DeleteEndpointMutation = UseMutationResult<void, Error, string>;
type UpdateEndpointMutation = UseMutationResult<Endpoint, Error, { endpointId: string; data: { status?: 'active' | 'disabled' } }>;

function createEndpointColumns(
  t: (key: string) => string,
  deleteEndpointMutation: DeleteEndpointMutation,
  updateEndpointMutation: UpdateEndpointMutation,
  onEdit: (endpoint: Endpoint) => void,
  onDeleteRequest: (endpoint: Endpoint) => void,
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
  columnHelper.accessor('limits.max_requests_per_minute', {
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
          onClick={() => onEdit(info.row.original)}
          className="p-1.5 text-icon-default hover:bg-hover rounded-sm transition-colors"
          aria-label={t('action_edit')}
          title={t('action_edit')}
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() =>
            updateEndpointMutation.mutate({
              endpointId: info.row.original.id,
              data: { status: info.row.original.status === 'active' ? 'disabled' : 'active' },
            })
          }
          disabled={updateEndpointMutation.isPending}
          className="p-1.5 text-icon-default hover:bg-hover rounded-sm transition-colors disabled:opacity-50"
          aria-label={
            info.row.original.status === 'active' ? t('action_disable') : t('action_enable')
          }
          title={
            info.row.original.status === 'active' ? t('action_disable') : t('action_enable')
          }
        >
          {info.row.original.status === 'active' ? (
            <PowerOff className="w-4 h-4 text-warning" />
          ) : (
            <Power className="w-4 h-4 text-success" />
          )}
        </button>
        <button
          onClick={() => onDeleteRequest(info.row.original)}
          disabled={deleteEndpointMutation.isPending}
          className="p-1.5 text-error hover:bg-hover rounded-sm transition-colors disabled:opacity-50"
          aria-label={t('action_delete')}
          title={t('action_delete')}
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
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [endpointToDelete, setEndpointToDelete] = useState<Endpoint | null>(null);


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

  const updateEndpointMutation = useMutation({
    mutationFn: (args: { endpointId: string; data: { status?: 'active' | 'disabled' } }) =>
      endpointAPI.update(workspaceId, projectId, args.endpointId, args.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints', workspaceId, projectId] });
    },
  });

  const invalidateEndpoints = () => {
    queryClient.invalidateQueries({ queryKey: ['endpoints', workspaceId, projectId] });
  };

  const endpoints = endpointsData?.items || [];

  const handleDeleteRequest = (endpoint: Endpoint) => {
    setEndpointToDelete(endpoint);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (endpointToDelete) {
      deleteEndpointMutation.mutate(endpointToDelete.id);
    }
    setDeleteConfirmOpen(false);
    setEndpointToDelete(null);
  };

  const endpointColumns = createEndpointColumns(
    t,
    deleteEndpointMutation,
    updateEndpointMutation,
    (endpoint) => {
      setSelectedEndpoint(endpoint);
      setEditDialogOpen(true);
    },
    handleDeleteRequest,
  );

  const table = useReactTable({
    data: endpoints,
    columns: endpointColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <div className="flex items-center justify-center h-full">
          <div className="text-tertiary">Loading...</div>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout>
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

          {selectedEndpoint && (
            <EditEndpointDialog
              open={editDialogOpen}
              onOpenChange={setEditDialogOpen}
              workspaceId={workspaceId}
              projectId={projectId}
              endpoint={selectedEndpoint}
              onSuccess={() => {
                invalidateEndpoints();
                setEditDialogOpen(false);
              }}
            />
          )}

          <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('delete_confirm_description', { name: endpointToDelete?.name || '' })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('delete_confirm_cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    handleDeleteConfirm();
                  }}
                  className="bg-error text-white hover:bg-error/90"
                >
                  {t('delete_confirm_action')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </PageLayout>
    </PageState>
  );
}
