/**
 * Endpoints page view.
 *
 * Route page should stay thin and delegate business orchestration to this component.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useReactTable, getCoreRowModel } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Server, Plus, Upload, Download } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { APIError, resolveApiErrorPresentation } from '@/lib/api/errors';
import type { Endpoint } from '@/lib/api/types';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { DataTable } from '@/components/ui/data-table';
import { Button, buttonVariants } from '@/components/ui/button';
import { CreateEndpointDialog } from '@/components/endpoints/CreateEndpointDialog';
import { EditEndpointDialog } from '@/components/endpoints/EditEndpointDialog';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { useEndpointsData } from '@/lib/endpoints/use-endpoints-data';
import { useEndpointsMutations } from '@/lib/endpoints/use-endpoints-mutations';
import type { ImportOpenAICompatiblePayload } from '@/lib/endpoints/types';
import { useEndpointsTableColumns } from '@/lib/endpoints/use-endpoints-table-columns';
import { RuntimeAPI, getApiClient } from '@/lib/api';
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

export interface EndpointsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export function EndpointsPageView({ params }: EndpointsPageProps) {
  const t = useTranslations('endpoints');
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [endpointToDelete, setEndpointToDelete] = useState<Endpoint | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPayloadText, setImportPayloadText] = useState(
    '{\n  "completion": {\n    "model": "deepseek-chat",\n    "api_base": "https://api.deepseek.com",\n    "api_key": "YOUR_API_KEY"\n  }\n}',
  );
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
      setResolvedParams({ workspace, project, locale: p.locale });
    });
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams?.locale ?? 'en-US';
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  const { endpoints, endpointsLoading } = useEndpointsData({
    workspaceId,
    projectId,
    canReadEndpoints,
  });

  const { invalidateEndpoints, deleteEndpointMutation, updateEndpointMutation, importOpenAICompatibleMutation } = useEndpointsMutations({
    workspaceId,
    projectId,
    onImportSuccess: () => {
      toast.success(t('import_success'));
      setImportDialogOpen(false);
    },
    onImportError: (error) => {
      const message = error instanceof APIError
        ? (() => {
            const resolved = resolveApiErrorPresentation({
              error,
              t: tErrors,
              fallbackMessage: t('import_failed'),
            });
            return `${resolved.title}: ${resolved.description}`;
          })()
        : t('import_failed');
      toast.error(message);
    },
  });

  const runtimeAPI = new RuntimeAPI(getApiClient());
  const syncCatalogMutation = useMutation({
    mutationFn: () => runtimeAPI.syncCatalog(workspaceId, projectId),
    onSuccess: () => {
      toast.success(t('catalog_sync_success'));
    },
    onError: (error: unknown) => {
      const message = error instanceof APIError
        ? (() => {
          const resolved = resolveApiErrorPresentation({
            error,
            t: tErrors,
            fallbackMessage: t('catalog_sync_failed'),
          });
          return `${resolved.title}: ${resolved.description}`;
        })()
        : t('catalog_sync_failed');
      toast.error(message);
    },
  });

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

  const handleExport = async () => {
    const exportPayload = {
      exported_at: new Date().toISOString(),
      workspace_id: workspaceId,
      project_id: projectId,
      endpoints: endpoints.map((endpoint) => ({
        name: endpoint.name,
        description: endpoint.description,
        model: endpoint.openai_model,
        type: endpoint.type,
        provider_family: endpoint.provider_family,
        protocol: endpoint.protocol,
        capabilities: endpoint.capabilities,
        models: endpoint.models,
        defaults: endpoint.defaults,
        api_base: endpoint.base_url,
        status: endpoint.status,
        credential_ref: endpoint.credential_ref,
        limits: endpoint.limits,
      })),
      openai_compatible_template: {
        reranker: {
          model: '',
          api_base: '',
          api_key: '',
          mode: 'openai',
        },
        embedding: {
          model: '',
          api_base: '',
          api_key: '',
          mode: 'openai',
        },
        completion: {
          model: '',
          api_base: '',
          api_key: '',
          mode: 'openai',
        },
        image_generation: {
          model: '',
          api_base: '',
          api_key: '',
          mode: 'openai',
        },
        video_generation: {
          model: '',
          api_base: '',
          api_key: '',
          mode: 'openai',
        },
      },
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fileName = `endpoints-${workspaceId}-${projectId}.json`;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(t('export_success'));
  };

  const handleImport = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importPayloadText);
    } catch {
      toast.error(t('import_invalid_json'));
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      toast.error(t('import_invalid_json'));
      return;
    }
    importOpenAICompatibleMutation.mutate(parsed as ImportOpenAICompatiblePayload);
  };

  const endpointColumns = useEndpointsTableColumns({
    t,
    deleteEndpointMutation,
    updateEndpointMutation,
    canManageEndpoints,
    onEdit: (endpoint) => {
      setSelectedEndpoint(endpoint);
      setEditDialogOpen(true);
    },
    onDeleteRequest: handleDeleteRequest,
  });

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
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/chat`}
                  className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                  data-testid="endpoints__open-chat"
                >
                  {t('open_chat')}
                </Link>
                <Link
                  href={`${basePath}/notebook`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="endpoints__open-notebook"
                >
                  {t('open_notebook')}
                </Link>
                <Link
                  href={`${basePath}/agents`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="endpoints__open-agents"
                >
                  {t('open_agents')}
                </Link>
              </div>
            )}
          />
        )}
        toolbar={(
          <PageToolbar>
            <Button
              onClick={() => setImportDialogOpen(true)}
              disabled={!canManageEndpoints}
              data-testid="endpoints__import-btn"
              variant="outline"
            >
              <Upload className="w-4 h-4" />
              {t('import')}
            </Button>
            <Button
              onClick={handleExport}
              disabled={!canReadEndpoints || endpoints.length === 0}
              data-testid="endpoints__export-btn"
              variant="outline"
            >
              <Download className="w-4 h-4" />
              {t('export')}
            </Button>
            <Button
              onClick={() => syncCatalogMutation.mutate()}
              disabled={!canManageEndpoints || syncCatalogMutation.isPending}
              data-testid="endpoints__sync-catalog-btn"
              variant="outline"
            >
              {t('sync_catalog')}
            </Button>
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

        <AlertDialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('import_dialog_title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('import_dialog_description')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <textarea
              value={importPayloadText}
              onChange={(e) => setImportPayloadText(e.target.value)}
              rows={16}
              className="w-full rounded-sm border border-subtle bg-surface-high px-3 py-2 text-sm font-mono text-primary"
              data-testid="endpoints__import-textarea"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>{t('import_cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleImport();
                }}
                disabled={importOpenAICompatibleMutation.isPending}
                data-testid="endpoints__import-confirm"
              >
                {t('import_confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageLayout>
    </PageState>
  );
}
