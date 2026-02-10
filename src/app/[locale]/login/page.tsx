'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import { Logo } from '@/components/app-shell/Logo';
import { getKeycloakClientId, getKeycloakRealmBase } from '@/lib/auth/keycloak';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Globe, ChevronDown } from 'lucide-react';

const useMsw = process.env.NEXT_PUBLIC_USE_MSW === 'true';
const keycloakClientId = getKeycloakClientId();

const mockWorkspaces = [
  { value: 'ws_default', label: 'Default Workspace' },
  { value: 'ws_test', label: 'Test Workspace' },
];

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomBase64Url(bytes = 32): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return encodeBase64Url(data);
}

async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return encodeBase64Url(new Uint8Array(digest));
}

export default function LoginPage() {
  const router = useRouter();
  const params = useParams();
  const t = useTranslations('auth');
  const hydrated = useAuthStoreHydration();
  const { setAuth, isAuthenticated } = useAuthStore();

  const [workspaceId, setWorkspaceId] = useState('ws_default');
  const [userEmail, setUserEmail] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [keycloakError, setKeycloakError] = useState<string | null>(null);

  // Get locale from params
  const locale = (params?.locale as string) || 'en-US';

  // Redirect authenticated users to workspace selection
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    router.replace(`/${locale}/login/workspace`);
  }, [hydrated, isAuthenticated, locale, router]);

  const handleQuickLogin = async () => {
    if (!userEmail.trim()) {
      return;
    }

    setIsLoggingIn(true);
    try {
      // Mock login: set auth state directly
      setAuth(
        {
          id: 'user_001',
          email: userEmail,
          name: userEmail.split('@')[0],
          locale: locale as 'en-US' | 'zh-CN',
        },
        'mock_token_' + Date.now()
      );
      // Redirect to workspace selection page
      const redirectPath = `/${locale}/login/workspace`;
      router.push(redirectPath);
    } catch (error) {
      console.error('Login failed:', error);
      setIsLoggingIn(false);
    }
  };

  const handleKeycloakLogin = async () => {
    if (!keycloakClientId) {
      setKeycloakError('Keycloak client ID is not configured');
      return;
    }

    const realmBase = getKeycloakRealmBase();
    if (!realmBase) {
      setKeycloakError('Keycloak realm is not configured');
      return;
    }

    setIsLoggingIn(true);
    setKeycloakError(null);

    try {
      const verifier = randomBase64Url(48);
      const state = randomBase64Url(24);
      const challenge = await createPkceChallenge(verifier);
      const redirectUri = `${window.location.origin}/${locale}/login/callback`;
      sessionStorage.setItem(
        'mbos:keycloak:pkce',
        JSON.stringify({ verifier, state, redirectUri, createdAt: Date.now() }),
      );

      const authUrl = new URL(`${realmBase}/protocol/openid-connect/auth`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', keycloakClientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'openid profile email');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      window.location.assign(authUrl.toString());
    } catch (error) {
      setIsLoggingIn(false);
      setKeycloakError(error instanceof Error ? error.message : 'Failed to start Keycloak login');
    }
  };

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          {/* Main Content */}
          <main className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-md space-y-8">
          {/* Logo & Title */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Logo className="scale-150" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">
              {t('welcome_title')}
            </h1>
            <p className="text-tertiary">
              {t('welcome_subtitle')}
            </p>
          </div>

          {/* Login Card */}
          <div className="bg-surface border border-border rounded-md p-8">
            <h2 className="text-lg font-semibold text-foreground mb-6">
              {t('sign_in')}
            </h2>

            <button
              data-testid="login__keycloak-btn"
              className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200 mb-4"
              onClick={handleKeycloakLogin}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? t('keycloak_redirecting') : t('login_with_keycloak')}
            </button>
            <p className="text-xs text-tertiary text-center mb-2">{t('keycloak_sign_in_hint')}</p>
            {keycloakError ? (
              <p className="text-xs text-error text-center mb-4" data-testid="login__keycloak-error">
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
                    <p className="text-sm text-tertiary mb-4 text-center">
                      {t('dev_mode')}
                    </p>

                    <div className="mb-4">
                      <label className="block text-sm font-medium text-secondary mb-2">
                        {t('workspace')}
                      </label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            data-testid="login__workspace-select"
                            className="w-full h-10 px-3 bg-surface-high border border-subtle rounded-sm text-primary flex items-center gap-2 justify-between hover:bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <Globe className="w-4 h-4 text-icon-default flex-shrink-0" />
                              <span className="truncate text-sm">
                                {mockWorkspaces.find((ws) => ws.value === workspaceId)?.label || t('select_workspace_placeholder')}
                              </span>
                            </span>
                            <ChevronDown className="w-4 h-4 text-tertiary flex-shrink-0" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                          {mockWorkspaces.map((ws) => (
                            <DropdownMenuItem
                              key={ws.value}
                              onSelect={() => setWorkspaceId(ws.value)}
                            >
                              {ws.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="mb-4">
                      <label className="block text-sm font-medium text-secondary mb-2">
                        {t('user_id_email')}
                      </label>
                      <input
                        type="text"
                        data-testid="login__email-input"
                        value={userEmail}
                        onChange={(e) => setUserEmail(e.target.value)}
                        placeholder={t('user_id_placeholder')}
                        className="w-full px-3 py-2 bg-surface-high border border-subtle rounded-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                    </div>

                    <button
                      data-testid="login__submit"
                      onClick={handleQuickLogin}
                      disabled={isLoggingIn || !userEmail.trim()}
                      className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoggingIn ? t('signing_in') : t('quick_login')}
                    </button>
                  </div>

                  <p className="text-xs text-tertiary text-center">
                    {t('dev_notice')}
                  </p>
                </div>
              </>
            ) : null}
          </div>
            </div>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
