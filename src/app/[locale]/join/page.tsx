'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useRouter } from '@/lib/i18n/routing';

function JoinPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('join');
  const token = searchParams.get('token');

  const handleAccept = () => {
    // TODO: Call join API with token; for v1 mock, redirect to login/workspace
    router.push('/login/workspace');
  };

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
        <div className="rounded-xl border border-border bg-surface p-8 max-w-md text-center">
          <h1 className="text-xl font-semibold text-foreground mb-2">{t('invalid_title')}</h1>
          <p className="text-sm text-tertiary mb-6">{t('invalid_description')}</p>
          <Button variant="default" onClick={() => router.push('/')}>
            {t('go_home')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <div className="rounded-xl border border-border bg-surface p-8 max-w-md text-center space-y-6">
        <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-tertiary">{t('description')}</p>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => router.push('/')}>
            {t('decline')}
          </Button>
          <Button variant="default" onClick={handleAccept}>
            {t('accept')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <React.Suspense
      fallback={
        <PageState state="loading">
          <PageLoading />
        </PageState>
      }
    >
      <PageState state="success">
        <PageLayout>
          <JoinPageContent />
        </PageLayout>
      </PageState>
    </React.Suspense>
  );
}
