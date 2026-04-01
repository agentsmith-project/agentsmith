'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Building2 } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { useAuthStore } from '@/lib/stores/authStore';
import { APIError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';

export function WorkspaceSelectView() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
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
  const desktopAuthRequestId = searchParams.get('desktop_auth_request_id')?.trim() ?? '';

  const handleWorkspaceSelect = (workspaceId: string) => {
    const suffix = desktopAuthRequestId
      ? `?desktop_auth_request_id=${encodeURIComponent(desktopAuthRequestId)}`
      : '';
    router.push(`/${locale}/workspaces/${workspaceId}/login${suffix}`);
  };

  const handleReLogin = useCallback(() => {
    clearAuth();
    router.replace(`/${locale}/login/workspace`);
  }, [clearAuth, locale, router]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4">
          <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center">
            <section className="w-full rounded-[28px] border border-border bg-surface px-6 py-7 shadow-[0_24px_60px_rgba(0,0,0,0.2)]">
              <div className="mb-6 space-y-2">
                <h1 data-testid="workspace-select__heading" className="text-2xl font-semibold text-foreground">
                  {t('select_your_workspace')}
                </h1>
                <p className="text-sm leading-6 text-secondary">{t('workspace_select_minimal_description')}</p>
              </div>

              <div className="rounded-[22px] border border-border bg-surface-high p-5">
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
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

              <div className="mt-5 flex justify-center">
                <Link
                  href={`/${locale}/system/login`}
                  className="text-xs text-tertiary transition-colors hover:text-secondary"
                  data-testid="workspace-select__system-link"
                >
                  {t('system_login_link')}
                </Link>
              </div>
            </section>
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
    <button
      type="button"
      data-testid={`workspace-select__card--${workspace.id}`}
      onClick={onSelect}
      className="group relative cursor-pointer rounded-[22px] border border-border bg-surface-high p-5 text-left transition-colors duration-200 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="mb-4 flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-background">
          <Building2 className="h-5 w-5 text-icon-default" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-foreground">{workspace.name}</h2>
          <p className="truncate text-sm text-tertiary">{workspace.id}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-secondary">{t('workspace_card_description')}</p>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-accent">
          {t('workspace_card_action')}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
