/**
 * Credentials Page
 *
 * Manage project-scoped credentials (API keys, etc.).
 * Secrets are never displayed; only fingerprint and metadata.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Key, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { CredentialsAPI, getApiClient, handleErrorForToast } from '@/lib/api';
import type { Credential } from '@/lib/api/types';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { DataTable } from '@/components/ui/data-table';
import { CreateCredentialDialog } from '@/components/credentials/CreateCredentialDialog';
import { RotateCredentialDialog } from '@/components/credentials/RotateCredentialDialog';
import { DeleteCredentialDialog } from '@/components/credentials/DeleteCredentialDialog';

interface CredentialsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

const columnHelper = createColumnHelper<Credential>();

function formatDate(iso: string | undefined): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const createCredentialColumns = (
  t: (key: string) => string,
  onRotate: (cred: Credential) => void,
  onDelete: (cred: Credential) => void,
  deleteMutation: { isPending: boolean }
) => [
  columnHelper.accessor('name', {
    header: t('table.name'),
    cell: (info) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center">
          <Key className="w-4 h-4 text-icon-default" />
        </div>
        <span className="text-foreground font-medium">{info.getValue()}</span>
      </div>
    ),
  }),
  columnHelper.accessor('type', {
    header: t('table.type'),
    cell: (info) => (
      <span className="text-tertiary text-sm capitalize">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('fingerprint', {
    header: t('fingerprint'),
    cell: (info) => (
      <span className="text-tertiary text-sm font-mono">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('last_rotated_at', {
    header: t('table.last_rotated'),
    cell: (info) => (
      <span className="text-tertiary text-sm">{formatDate(info.getValue())}</span>
    ),
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <button
          onClick={() => onRotate(info.row.original)}
          disabled={deleteMutation.isPending}
          className="p-1.5 text-tertiary hover:text-foreground hover:bg-hover rounded-sm transition-colors disabled:opacity-50"
          title={t('rotate')}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(info.row.original)}
          disabled={deleteMutation.isPending}
          className="p-1.5 text-error hover:bg-hover rounded-sm transition-colors disabled:opacity-50"
          title={t('delete')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    ),
  }),
];

export default function CredentialsPage({ params }: CredentialsPageProps) {
  const t = useTranslations('credentials');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace: string;
    project: string;
  } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null);

  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const credentialsAPI = new CredentialsAPI(getApiClient());
  const queryClient = useQueryClient();

  const { data: credentials, isLoading } = useQuery({
    queryKey: ['credentials', workspaceId, projectId],
    queryFn: () => credentialsAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['credentials', workspaceId, projectId] });
  };

  const deleteMutation = useMutation({
    mutationFn: (credId: string) => credentialsAPI.delete(workspaceId, projectId, credId),
    onSuccess: () => {
      setDeleteDialogOpen(false);
      setSelectedCredential(null);
      invalidate();
    },
    onError: handleErrorForToast,
  });

  const handleRotateClick = (cred: Credential) => {
    setSelectedCredential(cred);
    setRotateDialogOpen(true);
  };

  const handleDeleteClick = (cred: Credential) => {
    setSelectedCredential(cred);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (!selectedCredential) return;
    deleteMutation.mutate(selectedCredential.id);
  };

  const credentialColumns = createCredentialColumns(
    t,
    handleRotateClick,
    handleDeleteClick,
    deleteMutation
  );

  const table = useReactTable({
    data: credentials ?? [],
    columns: credentialColumns,
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
          <p className="text-sm text-tertiary mt-1">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setCreateDialogOpen(true)}
          className="flex items-center gap-2 px-4 h-10 bg-hover hover:bg-hover/80 text-foreground rounded-sm border border-subtle transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('create')}
        </button>
      </div>

      {isLoading ? (
        <PageLoading />
      ) : !credentials || credentials.length === 0 ? (
        <EmptyState
          icon={Key}
          title={t('empty.title')}
          description={t('empty.description')}
          action={{
            label: t('create'),
            onClick: () => setCreateDialogOpen(true),
          }}
        />
      ) : (
        <DataTable table={table} />
      )}

      <CreateCredentialDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={invalidate}
      />

      <RotateCredentialDialog
        open={rotateDialogOpen}
        onOpenChange={setRotateDialogOpen}
        credential={selectedCredential}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={invalidate}
      />

      <DeleteCredentialDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        credential={selectedCredential}
        onConfirm={handleDeleteConfirm}
        deleting={deleteMutation.isPending}
      />
    </div>
  );
}
