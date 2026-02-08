'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useAuthStore } from '@/lib/stores/authStore';

interface KeycloakTokenResponse {
  access_token: string;
}

interface KeycloakUserInfo {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

interface StoredPkceContext {
  verifier: string;
  state: string;
  redirectUri: string;
  createdAt: number;
}

const keycloakRealmsBase = process.env.NEXT_PUBLIC_KEYCLOAK_URL?.trim() ?? '';
const keycloakRealm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM?.trim() ?? '';
const keycloakClientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID?.trim() ?? '';

function keycloakRealmBase(): string | null {
  if (!keycloakRealmsBase || !keycloakRealm) {
    return null;
  }

  if (keycloakRealmsBase.endsWith('/realms')) {
    return `${keycloakRealmsBase}/${keycloakRealm}`;
  }

  if (keycloakRealmsBase.includes('/realms/')) {
    return keycloakRealmsBase.replace(/\/$/, '');
  }

  return `${keycloakRealmsBase.replace(/\/$/, '')}/realms/${keycloakRealm}`;
}

function readPkceContext(): StoredPkceContext | null {
  const raw = sessionStorage.getItem('mbos:keycloak:pkce');
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredPkceContext;
    if (!parsed.verifier || !parsed.state || !parsed.redirectUri) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export default function LoginCallbackPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations('auth');
  const { setAuth } = useAuthStore();
  const locale = (params?.locale as string) || 'en-US';
  const [error, setError] = useState<string | null>(null);

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const providerError = searchParams.get('error');
  const realmBase = useMemo(() => keycloakRealmBase(), []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (providerError) {
        setError(providerError);
        return;
      }

      if (!realmBase || !keycloakClientId) {
        setError('Keycloak not configured');
        return;
      }

      if (!code || !state) {
        setError('Missing OAuth callback parameters');
        return;
      }

      const pkce = readPkceContext();
      if (!pkce) {
        setError('Missing PKCE state');
        return;
      }

      if (pkce.state !== state) {
        setError('State mismatch');
        return;
      }

      const tokenRes = await fetch(`${realmBase}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: keycloakClientId,
          redirect_uri: pkce.redirectUri,
          code_verifier: pkce.verifier,
        }).toString(),
      });
      if (!tokenRes.ok) {
        setError(`token_exchange_failed_${tokenRes.status}`);
        return;
      }

      const token = (await tokenRes.json()) as KeycloakTokenResponse;
      const userinfoRes = await fetch(`${realmBase}/protocol/openid-connect/userinfo`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!userinfoRes.ok) {
        setError(`userinfo_failed_${userinfoRes.status}`);
        return;
      }

      const userinfo = (await userinfoRes.json()) as KeycloakUserInfo;
      if (!userinfo.sub) {
        setError('userinfo_missing_sub');
        return;
      }

      setAuth(
        {
          id: userinfo.sub,
          email: userinfo.email ?? `${userinfo.sub}@unknown.local`,
          name: userinfo.name ?? userinfo.preferred_username ?? userinfo.email ?? userinfo.sub,
          locale: locale as 'en-US' | 'zh-CN',
        },
        token.access_token,
      );

      sessionStorage.removeItem('mbos:keycloak:pkce');
      if (!cancelled) {
        router.replace(`/${locale}/login/workspace`);
      }
    };

    void run().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : 'login_callback_failed');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, state, providerError, realmBase, locale, router, setAuth]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-md p-8 text-center space-y-3">
            <h1 className="text-xl font-semibold text-foreground">
              {t('keycloak_callback_title')}
            </h1>
            {error ? (
              <>
                <p className="text-sm text-error" data-testid="login-callback__error">{error}</p>
                <button
                  type="button"
                  className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200"
                  onClick={() => router.replace(`/${locale}/login`)}
                >
                  {t('keycloak_back_to_login')}
                </button>
              </>
            ) : (
              <p className="text-sm text-tertiary">{t('keycloak_callback_description')}</p>
            )}
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
