'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, ShieldCheck } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Logo } from '@/components/app-shell/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PublicThemeToggle } from '@/components/theme/PublicThemeToggle';

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
      const data = (await response.json().catch(() => null)) as { error_message?: string } | null;
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
        <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
          <PublicThemeToggle className="absolute right-4 top-4 z-10 md:right-6 md:top-6" />
          <section className="surface-elevated grid w-full max-w-4xl gap-6 rounded-[32px] border border-border/70 p-6 md:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)] md:p-8">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface-high px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                {t('login_badge')}
              </div>
              <div className="space-y-3">
                <div className="flex justify-start">
                  <Logo className="origin-left scale-150" />
                </div>
                <h1 className="font-display text-4xl text-primary" data-testid="system-login__heading">
                  {t('login_title')}
                </h1>
                <p className="max-w-xl text-base leading-7 text-secondary">{t('login_subtitle')}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[20px] border border-subtle bg-background/70 px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('login_scope_label')}</p>
                  <p className="mt-2 text-base font-semibold text-foreground">{t('login_scope_value')}</p>
                  <p className="mt-1 text-sm text-secondary">{t('login_scope_hint')}</p>
                </div>
                <div className="rounded-[20px] border border-subtle bg-background/70 px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('login_access_label')}</p>
                  <p className="mt-2 text-base font-semibold text-foreground">{t('login_access_value')}</p>
                  <p className="mt-1 text-sm text-secondary">{t('login_access_hint')}</p>
                </div>
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
                    <div className="rounded-[18px] border border-error/25 bg-error/10 px-4 py-3 text-sm text-error" data-testid="system-login__error">
                      {t('login_error')}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSubmitting || !username.trim() || !password.trim()}
                      variant="primary"
                      className="flex-1"
                      data-testid="system-login__submit"
                    >
                      {isSubmitting ? t('logging_in') : t('login_submit')}
                    </Button>
                    <Link href={`/${locale}/login/workspace`} className="sm:flex-1">
                      <Button type="button" variant="outline" className="w-full">
                        {t('open_workspace_login')}
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
            <aside className="surface-soft flex flex-col justify-between rounded-[28px] border border-subtle p-5 md:p-6">
              <div className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-subtle bg-background text-icon-default">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h2 className="font-display text-2xl text-primary">{t('system_admin_title')}</h2>
                  <p className="text-sm leading-6 text-secondary">{t('login_scope_hint')}</p>
                </div>
                <div className="rounded-[20px] border border-subtle bg-background/70 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('login_access_label')}</p>
                  <p className="mt-1 text-sm text-secondary">{t('login_access_hint')}</p>
                </div>
              </div>
              <div className="space-y-3">
                <Link href={`/${locale}/login/workspace`}>
                  <Button variant="outline" className="w-full">
                    {t('open_workspace_login')}
                  </Button>
                </Link>
              </div>
            </aside>
          </section>
        </div>
      </PageLayout>
    </PageState>
  );
}
