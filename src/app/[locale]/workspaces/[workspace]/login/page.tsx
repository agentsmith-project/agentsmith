'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRouter } from '@/lib/i18n/routing';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Logo } from '@/components/app-shell/Logo';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import { createPkceChallenge, randomBase64Url } from '@/lib/auth/pkce';
import { resolveKeycloakRealmBase } from '@/lib/auth/keycloak';

type WorkspaceLoginConfig = {
  id: string;
  name: string;
  idp: {
    kind: 'keycloak';
    url: string;
    realm: string;
    client_id: string;
  };
};

const useMsw = process.env.NEXT_PUBLIC_USE_MSW === 'true';

export default function WorkspaceLoginPage() {
  const router = useRouter();
  const params = useParams();
  const t = useTranslations('auth');
  const hydrated = useAuthStoreHydration();
  const { setAuth, isAuthenticated } = useAuthStore();
  const locale = (params?.locale as string) || 'en-US';
  const workspaceId = (params?.workspace as string) || '';
  const [config, setConfig] = useState<WorkspaceLoginConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [keycloakError, setKeycloakError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    router.replace(`/workspaces/${workspaceId}/projects`);
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
      router.push(`/workspaces/${workspaceId}/projects`);
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

    const realmBase = resolveKeycloakRealmBase(config.idp.url, config.idp.realm);
    if (!realmBase || !config.idp.client_id) {
      setKeycloakError('keycloak_not_configured');
      return;
    }

    setIsLoggingIn(true);
    setKeycloakError(null);

    try {
      const verifier = randomBase64Url(48);
      const state = randomBase64Url(24);
      const pkce = await createPkceChallenge(verifier);
      const redirectUri = `${window.location.origin}/${locale}/workspaces/${workspaceId}/login/callback`;
      sessionStorage.setItem(
        'mbos:keycloak:pkce',
        JSON.stringify({ verifier, state, redirectUri, createdAt: Date.now(), workspaceId }),
      );

      const authUrl = new URL(`${realmBase}/protocol/openid-connect/auth`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', config.idp.client_id);
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
        <div className="min-h-screen bg-background flex flex-col">
          <main className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-md space-y-8">
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <Logo className="scale-150" />
                </div>
                <h1 className="text-2xl font-semibold text-foreground" data-testid="workspace-login__heading">
                  {config?.name || t('workspace_login_title')}
                </h1>
                <p className="text-tertiary">{t('workspace_login_subtitle')}</p>
              </div>

              <div className="bg-surface border border-border rounded-md p-8">
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
                    <button
                      data-testid="workspace-login__keycloak-btn"
                      className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200 mb-4"
                      onClick={handleKeycloakLogin}
                      disabled={isLoggingIn}
                    >
                      {isLoggingIn ? t('keycloak_redirecting') : t('login_with_keycloak')}
                    </button>
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
                          <div className="bg-surface-high border border-subtle rounded-md p-4">
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
                                className="w-full px-3 py-2 bg-surface-high border border-subtle rounded-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                              />
                            </div>
                            <button
                              data-testid="workspace-login__submit"
                              onClick={handleQuickLogin}
                              disabled={isLoggingIn || !userEmail.trim()}
                              className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isLoggingIn ? t('signing_in') : t('quick_login')}
                            </button>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
