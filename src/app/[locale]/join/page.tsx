'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/i18n/routing';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/app-shell/Logo';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import {
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthSection,
  PublicAuthShell,
} from '@/components/public/PublicAuthPage';
import { getApiClient, MemberAPI } from '@/lib/api';
import { buildPublicApiUrl } from '@/lib/public-runtime-config';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import {
  buildWorkspaceLoginPath,
  buildWorkspaceLoginLandingPath,
  buildWorkspaceSelectionPath,
  clearInviteHandoff,
  clearPendingInviteToken,
  persistInviteHandoff,
  persistPendingInviteToken,
} from '@/lib/auth/invite-handoff';
import { toast } from '@/components/ui/toast';

type InviteDetails = {
  invite_id: string;
  workspace_id: string;
  workspace_name?: string;
  project_id: string;
  project_name?: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
};

function JoinPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('join');
  const tAuth = useTranslations('auth');
  const token = searchParams.get('token')?.trim() ?? '';
  const hydrated = useAuthStoreHydration();
  const { isAuthenticated } = useAuthStore();
  const memberApi = React.useMemo(() => new MemberAPI(getApiClient()), []);
  const [invite, setInvite] = React.useState<InviteDetails | null>(null);
  const [isLoadingInvite, setIsLoadingInvite] = React.useState(Boolean(token));
  const [inviteError, setInviteError] = React.useState<string | null>(null);
  const [isAccepting, setIsAccepting] = React.useState(false);
  const autoAcceptedRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    const loadInvite = async () => {
      if (!token) {
        setIsLoadingInvite(false);
        setInvite(null);
        setInviteError(null);
        return;
      }
      setIsLoadingInvite(true);
      setInviteError(null);
      try {
        const response = await fetch(buildPublicApiUrl(`/join/invites/${encodeURIComponent(token)}`), {
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error('invite_not_found');
        }
        const payload = (await response.json()) as InviteDetails;
        if (!cancelled) {
          setInvite(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setInvite(null);
          setInviteError(error instanceof Error ? error.message : 'invite_not_found');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingInvite(false);
        }
      }
    };
    void loadInvite();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const continueToWorkspaceLogin = React.useCallback(() => {
    if (!invite || !token) return;
    persistPendingInviteToken(token);
    persistInviteHandoff({ workspaceId: invite.workspace_id, projectId: invite.project_id });
    router.push(
      buildWorkspaceLoginPath(invite.workspace_id, {
        projectId: invite.project_id,
      }),
    );
  }, [invite, router, token]);

  const acceptInviteAndContinue = React.useCallback(async () => {
    if (!invite || !token || isAccepting) return;
    setIsAccepting(true);
    try {
      const result = await memberApi.acceptInvite(token);
      clearPendingInviteToken();
      clearInviteHandoff();
      router.replace(
        buildWorkspaceLoginLandingPath(
          result.workspace_id ?? invite.workspace_id,
          result.project_id ?? invite.project_id,
        ),
      );
    } catch (error) {
      setIsAccepting(false);
      setInviteError('invite_accept_failed');
      toast.error(t('action_failed'));
      console.error('Invite acceptance failed for already authenticated member:', error);
    }
  }, [invite, isAccepting, memberApi, router, t, token]);

  React.useEffect(() => {
    if (!hydrated || !isAuthenticated || !invite || invite.status !== 'pending' || autoAcceptedRef.current) {
      return;
    }
    autoAcceptedRef.current = true;
    void acceptInviteAndContinue();
  }, [acceptInviteAndContinue, hydrated, invite, isAuthenticated]);
  if (!token) {
    return (
      <PublicAuthFrame width="narrow">
        <PublicAuthShell>
          <div className="space-y-6">
            <PublicAuthHeader
              logo={<Logo className="origin-left scale-125" />}
              title={t('invalid_title')}
              description={t('invalid_description')}
            />
            <PublicAuthSection>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="primary" className="sm:flex-1" onClick={() => router.push('/')}>
                  {t('go_home')}
                </Button>
                <Button variant="secondary" className="sm:flex-1" onClick={() => router.push(buildWorkspaceSelectionPath())}>
                  {tAuth('workspace_login_title')}
                </Button>
              </div>
            </PublicAuthSection>
          </div>
        </PublicAuthShell>
      </PublicAuthFrame>
    );
  }

  if (isLoadingInvite) {
    return (
      <PublicAuthFrame width="narrow">
        <PublicAuthShell>
          <div className="space-y-6">
            <PublicAuthHeader
              logo={<Logo className="origin-left scale-125" />}
              title={t('loading_title')}
              description={t('loading_description')}
            />
            <PublicAuthSection>
              <p className="text-sm text-tertiary" data-testid="join__loading">{t('loading_invite')}</p>
            </PublicAuthSection>
          </div>
        </PublicAuthShell>
      </PublicAuthFrame>
    );
  }

  if (!invite || inviteError || invite.status !== 'pending') {
    return (
      <PublicAuthFrame width="narrow">
        <PublicAuthShell>
          <div className="space-y-6">
            <PublicAuthHeader
              logo={<Logo className="origin-left scale-125" />}
              title={t('invalid_title')}
              description={invite?.status === 'expired' ? t('expired_description') : t('invalid_description')}
            />
            <PublicAuthSection>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="primary" className="sm:flex-1" onClick={() => router.push('/')}>
                  {t('go_home')}
                </Button>
                <Button variant="secondary" className="sm:flex-1" onClick={() => router.push(buildWorkspaceSelectionPath())}>
                  {tAuth('workspace_login_title')}
                </Button>
              </div>
            </PublicAuthSection>
          </div>
        </PublicAuthShell>
      </PublicAuthFrame>
    );
  }

  const workspaceLabel = invite.workspace_name?.trim() || invite.workspace_id;
  const projectLabel = invite.project_name?.trim() || invite.project_id;

  return (
    <PublicAuthFrame width="narrow">
      <PublicAuthShell>
        <div className="space-y-6">
          <PublicAuthHeader
            logo={<Logo className="origin-left scale-125" />}
            title={t('title')}
            description={t('description')}
          />

          <PublicAuthSection>
            <div className="space-y-4 rounded-md border border-subtle bg-surface/45 p-4" data-testid="join__invite-card">
              <div className="space-y-1.5">
                <p className="text-xs uppercase tracking-[0.2em] text-tertiary">{t('invite_badge')}</p>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground" data-testid="join__invite-workspace">{workspaceLabel}</p>
                  <p className="text-xs text-tertiary" data-testid="join__invite-project">{projectLabel}</p>
                </div>
                <p className="text-xs text-tertiary">{t('invite_hint')}</p>
              </div>

              {hydrated && isAuthenticated ? (
                <div className="rounded-sm border border-border/70 bg-background/80 px-4 py-3 text-sm text-tertiary" data-testid="join__auto-accepting">
                  {isAccepting ? t('accepting_and_opening') : t('accepting_and_opening')}
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    data-testid="join__continue-btn"
                    variant="primary"
                    className="justify-between sm:flex-1"
                    onClick={continueToWorkspaceLogin}
                  >
                    <span>{t('continue_to_workspace_sign_in')}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" className="sm:flex-1" onClick={() => router.push(buildWorkspaceSelectionPath())}>
                    {tAuth('workspace_login_title')}
                  </Button>
                </div>
              )}

              {inviteError ? (
                <p className="rounded-md border border-error/20 bg-error/8 px-4 py-3 text-sm text-error" data-testid="join__error">
                  {t('action_failed')}
                </p>
              ) : null}
            </div>
          </PublicAuthSection>
        </div>
      </PublicAuthShell>
    </PublicAuthFrame>
  );
}

export default function JoinPage() {
  return (
    <React.Suspense
      fallback={(
        <PageState state="loading">
          <PageLoading />
        </PageState>
      )}
    >
      <PageState state="success">
        <PageLayout>
          <JoinPageContent />
        </PageLayout>
      </PageState>
    </React.Suspense>
  );
}
