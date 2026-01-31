/**
 * UserData Page
 *
 * Manage source files for agent context.
 */

'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload, FileText, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';

interface UserDataPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UserDataPage({ params }: UserDataPageProps) {
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; project: string } | null>(null);
  const currentProject = useAuthStore((state) => state.currentProject);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, project: p.project }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';

  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ['sources', workspaceId, projectId],
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/sources`);
      return response.json();
    },
    enabled: !!workspaceId && !!projectId,
  });

  const sources = sourcesData?.items || [];

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
        <h1 className="text-2xl font-bold">UserData (Source Files)</h1>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
          <Upload className="w-4 h-4" />
          Upload Files
        </button>
      </div>

      {sourcesLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading files...</div>
      ) : sources.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-2">No source files</h2>
          <p className="text-muted-foreground">Upload files to provide context for your agents</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sources.map((source: any) => (
            <div key={source.id} className="p-4 rounded-lg border bg-card">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <FileText className="w-5 h-5 flex-shrink-0 text-muted-foreground" />
                  <span className="font-medium truncate">{source.file_name}</span>
                </div>
                <button className="p-1 text-destructive hover:bg-destructive/10 rounded-md transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>Size: {(source.file_size / 1024).toFixed(1)} KB</div>
                <div className="capitalize">Status: {source.status}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
