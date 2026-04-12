'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Mail, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { PublicThemeToggle } from '@/components/theme/PublicThemeToggle';
import { useRouter } from '@/lib/i18n/routing';
import { getApiClient, MemberAPI } from '@/lib/api';
import { toast } from '@/components/ui/toast';

function JoinPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('join');
  const token = searchParams.get('token');
  const memberApi = React.useMemo(() => new MemberAPI(getApiClient()), []);
  const [inlineError, setInlineError] = React.useState(false);

  const acceptInviteMutation = useMutation({
    mutationFn: async (inviteToken: string) => memberApi.acceptInvite(inviteToken),
    onSuccess: () => {
      setInlineError(false);
      router.push('/login/workspace');
    },
    onError: () => {
      setInlineError(true);
      toast.error(t('action_failed'));
    },
  });

  const declineInviteMutation = useMutation({
    mutationFn: async (inviteToken: string) => memberApi.declineInvite(inviteToken),
    onSuccess: () => {
      setInlineError(false);
      router.push('/');
    },
    onError: () => {
      setInlineError(true);
      toast.error(t('action_failed'));
    },
  });

  if (!token) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
        <PublicThemeToggle className="absolute right-4 top-4 z-10 md:right-6 md:top-6" />
        <section className="surface-elevated grid w-full max-w-4xl gap-6 rounded-[32px] border border-border/70 p-6 md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] md:p-8">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface-high px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
              <Mail className="h-3.5 w-3.5 text-accent" />
              {t('title')}
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-4xl text-primary">{t('invalid_title')}</h1>
              <p className="max-w-xl text-base leading-7 text-secondary">{t('invalid_description')}</p>
            </div>
            <div className="surface-soft rounded-[24px] border border-subtle px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <JoinSummaryCard
                  icon={<XCircle className="h-4 w-4 text-warning" />}
                  label={t('invalid_title')}
                  value={t('go_home')}
                  helper={t('invalid_description')}
                />
                <JoinSummaryCard
                  icon={<ArrowRight className="h-4 w-4 text-accent" />}
                  label={t('title')}
                  value={t('decline')}
                  helper={t('description')}
                />
              </div>
            </div>
          </div>
          <aside className="surface-soft flex flex-col justify-between rounded-[28px] border border-subtle p-5 md:p-6">
            <div className="space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-subtle bg-background text-icon-default">
                <Mail className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h2 className="font-display text-2xl text-primary">{t('go_home')}</h2>
                <p className="text-sm leading-6 text-secondary">{t('action_failed')}</p>
              </div>
            </div>
            <div className="space-y-3">
              <Button variant="action" className="w-full justify-between" onClick={() => router.push('/')}>
                {t('go_home')}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" className="w-full" onClick={() => router.push('/login/workspace')}>
                {t('decline')}
              </Button>
            </div>
          </aside>
        </section>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <PublicThemeToggle className="absolute right-4 top-4 z-10 md:right-6 md:top-6" />
      <section className="surface-elevated grid w-full max-w-4xl gap-6 rounded-[32px] border border-border/70 p-6 md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] md:p-8">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface-high px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
            <Mail className="h-3.5 w-3.5 text-accent" />
            {t('title')}
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-4xl text-primary">{t('title')}</h1>
            <p className="max-w-xl text-base leading-7 text-secondary">{t('description')}</p>
          </div>
          <div className="surface-soft rounded-[24px] border border-subtle px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <JoinSummaryCard
                icon={<CheckCircle2 className="h-4 w-4 text-success" />}
                label={t('accept')}
                value={t('accepting')}
                helper={t('description')}
              />
              <JoinSummaryCard
                icon={<XCircle className="h-4 w-4 text-warning" />}
                label={t('decline')}
                value={t('go_home')}
                helper={t('action_failed')}
              />
              <JoinSummaryCard
                icon={<ArrowRight className="h-4 w-4 text-accent" />}
                label={t('title')}
                value={t('accept')}
                helper={t('declining')}
              />
            </div>
          </div>
          {inlineError ? (
            <div className="rounded-[20px] border border-error/25 bg-error/10 px-4 py-3 text-sm text-error" data-testid="join__error">
              {t('action_failed')}
            </div>
          ) : null}
        </div>
        <aside className="surface-soft flex flex-col justify-between rounded-[28px] border border-subtle p-5 md:p-6">
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-subtle bg-background text-icon-default">
              <Mail className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-2xl text-primary">{t('accept')}</h2>
              <p className="text-sm leading-6 text-secondary">{t('description')}</p>
            </div>
            <div className="rounded-[20px] border border-subtle bg-background/70 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('go_home')}</p>
              <p className="mt-1 text-sm text-secondary">{t('decline')}</p>
            </div>
          </div>
          <div className="space-y-3">
            <Button
              data-testid="join__accept-btn"
              variant="action"
              className="w-full justify-between"
              disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
              onClick={() => {
                acceptInviteMutation.mutate(token);
              }}
            >
              {acceptInviteMutation.isPending ? t('accepting') : t('accept')}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              data-testid="join__decline-btn"
              variant="outline"
              className="w-full"
              disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
              onClick={() => {
                declineInviteMutation.mutate(token);
              }}
            >
              {declineInviteMutation.isPending ? t('declining') : t('decline')}
            </Button>
          </div>
        </aside>
      </section>
    </div>
  );
}

function JoinSummaryCard({
  icon,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[18px] border border-subtle bg-background/70 p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
        {icon}
        {label}
      </div>
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
