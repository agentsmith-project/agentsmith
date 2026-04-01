'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/i18n/routing';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Logo } from '@/components/app-shell/Logo';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import { createPkceChallenge, randomBase64Url } from '@/lib/auth/pkce';
import { resolveKeycloakRealmBase } from '@/lib/auth/keycloak';
import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';
import { ArrowRight } from 'lucide-react';

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
  const locale = (params?.locale as string) || 'en-US';
  const workspaceId = (params?.workspace as string) || '';
  const desktopAuthRequestId = searchParams.get('desktop_auth_request_id')?.trim() ?? '';
  const [config, setConfig] = useState<WorkspaceLoginConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [keycloakError, setKeycloakError] = useState<string | null>(null);
  const useMsw = getPublicRuntimeConfig().useMsw;

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    router.replace(`/workspaces/${workspaceId}`);
  }, [hydrated, isAuthenticated, locale, router, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      setIsLoadingConfig(true);
      setConfigError(null);
      try {
        const response = await fetch(`/api/public/workspaces/${workspaceId}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('workspace_not_found');
        }
        const payload = (await response.json()) as WorkspaceLoginConfig;
        if (!cancelled) {
          setConfig(payload);
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
    try {
      setAuth(
        {
          id: 'user_001',
          email: userEmail,
          name: userEmail.split('@')[0],
          locale: locale as 'en-US' | 'zh-CN',
        },
        `mock_token_${workspaceId}_${Date.now()}`,
      );
      router.push(`/workspaces/${workspaceId}`);
    } catch (error) {
      console.error('Workspace login failed:', error);
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

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4">
          <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center">
            <section className="w-full rounded-[28px] border border-border bg-surface px-6 py-7 shadow-[0_24px_60px_rgba(0,0,0,0.2)]">
              <div className="mb-6 flex justify-center">
                <Logo className="scale-150" />
              </div>
              <div className="mb-6 space-y-2 text-center">
                <h1 className="text-2xl font-semibold text-foreground" data-testid="workspace-login__heading">
                  {config?.name || t('workspace_login_title')}
                </h1>
                <p className="text-sm leading-6 text-secondary">{t('workspace_login_minimal_description')}</p>
              </div>

              <div className="rounded-[22px] border border-border bg-surface-high p-6">
                    {isLoadingConfig ? (
                      <p className="text-sm text-tertiary" data-testid="workspace-login__loading">{t('loading_workspaces')}</p>
                    ) : configError || !config ? (
                      <div className="space-y-4" data-testid="workspace-login__error">
                        <p className="text-sm text-error">{t('workspace_not_found')}</p>
                        <Link href={`/${locale}/login/workspace`} className="text-sm text-accent underline">
                          {t('back_to_workspace_select')}
                        </Link>
                      </div>
                    ) : (
                      <>
                        <Button
                          data-testid="workspace-login__keycloak-btn"
                          onClick={handleKeycloakLogin}
                          disabled={isLoggingIn}
                          variant="primary"
                          className="mb-4 w-full"
                        >
                          <ArrowRight className="h-4 w-4" />
                          {isLoggingIn ? t('keycloak_redirecting') : t('login_with_keycloak')}
                        </Button>
                        <p className="text-xs text-tertiary text-center mb-2">{t('keycloak_sign_in_hint')}</p>
                        {keycloakError ? (
                          <p className="text-xs text-error text-center mb-4" data-testid="workspace-login__keycloak-error">
                            {keycloakError}
                          </p>
                        ) : null}

                        {useMsw ? (
                          <>
                            <div className="relative my-6">
                              <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-subtle"></div>
                              </div>
                              <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-background text-tertiary">{t('or')}</span>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="rounded-xl border border-subtle bg-background p-4">
                                <p className="text-sm text-tertiary mb-4 text-center">{t('dev_mode')}</p>
                                <div className="mb-4">
                                  <label className="block text-sm font-medium text-secondary mb-2">
                                    {t('user_id_email')}
                                  </label>
                                  <input
                                    type="text"
                                    data-testid="workspace-login__email-input"
                                    value={userEmail}
                                    onChange={(event) => setUserEmail(event.target.value)}
                                    placeholder={t('user_id_placeholder')}
                                    className="w-full px-3 py-2 bg-background border border-subtle rounded-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                                  />
                                </div>
                                <Button
                                  data-testid="workspace-login__submit"
                                  onClick={handleQuickLogin}
                                  disabled={isLoggingIn || !userEmail.trim()}
                                  variant="action"
                                  className="w-full"
                                >
                                  {isLoggingIn ? t('signing_in') : t('quick_login')}
                                </Button>
                              </div>
                            </div>
                          </>
                        ) : null}

                        <div className="mt-6 text-center">
                          <Link
                            href={`/${locale}/login`}
                            className="text-xs text-tertiary transition-colors hover:text-secondary"
                            data-testid="workspace-login__back-to-selection"
                          >
                            {t('back_to_workspace_select')}
                          </Link>
                        </div>
                      </>
                    )}
              </div>
            </section>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
