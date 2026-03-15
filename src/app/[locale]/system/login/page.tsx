'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Logo } from '@/components/app-shell/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function SystemLoginPage() {
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
      window.location.assign(`/${locale}/system/workspaces`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageState state="success">
      <PageLayout>
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="w-full max-w-md">
            <section className="rounded-[28px] border border-border bg-surface px-6 py-7 shadow-[0_24px_60px_rgba(0,0,0,0.2)]">
              <div className="mb-6 flex justify-center">
                <Logo className="scale-150" />
              </div>
              <div className="mb-6 space-y-2 text-center">
                <h1 className="text-2xl font-semibold text-foreground" data-testid="system-login__heading">
                  {t('login_title')}
                </h1>
                <p className="text-sm leading-6 text-secondary">{t('login_subtitle')}</p>
              </div>
              <div className="rounded-[22px] border border-border bg-surface-high p-6">
                <div className="space-y-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-foreground">{t('username')}</span>
                  <Input
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="bg-background"
                    data-testid="system-login__username"
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-foreground">{t('password')}</span>
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="bg-background"
                    data-testid="system-login__password"
                  />
                </label>
                {error ? (
                  <p className="text-sm text-error" data-testid="system-login__error">
                    {t('login_error')}
                  </p>
                ) : null}
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting || !username.trim() || !password.trim()}
                  variant="primary"
                  className="w-full"
                  data-testid="system-login__submit"
                >
                  {isSubmitting ? t('logging_in') : t('login_submit')}
                </Button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
