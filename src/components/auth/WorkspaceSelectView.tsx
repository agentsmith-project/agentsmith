'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/i18n/routing';
import { useTranslations } from 'next-intl';
import { Building2, ChevronRight } from 'lucide-react';
import { Logo } from '@/components/app-shell/Logo';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { buildWorkspaceLoginHref, buildWorkspaceSelectionPath, clearLoginContinuationState, clearLogoutIntent, readInviteHandoff } from '@/lib/auth/invite-handoff';
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
  const [inviteHandoff] = useState(() => readInviteHandoff());
  const projectId = searchParams.get('project_id')?.trim() ?? '';

  useEffect(() => {
    clearLoginContinuationState();
    clearLogoutIntent();
  }, []);

  const getWorkspaceLoginHref = (workspaceId: string) => {
    const workspaceInviteHandoff = inviteHandoff?.workspaceId === workspaceId ? inviteHandoff : null;
    return buildWorkspaceLoginHref(locale, workspaceId, {
      projectId: projectId || workspaceInviteHandoff?.projectId || null,
    });
  };

  const handleWorkspaceSelect = (workspaceId: string) => {
    if (inviteHandoff && inviteHandoff.workspaceId !== workspaceId) {
      clearLoginContinuationState();
    }
  };

  const handleReLogin = () => {
    clearAuth();
    clearLoginContinuationState();
    router.replace(
      buildWorkspaceSelectionPath({
        projectId: projectId || null,
      }),
    );
  };

  return (
    <PageState state="success">
      <PageLayout>
        <PublicAuthFrame width="narrow">
          <PublicAuthShell>
            <div className="space-y-6">
              <PublicAuthHeader
                logo={<Logo className="origin-left scale-125" />}
                badge={(
                  <PublicAuthEyebrow>
                    <Building2 className="h-3.5 w-3.5" />
                    {t('workspace_select_badge')}
                  </PublicAuthEyebrow>
                )}
                title={<span data-testid="workspace-select__heading">{t('select_your_workspace')}</span>}
                description={t('workspace_select_minimal_description')}
              />

              <PublicAuthSection className="space-y-3">
                {isLoading ? (
                  <p className="text-sm text-tertiary" data-testid="workspace-select__loading">
                    {t('loading_workspaces')}
                  </p>
                ) : isUnauthorized ? (
                  <div className="space-y-4" data-testid="workspace-select__session-expired">
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium text-foreground">{t('workspace_session_expired_title')}</p>
                      <p className="text-sm text-tertiary">{t('workspace_session_expired_description')}</p>
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
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium text-foreground">{t('workspace_load_failed_title')}</p>
                      <p className="text-sm text-tertiary">{t('workspace_load_failed_description')}</p>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => refetch()} data-testid="workspace-select__retry-btn">
                      {t('workspace_retry')}
                    </Button>
                  </div>
                ) : (workspaces ?? []).length === 0 ? (
                  <div className="space-y-4" data-testid="workspace-select__empty">
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium text-foreground">{t('workspace_empty_title')}</p>
                      <p className="text-sm text-tertiary">{t('workspace_empty_description')}</p>
                    </div>
                    <Button type="button" variant="secondary" onClick={handleReLogin} data-testid="workspace-select__back-login-btn">
                      {t('keycloak_back_to_login')}
                    </Button>
                  </div>
                ) : (
                  <ul className="divide-y divide-subtle/70" data-testid="workspace-select__list">
                    {workspaces?.map((workspace) => (
                      <WorkspaceRow
                        key={workspace.id}
                        workspace={workspace}
                        href={getWorkspaceLoginHref(workspace.id)}
                        onSelect={() => handleWorkspaceSelect(workspace.id)}
                      />
                    ))}
                  </ul>
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

interface WorkspaceRowProps {
  workspace: { id: string; name: string };
  href: string;
  onSelect: () => void;
}

function WorkspaceRow({ workspace, href, onSelect }: WorkspaceRowProps) {
  return (
    <li className="list-none">
      <Link
        href={href}
        data-testid={`workspace-select__item--${workspace.id}`}
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-4 rounded-md px-0 py-3 text-left transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Building2 className="h-4 w-4 shrink-0 text-icon-default" />
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-medium text-foreground">{workspace.name}</h2>
            <p className="truncate text-xs text-tertiary">{workspace.id}</p>
          </div>
        </div>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-tertiary" aria-hidden="true" />
      </Link>
    </li>
  );
}
