/**
 * Agents Page
 *
 * Manage AI agents within the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, createColumnHelper, flexRender } from '@tanstack/react-table';
import { Bot, Plus, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient, AgentAPI } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { PageLoading, EmptyState } from '@/components/ui/loading';
import { StatusBadge } from '@/components/ui/status-badge';

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
        <div className="w-8 h-8 rounded bg-surface-high flex items-center justify-center">
          <Bot className="w-4 h-4 text-foreground-secondary" />
        </div>
        <div className="flex flex-col">
          <span className="text-foreground font-medium">{info.getValue()}</span>
          {info.row.original.description && (
            <span className="text-xs text-foreground-secondary line-clamp-1">
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
      <span className="text-foreground-secondary text-sm font-mono">
        {info.getValue() || '-'}
      </span>
    ),
  }),
  columnHelper.accessor('temperature', {
    header: 'Temp',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm">
        {info.getValue() ?? '-'}
      </span>
    ),
  }),
  columnHelper.accessor('mode', {
    header: 'Mode',
    cell: (info) => (
      <span className="text-foreground-secondary text-sm capitalize">
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
          className="px-3 py-1.5 text-xs rounded bg-surface hover:bg-surface-high transition-colors disabled:opacity-50 border border-border"
        >
          {info.row.original.status === 'enabled' ? 'Disable' : 'Enable'}
        </button>
        <button
          onClick={() => deleteAgentMutation.mutate(info.row.original.id)}
          disabled={deleteAgentMutation.isPending}
          className="p-1.5 text-error hover:bg-error/10 rounded transition-colors disabled:opacity-50"
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
          <p className="text-sm text-foreground-secondary mt-1">Manage AI agents within the project</p>
        </div>
        <button
          onClick={() => createAgentMutation.mutate({ name: newAgentName || 'New Agent' })}
          disabled={createAgentMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
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
        <div className="rounded-lg overflow-hidden border border-border bg-surface shadow-sm">
          <table className="w-full border-collapse">
            <thead className="bg-surface-high">
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th
                      key={header.id}
                      className="px-4 py-4 text-left text-sm font-medium text-foreground-secondary"
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => (
                <tr
                  key={row.id}
                  className="hover:bg-surface-hover transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 border-b border-border last:border-b-0"
                >
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      className="px-4 py-4 text-sm text-foreground"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
