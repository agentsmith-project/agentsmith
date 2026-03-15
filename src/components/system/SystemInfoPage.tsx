'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, Database, ShieldCheck, Wrench } from 'lucide-react';
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
  const provisioning = snapshot.workspace_provisioning;

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4 md:p-6">
          <div className="mx-auto max-w-5xl space-y-5">
            <header className="rounded-[24px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] p-6 shadow-[0_22px_55px_rgba(0,0,0,0.18)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                    <Activity className="h-3.5 w-3.5" />
                    {t('eyebrow')}
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-3xl font-semibold tracking-tight text-foreground" data-testid="system-info__heading">
                  {t('info_title')}
                    </h1>
                    <p className="max-w-2xl text-sm text-secondary">{t('info_subtitle')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/${locale}/system/workspaces`}>
                    <Button type="button" variant="outline" data-testid="system-info__back">
                      {t('back_to_workspaces')}
                    </Button>
                  </Link>
                  <SystemLogoutButton />
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-4">
                <SummaryCard label={t('workspace_total_label')} value={String(provisioning.total)} />
                <SummaryCard label={t('workspace_ready_label')} value={String(provisioning.ready)} tone="positive" />
                <SummaryCard label={t('workspace_provisioning_label')} value={String(provisioning.provisioning)} />
                <SummaryCard
                  label={t('workspace_last_failed_label')}
                  value={
                    provisioning.last_failed_at
                      ? new Date(provisioning.last_failed_at).toLocaleString(locale)
                      : '-'
                  }
                />
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
                  {
                    label: t('workspace_last_initialized_label'),
                    value: snapshot.workspace_provisioning.last_initialized_at
                      ? new Date(snapshot.workspace_provisioning.last_initialized_at).toLocaleString(locale)
                      : '-',
                  },
                  {
                    label: t('workspace_last_ready_label'),
                    value: snapshot.workspace_provisioning.last_ready_at
                      ? new Date(snapshot.workspace_provisioning.last_ready_at).toLocaleString(locale)
                      : '-',
                  },
                  {
                    label: t('workspace_last_failed_label'),
                    value: snapshot.workspace_provisioning.last_failed_at
                      ? new Date(snapshot.workspace_provisioning.last_failed_at).toLocaleString(locale)
                      : '-',
                  },
                  {
                    label: t('workspace_last_init_error_label'),
                    value: snapshot.workspace_provisioning.last_init_error || '-',
                  },
                ]}
              />
            </div>

            <section
              className="rounded-[22px] border border-dashed border-subtle bg-bg-base/20 p-5 shadow-[0_12px_28px_rgba(0,0,0,0.1)]"
              data-testid="system-info__notice"
            >
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
    <section className="rounded-[22px] border border-subtle bg-surface/95 p-5 shadow-[0_16px_34px_rgba(0,0,0,0.14)]">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <div className="flex h-9 w-9 items-center justify-center rounded-[14px] border border-white/6 bg-white/[0.03]">
          {icon}
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Config</p>
          <p>{title}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1 rounded-[18px] border border-white/5 bg-white/[0.025] p-3">
            <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{row.label}</p>
            <code className="block break-all text-sm text-foreground">{row.value}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive';
}) {
  return (
    <div
      className={
        tone === 'positive'
          ? 'rounded-[20px] border border-emerald-400/20 bg-emerald-400/10 p-4 shadow-[0_12px_24px_rgba(16,185,129,0.08)]'
          : 'rounded-[20px] border border-white/6 bg-black/15 p-4 shadow-[0_12px_24px_rgba(0,0,0,0.12)]'
      }
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{label}</div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}
