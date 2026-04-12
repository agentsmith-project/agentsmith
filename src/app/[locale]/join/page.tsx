'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/app-shell/Logo';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import {
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthSection,
  PublicAuthShell,
} from '@/components/public/PublicAuthPage';
import { useRouter } from '@/lib/i18n/routing';
import { getApiClient, MemberAPI } from '@/lib/api';
import { toast } from '@/components/ui/toast';

function JoinPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations('join');
  const tAuth = useTranslations('auth');
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
      <PublicAuthFrame width="narrow">
        <PublicAuthShell>
          <div className="space-y-6">
            <PublicAuthHeader
              logo={<Logo className="origin-left scale-125" />}
              title={t('invalid_title')}
              description={t('invalid_description')}
            />
            <PublicAuthSection>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="primary" className="sm:flex-1" onClick={() => router.push('/')}>
                  {t('go_home')}
                </Button>
                <Button variant="secondary" className="sm:flex-1" onClick={() => router.push('/login/workspace')}>
                  {tAuth('workspace_login_title')}
                </Button>
              </div>
            </PublicAuthSection>
          </div>
        </PublicAuthShell>
      </PublicAuthFrame>
    );
  }

  return (
      <PublicAuthFrame width="narrow">
      <PublicAuthShell>
        <div className="space-y-6">
          <PublicAuthHeader
            logo={<Logo className="origin-left scale-125" />}
            title={t('title')}
            description={t('description')}
          />

          <PublicAuthSection>
            <div className="space-y-4">
              {inlineError ? (
                <div className="rounded-md border border-error/20 bg-error/8 px-4 py-3 text-sm text-error" data-testid="join__error">
                  {t('action_failed')}
                </div>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  data-testid="join__accept-btn"
                  variant="primary"
                  className="justify-between sm:flex-1"
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
                  variant="secondary"
                  className="sm:flex-1"
                  disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
                  onClick={() => {
                    declineInviteMutation.mutate(token);
                  }}
                >
                  {declineInviteMutation.isPending ? t('declining') : t('decline')}
                </Button>
              </div>
            </div>
          </PublicAuthSection>
        </div>
      </PublicAuthShell>
    </PublicAuthFrame>
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
