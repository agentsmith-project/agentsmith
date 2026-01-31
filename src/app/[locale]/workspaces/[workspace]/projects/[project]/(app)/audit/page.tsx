/**
 * Audit Page
 *
 * View audit logs for the project.
 */

'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSearch, Clock } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';

interface AuditPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function AuditPage({ params }: AuditPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['audit', workspaceId, projectId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/audit`);
      return response.json();
    },
    enabled: !!workspaceId && !!projectId,
  });

  const events = auditData?.items || [];

  if (!resolvedParams || !currentProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="text-muted-foreground">Track all activity within the project</p>
      </div>

      {auditLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading audit logs...</div>
      ) : events.length === 0 ? (
        <div className="text-center py-12">
          <FileSearch className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-2">No audit events</h2>
          <p className="text-muted-foreground">Audit logs will appear here once activity occurs</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event: any) => (
            <div key={event.id} className="flex items-start gap-4 p-4 rounded-lg border bg-card">
              <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{event.actor_type}</span>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-sm">{event.action}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    event.result === 'ok' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {event.result}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {event.resource_type}:{event.resource_id}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(event.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
