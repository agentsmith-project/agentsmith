'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, LoaderCircle, LogIn, MonitorSmartphone } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/app-shell/Logo';
import {
  PublicAuthAsideBlock,
  PublicAuthEyebrow,
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthMutedCard,
  PublicAuthShell,
} from '@/components/public/PublicAuthPage';
import { buildPublicApiUrl } from '@/lib/public-runtime-config';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';

type DesktopAuthRequestStatus = 'loading' | 'redirecting' | 'completing' | 'done' | 'error';

export default function DesktopAuthRequestPage() {
  const params = useParams();
  const router = useRouter();
  const routerReplace = router.replace;
  const searchParams = useSearchParams();
  const t = useTranslations('auth');
  const hydrated = useAuthStoreHydration();
  const token = useAuthStore((state) => state.token);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const locale = (params?.locale as string) || 'en-US';
  const requestId = searchParams.get('desktop_auth_request_id')?.trim() ?? '';
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DesktopAuthRequestStatus>('loading');

  const completeUrl = useMemo(
    () => (requestId
      ? buildPublicApiUrl(`/me/desktop/auth/requests/${encodeURIComponent(requestId)}/complete`)
      : null),
    [requestId],
  );

  const startCompletion = useCallback(async (cancelled?: { current: boolean }) => {
    if (!completeUrl || !token) {
      throw new Error('desktop_auth_complete_failed');
    }

    setError(null);
    setStatus('completing');

    try {
      const response = await fetch(completeUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`desktop_auth_complete_failed_${response.status}`);
      }
      if (cancelled?.current) {
        return;
      }
      setStatus('done');
      routerReplace(`/${locale}/desktop/auth/complete?desktop_auth_request_id=${encodeURIComponent(requestId)}`);
    } catch (cause: unknown) {
      if (cancelled?.current) {
        return;
      }
      setError(cause instanceof Error ? cause.message : 'desktop_auth_complete_failed');
      setStatus('error');
    }
  }, [completeUrl, locale, requestId, routerReplace, token]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!requestId) {
      setError('desktop_auth_request_missing');
      setStatus('error');
      return;
    }
    if (!isAuthenticated || !token || !completeUrl) {
      setStatus('redirecting');
      routerReplace(`/${locale}/login/workspace?desktop_auth_request_id=${encodeURIComponent(requestId)}`);
      return;
    }

    const cancelled = { current: false };
    void startCompletion(cancelled);

    return () => {
      cancelled.current = true;
    };
  }, [completeUrl, hydrated, isAuthenticated, locale, requestId, routerReplace, startCompletion, token]);

  const statusContent = getStatusContent({ error, status, t });
  const workspaceLoginHref = requestId
    ? `/${locale}/login/workspace?desktop_auth_request_id=${encodeURIComponent(requestId)}`
    : `/${locale}/login/workspace`;
  const missingRequest = error === 'desktop_auth_request_missing';

  return (
    <PageState state="success">
      <PageLayout>
        <PublicAuthFrame>
          <PublicAuthShell
            aside={(
            <PublicAuthAsideBlock
                icon={<statusContent.icon className={statusContent.iconClassName} />}
                title={t('desktop_auth_request_checklist_label')}
                description={statusContent.detail}
              >
                {requestId ? (
                  <PublicAuthMutedCard>
                    <p className="type-caption text-tertiary">{t('desktop_auth_request_reference_label')}</p>
                    <p className="mt-2 type-mono text-sm text-foreground" data-testid="desktop-auth-request__request-id">{requestId}</p>
                  </PublicAuthMutedCard>
                ) : null}
              </PublicAuthAsideBlock>
            )}
          >
            <div className="space-y-6">
              <PublicAuthHeader
                logo={<Logo className="origin-left scale-125" />}
                badge={(
                  <PublicAuthEyebrow tone="accent">
                    <MonitorSmartphone className="h-3.5 w-3.5" />
                    {t('desktop_auth_request_badge')}
                  </PublicAuthEyebrow>
                )}
                title={<span data-testid="desktop-auth-request__title">{statusContent.title}</span>}
                description={statusContent.description}
              />
              {status === 'error' ? (
                <div className="flex flex-wrap gap-3">
                  <Button asChild variant="primary">
                    <Link href={workspaceLoginHref} data-testid="desktop-auth-request__workspace-login-link">
                      <LogIn className="h-4 w-4" />
                      {t('desktop_auth_request_back_to_workspace_login')}
                    </Link>
                  </Button>
                  {!missingRequest ? (
                    <Button type="button" variant="secondary" onClick={() => void startCompletion()}>
                      {t('desktop_auth_request_retry')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </PublicAuthShell>
        </PublicAuthFrame>
      </PageLayout>
    </PageState>
  );
}

function getStatusContent({
  error,
  status,
  t,
}: {
  error: string | null;
  status: DesktopAuthRequestStatus;
  t: ReturnType<typeof useTranslations<'auth'>>;
}) {
  if (status === 'redirecting') {
    return {
      title: t('desktop_auth_request_redirecting_title'),
      description: t('desktop_auth_request_redirecting_description'),
      detail: t('desktop_auth_request_redirecting_hint'),
      icon: LoaderCircle,
      iconClassName: 'h-5 w-5 animate-spin',
    };
  }

  if (status === 'completing' || status === 'done' || status === 'loading') {
    return {
      title: t('desktop_auth_request_title'),
      description: t('desktop_auth_request_description'),
      detail: t('desktop_auth_request_progress_hint'),
      icon: status === 'done' ? CheckCircle2 : LoaderCircle,
      iconClassName: status === 'done' ? 'h-5 w-5 text-success' : 'h-5 w-5 animate-spin',
    };
  }

  const missingRequest = error === 'desktop_auth_request_missing';
  return {
    title: missingRequest ? t('desktop_auth_request_missing_title') : t('desktop_auth_request_error_title'),
    description: missingRequest ? t('desktop_auth_request_missing_description') : t('desktop_auth_request_error_description'),
    detail: missingRequest ? t('desktop_auth_request_missing_hint') : t('desktop_auth_request_error_hint'),
    icon: AlertTriangle,
    iconClassName: 'h-5 w-5 text-warning',
  };
}
