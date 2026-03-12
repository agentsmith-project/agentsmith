'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Logo } from '@/components/app-shell/Logo';

export default function SystemLoginPage() {
  const router = useRouter();
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('system');
  const [username, setUsername] = useState('mbos-admin');
  const [password, setPassword] = useState('mbos-admin');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/system/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error_message?: string }
        | null;
      if (!response.ok) {
        setError(data?.error_message || 'invalid_system_admin_credentials');
        return;
      }
      router.replace('/system/workspaces');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageState state="success">
      <PageLayout>
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="w-full max-w-md space-y-8">
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <Logo className="scale-150" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('eyebrow')}</p>
                <h1 className="mt-2 text-2xl font-semibold text-foreground" data-testid="system-login__heading">
                  {t('login_title')}
                </h1>
                <p className="mt-2 text-sm text-tertiary">{t('login_subtitle')}</p>
              </div>
            </div>

            <div className="rounded-md border border-border bg-surface p-8">
              <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-foreground">{t('username')}</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="h-10 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground"
                    data-testid="system-login__username"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-foreground">{t('password')}</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-10 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground"
                    data-testid="system-login__password"
                  />
                </label>
                {error ? (
                  <p className="text-sm text-error" data-testid="system-login__error">
                    {t('login_error')}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting || !username.trim() || !password.trim()}
                  className="h-10 w-full rounded-sm border border-subtle bg-hover px-4 font-medium text-foreground transition-colors duration-200 hover:bg-hover/80 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="system-login__submit"
                >
                  {isSubmitting ? t('logging_in') : t('login_submit')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
