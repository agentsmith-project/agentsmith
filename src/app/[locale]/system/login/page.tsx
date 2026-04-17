'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Logo } from '@/components/app-shell/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PublicAuthEyebrow,
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthSection,
  PublicAuthShell,
  PublicAuthSupportBlock,
} from '@/components/public/PublicAuthPage';

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
        <PublicAuthFrame recipe="public_auth_single">
          <PublicAuthShell recipe="public_auth_single">
            <div className="space-y-6">
              <PublicAuthHeader
                logo={<Logo className="origin-left scale-125" />}
                badge={(
                  <PublicAuthEyebrow tone="accent">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {t('login_badge')}
                  </PublicAuthEyebrow>
                )}
                title={<span data-testid="system-login__heading">{t('login_title')}</span>}
                description={t('login_subtitle')}
              />

              <PublicAuthSection>
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
                    <div className="rounded-md border border-error/20 bg-error/8 px-4 py-3 text-sm text-error" data-testid="system-login__error">
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
                  </div>
                </div>
              </PublicAuthSection>

              <PublicAuthSection className="space-y-4">
                <PublicAuthSupportBlock
                  testId="system-login__support"
                  eyebrow={t('login_scope_label')}
                  title={t('login_scope_value')}
                  description={t('login_scope_hint')}
                >
                  <Link href={`/${locale}/login/workspace`}>
                    <Button variant="secondary" className="w-full">
                      {t('open_workspace_login')}
                    </Button>
                  </Link>
                </PublicAuthSupportBlock>
              </PublicAuthSection>
            </div>
          </PublicAuthShell>
        </PublicAuthFrame>
      </PageLayout>
    </PageState>
  );
}
