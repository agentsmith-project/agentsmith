'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, MonitorSmartphone } from 'lucide-react';
import { Logo } from '@/components/app-shell/Logo';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import {
  PublicAuthEyebrow,
  PublicAuthFrame,
  PublicAuthHeader,
  PublicAuthSection,
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
        <PublicAuthFrame width="narrow">
          <PublicAuthShell>
            <div className="space-y-5">
              <PublicAuthHeader
                logo={<Logo className="origin-left scale-125" />}
                badge={(
                  <PublicAuthEyebrow tone="success">
                    <MonitorSmartphone className="h-3.5 w-3.5" />
                    {t('desktop_auth_complete_badge')}
                  </PublicAuthEyebrow>
                )}
                title={<span data-testid="desktop-auth-complete__title">{t('desktop_auth_complete_title')}</span>}
                description={t('desktop_auth_complete_description')}
              />
              <PublicAuthSection className="space-y-3">
                {requestId ? (
                  <div className="space-y-1" data-testid="desktop-auth-complete__request-meta">
                    <p className="type-caption text-tertiary">{t('desktop_auth_request_reference_label')}</p>
                    <p className="type-mono text-sm text-foreground" data-testid="desktop-auth-complete__request-id">{requestId}</p>
                  </div>
                ) : null}
                <Link
                  href={workspaceEntryHref}
                  className="inline-flex items-center gap-2 text-sm text-secondary transition-colors hover:text-foreground"
                  data-testid="desktop-auth-complete__workspace-entry-link"
                >
                  <span>{t('desktop_auth_complete_open_workspace_entry')}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </PublicAuthSection>
            </div>
          </PublicAuthShell>
        </PublicAuthFrame>
      </PageLayout>
    </PageState>
  );
}
