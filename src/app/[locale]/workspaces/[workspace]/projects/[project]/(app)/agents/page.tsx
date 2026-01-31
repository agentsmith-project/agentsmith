/**
 * Agents Page
 *
 * Manage AI agents within the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Edit, Trash2, Power, PowerOff } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient, AgentAPI } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { PageLoading, EmptyState } from '@/components/ui/loading';

interface AgentsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AgentsPage({ params }: AgentsPageProps) {
  const queryClient = useQueryClient();
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
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

  const updateAgentMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: { name?: string; status?: 'enabled' | 'disabled' } }) =>
      agentAPI.update(workspaceId, projectId, agentId, data),
    onSuccess: () => {
      setEditingAgent(null);
      queryClient.invalidateQueries({ queryKey: ['agents', workspaceId, projectId] });
      toast.success('Agent updated successfully');
    },
    onError: () => {
      toast.error('Failed to update agent');
    },
  });

  const deleteAgentMutation = useMutation({
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

  if (!resolvedParams || !currentProject) {
    return <PageLoading />;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Agents</h1>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div key={agent.id} className="p-4 rounded-lg border bg-card">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-5 h-5" />
                  {editingAgent === agent.id ? (
                    <input
                      type="text"
                      defaultValue={agent.name}
                      onBlur={(e) => {
                        if (e.target.value && e.target.value !== agent.name) {
                          updateAgentMutation.mutate({ agentId: agent.id, data: { name: e.target.value } });
                        }
                        setEditingAgent(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        } else if (e.key === 'Escape') {
                          setEditingAgent(null);
                        }
                      }}
                      autoFocus
                      className="bg-background border border-border rounded px-2 py-1 text-sm"
                    />
                  ) : (
                    <h3 className="font-semibold">{agent.name}</h3>
                  )}
                </div>
                <button
                  onClick={() => setEditingAgent(agent.id)}
                  className="p-1 text-muted-foreground hover:text-foreground"
                >
                  <Edit className="w-4 h-4" />
                </button>
              </div>

              {agent.description && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{agent.description}</p>
              )}

              <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                <div className="flex items-center gap-1">
                  {agent.status === 'enabled' ? (
                    <Power className="w-3 h-3 text-green-500" />
                  ) : (
                    <PowerOff className="w-3 h-3 text-gray-500" />
                  )}
                  <span className="capitalize">{agent.status}</span>
                </div>
                <div className="capitalize">{agent.presence}</div>
                <div className="capitalize">{agent.mode}</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateAgentMutation.mutate({
                    agentId: agent.id,
                    data: { status: agent.status === 'enabled' ? 'disabled' : 'enabled' },
                  })}
                  disabled={updateAgentMutation.isPending}
                  className="flex-1 px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80 transition-colors disabled:opacity-50"
                >
                  {agent.status === 'enabled' ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => deleteAgentMutation.mutate(agent.id)}
                  disabled={deleteAgentMutation.isPending}
                  className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
