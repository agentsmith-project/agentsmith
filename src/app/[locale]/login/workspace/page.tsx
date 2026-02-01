'use client';

import { useAuthStore } from '@/lib/stores/authStore';
import { useRouter } from 'next/navigation';
import { Building2, FolderKanban } from 'lucide-react';

export default function WorkspaceSelectPage() {
  const router = useRouter();
  const { workspaces } = useAuthStore();

  const handleWorkspaceSelect = (workspaceId: string) => {
    router.push(`/en-US/workspaces/${workspaceId}/projects`);
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Select your workspace
        </h1>
        <p className="text-foreground-secondary mb-8">
          Choose a workspace to continue
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {workspaces?.map(workspace => (
            <WorkspaceCard
              key={workspace.id}
              workspace={workspace}
              onSelect={() => handleWorkspaceSelect(workspace.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceCard({ workspace, onSelect }: { workspace: any; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className="relative group bg-surface border border-border rounded-md p-6 transition-all duration-200 hover:bg-surface-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 rounded-lg bg-surface-high flex items-center justify-center">
          <Building2 className="w-6 h-6 text-foreground-secondary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">{workspace.name}</h3>
          <p className="text-sm text-foreground-secondary">{workspace.role}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-foreground-secondary">
        <span className="flex items-center gap-1">
          <FolderKanban className="w-4 h-4" />
          {workspace.projects?.length || 0} projects
        </span>
      </div>
    </div>
  );
}
