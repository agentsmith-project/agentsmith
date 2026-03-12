'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, FolderKanban } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { useAuthStore } from '@/lib/stores/authStore';
import { APIError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  } = useWorkspaces({ public: true });

  const isUnauthorized = isError && error instanceof APIError && error.statusCode === 401;

  const handleWorkspaceSelect = (workspaceId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/login`);
  };

  const handleReLogin = useCallback(() => {
    clearAuth();
    router.replace(`/${locale}/login`);
  }, [clearAuth, locale, router]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-8">
          <div className="mx-auto max-w-4xl">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 data-testid="workspace-select__heading" className="mb-2 text-2xl font-semibold text-foreground">
                  {t('select_your_workspace')}
                </h1>
                <p className="text-tertiary">{t('choose_workspace')}</p>
              </div>
              <Link
                href={`/${locale}/workspaces/overview`}
                className={cn(
                  'inline-flex h-9 items-center rounded-sm border border-subtle px-3 text-sm font-medium text-foreground transition-colors',
                  'hover:bg-hover',
                )}
                data-testid="workspace-select__open-workspaces"
              >
                {t('open_all_workspaces')}
              </Link>
            </div>

            {isLoading ? (
              <p className="text-sm text-tertiary" data-testid="workspace-select__loading">
                {t('loading_workspaces')}
              </p>
            ) : isUnauthorized ? (
              <div
                className="max-w-xl space-y-3 rounded-md border border-error/40 bg-surface p-4"
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
              <div className="max-w-xl space-y-3 rounded-md border border-subtle bg-surface p-4" data-testid="workspace-select__error">
                <p className="text-sm font-medium text-foreground">{t('workspace_load_failed_title')}</p>
                <p className="text-sm text-tertiary">{t('workspace_load_failed_description')}</p>
                <Button type="button" variant="outline" onClick={() => refetch()} data-testid="workspace-select__retry-btn">
                  {t('workspace_retry')}
                </Button>
              </div>
            ) : (workspaces ?? []).length === 0 ? (
              <div className="max-w-xl space-y-2 rounded-md border border-subtle bg-surface p-4" data-testid="workspace-select__empty">
                <p className="text-sm font-medium text-foreground">{t('workspace_empty_title')}</p>
                <p className="text-sm text-tertiary">{t('workspace_empty_description')}</p>
                <Button type="button" variant="outline" onClick={handleReLogin} data-testid="workspace-select__back-login-btn">
                  {t('keycloak_back_to_login')}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {workspaces?.map((workspace) => (
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
      className="group relative cursor-pointer rounded-md border border-border bg-surface p-6 transition-colors duration-200 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="mb-4 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-sm bg-surface-high">
          <Building2 className="h-6 w-6 text-icon-default" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">{workspace.name}</h3>
          <p className="text-sm text-tertiary">{workspace.id}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-tertiary">
        <span className="flex items-center gap-1">
          <FolderKanban className="h-4 w-4" />
          {t('projects_count', { count: 0 })}
        </span>
      </div>
    </div>
  );
}
