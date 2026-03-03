/**
 * Agents Page
 *
 * Manage AI agents within the project.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Bot, Plus, Key, Pencil, Power, PowerOff, Trash2 } from 'lucide-react';
import { getApiClient, AgentAPI } from '@/lib/api';
import type { Agent, AgentDiagnostics } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';
import { Button, buttonVariants } from '@/components/ui/button';
import { AgentKeysDialog } from '@/components/api-keys/AgentKeysDialog';
import { CreateAgentDialog } from '@/components/agents/CreateAgentDialog';
import { EditAgentDialog } from '@/components/agents/EditAgentDialog';
import { AgentDiagnosticsPanel } from '@/components/agents/AgentDiagnosticsPanel';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { cn } from '@/lib/utils';
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

interface AgentsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

const columnHelper = createColumnHelper<Agent>();

type UpdateMutation = UseMutationResult<Agent, Error, { agentId: string; data: { name?: string; status?: 'enabled' | 'disabled' } }>;

function formatDuration(sec?: number): string {
  if (sec == null || sec < 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function createAgentColumns(
  t: (key: string) => string,
  updateAgentMutation: UpdateMutation,
  canManageAgents: boolean,
  canIssueAgentKeys: boolean,
  onKeysClick: (agent: Agent) => void,
  onEditClick: (agent: Agent) => void,
  onDeleteRequest: (agent: Agent) => void
) {
  return [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: (info) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center">
          <Bot className="w-4 h-4 text-icon-default" />
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
  columnHelper.accessor('mode', {
    header: 'Mode',
    cell: (info) => (
      <span className="text-tertiary text-sm capitalize">
        {info.getValue()}
      </span>
    ),
  }),
  columnHelper.display({
    id: 'mode_stats',
    header: 'Stats',
    cell: (info) => {
      const agent = info.row.original;
      if (agent.mode === 'external') {
        const s = agent.external_stats;
        return (
          <div className="text-xs text-tertiary space-y-0.5">
            {s?.source_ip != null && <div>IP: {s.source_ip}</div>}
            {s?.connection_duration_sec != null && (
              <div>{t('connection_duration')}: {formatDuration(s.connection_duration_sec)}</div>
            )}
            {s?.qpm != null && <div>QPM: {s.qpm}</div>}
            {!s?.source_ip && !s?.connection_duration_sec && s?.qpm == null && <span>—</span>}
          </div>
        );
      }
      // internal
      const s = agent.internal_stats;
      return (
        <div className="text-xs text-tertiary space-y-0.5">
          {s?.pod_count != null && <div>{t('pods_running')}: {s.pod_count}</div>}
          {s?.desired_replicas != null && <div>{t('desired_replicas')}: {s.desired_replicas}</div>}
          {s?.pod_count == null && s?.desired_replicas == null && <span>—</span>}
        </div>
      );
    },
  }),
  columnHelper.display({
    id: 'owner',
    header: 'Owner',
    cell: (info) => {
      const a = info.row.original;
      const ownerLabel = a.owner_name ?? a.owner_id ?? '—';
      const adminLabel = a.admin_name ?? a.admin_id;
      return (
        <div className="text-xs text-tertiary space-y-0.5">
          <div>{ownerLabel}</div>
          {adminLabel && adminLabel !== ownerLabel && (
            <div className="text-tertiary/80">{t('admin')}: {adminLabel}</div>
          )}
        </div>
      );
    },
  }),
  columnHelper.display({
    id: 'interaction',
    header: 'Interaction',
    cell: (info) => {
      const mode = info.row.original.interaction_mode;
      if (!mode) return <span className="text-tertiary text-xs">—</span>;
      return (
        <span className="text-tertiary text-xs capitalize">
          {mode === 'both' ? t('interaction_both') : t(`interaction_${mode}`)}
        </span>
      );
    },
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue() === 'enabled' ? 'active' : 'paused'} />,
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: (info) => {
      const agent = info.row.original;
      const isEnabled = agent.status === 'enabled';
      const isExternal = agent.mode === 'external';
      return (
        <div className="flex items-center justify-end gap-1.5 min-w-[140px]">
          {canManageAgents && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(event) => {
                event.stopPropagation();
                onEditClick(agent);
              }}
              className="h-8 w-8 text-icon-default hover:bg-hover"
              title={t('edit')}
              aria-label={t('edit')}
            >
              <Pencil className="w-4 h-4" />
            </Button>
          )}
          {isExternal && canIssueAgentKeys && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(event) => {
                event.stopPropagation();
                onKeysClick(agent);
              }}
              className="h-8 w-8 text-icon-default hover:bg-hover"
              title={t('keys_title')}
              aria-label={t('keys_title')}
            >
              <Key className="w-4 h-4" />
            </Button>
          )}
          {canManageAgents && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteRequest(agent);
                }}
                className="h-8 w-8 text-error hover:bg-hover"
                title={t('delete')}
                aria-label={t('delete')}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  updateAgentMutation.mutate({
                    agentId: agent.id,
                    data: { status: isEnabled ? 'disabled' : 'enabled' },
                  });
                }}
                disabled={updateAgentMutation.isPending}
                className="h-8 gap-1.5 px-3 text-xs"
                title={isEnabled ? t('disable_hint') : t('enable_hint')}
              >
                {isEnabled ? (
                  <>
                    <PowerOff className="w-3.5 h-3.5 text-warning" />
                    {t('disable')}
                  </>
                ) : (
                  <>
                    <Power className="w-3.5 h-3.5 text-success" />
                    {t('enable')}
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      );
    },
  }),
  ];
}

export default function AgentsPage({ params }: AgentsPageProps) {
  const t = useTranslations('agents');
  const tToast = useTranslations('common.toast');
  const tErrors = useTranslations('errors');
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
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
  const canProjectManagePermission = useHasPermission('project:manage');
  const canAgentPublic = canAgentPublicPermission || canProjectManagePermission;
  const canReadAgents = canAgentRead || canAgentCreate || canAgentUpdate || canAgentDelete;
  const canManageAgents = canAgentCreate || canAgentUpdate || canAgentDelete;
  const canIssueAgentKeys = canAgentKeyIssue || canAgentKeyRevoke;

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

  useEffect(() => {
    const requestedAgentId = searchParams.get('agent');
    if (!requestedAgentId || agents.length === 0) return;
    const matched = agents.find((agent) => agent.id === requestedAgentId);
    if (!matched) return;
    setDetailsAgent((prev) => (prev?.id === matched.id ? prev : matched));
    setDetailsOpen(true);
  }, [agents, searchParams]);

  const agentColumns = createAgentColumns(
    t,
    updateAgentMutation,
    canManageAgents,
    canIssueAgentKeys,
    (agent) => setKeysDialogAgent(agent),
    (agent) => {
      setEditDialogAgent(agent);
      setDetailsAgent(agent);
      setDetailsOpen(true);
    },
    (agent) => {
      setAgentToDelete(agent);
      setDeleteConfirmOpen(true);
    },
  );

  const table = useReactTable({
    data: agents,
    columns: agentColumns,
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
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${basePath}/chat`}
                  className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                  data-testid="agents__open-chat"
                >
                  {t('open_chat')}
                </Link>
                <Link
                  href={`${basePath}/notebook`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="agents__open-notebook"
                >
                  {t('open_notebook')}
                </Link>
                <Link
                  href={`${basePath}/endpoints`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="agents__open-endpoints"
                >
                  {t('open_endpoints')}
                </Link>
              </div>
            )}
          />
        )}
        toolbar={(
          <PageToolbar>
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
            <DataTable
              table={table}
              testId="agents__table"
              onRowClick={(agent) => {
                setDetailsAgent(agent);
                setDetailsOpen(true);
              }}
            />
          )}

          {detailsAgent && detailsOpen && (
            <div className="rounded-md border border-border bg-surface p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t('detail_title')}</h2>
                  <p className="text-sm text-tertiary">{detailsAgent.name}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-sm text-tertiary"
                  onClick={() => setDetailsOpen(false)}
                >
                  {t('cancel')}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-tertiary">{t('mode_external')}</p>
                  <p className="text-foreground capitalize">{detailsAgent.mode}</p>
                </div>
                <div>
                  <p className="text-xs text-tertiary">{t('interaction_mode')}</p>
                  <p className="text-foreground capitalize">{detailsAgent.interaction_mode ?? '—'}</p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-foreground mb-2">{t('detail_diagnostics')}</h3>
                <AgentDiagnosticsPanel diagnostics={diagnosticsData as AgentDiagnostics | null} loading={diagnosticsLoading} />
              </div>
            </div>
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
