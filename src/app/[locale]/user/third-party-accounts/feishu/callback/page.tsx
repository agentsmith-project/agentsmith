'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { UserExternalConnectionsAPI, getApiClient } from '@/lib/api';
import { useRouter } from '@/lib/i18n/routing';

export default function FeishuCallbackPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('third_party_accounts');
  const locale = (params?.locale as string) || 'en-US';
  const api = useMemo(() => new UserExternalConnectionsAPI(getApiClient()), []);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const providerError = searchParams.get('error');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (providerError) {
        setError(providerError);
        return;
      }
      if (!code || !state) {
        setError('missing_oauth_callback_parameters');
        return;
      }
      await api.completeFeishuOAuth({ code, state });
      if (cancelled) {
        return;
      }
      setCompleted(true);
      window.setTimeout(() => {
        router.replace(`/${locale}/user/third-party-accounts?provider=feishu&connected=1`);
      }, 800);
    };

    void run().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : 'feishu_callback_failed');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [api, code, state, providerError, locale, router]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-md p-8 text-center space-y-3">
            <h1 className="text-xl font-semibold text-foreground">
              {t('feishu_callback_title')}
            </h1>
            {error ? (
              <>
                <p className="text-sm text-error" data-testid="feishu-callback__error">{error}</p>
                <button
                  type="button"
                  className="w-full h-10 px-4 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200"
                  onClick={() => router.replace(`/${locale}/user/third-party-accounts`)}
                >
                  {t('back_to_accounts')}
                </button>
              </>
            ) : completed ? (
              <p className="text-sm text-success">{t('feishu_callback_success')}</p>
            ) : (
              <p className="text-sm text-tertiary">{t('feishu_callback_description')}</p>
            )}
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
