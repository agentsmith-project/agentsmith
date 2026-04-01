'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { buildPublicApiUrl } from '@/lib/public-runtime-config';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';

export default function DesktopAuthRequestPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('auth');
  const hydrated = useAuthStoreHydration();
  const token = useAuthStore((state) => state.token);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const locale = (params?.locale as string) || 'en-US';
  const requestId = searchParams.get('desktop_auth_request_id')?.trim() ?? '';
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'redirecting' | 'completing' | 'done' | 'error'>('loading');

  const completeUrl = useMemo(
    () => requestId
      ? buildPublicApiUrl(`/me/desktop/auth/requests/${encodeURIComponent(requestId)}/complete`)
      : null,
    [requestId],
  );

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
      router.replace(`/${locale}/login/workspace?desktop_auth_request_id=${encodeURIComponent(requestId)}`);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setStatus('completing');
      const response = await fetch(completeUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`desktop_auth_complete_failed_${response.status}`);
      }
      if (cancelled) {
        return;
      }
      setStatus('done');
      router.replace(`/${locale}/desktop/auth/complete?desktop_auth_request_id=${encodeURIComponent(requestId)}`);
    };

    void run().catch((cause: unknown) => {
      if (cancelled) {
        return;
      }
      setError(cause instanceof Error ? cause.message : 'desktop_auth_complete_failed');
      setStatus('error');
    });

    return () => {
      cancelled = true;
    };
  }, [completeUrl, hydrated, isAuthenticated, locale, requestId, router, token]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-md p-8 text-center space-y-3">
            <h1 className="text-xl font-semibold text-foreground">{t('desktop_auth_request_title')}</h1>
            {status === 'error' ? (
              <p className="text-sm text-error" data-testid="desktop-auth-request__error">{error}</p>
            ) : (
              <p className="text-sm text-tertiary">{t('desktop_auth_request_description')}</p>
            )}
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
