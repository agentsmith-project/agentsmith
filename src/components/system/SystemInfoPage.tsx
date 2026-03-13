'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Database, ShieldCheck, Wrench } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import type { SystemInfoSnapshot } from '@/lib/system-admin/config';
import { SystemLogoutButton } from './SystemLogoutButton';

interface SystemInfoPageProps {
  snapshot: SystemInfoSnapshot;
}

export function SystemInfoPage({ snapshot }: SystemInfoPageProps) {
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('system');

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4 md:p-6">
          <div className="mx-auto max-w-5xl space-y-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('eyebrow')}</p>
                <h1 className="text-2xl font-semibold text-foreground" data-testid="system-info__heading">
                  {t('info_title')}
                </h1>
                <p className="text-sm text-tertiary">{t('info_subtitle')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/${locale}/system/workspaces`}>
                  <Button type="button" variant="outline" data-testid="system-info__back">
                    {t('back_to_workspaces')}
                  </Button>
                </Link>
                <SystemLogoutButton />
              </div>
            </header>

            <div className="grid gap-4 lg:grid-cols-3">
              <InfoCard
                icon={<ShieldCheck className="h-5 w-5" />}
                title={t('system_admin_title')}
                rows={[
                  { label: t('system_admin_username_label'), value: snapshot.system_admin_username },
                ]}
              />
              <InfoCard
                icon={<Wrench className="h-5 w-5" />}
                title={t('api_service_title')}
                rows={[
                  { label: t('api_base_url_label'), value: snapshot.api_base_url },
                ]}
              />
              <InfoCard
                icon={<Wrench className="h-5 w-5" />}
                title={t('workspace_registry_title')}
                rows={[
                  { label: t('workspace_registry_path_label'), value: snapshot.workspace_registry_path },
                  { label: t('workspace_registry_status_label'), value: t(`config_status.${snapshot.workspace_registry_status}`) },
                ]}
              />
              <InfoCard
                icon={<Database className="h-5 w-5" />}
                title={t('data_service_title')}
                rows={[
                  { label: t('substrate_label_label'), value: snapshot.substrate_label },
                  { label: t('substrate_url_label'), value: snapshot.substrate_url },
                  { label: t('data_service_status_label'), value: t(`config_status.${snapshot.data_service_status}`) },
                ]}
              />
              <InfoCard
                icon={<Wrench className="h-5 w-5" />}
                title={t('default_workspace_title')}
                rows={[
                  { label: t('default_workspace_id_label'), value: snapshot.default_workspace_id },
                  { label: t('default_workspace_name_label'), value: snapshot.default_workspace_name },
                ]}
              />
              <InfoCard
                icon={<ShieldCheck className="h-5 w-5" />}
                title={t('default_idp_title')}
                rows={[
                  { label: t('default_idp_url_label'), value: snapshot.default_idp_url || '-' },
                  { label: t('default_idp_realm_label'), value: snapshot.default_idp_realm || '-' },
                  { label: t('default_idp_client_id_label'), value: snapshot.default_idp_client_id || '-' },
                  { label: t('default_idp_status_label'), value: t(`config_status.${snapshot.default_idp_status}`) },
                ]}
              />
              <InfoCard
                icon={<Wrench className="h-5 w-5" />}
                title={t('tenant_rules_title')}
                rows={[
                  { label: t('database_prefix_label'), value: snapshot.database_prefix },
                  { label: t('collection_prefix_label'), value: snapshot.collection_prefix },
                  { label: t('key_prefix_label'), value: snapshot.key_prefix },
                ]}
              />
              <InfoCard
                icon={<Wrench className="h-5 w-5" />}
                title={t('workspace_provisioning_title')}
                rows={[
                  { label: t('workspace_total_label'), value: String(snapshot.workspace_provisioning.total) },
                  { label: t('workspace_ready_label'), value: String(snapshot.workspace_provisioning.ready) },
                  { label: t('workspace_provisioning_label'), value: String(snapshot.workspace_provisioning.provisioning) },
                  { label: t('workspace_failed_label'), value: String(snapshot.workspace_provisioning.failed) },
                  { label: t('workspace_draft_label'), value: String(snapshot.workspace_provisioning.draft) },
                  { label: t('workspace_disabled_label'), value: String(snapshot.workspace_provisioning.disabled) },
                ]}
              />
            </div>

            <section className="rounded-md border border-dashed border-subtle bg-bg-base/20 p-4" data-testid="system-info__notice">
              <p className="text-sm text-tertiary">{t('info_notice')}</p>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function InfoCard({
  icon,
  title,
  rows,
}: {
  icon: ReactNode;
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {icon}
        {title}
      </div>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1">
            <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{row.label}</p>
            <code className="block break-all text-sm text-foreground">{row.value}</code>
          </div>
        ))}
      </div>
    </section>
  );
}
