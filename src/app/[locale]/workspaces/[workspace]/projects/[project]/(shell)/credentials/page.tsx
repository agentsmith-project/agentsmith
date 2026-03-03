/**
 * Credentials Page
 *
 * Manage project-scoped credentials (API keys, etc.).
 * Secrets are never displayed; only fingerprint and metadata.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Key, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { CredentialsAPI, getApiClient } from '@/lib/api';
import type { Credential } from '@/lib/api/types';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { DataTable } from '@/components/ui/data-table';
import { Button, buttonVariants } from '@/components/ui/button';
import { CreateCredentialDialog } from '@/components/credentials/CreateCredentialDialog';
import { RotateCredentialDialog } from '@/components/credentials/RotateCredentialDialog';
import { DeleteCredentialDialog } from '@/components/credentials/DeleteCredentialDialog';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { cn } from '@/lib/utils';

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
  canManageCredentials: boolean,
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRotate(info.row.original)}
          disabled={!canManageCredentials || deleteMutation.isPending}
          className="h-8 w-8 text-tertiary hover:text-foreground hover:bg-hover"
          title={t('rotate')}
          data-testid={`credentials__action-rotate--${info.row.original.id}`}
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(info.row.original)}
          disabled={!canManageCredentials || deleteMutation.isPending}
          className="h-8 w-8 text-error hover:bg-hover"
          title={t('delete')}
          data-testid={`credentials__action-delete--${info.row.original.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    ),
  }),
];

export default function CredentialsPage({ params }: CredentialsPageProps) {
  const t = useTranslations('credentials');
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
    locale?: string;
  } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null);
  const canManageCredentials = useHasPermission('project:manage');
  const canReadCredentials = canManageCredentials;


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
  });

  const handleRotateClick = (cred: Credential) => {
    if (!canManageCredentials) return;
    setSelectedCredential(cred);
    setRotateDialogOpen(true);
  };

  const handleDeleteClick = (cred: Credential) => {
    if (!canManageCredentials) return;
    setSelectedCredential(cred);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedCredential) return;
    await deleteMutation.mutateAsync(selectedCredential.id);
    setDeleteDialogOpen(false);
    setSelectedCredential(null);
    invalidate();
  };

  const credentialColumns = createCredentialColumns(
    t,
    handleRotateClick,
    handleDeleteClick,
    canManageCredentials,
    deleteMutation
  );

  const table = useReactTable({
    data: credentials ?? [],
    columns: credentialColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
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

  if (!canReadCredentials) {
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
                  href={`${basePath}/members`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="credentials__open-members"
                >
                  {t('open_members')}
                </Link>
                <Link
                  href={`${basePath}/resource-policy`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="credentials__open-resource-policy"
                >
                  {t('open_resource_policy')}
                </Link>
                <Link
                  href={`${basePath}/audit`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="credentials__open-audit"
                >
                  {t('open_audit')}
                </Link>
              </div>
            )}
          />
        )}
        toolbar={(
          <PageToolbar>
            <Button
              onClick={() => setCreateDialogOpen(true)}
              disabled={!canManageCredentials}
              data-testid="credentials__create-btn"
              variant="action"
            >
              <Plus className="w-4 h-4" />
              {t('create')}
            </Button>
          </PageToolbar>
        )}
      >
        <div className="w-full">
          {isLoading ? (
            <PageLoading />
          ) : !credentials || credentials.length === 0 ? (
            <EmptyState
              icon={Key}
              title={t('empty.title')}
              description={t('empty.description')}
              action={canManageCredentials ? {
                label: t('create'),
                onClick: () => setCreateDialogOpen(true),
              } : undefined}
            />
          ) : (
            <DataTable table={table} testId="credentials__table" />
          )}
        </div>

        <CreateCredentialDialog
          open={canManageCredentials && createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          workspaceId={workspaceId}
          projectId={projectId}
          onSuccess={invalidate}
        />

        <RotateCredentialDialog
          open={canManageCredentials && rotateDialogOpen}
          onOpenChange={setRotateDialogOpen}
          credential={selectedCredential}
          workspaceId={workspaceId}
          projectId={projectId}
          onSuccess={invalidate}
        />

        <DeleteCredentialDialog
          open={canManageCredentials && deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          credential={selectedCredential}
          onConfirm={handleDeleteConfirm}
        />
      </PageLayout>
    </PageState>
  );
}
