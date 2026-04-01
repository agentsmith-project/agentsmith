'use client';

import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';

export default function DesktopAuthCompletePage() {
  const t = useTranslations('auth');

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-md p-8 text-center space-y-3">
            <h1 className="text-xl font-semibold text-foreground">{t('desktop_auth_complete_title')}</h1>
            <p className="text-sm text-tertiary">{t('desktop_auth_complete_description')}</p>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
