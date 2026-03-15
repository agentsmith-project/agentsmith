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
        <div className="max-w-3xl space-y-4">
          <div className="rounded-[24px] border border-subtle bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
            <div className="grid gap-3 md:grid-cols-3">
              <JoinSummaryCard label={t('invalid_title')} value={t('go_home')} helper={t('invalid_description')} />
              <JoinSummaryCard label={t('title')} value={t('decline')} helper={t('description')} />
              <JoinSummaryCard label={t('accept')} value={t('accepting')} helper={t('action_failed')} />
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-8 max-w-md text-center">
            <h1 className="text-xl font-semibold text-foreground mb-2">{t('invalid_title')}</h1>
            <p className="text-sm text-tertiary mb-6">{t('invalid_description')}</p>
            <Button variant="default" onClick={() => router.push('/')}>
              {t('go_home')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <div className="w-full max-w-3xl space-y-4">
        <div className="rounded-[24px] border border-subtle bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
          <div className="grid gap-3 md:grid-cols-3">
            <JoinSummaryCard label={t('title')} value={t('accept')} helper={t('description')} />
            <JoinSummaryCard label={t('decline')} value={t('go_home')} helper={t('action_failed')} />
            <JoinSummaryCard label={t('accepting')} value={t('declining')} helper={t('description')} />
          </div>
        </div>
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
    </div>
  );
}

function JoinSummaryCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[18px] border border-white/6 bg-white/[0.03] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.12)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{label}</div>
      <div className="mt-2 text-base font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-secondary">{helper}</div>
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
