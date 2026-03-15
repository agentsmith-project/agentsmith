'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Logo } from '@/components/app-shell/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LockKeyhole, ShieldCheck } from 'lucide-react';

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
      router.replace(`/${locale}/system/workspaces`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageState state="success">
      <PageLayout>
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="w-full max-w-4xl">
            <section className="rounded-3xl border border-border bg-surface px-6 py-8 shadow-[0_24px_60px_rgba(0,0,0,0.22)]">
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
                <div className="space-y-5 text-center lg:text-left">
                  <div className="flex justify-center lg:justify-start">
                    <Logo className="scale-150" />
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {t('login_badge')}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('eyebrow')}</p>
                    <h1 className="mt-2 text-2xl font-semibold text-foreground" data-testid="system-login__heading">
                      {t('login_title')}
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-tertiary">{t('login_subtitle')}</p>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-secondary">{t('login_description')}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border/70 bg-surface-high p-4 text-left">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                        <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                        {t('login_scope_label')}
                      </div>
                      <div className="mt-3 text-base font-semibold text-foreground">{t('login_scope_value')}</div>
                      <p className="mt-1 text-sm text-tertiary">{t('login_scope_hint')}</p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-surface-high p-4 text-left">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                        <LockKeyhole className="h-3.5 w-3.5 text-accent" />
                        {t('login_access_label')}
                      </div>
                      <div className="mt-3 text-base font-semibold text-foreground">{t('login_access_value')}</div>
                      <p className="mt-1 text-sm text-tertiary">{t('login_access_hint')}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-surface-high p-6">
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
              </div>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
