/**
 * Workbench Page
 *
 * Multi-turn agent conversation interface with:
 * - Left: Source files list
 * - Center: Thread and turn management
 * - Right: Turn details and events
 */

'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Plus,
  MessageSquare,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';

interface WorkbenchPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function WorkbenchPage({ params }: WorkbenchPageProps) {
  const queryClient = useQueryClient();
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);

  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  // Simple fetch functions (we'll create proper API classes later)
  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ['workbench', 'sources', workspaceId, projectId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/sources`);
      return response.json();
    },
    enabled: !!workspaceId && !!projectId,
  });

  const { data: threadsData, isLoading: threadsLoading } = useQuery({
    queryKey: ['workbench', 'threads', workspaceId, projectId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/threads`);
      return response.json();
    },
    enabled: !!workspaceId && !!projectId,
  });

  const { data: turnsData, isLoading: turnsLoading } = useQuery({
    queryKey: ['workbench', 'turns', workspaceId, projectId, currentThreadId],
    queryFn: async () => {
      if (!currentThreadId) return { items: [], total: 0 };
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/threads/${currentThreadId}/turns`);
      return response.json();
    },
    enabled: !!currentThreadId,
  });

  const createThreadMutation = useMutation({
    mutationFn: async (data: { end_user_id: string; agent_id: string; title?: string }) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return response.json();
    },
    onSuccess: (data) => {
      setCurrentThreadId(data.id);
      queryClient.invalidateQueries({ queryKey: ['workbench', 'threads', workspaceId, projectId] });
    },
  });

  const sources = sourcesData?.items || [];
  const threads = threadsData?.items || [];
  const turns = turnsData?.items || [];
  const currentThread = threads.find((t: any) => t.id === currentThreadId);

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'processing':
      case 'started':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'attached':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex h-full">
      {/* Left Panel - Source Files */}
      <div className="w-72 border-r border-border bg-card">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Source Files</h2>
        </div>
        <div className="p-2 overflow-y-auto h-[calc(100%-60px)]">
          {sourcesLoading ? (
            <div className="text-sm text-muted-foreground text-center py-4">Loading sources...</div>
          ) : sources.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">No source files</div>
          ) : (
            <div className="space-y-1">
              {sources.map((source: any) => (
                <div
                  key={source.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent/50 cursor-pointer"
                >
                  <FileText className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{source.file_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {(source.file_size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  {getStatusIcon(source.status)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Center Panel - Threads */}
      <div className="flex-1 flex flex-col bg-background">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">Agent Threads</h2>
          <button
            onClick={() => createThreadMutation.mutate({
              end_user_id: 'usr-demo',
              agent_id: 'agent_001',
              title: 'New Thread',
            })}
            disabled={createThreadMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm"
          >
            <Plus className="w-4 h-4" />
            New Thread
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {threadsLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground">Loading threads...</div>
            </div>
          ) : threads.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No threads yet. Create one to start.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {threads.map((thread: any) => (
                <div
                  key={thread.id}
                  onClick={() => setCurrentThreadId(thread.id)}
                  className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                    currentThreadId === thread.id
                      ? 'bg-accent border-accent-foreground'
                      : 'bg-card border-border hover:border-accent-foreground'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-medium truncate">{thread.title || 'Untitled Thread'}</h3>
                    {getStatusIcon(thread.status)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <div>Agent: {thread.current_agent_id}</div>
                    <div>User: {thread.end_user_id}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Thread Details */}
      <div className="w-80 border-l border-border bg-card">
        {currentThread ? (
          <div className="h-full flex flex-col">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold mb-2">{currentThread.title || 'Thread Details'}</h3>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>Status: {currentThread.status}</div>
                <div>Agent: {currentThread.current_agent_id}</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <h4 className="font-semibold mb-3">Turns</h4>
              {turnsLoading ? (
                <div className="text-sm text-muted-foreground text-center py-4">Loading turns...</div>
              ) : turns.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">No turns yet</div>
              ) : (
                <div className="space-y-3">
                  {turns.map((turn: any) => (
                    <div key={turn.id} className="p-3 rounded-md bg-background">
                      <div className="flex items-center gap-2 mb-2">
                        {getStatusIcon(turn.status)}
                        <span className="text-sm font-medium capitalize">{turn.status}</span>
                      </div>
                      {turn.input_message && (
                        <div className="text-sm mb-2">
                          <div className="text-muted-foreground mb-1">Input:</div>
                          <div className="line-clamp-2">{turn.input_message}</div>
                        </div>
                      )}
                      {turn.output_message && (
                        <div className="text-sm">
                          <div className="text-muted-foreground mb-1">Output:</div>
                          <div className="line-clamp-3">{turn.output_message}</div>
                        </div>
                      )}
                      {turn.error_message && (
                        <div className="text-sm text-red-500 mt-2">
                          <div className="text-red-400 mb-1">Error:</div>
                          <div>{turn.error_message}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="text-sm text-muted-foreground text-center">
              Select a thread to view details
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
