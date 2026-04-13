'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient, MemberAPI } from '@/lib/api';
import { resolveKeycloakRealmBase } from '@/lib/auth/keycloak';
import { readAccessTokenClaims } from '@/lib/auth/token-claims';
import { buildWorkspaceLoginLandingHref, clearInviteHandoff, readInviteHandoffForWorkspace, readPendingInviteToken, clearPendingInviteToken } from '@/lib/auth/invite-handoff';
import {
  buildDesktopAuthCompleteHref,
  buildDesktopAuthRequestHref,
  completeDesktopAuthRequest,
} from '@/lib/auth/desktop-auth-request';

interface KeycloakTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface StoredPkceContext {
  verifier: string;
  state: string;
  redirectUri: string;
  createdAt: number;
  workspaceId?: string;
  locale?: string;
  desktopAuthRequestId?: string;
  projectId?: string;
}

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

type WorkspaceLoginMessages = {
  title: string;
  description: string;
  backToLogin: string;
};

function resolveWorkspaceLoginMessages(locale: string): WorkspaceLoginMessages {
  if (locale === 'zh-CN') {
    return {
      title: '正在完成工作区登录',
      description: '请稍候，系统正在完成当前工作区的登录。',
      backToLogin: '返回工作区登录',
    };
  }
  return {
    title: 'Completing workspace sign in',
    description: 'Please wait while we complete sign in for this workspace.',
    backToLogin: 'Back to workspace sign in',
  };
}

function readPkceContext(): StoredPkceContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = sessionStorage.getItem('mbos:keycloak:pkce');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPkceContext;
    if (!parsed.verifier || !parsed.state || !parsed.redirectUri) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function tryBindWorkspaceAdmin(workspaceId: string, accessToken: string): Promise<void> {
  await fetch(`/api/public/workspaces/${workspaceId}/admin-binding`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  }).catch(() => undefined);
}

export function WorkspaceLoginCallbackClient({
  workspaceId,
  fallbackLocale = 'en-US',
}: {
  workspaceId: string;
  fallbackLocale?: string;
}) {
  const searchParams = useSearchParams();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const handledCallbackRef = useRef(false);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const providerError = searchParams.get('error');
  const [config, setConfig] = useState<WorkspaceLoginConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const response = await fetch(`/api/public/workspaces/${workspaceId}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('workspace_not_found');
        const payload = (await response.json()) as WorkspaceLoginConfig;
        if (!cancelled) setConfig(payload);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'workspace_not_found');
      }
    };
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const realmBase = useMemo(() => {
    if (!config) return null;
    return resolveKeycloakRealmBase(config.login_idp.url, config.login_idp.realm);
  }, [config]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!config || !realmBase) return;
      if (handledCallbackRef.current) return;

      if (providerError) {
        setError(providerError);
        return;
      }
      if (!code || !state) {
        setError('missing_oauth_callback_parameters');
        return;
      }
      const pkce = readPkceContext();
      if (!pkce) {
        setError('missing_pkce_state');
        return;
      }
      if (pkce.workspaceId && pkce.workspaceId !== workspaceId) {
        setError('workspace_mismatch');
        return;
      }
      if (pkce.state !== state) {
        setError('state_mismatch');
        return;
      }

      const tokenRes = await fetch(`${realmBase}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: config.login_idp.client_id,
          redirect_uri: pkce.redirectUri,
          code_verifier: pkce.verifier,
        }).toString(),
      });
      if (!tokenRes.ok) {
        setError(`token_exchange_failed_${tokenRes.status}`);
        return;
      }

      const token = (await tokenRes.json()) as KeycloakTokenResponse;
      const claims = readAccessTokenClaims(token.access_token);
      if (!claims?.sub) {
        setError('access_token_missing_sub');
        return;
      }

      handledCallbackRef.current = true;

      const locale = pkce.locale || fallbackLocale;
      const inviteHandoff = readInviteHandoffForWorkspace(workspaceId);
      const resolvedProjectId = pkce.projectId || inviteHandoff?.projectId || null;
      const desktopAuthRequestHref = pkce.desktopAuthRequestId
        ? buildDesktopAuthRequestHref(locale, pkce.desktopAuthRequestId)
        : null;
      const pendingInviteToken = readPendingInviteToken();
      const memberApi = new MemberAPI(getApiClient());
      setAuth(
        {
          id: claims.sub,
          email: claims.email ?? `${claims.sub}@unknown.local`,
          name: claims.name ?? claims.preferred_username ?? claims.email ?? claims.sub,
          locale: locale as 'en-US' | 'zh-CN',
        },
        token.access_token,
        {
          refreshToken: token.refresh_token ?? null,
          expiresIn: token.expires_in,
          keycloakSession: {
            realmBase,
            clientId: config.login_idp.client_id,
          },
        },
      );
      getApiClient().setToken(token.access_token);
      await tryBindWorkspaceAdmin(workspaceId, token.access_token);
      if (!pkce.desktopAuthRequestId && pendingInviteToken) {
        try {
          const invite = await memberApi.acceptInvite(pendingInviteToken);
          clearPendingInviteToken();
          sessionStorage.removeItem('mbos:keycloak:pkce');
          if (!cancelled) {
            clearInviteHandoff();
            window.location.replace(
              buildWorkspaceLoginLandingHref(
                locale,
                invite.workspace_id ?? workspaceId,
                invite.project_id ?? resolvedProjectId,
              ),
            );
          }
          return;
        } catch (cause) {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : 'invite_accept_failed');
          }
          return;
        }
      }
      if (pkce.desktopAuthRequestId) {
        try {
          await completeDesktopAuthRequest(pkce.desktopAuthRequestId, token.access_token);
        } catch (cause) {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : 'desktop_auth_complete_failed');
            if (desktopAuthRequestHref) {
              window.location.replace(desktopAuthRequestHref);
            }
          }
          return;
        }
      }
      sessionStorage.removeItem('mbos:keycloak:pkce');
      if (!cancelled) {
        clearInviteHandoff();
        window.location.replace(
          pkce.desktopAuthRequestId
            ? buildDesktopAuthCompleteHref(locale, pkce.desktopAuthRequestId)
            : buildWorkspaceLoginLandingHref(locale, workspaceId, resolvedProjectId),
        );
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
  }, [code, config, fallbackLocale, providerError, realmBase, setAuth, state, workspaceId]);

  const retryLocale = readPkceContext()?.locale || fallbackLocale;
  const messages = resolveWorkspaceLoginMessages(retryLocale);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-md p-8 text-center space-y-3">
            <h1 className="text-xl font-semibold text-foreground">{messages.title}</h1>
            {error ? (
              <>
                <p className="text-sm text-error" data-testid="workspace-login-callback__error">{error}</p>
                <button
                  type="button"
                  className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200"
                  onClick={() => window.location.replace(`/${retryLocale}/workspaces/${workspaceId}/login`)}
                >
                  {messages.backToLogin}
                </button>
              </>
            ) : (
              <p className="text-sm text-tertiary">{messages.description}</p>
            )}
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
