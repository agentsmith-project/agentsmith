/**
 * Agent Runners Page
 *
 * Task runner configuration, readiness, and diagnostics surface.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Bot, Plus } from 'lucide-react';
import { AgentRunnerAPI, getApiClient } from '@/lib/api';
import type { AgentDiagnostics } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { EmptyState, PageLoading } from '@/components/ui/loading';
import { Button } from '@/components/ui/button';
import { AgentRunnerKeysDialog } from '@/components/api-keys/AgentRunnerKeysDialog';
import { CreateAgentRunnerDialog } from '@/components/agent-runners/CreateAgentRunnerDialog';
import { EditAgentRunnerDialog } from '@/components/agent-runners/EditAgentRunnerDialog';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { useAgentRunnerPageCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { ProjectRecoveryState } from '../_components/ProjectRecoveryState';
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
import { AgentRunnerDetailsCard } from './_components/AgentRunnerDetailsCard';
import { AgentRunnersHeaderActions } from './_components/AgentRunnersHeaderActions';
import { AgentRunnersTable } from './_components/AgentRunnersTable';
import type { AgentRunnerPageRecord, AgentRunnerStatusUpdateInput } from './agent-runners-page-types';

interface AgentRunnersPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AgentRunnersPage({ params }: AgentRunnersPageProps) {
  const t = useTranslations('agent_runners');
  const tToast = useTranslations('common.toast');
  const tErrors = useTranslations('errors');
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const resolvedParams = useResolvedProjectRoute(params);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogRunner, setEditDialogRunner] = useState<AgentRunnerPageRecord | null>(null);
  const [detailsRunner, setDetailsRunner] = useState<AgentRunnerPageRecord | null>(null);
  const [connectionKeysRunner, setConnectionKeysRunner] = useState<AgentRunnerPageRecord | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [runnerToDelete, setRunnerToDelete] = useState<AgentRunnerPageRecord | null>(null);
  const capabilities = useAgentRunnerPageCapabilities();

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams?.locale ?? 'en-US';
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  const runnerAPI = new AgentRunnerAPI(getApiClient());
  const runnerQueryKey = ['agent-runners', workspaceId, projectId] as const;

  const { data: runnersData, isLoading: runnersLoading } = useQuery({
    queryKey: runnerQueryKey,
    queryFn: () => runnerAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && capabilities.canRead,
  });

  const { data: diagnosticsData, isLoading: diagnosticsLoading } = useQuery({
    queryKey: ['agent-runners', workspaceId, projectId, detailsRunner?.id, 'diagnostics'],
    queryFn: () =>
      detailsRunner ? runnerAPI.getDiagnostics(workspaceId, projectId, detailsRunner.id) : Promise.resolve(null),
    enabled: !!detailsRunner && !!workspaceId && !!projectId && capabilities.canRead,
  });

  const invalidateRunners = () => {
    queryClient.invalidateQueries({ queryKey: runnerQueryKey });
  };

  const updateRunnerMutation = useMutation({
    mutationFn: ({ runnerId, data }: { runnerId: string; data: AgentRunnerStatusUpdateInput }) =>
      runnerAPI.update(workspaceId, projectId, runnerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runnerQueryKey });
      toast.success(t('edit_dialog.success'));
    },
    onError: () => {
      toast.error(tToast('update_agent_runner_failed'));
    },
  });

  const deleteRunnerMutation = useMutation({
    mutationFn: (runnerId: string) => runnerAPI.delete(workspaceId, projectId, runnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runnerQueryKey });
      toast.success(tToast('delete_success'));
    },
    onError: () => {
      toast.error(tToast('delete_failed'));
    },
  });

  const runners = useMemo(
    () => (runnersData?.items ?? []) as AgentRunnerPageRecord[],
    [runnersData?.items],
  );
  const readyCount = runners.filter((runner) => runner.status === 'ready').length;
  const diagnosticIssueCount = runners.filter((runner) => runner.diagnostics?.last_error).length;

  useEffect(() => {
    const requestedRunnerId = searchParams.get('runner');
    if (!requestedRunnerId || runners.length === 0) return;
    const matched = runners.find((runner) => runner.id === requestedRunnerId);
    if (!matched) return;
    setDetailsRunner((prev) => (prev?.id === matched.id ? prev : matched));
    setDetailsOpen(true);
  }, [runners, searchParams]);

  if (!resolvedParams.isReady) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.isValid || !workspaceId || !projectId) {
    return (
      <PageState state="error">
        <ProjectRecoveryState
          title={tErrors('validation_error')}
          description={tErrors('badRequest.description')}
          locale={locale}
          workspaceId={workspaceId}
        />
      </PageState>
    );
  }

  if (!capabilities.canRead) {
    return (
      <PageState state="error">
        <ProjectRecoveryState
          title={tErrors('permission_denied_title')}
          description={tErrors('permission_denied_hint')}
          locale={locale}
          workspaceId={workspaceId}
        />
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
            actions={<AgentRunnersHeaderActions basePath={basePath} t={t} />}
          />
        )}
        toolbar={(
          <PageToolbar>
            <div className="rounded-full border border-subtle bg-surface-low px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              {runners.length} {t('runner_count_label')}
            </div>
            <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              {readyCount} {t('ready_count_label')}
            </div>
            <div className="rounded-full border border-subtle bg-surface-low px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              {diagnosticIssueCount} {t('diagnostic_issue_count_label')}
            </div>
            <Button
              type="button"
              variant="action"
              onClick={() => setCreateDialogOpen(true)}
              disabled={!capabilities.canManage}
              data-testid="agent-runners__create-btn"
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              {t('create')}
            </Button>
          </PageToolbar>
        )}
      >
        <div className="flex w-full flex-col gap-6">
          {runnersLoading ? (
            <PageLoading />
          ) : runners.length === 0 ? (
            <EmptyState
              icon={Bot}
              title={t('empty.title')}
              description={t('empty.description')}
              action={capabilities.canManage ? {
                label: t('create'),
                onClick: () => setCreateDialogOpen(true),
              } : undefined}
            />
          ) : (
            <AgentRunnersTable
              runners={runners}
              canManageRunners={capabilities.canManage}
              isUpdating={updateRunnerMutation.isPending}
              t={t}
              onDeleteRequest={(runner) => {
                setRunnerToDelete(runner);
                setDeleteConfirmOpen(true);
              }}
              onEditClick={(runner) => {
                setEditDialogRunner(runner);
                setDetailsRunner(runner);
                setDetailsOpen(true);
              }}
              onConnectionKeysClick={(runner) => setConnectionKeysRunner(runner)}
              onRowClick={(runner) => {
                setDetailsRunner(runner);
                setDetailsOpen(true);
              }}
              onStatusToggle={(input) => updateRunnerMutation.mutate(input)}
            />
          )}

          {detailsRunner && detailsOpen ? (
            <AgentRunnerDetailsCard
              runner={detailsRunner}
              diagnostics={diagnosticsData as AgentDiagnostics | null}
              diagnosticsLoading={diagnosticsLoading}
              t={t}
              onClose={() => setDetailsOpen(false)}
            />
          ) : null}
        </div>

        <CreateAgentRunnerDialog
          open={capabilities.canManage && createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          workspaceId={workspaceId}
          projectId={projectId}
          onSuccess={invalidateRunners}
        />

        <EditAgentRunnerDialog
          open={!!editDialogRunner}
          onOpenChange={(open) => !open && setEditDialogRunner(null)}
          workspaceId={workspaceId}
          projectId={projectId}
          runner={editDialogRunner}
          onSuccess={invalidateRunners}
        />

        {connectionKeysRunner ? (
          <AgentRunnerKeysDialog
            open={!!connectionKeysRunner}
            onOpenChange={(open) => {
              if (!open) setConnectionKeysRunner(null);
            }}
            workspaceId={workspaceId}
            projectId={projectId}
            runnerId={connectionKeysRunner.id}
            runnerName={connectionKeysRunner.name}
          />
        ) : null}

        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('delete_confirm_message', { name: runnerToDelete?.name ?? '' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('delete_confirm_cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  if (!runnerToDelete) return;
                  deleteRunnerMutation.mutate(runnerToDelete.id);
                  setDeleteConfirmOpen(false);
                  setRunnerToDelete(null);
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
