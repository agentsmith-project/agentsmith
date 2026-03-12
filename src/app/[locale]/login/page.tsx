'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, ShieldUser } from 'lucide-react';
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
            <div className="w-full max-w-3xl space-y-8">
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <Logo className="scale-150" />
                </div>
                <h1 className="text-2xl font-semibold text-foreground" data-testid="login-entry__heading">
                  {t('entry_title')}
                </h1>
                <p className="text-tertiary">{t('entry_subtitle')}</p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <Link
                  href={`/${locale}/login/workspace`}
                  className="group rounded-md border border-border bg-surface p-6 transition-colors hover:bg-hover"
                  data-testid="login-entry__workspace"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm bg-surface-high">
                    <Building2 className="h-6 w-6 text-icon-default" />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">{t('entry_workspace_title')}</h2>
                  <p className="mt-2 text-sm text-tertiary">{t('entry_workspace_description')}</p>
                </Link>

                <Link
                  href={`/${locale}/system/login`}
                  className="group rounded-md border border-border bg-surface p-6 transition-colors hover:bg-hover"
                  data-testid="login-entry__system"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm bg-surface-high">
                    <ShieldUser className="h-6 w-6 text-icon-default" />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">{t('entry_system_title')}</h2>
                  <p className="mt-2 text-sm text-tertiary">{t('entry_system_description')}</p>
                </Link>
              </div>
            </div>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
