'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { useRouter } from '@/lib/i18n/routing';
import { getApiClient, MemberAPI } from '@/lib/api';
import { toast } from '@/components/ui/toast';

function JoinPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('join');
  const token = searchParams.get('token');
  const memberApi = React.useMemo(() => new MemberAPI(getApiClient()), []);

  const acceptInviteMutation = useMutation({
    mutationFn: async (inviteToken: string) => memberApi.acceptInvite(inviteToken),
    onSuccess: () => {
      router.push('/login/workspace');
    },
    onError: () => {
      toast.error(t('action_failed'));
    },
  });

  const declineInviteMutation = useMutation({
    mutationFn: async (inviteToken: string) => memberApi.declineInvite(inviteToken),
    onSuccess: () => {
      router.push('/');
    },
    onError: () => {
      toast.error(t('action_failed'));
    },
  });

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
          <Button
            data-testid="join__decline-btn"
            variant="outline"
            disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
            onClick={() => {
              if (!token) return;
              declineInviteMutation.mutate(token);
            }}
          >
            {declineInviteMutation.isPending ? t('declining') : t('decline')}
          </Button>
          <Button
            data-testid="join__accept-btn"
            variant="default"
            disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
            onClick={() => {
              if (!token) return;
              acceptInviteMutation.mutate(token);
            }}
          >
            {acceptInviteMutation.isPending ? t('accepting') : t('accept')}
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
