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
import {
  PublicAuthEyebrow,
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthSection,
  PublicAuthShell,
} from '@/components/public/PublicAuthPage';

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
        <PublicAuthFrame width="narrow">
          <PublicAuthShell>
            <div className="space-y-6">
              <PublicAuthHeader
                badge={(
                  <PublicAuthEyebrow>
                    <Building2 className="h-3.5 w-3.5" />
                    {t('workspace_select_badge')}
                  </PublicAuthEyebrow>
                )}
                title={<span data-testid="workspace-select__heading">{t('select_your_workspace')}</span>}
                description={t('workspace_select_minimal_description')}
              />

              <PublicAuthSection>
                {isLoading ? (
                  <p className="text-sm text-tertiary" data-testid="workspace-select__loading">
                    {t('loading_workspaces')}
                  </p>
                ) : isUnauthorized ? (
                  <div className="space-y-4" data-testid="workspace-select__session-expired">
                    <div className="rounded-md border border-error/20 bg-error/8 px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{t('workspace_session_expired_title')}</p>
                      <p className="mt-1 text-sm text-tertiary">{t('workspace_session_expired_description')}</p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button type="button" variant="primary" onClick={handleReLogin} data-testid="workspace-select__relogin-btn">
                        {t('workspace_session_expired_relogin')}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => refetch()} data-testid="workspace-select__retry-btn">
                        {t('workspace_retry')}
                      </Button>
                    </div>
                  </div>
                ) : isError ? (
                  <div className="space-y-4" data-testid="workspace-select__error">
                    <div className="rounded-md border border-border/50 bg-background/72 px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{t('workspace_load_failed_title')}</p>
                      <p className="mt-1 text-sm text-tertiary">{t('workspace_load_failed_description')}</p>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => refetch()} data-testid="workspace-select__retry-btn">
                      {t('workspace_retry')}
                    </Button>
                  </div>
                ) : (workspaces ?? []).length === 0 ? (
                  <div className="space-y-4" data-testid="workspace-select__empty">
                    <div className="rounded-md border border-border/50 bg-background/72 px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{t('workspace_empty_title')}</p>
                      <p className="mt-1 text-sm text-tertiary">{t('workspace_empty_description')}</p>
                    </div>
                    <Button type="button" variant="secondary" onClick={handleReLogin} data-testid="workspace-select__back-login-btn">
                      {t('keycloak_back_to_login')}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {workspaces?.map((workspace) => (
                      <WorkspaceCard
                        key={workspace.id}
                        workspace={workspace}
                        onSelect={() => handleWorkspaceSelect(workspace.id)}
                      />
                    ))}
                  </div>
                )}
              </PublicAuthSection>

              <div className="flex justify-center pt-1">
                <Link
                  href={`/${locale}/system/login`}
                  className="text-xs text-tertiary transition-colors hover:text-secondary"
                  data-testid="workspace-select__system-link"
                >
                  {t('system_login_link')}
                </Link>
              </div>
            </div>
          </PublicAuthShell>
        </PublicAuthFrame>
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
      className="group w-full rounded-md border border-border/45 bg-background/72 p-4 text-left transition-[border-color,background-color,transform] duration-150 hover:border-border/70 hover:bg-surface-low/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border/45 bg-surface-low/70">
          <Building2 className="h-5 w-5 text-icon-default" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium text-foreground">{workspace.name}</h2>
          <p className="truncate text-sm text-tertiary">{workspace.id}</p>
        </div>
        <span className="inline-flex items-center gap-1 text-sm text-secondary transition-colors group-hover:text-foreground">
          {t('workspace_card_action')}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
