/**
 * Endpoints page view.
 *
 * Route page should stay thin and delegate business orchestration to this component.
 */

'use client';

import { useState } from 'react';
import { useReactTable, getCoreRowModel } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { APIError, resolveApiErrorPresentation } from '@/lib/api/errors';
import type { Endpoint } from '@/lib/api/types';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { useEndpointPageCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { toast } from '@/components/ui/toast';
import { useEndpointsData } from '@/lib/endpoints/use-endpoints-data';
import { useEndpointsMutations } from '@/lib/endpoints/use-endpoints-mutations';
import type { ImportOpenAICompatiblePayload } from '@/lib/endpoints/types';
import { useEndpointsTableColumns } from '@/lib/endpoints/use-endpoints-table-columns';
import { ModelConfigAPI, getApiClient } from '@/lib/api';
import { EndpointsContent } from '@/components/endpoints/endpoints-page/EndpointsContent';
import { EndpointsDialogs } from '@/components/endpoints/endpoints-page/EndpointsDialogs';
import { EndpointsHeaderActions } from '@/components/endpoints/endpoints-page/EndpointsHeaderActions';
import { EndpointsToolbar } from '@/components/endpoints/endpoints-page/EndpointsToolbar';
import {
  buildEndpointsBasePath,
  buildEndpointsExportPayload,
  createEndpointsErrorContent,
} from '@/components/endpoints/endpoints-page-utils';

export interface EndpointsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export function EndpointsPageView({ params }: EndpointsPageProps) {
  const t = useTranslations('endpoints');
  const tErrors = useTranslations('errors');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [endpointToDelete, setEndpointToDelete] = useState<Endpoint | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPayloadText, setImportPayloadText] = useState(
    '{\n  "completion": {\n    "model": "deepseek-chat",\n    "api_base": "https://api.deepseek.com",\n    "api_key": "YOUR_API_KEY"\n  }\n}',
  );
  const resolvedRoute = useResolvedProjectRoute(params);
  const { canRead: canReadEndpoints, canManage: canManageEndpoints } = useEndpointPageCapabilities();

  const workspaceId = resolvedRoute.workspace ?? '';
  const projectId = resolvedRoute.project ?? '';
  const locale = resolvedRoute.locale;
  const basePath = buildEndpointsBasePath(locale, workspaceId, projectId);

  const { endpoints, endpointsLoading } = useEndpointsData({
    workspaceId,
    projectId,
    canReadEndpoints,
  });
  const activeCount = endpoints.filter((endpoint) => endpoint.status === 'active').length;
  const disabledCount = endpoints.filter((endpoint) => endpoint.status === 'disabled').length;

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

  const modelConfigAPI = new ModelConfigAPI(getApiClient());
  const syncCatalogMutation = useMutation({
    mutationFn: () => modelConfigAPI.syncModelCatalog(workspaceId, projectId),
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
    const exportPayload = buildEndpointsExportPayload(workspaceId, projectId, endpoints);
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

  if (!resolvedRoute.isReady) {
    return (
      <PageState state="loading">
        <div className="flex items-center justify-center h-full">
          <div className="text-tertiary">Loading...</div>
        </div>
      </PageState>
    );
  }

  if (!resolvedRoute.isValid || !workspaceId || !projectId) {
    return (
      <PageState state="error">
        {createEndpointsErrorContent(
          tErrors('validation_error'),
          tErrors('badRequest.description'),
        )}
      </PageState>
    );
  }

  if (!canReadEndpoints) {
    return (
      <PageState state="error">
        {createEndpointsErrorContent(
          tErrors('permission_denied_title'),
          tErrors('permission_denied_hint'),
        )}
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
            variant="compact"
            actions={<EndpointsHeaderActions basePath={basePath} t={t} />}
          />
        )}
        toolbar={(
          <EndpointsToolbar
            canManageEndpoints={canManageEndpoints}
            canReadEndpoints={canReadEndpoints}
            endpointsCount={endpoints.length}
            activeCount={activeCount}
            disabledCount={disabledCount}
            syncPending={syncCatalogMutation.isPending}
            t={t}
            onCreate={() => setCreateDialogOpen(true)}
            onExport={() => {
              void handleExport();
            }}
            onImport={() => setImportDialogOpen(true)}
            onSyncCatalog={() => syncCatalogMutation.mutate()}
          />
        )}
      >
        <div className="w-full space-y-4">
          <EndpointsContent
            canManageEndpoints={canManageEndpoints}
            endpoints={endpoints}
            endpointsLoading={endpointsLoading}
            t={t}
            table={table}
            onCreate={() => setCreateDialogOpen(true)}
          />
        </div>

        <EndpointsDialogs
          canManageEndpoints={canManageEndpoints}
          createDialogOpen={createDialogOpen}
          deleteConfirmOpen={deleteConfirmOpen}
          editDialogOpen={editDialogOpen}
          endpointToDelete={endpointToDelete}
          importDialogOpen={importDialogOpen}
          importOpenAICompatiblePending={importOpenAICompatibleMutation.isPending}
          importPayloadText={importPayloadText}
          projectId={projectId}
          selectedEndpoint={selectedEndpoint}
          t={t}
          workspaceId={workspaceId}
          onConfirmDelete={handleDeleteConfirm}
          onCreateDialogOpenChange={setCreateDialogOpen}
          onEditDialogOpenChange={setEditDialogOpen}
          onImport={handleImport}
          onImportDialogOpenChange={setImportDialogOpen}
          onImportPayloadTextChange={setImportPayloadText}
          onInvalidateEndpoints={invalidateEndpoints}
          onResetDeleteTarget={() => {
            setDeleteConfirmOpen(false);
            setEndpointToDelete(null);
          }}
        />
      </PageLayout>
    </PageState>
  );
}
