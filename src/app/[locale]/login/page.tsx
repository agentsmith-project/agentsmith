'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Building2, ShieldUser, Sparkles } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Logo } from '@/components/app-shell/Logo';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';

export default function LoginEntryPage() {
  const router = useRouter();
  const params = useParams();
  const t = useTranslations('auth');
  const hydrated = useAuthStoreHydration();
  const { isAuthenticated } = useAuthStore();
  const locale = (params?.locale as string) || 'en-US';

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    router.replace('/login/workspace');
  }, [hydrated, isAuthenticated, locale, router]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <main className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-4xl space-y-8">
              <section className="rounded-3xl border border-border bg-surface px-6 py-8 shadow-[0_24px_60px_rgba(0,0,0,0.22)]">
                <div className="text-center space-y-5">
                  <div className="flex justify-center">
                    <Logo className="scale-150" />
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('entry_badge')}
                  </div>
                  <div className="space-y-3">
                    <h1 className="text-2xl font-semibold text-foreground" data-testid="login-entry__heading">
                      {t('entry_title')}
                    </h1>
                    <p className="mx-auto max-w-2xl text-sm leading-6 text-tertiary">{t('entry_subtitle')}</p>
                    <p className="mx-auto max-w-2xl text-sm leading-6 text-secondary">{t('entry_description')}</p>
                  </div>
                </div>

                <div className="mt-8 grid gap-6 md:grid-cols-2">
                <Link
                  href={`/${locale}/login/workspace`}
                  className="group rounded-2xl border border-border bg-surface-high p-6 transition-colors hover:bg-hover"
                  data-testid="login-entry__workspace"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm bg-background">
                    <Building2 className="h-6 w-6 text-icon-default" />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">{t('entry_workspace_title')}</h2>
                  <p className="mt-2 text-sm leading-6 text-tertiary">{t('entry_workspace_description')}</p>
                  <div className="mt-5 flex items-center justify-between gap-3 text-sm">
                    <span className="text-secondary">{t('entry_workspace_hint')}</span>
                    <span className="inline-flex items-center gap-1 font-medium text-accent">
                      {t('entry_action')}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>

                <Link
                  href={`/${locale}/system/login`}
                  className="group rounded-2xl border border-border bg-surface-high p-6 transition-colors hover:bg-hover"
                  data-testid="login-entry__system"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm bg-background">
                    <ShieldUser className="h-6 w-6 text-icon-default" />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">{t('entry_system_title')}</h2>
                  <p className="mt-2 text-sm leading-6 text-tertiary">{t('entry_system_description')}</p>
                  <div className="mt-5 flex items-center justify-between gap-3 text-sm">
                    <span className="text-secondary">{t('entry_system_hint')}</span>
                    <span className="inline-flex items-center gap-1 font-medium text-accent">
                      {t('entry_action')}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
                </div>
              </section>
            </div>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
