'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, AlertTriangle, CheckCircle2, Database, ShieldCheck, Wrench } from 'lucide-react';
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
  const attentionItems = buildAttentionItems(snapshot, locale, t);
  const statusOverview = [
    {
      label: t('workspace_total_label'),
      value: String(provisioning.total),
      detail: t('system_info_total_detail'),
      tone: 'default' as const,
    },
    {
      label: t('workspace_ready_label'),
      value: String(provisioning.ready),
      detail: t('system_info_ready_detail'),
      tone: 'positive' as const,
    },
    {
      label: t('system_info_attention_label'),
      value: String(provisioning.failed + provisioning.provisioning + provisioning.disabled),
      detail: t('system_info_attention_detail'),
      tone: attentionItems.length > 0 ? 'warning' as const : 'default' as const,
    },
    {
      label: t('workspace_last_failed_label'),
      value: provisioning.last_failed_at
        ? new Date(provisioning.last_failed_at).toLocaleString(locale)
        : '-',
      detail: provisioning.last_init_error || t('system_info_no_recent_failure'),
      tone: provisioning.last_failed_at ? 'warning' as const : 'default' as const,
    },
  ];

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4 md:p-6">
          <div className="mx-auto max-w-[1440px] space-y-5">
            <header className="rounded-[30px] border border-subtle bg-surface/95 p-6 shadow-[0_24px_56px_rgba(0,0,0,0.2)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('eyebrow')}</p>
                  <h1 className="text-2xl font-semibold text-foreground" data-testid="system-info__heading">
                    {t('info_title')}
                  </h1>
                  <p className="text-sm leading-6 text-secondary">{t('info_subtitle')}</p>
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

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {statusOverview.map((item) => (
                  <SummaryTile
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    detail={item.detail}
                    tone={item.tone}
                  />
                ))}
              </div>
            </header>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
              <div className="space-y-4">
                <SectionCard
                  eyebrow={t('system_info_health_label')}
                  title={t('system_info_health_title')}
                  description={t('system_info_health_description')}
                  icon={<Activity className="h-4 w-4" />}
                  dataTestId="system-info__health"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <StatusLine
                      label={t('workspace_registry_title')}
                      value={t(`config_status.${snapshot.workspace_registry_status}`)}
                      tone={snapshot.workspace_registry_status === 'available' ? 'positive' : 'warning'}
                    />
                    <StatusLine
                      label={t('data_service_title')}
                      value={t(`config_status.${snapshot.data_service_status}`)}
                      tone={snapshot.data_service_status === 'configured' ? 'positive' : 'warning'}
                    />
                    <StatusLine
                      label={t('default_idp_title')}
                      value={t(`config_status.${snapshot.default_idp_status}`)}
                      tone={snapshot.default_idp_status === 'configured' ? 'positive' : 'warning'}
                    />
                    <StatusLine
                      label={t('workspace_provisioning_title')}
                      value={summarizeProvisioning(provisioning, t)}
                      tone={attentionItems.length > 0 ? 'warning' : 'positive'}
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  eyebrow={t('system_info_configuration_label')}
                  title={t('system_info_configuration_title')}
                  description={t('system_info_configuration_description')}
                  icon={<ShieldCheck className="h-4 w-4" />}
                >
                  <div className="grid gap-3 lg:grid-cols-2">
                    <InfoGroup
                      title={t('api_service_title')}
                      rows={[
                        { label: t('api_base_url_label'), value: snapshot.api_base_url },
                      ]}
                    />
                    <InfoGroup
                      title={t('system_admin_title')}
                      rows={[
                        { label: t('system_admin_username_label'), value: snapshot.system_admin_username },
                      ]}
                    />
                    <InfoGroup
                      title={t('default_workspace_title')}
                      rows={[
                        { label: t('default_workspace_id_label'), value: snapshot.default_workspace_id },
                        { label: t('default_workspace_name_label'), value: snapshot.default_workspace_name },
                      ]}
                    />
                    <InfoGroup
                      title={t('default_idp_title')}
                      rows={[
                        { label: t('default_idp_url_label'), value: snapshot.default_idp_url || '-' },
                        { label: t('default_idp_realm_label'), value: snapshot.default_idp_realm || '-' },
                        { label: t('default_idp_client_id_label'), value: snapshot.default_idp_client_id || '-' },
                      ]}
                    />
                    <InfoGroup
                      title={t('workspace_registry_title')}
                      rows={[
                        { label: t('workspace_registry_status_label'), value: t(`config_status.${snapshot.workspace_registry_status}`) },
                      ]}
                    />
                  </div>
                </SectionCard>

                <SectionCard
                  eyebrow={t('system_info_data_plane_label')}
                  title={t('system_info_data_plane_title')}
                  description={t('system_info_data_plane_description')}
                  icon={<Database className="h-4 w-4" />}
                >
                  <div className="grid gap-3 lg:grid-cols-2">
                    <InfoGroup
                      title={t('data_service_title')}
                      rows={[
                        { label: t('substrate_label_label'), value: snapshot.substrate_label },
                        { label: t('substrate_url_label'), value: snapshot.substrate_url },
                        { label: t('data_service_status_label'), value: t(`config_status.${snapshot.data_service_status}`) },
                      ]}
                    />
                    <InfoGroup
                      title={t('tenant_rules_title')}
                      rows={[
                        { label: t('database_prefix_label'), value: snapshot.database_prefix },
                        { label: t('collection_prefix_label'), value: snapshot.collection_prefix },
                        { label: t('key_prefix_label'), value: snapshot.key_prefix },
                      ]}
                    />
                  </div>
                </SectionCard>
              </div>

              <div className="space-y-4">
                <SectionCard
                  eyebrow={t('system_info_attention_panel_label')}
                  title={t('system_info_attention_panel_title')}
                  description={t('system_info_attention_panel_description')}
                  icon={<AlertTriangle className="h-4 w-4" />}
                  dataTestId="system-info__attention"
                >
                  {attentionItems.length > 0 ? (
                    <div className="space-y-3">
                      {attentionItems.map((item) => (
                        <div key={item.title} className="rounded-[18px] border border-warning/25 bg-warning/10 p-4">
                          <div className="flex items-start gap-3">
                            <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-foreground">{item.title}</p>
                              <p className="text-sm leading-6 text-secondary">{item.body}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[18px] border border-success/25 bg-success/10 p-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">{t('system_info_all_clear_title')}</p>
                          <p className="text-sm leading-6 text-secondary">{t('system_info_all_clear_body')}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  eyebrow={t('system_info_provisioning_label')}
                  title={t('workspace_provisioning_title')}
                  description={t('system_info_provisioning_description')}
                  icon={<Wrench className="h-4 w-4" />}
                >
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <KeyMetric label={t('workspace_ready_label')} value={String(provisioning.ready)} />
                      <KeyMetric label={t('workspace_failed_label')} value={String(provisioning.failed)} />
                      <KeyMetric label={t('workspace_draft_label')} value={String(provisioning.draft)} />
                      <KeyMetric label={t('workspace_disabled_label')} value={String(provisioning.disabled)} />
                    </div>
                    <div className="space-y-2 rounded-[18px] border border-subtle bg-background/70 p-4">
                      <TimelineRow label={t('workspace_last_initialized_label')} value={formatTimestamp(provisioning.last_initialized_at, locale)} />
                      <TimelineRow label={t('workspace_last_ready_label')} value={formatTimestamp(provisioning.last_ready_at, locale)} />
                      <TimelineRow label={t('workspace_last_failed_label')} value={formatTimestamp(provisioning.last_failed_at, locale)} />
                      <TimelineRow label={t('workspace_last_init_error_label')} value={provisioning.last_init_error || '-'} />
                    </div>
                  </div>
                </SectionCard>

                <section
                  className="rounded-[24px] border border-dashed border-subtle bg-bg-base/20 p-5 shadow-[0_12px_28px_rgba(0,0,0,0.1)]"
                  data-testid="system-info__notice"
                >
                  <p className="text-sm leading-6 text-tertiary">{t('info_notice')}</p>
                </section>
              </div>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function SectionCard({
  eyebrow,
  title,
  description,
  icon,
  children,
  dataTestId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
  dataTestId?: string;
}) {
  return (
    <section
      className="rounded-[28px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
      data-testid={dataTestId}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-background text-icon-default">
          {icon}
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{eyebrow}</p>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm leading-6 text-secondary">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'default' | 'positive' | 'warning';
}) {
  const toneClassName = (
    tone === 'positive'
      ? 'border-success/30 bg-success/10'
      : tone === 'warning'
        ? 'border-warning/30 bg-warning/10'
        : 'border-border bg-surface-high'
  );

  return (
    <div className={`rounded-[20px] border p-4 shadow-[0_12px_24px_rgba(0,0,0,0.12)] ${toneClassName}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{label}</p>
      <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-5 text-secondary">{detail}</p>
    </div>
  );
}

function StatusLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'positive' | 'warning';
}) {
  return (
    <div className="rounded-[18px] border border-subtle bg-background/70 p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{label}</p>
      <p className={`mt-2 text-base font-semibold ${tone === 'positive' ? 'text-success' : 'text-warning'}`}>{value}</p>
    </div>
  );
}

function InfoGroup({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-[20px] border border-subtle bg-surface-high p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1 rounded-[16px] border border-white/5 bg-background/70 p-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">{row.label}</p>
            <code className="block break-all text-sm text-foreground">{row.value}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function KeyMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[18px] border border-subtle bg-surface-high p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function TimelineRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 last:border-b-0 last:pb-0 first:pt-0">
      <p className="text-sm text-tertiary">{label}</p>
      <p className="max-w-[60%] text-right text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function buildAttentionItems(
  snapshot: SystemInfoSnapshot,
  locale: string,
  t: (key: string, values?: Record<string, string>) => string,
) {
  const items: Array<{ title: string; body: string; icon: typeof AlertTriangle }> = [];

  if (snapshot.workspace_registry_status !== 'available') {
    items.push({
      title: t('system_info_attention_registry_title'),
      body: t('system_info_attention_registry_body'),
      icon: AlertTriangle,
    });
  }

  if (snapshot.data_service_status !== 'configured') {
    items.push({
      title: t('system_info_attention_data_title'),
      body: t('system_info_attention_data_body'),
      icon: AlertTriangle,
    });
  }

  if (snapshot.default_idp_status !== 'configured') {
    items.push({
      title: t('system_info_attention_idp_title'),
      body: t('system_info_attention_idp_body'),
      icon: AlertTriangle,
    });
  }

  if (snapshot.workspace_provisioning.last_init_error || snapshot.workspace_provisioning.failed > 0) {
    items.push({
      title: t('system_info_attention_provisioning_title'),
      body: snapshot.workspace_provisioning.last_init_error
        ? `${snapshot.workspace_provisioning.last_init_error} · ${formatTimestamp(snapshot.workspace_provisioning.last_failed_at, locale)}`
        : t('system_info_attention_provisioning_body'),
      icon: AlertTriangle,
    });
  }

  return items;
}

function summarizeProvisioning(
  provisioning: SystemInfoSnapshot['workspace_provisioning'],
  t: (key: string, values?: Record<string, string>) => string,
) {
  if (provisioning.failed > 0) {
    return t('system_info_provisioning_failed_summary', { count: String(provisioning.failed) });
  }
  if (provisioning.provisioning > 0) {
    return t('system_info_provisioning_running_summary', { count: String(provisioning.provisioning) });
  }
  return t('system_info_provisioning_ready_summary');
}

function formatTimestamp(value: string | null, locale: string) {
  return value ? new Date(value).toLocaleString(locale) : '-';
}
