/**
 * Agents Page
 *
 * Manage AI agents within the project.
 */

'use client';

import { useEffect, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Bot, Plus } from 'lucide-react';
import { getApiClient, AgentAPI } from '@/lib/api';
import type { Agent, AgentDiagnostics } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { Button } from '@/components/ui/button';
import { AgentKeysDialog } from '@/components/api-keys/AgentKeysDialog';
import { CreateAgentDialog } from '@/components/agents/CreateAgentDialog';
import { EditAgentDialog } from '@/components/agents/EditAgentDialog';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { useAgentPageCapabilities } from '@/lib/hooks/use-permissions';
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
import { AgentDetailsCard } from './_components/AgentDetailsCard';
import { AgentsHeaderActions } from './_components/AgentsHeaderActions';
import { AgentsTable } from './_components/AgentsTable';
interface AgentsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AgentsPage({ params }: AgentsPageProps) {
  const t = useTranslations('agents');
  const tToast = useTranslations('common.toast');
  const tErrors = useTranslations('errors');
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const resolvedParams = useResolvedProjectRoute(params);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogAgent, setEditDialogAgent] = useState<Agent | null>(null);
  const [keysDialogAgent, setKeysDialogAgent] = useState<Agent | null>(null);
  const [detailsAgent, setDetailsAgent] = useState<Agent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const capabilities = useAgentPageCapabilities();

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams?.locale ?? 'en-US';
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  const agentAPI = new AgentAPI(getApiClient());

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId],
    queryFn: () => agentAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && capabilities.canRead,
  });

  const { data: diagnosticsData, isLoading: diagnosticsLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId, detailsAgent?.id, 'diagnostics'],
    queryFn: () =>
      detailsAgent ? agentAPI.getDiagnostics(workspaceId, projectId, detailsAgent.id) : Promise.resolve(null),
    enabled: !!detailsAgent && !!workspaceId && !!projectId && capabilities.canRead,
  });

  const invalidateAgents = () => {
    queryClient.invalidateQueries({ queryKey: ['agents', workspaceId, projectId] });
  };

  const updateAgentMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: { name?: string; status?: 'enabled' | 'disabled' } }) =>
      agentAPI.update(workspaceId, projectId, agentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', workspaceId, projectId] });
      toast.success(t('edit_dialog.success'));
    },
    onError: () => {
      toast.error(tToast('update_agent_failed'));
    },
  });
  const deleteAgentMutation = useMutation({
    mutationFn: (agentId: string) => agentAPI.delete(workspaceId, projectId, agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', workspaceId, projectId] });
      toast.success(tToast('delete_success'));
    },
    onError: () => {
      toast.error(tToast('delete_failed'));
    },
  });

  const agents = useMemo(() => agentsData?.items ?? [], [agentsData?.items]);
  const enabledCount = agents.filter((agent) => agent.status === 'enabled').length;
  const externalCount = agents.filter((agent) => agent.mode === 'external').length;

  useEffect(() => {
    const requestedAgentId = searchParams.get('agent');
    if (!requestedAgentId || agents.length === 0) return;
    const matched = agents.find((agent) => agent.id === requestedAgentId);
    if (!matched) return;
    setDetailsAgent((prev) => (prev?.id === matched.id ? prev : matched));
    setDetailsOpen(true);
  }, [agents, searchParams]);

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
            actions={<AgentsHeaderActions basePath={basePath} t={t} />}
          />
        )}
        toolbar={(
          <PageToolbar>
            <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              {agents.length} {t('title').toLowerCase()}
            </div>
            <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              {enabledCount} {t('status_enabled').toLowerCase()}
            </div>
            <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
              {externalCount} {t('detail_title').toLowerCase()}
            </div>
            <Button
              type="button"
              variant="action"
              onClick={() => setCreateDialogOpen(true)}
              disabled={!capabilities.canManage}
              data-testid="agents__create-btn"
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              {t('create')}
            </Button>
          </PageToolbar>
        )}
      >
        <div className="w-full flex flex-col gap-6">
          {agentsLoading ? (
            <PageLoading />
          ) : agents.length === 0 ? (
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
            <AgentsTable
              agents={agents}
              canIssueAgentKeys={capabilities.canIssueKeys}
              canManageAgents={capabilities.canManage}
              isUpdating={updateAgentMutation.isPending}
              t={t}
              onDeleteRequest={(agent) => {
                setAgentToDelete(agent);
                setDeleteConfirmOpen(true);
              }}
              onEditClick={(agent) => {
                setEditDialogAgent(agent);
                setDetailsAgent(agent);
                setDetailsOpen(true);
              }}
              onKeysClick={setKeysDialogAgent}
              onRowClick={(agent) => {
                setDetailsAgent(agent);
                setDetailsOpen(true);
              }}
              onStatusToggle={(input) => updateAgentMutation.mutate(input)}
            />
          )}

          {detailsAgent && detailsOpen && (
            <AgentDetailsCard
              agent={detailsAgent}
              diagnostics={diagnosticsData as AgentDiagnostics | null}
              diagnosticsLoading={diagnosticsLoading}
              t={t}
              onClose={() => setDetailsOpen(false)}
            />
          )}
        </div>

        <CreateAgentDialog
          open={capabilities.canManage && createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          workspaceId={workspaceId}
          projectId={projectId}
          onSuccess={invalidateAgents}
        />

        <EditAgentDialog
          open={!!editDialogAgent}
          onOpenChange={(open) => !open && setEditDialogAgent(null)}
          workspaceId={workspaceId}
          projectId={projectId}
          agent={editDialogAgent}
          canSetVisibility={capabilities.canPublic}
          onSuccess={invalidateAgents}
        />

        {keysDialogAgent && workspaceId && projectId && (
          <AgentKeysDialog
            open={!!keysDialogAgent}
            onOpenChange={(open) => !open && setKeysDialogAgent(null)}
            workspaceId={workspaceId}
            projectId={projectId}
            agentId={keysDialogAgent.id}
            agentName={keysDialogAgent.name}
          />
        )}

        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('delete_confirm_message', { name: agentToDelete?.name ?? '' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('delete_confirm_cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  if (!agentToDelete) return;
                  deleteAgentMutation.mutate(agentToDelete.id);
                  setDeleteConfirmOpen(false);
                  setAgentToDelete(null);
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
