/**
 * Agents Page
 *
 * Manage AI agents within the project.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { AgentDetailsCard } from './_components/AgentDetailsCard';
import { AgentsHeaderActions } from './_components/AgentsHeaderActions';
import { AgentsTable } from './_components/AgentsTable';
import type { ResolvedAgentsPageParams } from './agents-page-types';

interface AgentsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AgentsPage({ params }: AgentsPageProps) {
  const t = useTranslations('agents');
  const tToast = useTranslations('common.toast');
  const tErrors = useTranslations('errors');
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [resolvedParams, setResolvedParams] = useState<ResolvedAgentsPageParams | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogAgent, setEditDialogAgent] = useState<Agent | null>(null);
  const [keysDialogAgent, setKeysDialogAgent] = useState<Agent | null>(null);
  const [detailsAgent, setDetailsAgent] = useState<Agent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const canAgentRead = useHasPermission('project:agent:manage');
  const canAgentCreate = useHasPermission('project:agent:manage');
  const canAgentUpdate = useHasPermission('project:agent:manage');
  const canAgentDelete = useHasPermission('project:agent:manage');
  const canAgentKeyIssue = useHasPermission('project:agent:manage');
  const canAgentKeyRevoke = useHasPermission('project:agent:manage');
  const canAgentPublicPermission = useHasPermission('project:agent:public');
  const canAgentPublic = canAgentPublicPermission;
  const canReadAgents = canAgentRead || canAgentCreate || canAgentUpdate || canAgentDelete;
  const canManageAgents = canAgentCreate || canAgentUpdate || canAgentDelete;
  const canIssueAgentKeys = canAgentKeyIssue || canAgentKeyRevoke;

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

  const agentAPI = new AgentAPI(getApiClient());

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId],
    queryFn: () => agentAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && canReadAgents,
  });

  const { data: diagnosticsData, isLoading: diagnosticsLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId, detailsAgent?.id, 'diagnostics'],
    queryFn: () =>
      detailsAgent ? agentAPI.getDiagnostics(workspaceId, projectId, detailsAgent.id) : Promise.resolve(null),
    enabled: !!detailsAgent && !!workspaceId && !!projectId && canReadAgents,
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

  if (!canReadAgents) {
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
              disabled={!canManageAgents}
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
              action={canManageAgents ? {
                label: t('create'),
                onClick: () => setCreateDialogOpen(true),
              } : undefined}
            />
          ) : (
            <AgentsTable
              agents={agents}
              canIssueAgentKeys={canIssueAgentKeys}
              canManageAgents={canManageAgents}
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
          open={canManageAgents && createDialogOpen}
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
          canSetVisibility={canAgentPublic}
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
