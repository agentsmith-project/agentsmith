/**
 * Endpoints Page
 *
 * Manage LLM endpoints within the project.
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Server, Plus, Edit, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient, EndpointAPI } from '@/lib/api';

interface EndpointsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function EndpointsPage({ params }: EndpointsPageProps) {
  const queryClient = useQueryClient();
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const [editingEndpoint, setEditingEndpoint] = useState<string | null>(null);

  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const endpointAPI = new EndpointAPI(getApiClient());

  const { data: endpointsData, isLoading: endpointsLoading } = useQuery({
    queryKey: ['endpoints', workspaceId, projectId],
    queryFn: () => endpointAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
  });

  const deleteEndpointMutation = useMutation({
    mutationFn: (endpointId: string) => endpointAPI.delete(workspaceId, projectId, endpointId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints', workspaceId, projectId] });
    },
  });

  const endpoints = endpointsData?.items || [];

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Endpoints</h1>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
          <Plus className="w-4 h-4" />
          New Endpoint
        </button>
      </div>

      {endpointsLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading endpoints...</div>
      ) : endpoints.length === 0 ? (
        <div className="text-center py-12">
          <Server className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-2">No endpoints yet</h2>
          <p className="text-muted-foreground">Add your first LLM endpoint to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {endpoints.map((endpoint) => (
            <div key={endpoint.id} className="p-4 rounded-lg border bg-card">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      {editingEndpoint === endpoint.id ? (
                        <input
                          type="text"
                          defaultValue={endpoint.name}
                          className="bg-background border border-border rounded px-2 py-1"
                          autoFocus
                        />
                      ) : (
                        <h3 className="font-semibold">{endpoint.name}</h3>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        endpoint.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {endpoint.status}
                      </span>
                    </div>
                    {endpoint.description && (
                      <p className="text-sm text-muted-foreground mt-1">{endpoint.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <div>Model: <code className="bg-background px-1 rounded">{endpoint.openai_model}</code></div>
                      <div className="capitalize">{endpoint.type}</div>
                      <div className="truncate max-w-xs">{endpoint.base_url}</div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingEndpoint(endpoint.id)}
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteEndpointMutation.mutate(endpoint.id)}
                    disabled={deleteEndpointMutation.isPending}
                    className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
