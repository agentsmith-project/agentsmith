'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, MonitorSmartphone } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';

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
        <div className="min-h-screen bg-background px-4 py-6 md:px-6 md:py-8">
          <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center justify-center">
            <section className="surface-elevated grid w-full gap-6 rounded-[32px] border border-border/70 p-6 md:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)] md:p-8">
              <div className="space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-success">
                  <MonitorSmartphone className="h-3.5 w-3.5" />
                  {t('desktop_auth_complete_badge')}
                </div>
                <div className="space-y-3">
                  <h1 className="type-display max-w-2xl text-balance text-foreground" data-testid="desktop-auth-complete__title">
                    {t('desktop_auth_complete_title')}
                  </h1>
                  <p className="type-body-ui max-w-2xl text-secondary">{t('desktop_auth_complete_description')}</p>
                </div>
                <div className="surface-soft rounded-[24px] border border-subtle px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-[14px] border border-success/20 bg-success/10 text-success">
                      <CheckCircle2 className="h-4.5 w-4.5" />
                    </div>
                    <div className="space-y-2">
                      <p className="type-system-caption text-tertiary">{t('desktop_auth_complete_next_steps_title')}</p>
                      <p className="type-body-ui text-secondary">{t('desktop_auth_complete_close_hint')}</p>
                      <p className="type-body-ui text-secondary">{t('desktop_auth_complete_retry_hint')}</p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild variant="primary">
                    <Link href={workspaceEntryHref} data-testid="desktop-auth-complete__workspace-entry-link">
                      {t('desktop_auth_complete_open_workspace_entry')}
                    </Link>
                  </Button>
                </div>
              </div>

              <aside className="surface-soft flex flex-col justify-between rounded-[28px] border border-subtle p-5 md:p-6">
                <div className="space-y-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-subtle bg-background text-success">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <p className="type-system-caption text-tertiary">{t('desktop_auth_request_checklist_label')}</p>
                    <ul className="space-y-3 text-sm leading-6 text-secondary">
                      <li>{t('desktop_auth_request_checklist_followup')}</li>
                      <li>{t('desktop_auth_complete_close_hint')}</li>
                    </ul>
                  </div>
                </div>
                {requestId ? (
                  <div className="rounded-[20px] border border-subtle bg-background/70 px-4 py-3">
                    <p className="type-system-caption text-tertiary">{t('desktop_auth_request_reference_label')}</p>
                    <p className="mt-2 type-mono text-sm text-foreground" data-testid="desktop-auth-complete__request-id">{requestId}</p>
                  </div>
                ) : null}
              </aside>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
