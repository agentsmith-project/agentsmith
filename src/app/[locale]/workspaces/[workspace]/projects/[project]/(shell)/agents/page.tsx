/**
 * Agents Page
 *
 * Manage AI agents within the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Bot, Plus, Key, Pencil, Power, PowerOff } from 'lucide-react';
import { getApiClient, AgentAPI } from '@/lib/api';
import type { Agent, AgentDiagnostics } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';
import { AgentKeysDialog } from '@/components/api-keys/AgentKeysDialog';
import { CreateAgentDialog } from '@/components/agents/CreateAgentDialog';
import { EditAgentDialog } from '@/components/agents/EditAgentDialog';
import { AgentDiagnosticsPanel } from '@/components/agents/AgentDiagnosticsPanel';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageToolbar } from '@/components/layout/PageToolbar';

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
  onKeysClick: (agent: Agent) => void,
  onEditClick: (agent: Agent) => void
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
      return (
        <div className="text-xs text-tertiary space-y-0.5">
          {a.owner_name ? <div>{a.owner_name}</div> : <span>—</span>}
          {a.admin_name && a.admin_name !== a.owner_name && (
            <div className="text-tertiary/80">{t('admin')}: {a.admin_name}</div>
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
          <button
            onClick={() => onEditClick(agent)}
            className="h-8 w-8 flex items-center justify-center text-icon-default hover:bg-hover rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent/50"
            title={t('edit')}
            aria-label={t('edit')}
          >
            <Pencil className="w-4 h-4" />
          </button>
          {isExternal && (
            <button
              onClick={() => onKeysClick(agent)}
              className="h-8 w-8 flex items-center justify-center text-icon-default hover:bg-hover rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent/50"
              title={t('keys_title')}
              aria-label={t('keys_title')}
            >
              <Key className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => {
              updateAgentMutation.mutate({
                agentId: agent.id,
                data: { status: isEnabled ? 'disabled' : 'enabled' },
              });
            }}
            disabled={updateAgentMutation.isPending}
            className="h-8 flex items-center gap-1.5 px-3 text-xs font-medium rounded-md border border-subtle bg-surface-high hover:bg-hover text-primary transition-colors duration-200 disabled:opacity-50"
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
          </button>
        </div>
      );
    },
  }),
  ];
}

export default function AgentsPage({ params }: AgentsPageProps) {
  const t = useTranslations('agents');
  const tToast = useTranslations('common.toast');
  const queryClient = useQueryClient();
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogAgent, setEditDialogAgent] = useState<Agent | null>(null);
  const [keysDialogAgent, setKeysDialogAgent] = useState<Agent | null>(null);
  const [detailsAgent, setDetailsAgent] = useState<Agent | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const agentAPI = new AgentAPI(getApiClient());

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId],
    queryFn: () => agentAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });

  const { data: diagnosticsData, isLoading: diagnosticsLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId, detailsAgent?.id, 'diagnostics'],
    queryFn: () =>
      detailsAgent ? agentAPI.getDiagnostics(workspaceId, projectId, detailsAgent.id) : Promise.resolve(null),
    enabled: !!detailsAgent && !!workspaceId && !!projectId,
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

  const agents = agentsData?.items || [];

  const agentColumns = createAgentColumns(
    t,
    updateAgentMutation,
    (agent) => setKeysDialogAgent(agent),
    (agent) => {
      setEditDialogAgent(agent);
      setDetailsAgent(agent);
      setDetailsOpen(true);
    }
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

  return (
    <PageState state="success">
      <PageLayout
        header={<PageHeader title={t('title')} subtitle="Manage AI agents" />}
        toolbar={(
          <PageToolbar>
            <button
              onClick={() => setCreateDialogOpen(true)}
              data-testid="agents__create-btn"
              className="flex items-center gap-2 px-4 h-10 bg-hover hover:bg-hover/90 text-foreground rounded-md border border-subtle transition-colors duration-200"
            >
              <Plus className="w-4 h-4" />
              {t('create')}
            </button>
          </PageToolbar>
        )}
      >
        <div className="max-w-6xl mx-auto w-full flex flex-col gap-6">
          {agentsLoading ? (
            <PageLoading />
          ) : agents.length === 0 ? (
            <EmptyState
              icon={Bot}
              title={`No ${t('title').toLowerCase()} yet`}
              description={`Create your first ${t('title').toLowerCase()} to get started`}
              action={{
                label: t('create'),
                onClick: () => setCreateDialogOpen(true),
              }}
            />
          ) : (
            <DataTable table={table} testId="agents__table" />
          )}

          {detailsAgent && detailsOpen && (
            <div className="rounded-md border border-border bg-surface p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t('detail_title')}</h2>
                  <p className="text-sm text-tertiary">{detailsAgent.name}</p>
                </div>
                <button
                  className="text-sm text-tertiary hover:text-primary"
                  onClick={() => setDetailsOpen(false)}
                >
                  {t('cancel')}
                </button>
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
          open={createDialogOpen}
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
          onSuccess={invalidateAgents}
        />

        {keysDialogAgent && resolvedParams && (
          <AgentKeysDialog
            open={!!keysDialogAgent}
            onOpenChange={(open) => !open && setKeysDialogAgent(null)}
            workspaceId={resolvedParams.workspace}
            projectId={resolvedParams.project}
            agentId={keysDialogAgent.id}
            agentName={keysDialogAgent.name}
          />
        )}
      </PageLayout>
    </PageState>
  );
}
