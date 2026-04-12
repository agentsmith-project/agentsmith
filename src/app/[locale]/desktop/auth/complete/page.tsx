'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, MonitorSmartphone } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import {
  PublicAuthAsideBlock,
  PublicAuthEyebrow,
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthMutedCard,
  PublicAuthShell,
} from '@/components/public/PublicAuthPage';

export default function DesktopAuthCompletePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations('auth');
  const locale = (params?.locale as string) || 'en-US';
  const requestId = searchParams.get('desktop_auth_request_id')?.trim() ?? '';
  const workspaceEntryHref = `/${locale}/login/workspace`;

  return (
    <PageState state="success">
      <PageLayout>
        <PublicAuthFrame>
          <PublicAuthShell
            aside={(
              <PublicAuthAsideBlock
                icon={<CheckCircle2 className="h-5 w-5 text-success" />}
                title={t('desktop_auth_complete_next_steps_title')}
                description={t('desktop_auth_complete_close_hint')}
              >
                <div className="space-y-3 text-sm leading-6 text-secondary">
                  <p>{t('desktop_auth_request_checklist_followup')}</p>
                  <p>{t('desktop_auth_complete_retry_hint')}</p>
                </div>
                {requestId ? (
                  <PublicAuthMutedCard>
                    <p className="type-caption text-tertiary">{t('desktop_auth_request_reference_label')}</p>
                    <p className="mt-2 type-mono text-sm text-foreground" data-testid="desktop-auth-complete__request-id">{requestId}</p>
                  </PublicAuthMutedCard>
                ) : null}
              </PublicAuthAsideBlock>
            )}
          >
            <div className="space-y-6">
              <PublicAuthHeader
                badge={(
                  <PublicAuthEyebrow tone="success">
                    <MonitorSmartphone className="h-3.5 w-3.5" />
                    {t('desktop_auth_complete_badge')}
                  </PublicAuthEyebrow>
                )}
                title={<span data-testid="desktop-auth-complete__title">{t('desktop_auth_complete_title')}</span>}
                description={t('desktop_auth_complete_description')}
              />
              <PublicAuthMutedCard>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md border border-success/18 bg-success/8 text-success">
                    <CheckCircle2 className="h-4.5 w-4.5" />
                  </div>
                  <div className="space-y-2">
                    <p className="type-caption text-tertiary">{t('desktop_auth_complete_next_steps_title')}</p>
                    <p className="type-body-ui text-secondary">{t('desktop_auth_complete_close_hint')}</p>
                    <p className="type-body-ui text-secondary">{t('desktop_auth_complete_retry_hint')}</p>
                  </div>
                </div>
              </PublicAuthMutedCard>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="primary">
                  <Link href={workspaceEntryHref} data-testid="desktop-auth-complete__workspace-entry-link">
                    {t('desktop_auth_complete_open_workspace_entry')}
                  </Link>
                </Button>
              </div>
            </div>
          </PublicAuthShell>
        </PublicAuthFrame>
      </PageLayout>
    </PageState>
  );
}
