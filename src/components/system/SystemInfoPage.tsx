'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
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
    { label: t('workspace_total_label'), value: String(provisioning.total), tone: 'default' as const },
    { label: t('workspace_ready_label'), value: String(provisioning.ready), tone: 'positive' as const },
    {
      label: t('system_info_attention_label'),
      value: String(provisioning.failed + provisioning.provisioning + provisioning.disabled),
      tone: attentionItems.length > 0 ? 'warning' as const : 'default' as const,
    },
    {
      label: t('workspace_last_failed_label'),
      value: provisioning.last_failed_at ? new Date(provisioning.last_failed_at).toLocaleString(locale) : '-',
      tone: provisioning.last_failed_at ? 'warning' as const : 'default' as const,
    },
  ];

  const quickActions = [
    {
      href: `/${locale}/system/workspaces`,
      title: t('system_info_next_steps_directory_title'),
      body: t('system_info_next_steps_directory_body'),
      cta: t('back_to_workspaces'),
    },
    {
      href: `/${locale}/system/workspaces/new`,
      title: t('system_info_next_steps_create_title'),
      body: t('system_info_next_steps_create_body'),
      cta: t('new_workspace'),
    },
  ];

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background px-4 py-5 md:px-6 md:py-7">
          <div className="mx-auto max-w-[1280px] space-y-7">
            <header className="space-y-5">
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

              <div className="flex flex-wrap gap-x-10 gap-y-4 border-t border-subtle pt-4">
                {statusOverview.map((item) => (
                  <InlineMetric key={item.label} label={item.label} value={item.value} tone={item.tone} />
                ))}
              </div>
            </header>

            <section className="grid gap-8 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
              <div className="space-y-7">
                <SectionBlock eyebrow={t('system_info_health_label')} title={t('system_info_health_title')} dataTestId="system-info__health">
                  <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
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
                </SectionBlock>

                <SectionBlock eyebrow={t('system_info_configuration_label')} title={t('system_info_configuration_title')}>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <InfoGroup title={t('api_service_title')} rows={[{ label: t('api_base_url_label'), value: snapshot.api_base_url }]} />
                    <InfoGroup title={t('system_admin_title')} rows={[{ label: t('system_admin_username_label'), value: snapshot.system_admin_username }]} />
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
                      rows={[{ label: t('workspace_registry_status_label'), value: t(`config_status.${snapshot.workspace_registry_status}`) }]}
                    />
                  </div>
                </SectionBlock>

                <SectionBlock eyebrow={t('system_info_data_plane_label')} title={t('system_info_data_plane_title')}>
                  <div className="grid gap-6 lg:grid-cols-2">
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
                </SectionBlock>
              </div>

              <div className="space-y-7">
                <SectionBlock eyebrow={t('system_info_attention_panel_label')} title={t('system_info_attention_panel_title')} dataTestId="system-info__attention">
                  {attentionItems.length > 0 ? (
                    <div className="divide-y divide-subtle border-y border-subtle">
                      {attentionItems.map((item) => (
                        <div key={item.title} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                          <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">{item.title}</p>
                            <p className="text-sm leading-6 text-secondary">{item.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 border-y border-subtle py-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">{t('system_info_all_clear_title')}</p>
                        <p className="text-sm leading-6 text-secondary">{t('system_info_all_clear_body')}</p>
                      </div>
                    </div>
                  )}
                </SectionBlock>

                <SectionBlock eyebrow={t('system_info_provisioning_label')} title={t('workspace_provisioning_title')}>
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-x-8 gap-y-3">
                      <InlineMetric label={t('workspace_ready_label')} value={String(provisioning.ready)} tone="default" />
                      <InlineMetric label={t('workspace_failed_label')} value={String(provisioning.failed)} tone={provisioning.failed > 0 ? 'warning' : 'default'} />
                      <InlineMetric label={t('workspace_draft_label')} value={String(provisioning.draft)} tone="default" />
                      <InlineMetric label={t('workspace_disabled_label')} value={String(provisioning.disabled)} tone="default" />
                    </div>
                    <div className="space-y-2 border-t border-subtle pt-3">
                      <TimelineRow label={t('workspace_last_initialized_label')} value={formatTimestamp(provisioning.last_initialized_at, locale)} />
                      <TimelineRow label={t('workspace_last_ready_label')} value={formatTimestamp(provisioning.last_ready_at, locale)} />
                      <TimelineRow label={t('workspace_last_failed_label')} value={formatTimestamp(provisioning.last_failed_at, locale)} />
                      <TimelineRow label={t('workspace_last_init_error_label')} value={provisioning.last_init_error || '-'} />
                    </div>
                    <p className="text-sm leading-6 text-tertiary" data-testid="system-info__notice">{t('info_notice')}</p>
                  </div>
                </SectionBlock>

                <SectionBlock eyebrow={t('system_info_next_steps_label')} title={t('system_info_next_steps_title')} dataTestId="system-info__next-steps">
                  <div className="divide-y divide-subtle border-y border-subtle">
                    {quickActions.map((action) => (
                      <Link key={action.href} href={action.href} className="group flex items-start justify-between gap-4 py-4 transition-colors hover:text-foreground">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">{action.title}</p>
                          <p className="text-sm leading-6 text-secondary">{action.body}</p>
                          <p className="pt-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent">{action.cta}</p>
                        </div>
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </Link>
                    ))}
                  </div>
                </SectionBlock>
              </div>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function SectionBlock({
  eyebrow,
  title,
  children,
  dataTestId,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  dataTestId?: string;
}) {
  return (
    <section className="border-t border-subtle pt-4" data-testid={dataTestId}>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{eyebrow}</p>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InlineMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'default' | 'positive' | 'warning';
}) {
  const toneClassName = tone === 'positive' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-foreground';

  return (
    <div className="min-w-[9rem] space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{label}</p>
      <p className={`text-base font-semibold ${toneClassName}`}>{value}</p>
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
    <div className="space-y-1 border-t border-subtle pt-3 first:border-t-0 first:pt-0">
      <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{label}</p>
      <p className={`text-sm font-medium ${tone === 'positive' ? 'text-success' : 'text-warning'}`}>{value}</p>
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
    <div className="space-y-3 border-t border-subtle pt-3 first:border-t-0 first:pt-0">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="divide-y divide-subtle">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <p className="max-w-[42%] text-[11px] uppercase tracking-[0.08em] text-tertiary">{row.label}</p>
            <code className="max-w-[58%] break-all text-right text-sm text-foreground">{row.value}</code>
          </div>
        ))}
      </div>
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
    <div className="flex items-start justify-between gap-3 border-b border-subtle py-2 first:pt-0 last:border-b-0 last:pb-0">
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
