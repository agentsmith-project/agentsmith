/**
 * Agents Page
 *
 * Manage AI agents within the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper } from '@tanstack/react-table';
import { Bot, Plus, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient, AgentAPI } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';

interface AgentsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

interface Agent {
  id: string;
  name: string;
  description?: string;
  model?: string;
  temperature?: number;
  status: 'enabled' | 'disabled';
  presence: string;
  mode: string;
}

const columnHelper = createColumnHelper<Agent>();

const agentColumns = [
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
  columnHelper.accessor('model', {
    header: 'Model',
    cell: (info) => (
      <span className="text-tertiary text-sm font-mono">
        {info.getValue() || '-'}
      </span>
    ),
  }),
  columnHelper.accessor('temperature', {
    header: 'Temp',
    cell: (info) => (
      <span className="text-tertiary text-sm">
        {info.getValue() ?? '-'}
      </span>
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
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue() === 'enabled' ? 'active' : 'paused'} />,
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: (info) => (
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            const row = info.row.original;
            updateAgentMutation.mutate({
              agentId: row.id,
              data: { status: row.status === 'enabled' ? 'disabled' : 'enabled' },
            });
          }}
          disabled={updateAgentMutation.isPending}
          className="px-3 py-1.5 text-xs rounded-sm bg-surface-high hover:bg-hover transition-colors disabled:opacity-50 border border-subtle text-primary"
        >
          {info.row.original.status === 'enabled' ? 'Disable' : 'Enable'}
        </button>
        <button
          onClick={() => deleteAgentMutation.mutate(info.row.original.id)}
          disabled={deleteAgentMutation.isPending}
          className="p-1.5 text-error hover:bg-hover rounded-sm transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    ),
  }),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let updateAgentMutation: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deleteAgentMutation: any;

export default function AgentsPage({ params }: AgentsPageProps) {
  const queryClient = useQueryClient();
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const [newAgentName, setNewAgentName] = useState('');

  const currentProject = useAuthStore((state) => state.currentProject);

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

  const createAgentMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      agentAPI.create(workspaceId, projectId, {
        name: data.name,
        description: data.description,
        mode: 'external',
      }),
    onSuccess: () => {
      setNewAgentName('');
      queryClient.invalidateQueries({ queryKey: ['agents', workspaceId, projectId] });
      toast.success('Agent created successfully');
    },
    onError: () => {
      toast.error('Failed to create agent');
    },
  });

  updateAgentMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: { name?: string; status?: 'enabled' | 'disabled' } }) =>
      agentAPI.update(workspaceId, projectId, agentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', workspaceId, projectId] });
      toast.success('Agent updated successfully');
    },
    onError: () => {
      toast.error('Failed to update agent');
    },
  });

  deleteAgentMutation = useMutation({
    mutationFn: (agentId: string) => agentAPI.delete(workspaceId, projectId, agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', workspaceId, projectId] });
      toast.success('Agent deleted successfully');
    },
    onError: () => {
      toast.error('Failed to delete agent');
    },
  });

  const agents = agentsData?.items || [];

  const table = useReactTable({
    data: agents,
    columns: agentColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!resolvedParams || !currentProject) {
    return <PageLoading />;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
          <p className="text-sm text-tertiary mt-1">Manage AI agents within the project</p>
        </div>
        <button
          onClick={() => createAgentMutation.mutate({ name: newAgentName || 'New Agent' })}
          disabled={createAgentMutation.isPending}
          className="flex items-center gap-2 px-4 h-10 bg-hover hover:bg-hover/80 text-foreground rounded-sm border border-subtle transition-colors disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          New Agent
        </button>
      </div>

      {agentsLoading ? (
        <PageLoading />
      ) : agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          description="Create your first agent to get started"
          action={{
            label: 'Create Agent',
            onClick: () => createAgentMutation.mutate({ name: 'My Agent' }),
          }}
        />
      ) : (
        <DataTable table={table} />
      )}
    </div>
  );
}
