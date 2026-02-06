'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, FolderKanban } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';

export default function WorkspaceSelectPage() {
  const router = useRouter();
  const params = useParams();
  const t = useTranslations('auth');
  const locale = (params?.locale as string) || 'en-US';
  const { data: workspaces } = useWorkspaces();

  const handleWorkspaceSelect = (workspaceId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects`);
  };

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-8">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              {t('select_your_workspace')}
            </h1>
            <p className="text-tertiary mb-8">
              {t('choose_workspace')}
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
      </PageLayout>
    </PageState>
  );
}

interface WorkspaceCardProps {
  workspace: { id: string; name: string };
  onSelect: () => void;
}

function WorkspaceCard({ workspace, onSelect }: WorkspaceCardProps) {
  const t = useTranslations('auth');
  return (
    <div
      onClick={onSelect}
      className="relative group bg-surface border border-border rounded-md p-6 transition-colors duration-200 hover:bg-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 rounded-sm bg-surface-high flex items-center justify-center">
          <Building2 className="w-6 h-6 text-icon-default" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">{workspace.name}</h3>
          <p className="text-sm text-tertiary">{workspace.id}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-tertiary">
        <span className="flex items-center gap-1">
          <FolderKanban className="w-4 h-4" />
          {t('projects_count', { count: 0 })}
        </span>
      </div>
    </div>
  );
}
