'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Logo } from '@/components/app-shell/Logo';
import { Input } from '@/components/ui/input';
import {
  PublicAuthEyebrow,
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthMutedCard,
  PublicAuthSection,
  PublicAuthShell,
} from '@/components/public/PublicAuthPage';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import { createPkceChallenge, randomBase64Url } from '@/lib/auth/pkce';
import { resolveKeycloakRealmBase } from '@/lib/auth/keycloak';
import { getApiClient, MemberAPI } from '@/lib/api';
import {
  buildDesktopAuthCompleteHref,
  buildDesktopAuthRequestHref,
  completeDesktopAuthRequest,
} from '@/lib/auth/desktop-auth-request';
import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';
import { createMockAuthToken } from '@/mocks/utils/mock-auth-token';
import {
  buildWorkspaceLoginLandingPath,
  buildWorkspaceSelectionHref,
  clearInviteHandoff,
  clearPendingInviteToken,
  readInviteHandoffForWorkspace,
  readPendingInviteToken,
} from '@/lib/auth/invite-handoff';
import { ArrowRight, Globe2 } from 'lucide-react';

const WORKSPACE_CONFIG_RETRY_ATTEMPTS = 3;
const WORKSPACE_CONFIG_RETRY_DELAY_MS = 100;

type WorkspaceLoginConfig = {
  id: string;
  name: string;
  login_idp: {
    kind: 'keycloak';
    url: string;
    realm: string;
    client_id: string;
  };
};

export default function WorkspaceLoginPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations('auth');
  const hydrated = useAuthStoreHydration();
  const { setAuth, isAuthenticated } = useAuthStore();
  const authToken = useAuthStore((state) => state.token);
  const locale = (params?.locale as string) || 'en-US';
  const workspaceId = (params?.workspace as string) || '';
  const desktopAuthRequestId = searchParams.get('desktop_auth_request_id')?.trim() ?? '';
  const inviteHandoff = readInviteHandoffForWorkspace(workspaceId);
  const projectId = searchParams.get('project_id')?.trim() ?? inviteHandoff?.projectId ?? '';
  const desktopAuthRequestHref = desktopAuthRequestId ? buildDesktopAuthRequestHref(locale, desktopAuthRequestId) : null;
  const [config, setConfig] = useState<WorkspaceLoginConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [keycloakError, setKeycloakError] = useState<string | null>(null);
  const handledAuthenticatedContinuationRef = useRef(false);
  const useMsw = getPublicRuntimeConfig().useMsw;
  const memberApi = useMemo(() => new MemberAPI(getApiClient()), []);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !authToken) {
      handledAuthenticatedContinuationRef.current = false;
      return;
    }
    if (handledAuthenticatedContinuationRef.current) return;
    handledAuthenticatedContinuationRef.current = true;

    const continueAuthenticatedWorkspaceLogin = async () => {
      if (desktopAuthRequestId) {
        try {
          await completeDesktopAuthRequest(desktopAuthRequestId, authToken);
          clearInviteHandoff();
          router.replace(buildDesktopAuthCompleteHref(locale, desktopAuthRequestId));
        } catch (error) {
          console.error('Desktop auth completion failed after quick login:', error);
          setIsLoggingIn(false);
          if (desktopAuthRequestHref) {
            clearInviteHandoff();
            router.replace(desktopAuthRequestHref);
          }
        }
        return;
      }

      const pendingInviteToken = readPendingInviteToken();
      if (pendingInviteToken) {
        try {
          const invite = await memberApi.acceptInvite(pendingInviteToken);
          clearPendingInviteToken();
          clearInviteHandoff();
          router.replace(buildWorkspaceLoginLandingPath(
            invite.workspace_id ?? workspaceId,
            (invite.project_id ?? projectId) || null,
          ));
        } catch (error) {
          console.error('Invite acceptance failed after quick login:', error);
          setKeycloakError(error instanceof Error ? error.message : 'invite_accept_failed');
          setIsLoggingIn(false);
        }
        return;
      }

      clearInviteHandoff();
      router.push(buildWorkspaceLoginLandingPath(workspaceId, projectId || null));
    };

    void continueAuthenticatedWorkspaceLogin();
  }, [authToken, desktopAuthRequestHref, desktopAuthRequestId, hydrated, isAuthenticated, locale, memberApi, projectId, router, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      setIsLoadingConfig(true);
      setConfigError(null);
      try {
        for (let attempt = 0; attempt < WORKSPACE_CONFIG_RETRY_ATTEMPTS; attempt += 1) {
          const response = await fetch(`/api/public/workspaces/${workspaceId}`, { cache: 'no-store' });
          if (response.ok) {
            const payload = (await response.json()) as WorkspaceLoginConfig;
            if (!cancelled) {
              setConfig(payload);
            }
            return;
          }
          if (response.status !== 404 || attempt === WORKSPACE_CONFIG_RETRY_ATTEMPTS - 1) {
            throw new Error('workspace_not_found');
          }
          await new Promise((resolve) => setTimeout(resolve, WORKSPACE_CONFIG_RETRY_DELAY_MS));
        }
      } catch (error) {
        if (!cancelled) {
          setConfig(null);
          setConfigError(error instanceof Error ? error.message : 'workspace_not_found');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingConfig(false);
        }
      }
    };
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleQuickLogin = async () => {
    if (!userEmail.trim()) return;
    setIsLoggingIn(true);
    setKeycloakError(null);
    try {
      const trimmedEmail = userEmail.trim();
      const accessToken = createMockAuthToken({
        userId: 'user_001',
        userEmail: trimmedEmail,
      });
      setAuth(
        {
          id: 'user_001',
          email: trimmedEmail,
          name: trimmedEmail.split('@')[0],
          locale: locale as 'en-US' | 'zh-CN',
        },
        accessToken,
      );
    } catch (error) {
      console.error('Workspace login failed:', error);
      setKeycloakError(error instanceof Error ? error.message : 'desktop_auth_complete_failed');
      setIsLoggingIn(false);
    }
  };

  const handleKeycloakLogin = async () => {
    if (!config) {
      setKeycloakError('workspace_not_found');
      return;
    }

    const realmBase = resolveKeycloakRealmBase(config.login_idp.url, config.login_idp.realm);
    if (!realmBase || !config.login_idp.client_id) {
      setKeycloakError('keycloak_not_configured');
      return;
    }

    setIsLoggingIn(true);
    setKeycloakError(null);

    try {
      const verifier = randomBase64Url(48);
      const state = randomBase64Url(24);
      const pkce = await createPkceChallenge(verifier);
      const redirectUri = `${window.location.origin}/workspaces/${workspaceId}/login/callback`;
      sessionStorage.setItem(
        'mbos:keycloak:pkce',
        JSON.stringify({
          verifier,
          state,
          redirectUri,
          createdAt: Date.now(),
          workspaceId,
          locale,
          desktopAuthRequestId: desktopAuthRequestId || undefined,
          projectId: projectId || undefined,
        }),
      );

      const authUrl = new URL(`${realmBase}/protocol/openid-connect/auth`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', config.login_idp.client_id);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'openid profile email');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', pkce.challenge);
      authUrl.searchParams.set('code_challenge_method', pkce.method);
      window.location.assign(authUrl.toString());
    } catch (error) {
      setIsLoggingIn(false);
      setKeycloakError(error instanceof Error ? error.message : 'keycloak_login_failed');
    }
  };

  const heading = config?.name || t('workspace_login_title');

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
                    <Globe2 className="h-3.5 w-3.5" />
                    {t('workspace_login_badge')}
                  </PublicAuthEyebrow>
                )}
                title={<span data-testid="workspace-login__heading">{heading}</span>}
                description={t('workspace_login_minimal_description')}
              />

              <PublicAuthSection>
                {isLoadingConfig ? (
                  <p className="text-sm text-tertiary" data-testid="workspace-login__loading">{t('loading_workspaces')}</p>
                ) : configError || !config ? (
                  <div className="space-y-4" data-testid="workspace-login__error">
                    <div className="rounded-md border border-error/20 bg-error/8 px-4 py-3 text-sm text-error">
                      {t('workspace_not_found')}
                    </div>
                    <Link href={buildWorkspaceSelectionHref(locale, {
                      desktopAuthRequestId: desktopAuthRequestId || null,
                      projectId: projectId || null,
                    })} className="text-sm text-accent underline underline-offset-4">
                      {t('back_to_workspace_select')}
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div
                      className="space-y-4 rounded-[18px] border border-foreground/12 bg-background p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)] md:p-6"
                      data-testid="workspace-login__primary-action-panel"
                    >
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.18em] text-tertiary">
                          {t('workspace_login_badge')}
                        </p>
                      </div>
                      <Button
                        data-testid="workspace-login__keycloak-btn"
                        onClick={handleKeycloakLogin}
                        disabled={isLoggingIn}
                        variant="primary"
                        size="lg"
                        className="h-12 w-full justify-between rounded-[14px] border border-foreground/10 bg-foreground px-4 text-[15px] font-semibold tracking-[0.01em] text-background shadow-[0_20px_48px_rgba(15,23,42,0.24)] ring-1 ring-foreground/5 hover:bg-foreground hover:shadow-[0_24px_56px_rgba(15,23,42,0.28)]"
                      >
                        <span>{isLoggingIn ? t('keycloak_redirecting') : t('workspace_login_primary_action')}</span>
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                      <div className="space-y-1">
                        <p className="type-title text-foreground">{t('workspace_login_support_value')}</p>
                        <p className="text-sm text-secondary">{t('keycloak_sign_in_hint')}</p>
                        <p className="text-xs text-tertiary">{t('workspace_login_support_hint')}</p>
                      </div>
                      {keycloakError ? (
                        <p className="rounded-md border border-error/20 bg-error/8 px-4 py-3 text-xs text-error" data-testid="workspace-login__keycloak-error">
                          {keycloakError}
                        </p>
                      ) : null}
                    </div>

                    {useMsw ? (
                      <div className="space-y-4 border-t border-border/45 pt-4">
                        <p className="text-center text-sm text-tertiary">{t('dev_mode')}</p>
                        <PublicAuthMutedCard>
                          <div className="space-y-4">
                            <label className="block space-y-2">
                              <span className="text-sm font-medium text-foreground">{t('user_id_email')}</span>
                              <Input
                                type="text"
                                data-testid="workspace-login__email-input"
                                value={userEmail}
                                onChange={(event) => setUserEmail(event.target.value)}
                                placeholder={t('user_id_placeholder')}
                                className="bg-background"
                              />
                            </label>
                            <Button
                              data-testid="workspace-login__submit"
                              onClick={handleQuickLogin}
                              disabled={isLoggingIn || !userEmail.trim()}
                              variant="secondary"
                              className="w-full"
                            >
                              {isLoggingIn ? t('signing_in') : t('quick_login')}
                            </Button>
                          </div>
                        </PublicAuthMutedCard>
                      </div>
                    ) : null}

                    <div className="pt-1 text-center">
                      <Link
                        href={buildWorkspaceSelectionHref(locale, {
                          desktopAuthRequestId: desktopAuthRequestId || null,
                          projectId: projectId || null,
                        })}
                        className="text-xs text-tertiary transition-colors hover:text-secondary"
                        data-testid="workspace-login__back-to-selection"
                      >
                        {t('back_to_workspace_select')}
                      </Link>
                    </div>
                  </div>
                )}
              </PublicAuthSection>
            </div>
          </PublicAuthShell>
        </PublicAuthFrame>
      </PageLayout>
    </PageState>
  );
}
