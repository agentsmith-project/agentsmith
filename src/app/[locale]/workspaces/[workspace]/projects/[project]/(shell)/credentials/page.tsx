/**
 * Credentials Page
 *
 * Manage project-scoped credentials (API keys, etc.).
 * Secrets are never displayed; only fingerprint and metadata.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { KeyRound, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import { CredentialsAPI, getApiClient } from '@/lib/api';
import type { Credential } from '@/lib/api/types';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { PageLoading } from '@/components/ui/loading';
import { Button } from '@/components/ui/button';
import { CreateCredentialDialog } from '@/components/credentials/CreateCredentialDialog';
import { RotateCredentialDialog } from '@/components/credentials/RotateCredentialDialog';
import { DeleteCredentialDialog } from '@/components/credentials/DeleteCredentialDialog';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { CredentialsContent } from './_components/CredentialsContent';
import { CredentialsHeaderActions } from './_components/CredentialsHeaderActions';
import { createCredentialColumns } from './credentials-table';

interface CredentialsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

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
  const canManageCredentials = useHasPermission('project:governance:update');
  const canReadCredentials = canManageCredentials;

  useEffect(() => {
    params.then((p) => {
      const nextParams = {
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        locale: p.locale,
      };
      setResolvedParams((previous) =>
        previous &&
        previous.workspace === nextParams.workspace &&
        previous.project === nextParams.project &&
        previous.locale === nextParams.locale
          ? previous
          : nextParams,
      );
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

  const credentialColumns = createCredentialColumns({
    t,
    onRotate: handleRotateClick,
    onDelete: handleDeleteClick,
    canManageCredentials,
    deletePending: deleteMutation.isPending,
  });

  const table = useReactTable({
    data: credentials ?? [],
    columns: credentialColumns,
    getCoreRowModel: getCoreRowModel(),
  });
  const credentialList = credentials ?? [];
  const rotatedCount = credentialList.filter((credential) => credential.last_rotated_at).length;
  const credentialTypeCount = new Set(credentialList.map((credential) => credential.type)).size;

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
              <CredentialsHeaderActions
                basePath={basePath}
                openMembersLabel={t('open_members')}
                openResourcePolicyLabel={t('open_resource_policy')}
                openAuditLabel={t('open_audit')}
              />
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
        <div className="w-full space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <CredentialsSummaryCard
              icon={<KeyRound className="h-4 w-4" />}
              label={t('table.name')}
              value={String(credentialList.length)}
              helper={t('create')}
            />
            <CredentialsSummaryCard
              icon={<RotateCcw className="h-4 w-4" />}
              label={t('rotate.title')}
              value={String(rotatedCount)}
              helper={t('table.last_rotated')}
            />
            <CredentialsSummaryCard
              icon={<ShieldCheck className="h-4 w-4" />}
              label={t('fingerprint')}
              value={String(credentialTypeCount)}
              helper={t('table.last_rotated')}
            />
          </div>

          <CredentialsContent
            isLoading={isLoading}
            credentials={credentials}
            canManageCredentials={canManageCredentials}
            createLabel={t('create')}
            emptyTitle={t('empty.title')}
            emptyDescription={t('empty.description')}
            onCreate={() => setCreateDialogOpen(true)}
            table={table}
          />
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

function CredentialsSummaryCard({
  icon,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[18px] border border-white/6 bg-white/[0.03] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
        {icon}
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-sm text-secondary">{helper}</div>
    </div>
  );
}
