'use client';

import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, FolderKanban } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { useAuthStore } from '@/lib/stores/authStore';
import { APIError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';

export default function WorkspaceSelectPage() {
  const router = useRouter();
  const params = useParams();
  const t = useTranslations('auth');
  const locale = (params?.locale as string) || 'en-US';
  const { clearAuth } = useAuthStore();
  const {
    data: workspaces,
    isLoading,
    isError,
    error,
    refetch,
  } = useWorkspaces();

  const isUnauthorized = isError && error instanceof APIError && error.statusCode === 401;

  const handleWorkspaceSelect = (workspaceId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects`);
  };

  const handleReLogin = useCallback(() => {
    clearAuth();
    router.replace(`/${locale}/login`);
  }, [clearAuth, locale, router]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-8">
          <div className="max-w-4xl mx-auto">
            <h1 data-testid="workspace-select__heading" className="text-2xl font-semibold text-foreground mb-2">
              {t('select_your_workspace')}
            </h1>
            <p className="text-tertiary mb-8">
              {t('choose_workspace')}
            </p>

            {isLoading ? (
              <p className="text-sm text-tertiary" data-testid="workspace-select__loading">{t('loading_workspaces')}</p>
            ) : isUnauthorized ? (
              <div
                className="max-w-xl rounded-md border border-error/40 bg-surface p-4 space-y-3"
                data-testid="workspace-select__session-expired"
              >
                <p className="text-sm font-medium text-foreground">{t('workspace_session_expired_title')}</p>
                <p className="text-sm text-tertiary">{t('workspace_session_expired_description')}</p>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="action" onClick={handleReLogin} data-testid="workspace-select__relogin-btn">
                    {t('workspace_session_expired_relogin')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => refetch()} data-testid="workspace-select__retry-btn">
                    {t('workspace_retry')}
                  </Button>
                </div>
              </div>
            ) : isError ? (
              <div className="max-w-xl rounded-md border border-subtle bg-surface p-4 space-y-3" data-testid="workspace-select__error">
                <p className="text-sm font-medium text-foreground">{t('workspace_load_failed_title')}</p>
                <p className="text-sm text-tertiary">{t('workspace_load_failed_description')}</p>
                <Button type="button" variant="outline" onClick={() => refetch()} data-testid="workspace-select__retry-btn">
                  {t('workspace_retry')}
                </Button>
              </div>
            ) : (workspaces ?? []).length === 0 ? (
              <div className="max-w-xl rounded-md border border-subtle bg-surface p-4 space-y-2" data-testid="workspace-select__empty">
                <p className="text-sm font-medium text-foreground">{t('workspace_empty_title')}</p>
                <p className="text-sm text-tertiary">{t('workspace_empty_description')}</p>
                <Button type="button" variant="outline" onClick={handleReLogin} data-testid="workspace-select__back-login-btn">
                  {t('keycloak_back_to_login')}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {workspaces?.map(workspace => (
                  <WorkspaceCard
                    key={workspace.id}
                    workspace={workspace}
                    onSelect={() => handleWorkspaceSelect(workspace.id)}
                  />
                ))}
              </div>
            )}
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
      data-testid={`workspace-select__card--${workspace.id}`}
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
