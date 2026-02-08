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
import { Button } from '@/components/ui/button';
import { CreateEndpointDialog } from '@/components/endpoints/CreateEndpointDialog';
import { EditEndpointDialog } from '@/components/endpoints/EditEndpointDialog';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
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
  canManageEndpoints: boolean,
  onEdit: (endpoint: Endpoint) => void,
  onDeleteRequest: (endpoint: Endpoint) => void,
) {
  return [
  columnHelper.accessor('name', {
    header: t('table.name'),
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
    header: t('table.url'),
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
    header: t('table.type'),
    cell: (info) => (
      <span className="text-tertiary text-sm capitalize">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor('openai_model', {
    header: t('table.model'),
    cell: (info) => (
      <span className="text-tertiary text-sm font-mono">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.accessor((row) => row.limits, {
    id: 'limits',
    header: t('table.rate_limit'),
    cell: (info) => (
      <div className="text-xs text-tertiary leading-5">
        <p>
          RPM:{' '}
          <span className="text-primary">
            {info.getValue()?.max_requests_per_minute ?? '-'}
          </span>
        </p>
        <p>
          Tokens/day:{' '}
          <span className="text-primary">
            {info.getValue()?.max_tokens_per_day ?? '-'}
          </span>
        </p>
      </div>
    ),
  }),
  columnHelper.accessor('status', {
    header: t('table.status'),
    cell: (info) => <StatusBadge status={info.getValue() === 'active' ? 'active' : 'paused'} />,
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: (info) => {
      if (!canManageEndpoints) {
        return <span className="text-tertiary text-sm">-</span>;
      }

      return (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(info.row.original)}
            className="h-8 px-2 text-icon-default hover:bg-hover text-xs"
            aria-label={t('action_edit')}
            title={t('action_edit')}
            data-testid={`endpoints__action-edit--${info.row.original.id}`}
          >
            <Pencil className="w-4 h-4" />
            <span className="hidden lg:inline">{t('action_edit')}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              updateEndpointMutation.mutate({
                endpointId: info.row.original.id,
                data: { status: info.row.original.status === 'active' ? 'disabled' : 'active' },
              })
            }
            disabled={updateEndpointMutation.isPending}
            className="h-8 px-2 text-icon-default hover:bg-hover text-xs"
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
            <span className="hidden lg:inline">
              {info.row.original.status === 'active' ? t('action_disable') : t('action_enable')}
            </span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDeleteRequest(info.row.original)}
            disabled={deleteEndpointMutation.isPending}
            className="h-8 px-2 text-error hover:bg-hover text-xs"
            aria-label={t('action_delete')}
            title={t('action_delete')}
            data-testid={`endpoints__action-delete--${info.row.original.id}`}
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden lg:inline">{t('action_delete')}</span>
          </Button>
        </div>
      );
    },
  }),
  ];
}

export default function EndpointsPage({ params }: EndpointsPageProps) {
  const t = useTranslations('endpoints');
  const tErrors = useTranslations('errors');
  const queryClient = useQueryClient();
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [endpointToDelete, setEndpointToDelete] = useState<Endpoint | null>(null);
  const canProjectEndpointRead = useHasPermission('project:endpoint:use');
  const canProjectEndpointUpdate = useHasPermission('project:endpoint:manage');
  const canProjectEndpointCreate = useHasPermission('project:endpoint:manage');
  const canProjectEndpointDelete = useHasPermission('project:endpoint:manage');
  const canReadEndpoints = canProjectEndpointRead || canProjectEndpointUpdate;
  const canManageEndpoints = canProjectEndpointCreate || canProjectEndpointUpdate || canProjectEndpointDelete;


  useEffect(() => {
    params.then((p) => {
      const workspace = validateWorkspaceParam(p.workspace);
      const project = validateProjectParam(p.project);
      setResolvedParams({ workspace, project });
    });
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const endpointAPI = new EndpointAPI(getApiClient());

  const { data: endpointsData, isLoading: endpointsLoading } = useQuery({
    queryKey: ['endpoints', workspaceId, projectId],
    queryFn: () => endpointAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && canReadEndpoints,
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
    canManageEndpoints,
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

  if (!workspaceId || !projectId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadEndpoints) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout
        header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}
        toolbar={(
          <PageToolbar>
            <Button
              onClick={() => setCreateDialogOpen(true)}
              disabled={!canManageEndpoints}
              data-testid="endpoints__create-btn"
              variant="action"
            >
              <Plus className="w-4 h-4" />
              {t('create')}
            </Button>
          </PageToolbar>
        )}
      >
        <div className="w-full">
          {endpointsLoading ? (
            <PageLoading />
          ) : endpoints.length === 0 ? (
            <EmptyState
              icon={Server}
              title={t('empty.title')}
              description={t('empty.description')}
              action={canManageEndpoints ? {
                label: `Add ${t('title')}`,
                onClick: () => setCreateDialogOpen(true),
              } : undefined}
            />
          ) : (
            <DataTable table={table} testId="endpoints__table" />
          )}
        </div>

        <CreateEndpointDialog
          open={canManageEndpoints && createDialogOpen}
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
      </PageLayout>
    </PageState>
  );
}
