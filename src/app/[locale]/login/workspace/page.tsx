'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, FolderKanban } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { StatusBadge } from '@/components/ui/status-badge';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { useOrganizationGovernanceRollup } from '@/lib/hooks/use-organization-governance-rollup';
import { useAuthStore } from '@/lib/stores/authStore';
import { APIError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function WorkspaceSelectPage() {
  const router = useRouter();
  const params = useParams();
  const t = useTranslations('auth');
  const locale = (params?.locale as string) || 'en-US';
  const { clearAuth } = useAuthStore();
  const {
    data: workspaces,
    isLoading,
    isError,
    error,
    refetch,
  } = useWorkspaces();
  const organizationGovernance = useOrganizationGovernanceRollup(workspaces);

  const isUnauthorized = isError && error instanceof APIError && error.statusCode === 401;

  const handleWorkspaceSelect = (workspaceId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects`);
  };

  const handleReLogin = useCallback(() => {
    clearAuth();
    router.replace(`/${locale}/login`);
  }, [clearAuth, locale, router]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-8">
          <div className="max-w-4xl mx-auto">
            <h1 data-testid="workspace-select__heading" className="text-2xl font-semibold text-foreground mb-2">
              {t('select_your_workspace')}
            </h1>
            <p className="text-tertiary mb-8">
              {t('choose_workspace')}
            </p>

            {isLoading ? (
              <p className="text-sm text-tertiary" data-testid="workspace-select__loading">{t('loading_workspaces')}</p>
            ) : isUnauthorized ? (
              <div
                className="max-w-xl rounded-md border border-error/40 bg-surface p-4 space-y-3"
                data-testid="workspace-select__session-expired"
              >
                <p className="text-sm font-medium text-foreground">{t('workspace_session_expired_title')}</p>
                <p className="text-sm text-tertiary">{t('workspace_session_expired_description')}</p>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="action" onClick={handleReLogin} data-testid="workspace-select__relogin-btn">
                    {t('workspace_session_expired_relogin')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => refetch()} data-testid="workspace-select__retry-btn">
                    {t('workspace_retry')}
                  </Button>
                </div>
              </div>
            ) : isError ? (
              <div className="max-w-xl rounded-md border border-subtle bg-surface p-4 space-y-3" data-testid="workspace-select__error">
                <p className="text-sm font-medium text-foreground">{t('workspace_load_failed_title')}</p>
                <p className="text-sm text-tertiary">{t('workspace_load_failed_description')}</p>
                <Button type="button" variant="outline" onClick={() => refetch()} data-testid="workspace-select__retry-btn">
                  {t('workspace_retry')}
                </Button>
              </div>
            ) : (workspaces ?? []).length === 0 ? (
              <div className="max-w-xl rounded-md border border-subtle bg-surface p-4 space-y-2" data-testid="workspace-select__empty">
                <p className="text-sm font-medium text-foreground">{t('workspace_empty_title')}</p>
                <p className="text-sm text-tertiary">{t('workspace_empty_description')}</p>
                <Button type="button" variant="outline" onClick={handleReLogin} data-testid="workspace-select__back-login-btn">
                  {t('keycloak_back_to_login')}
                </Button>
              </div>
            ) : (
              <div className="space-y-6">
                <OrganizationGovernanceOverview
                  locale={locale}
                  isLoading={organizationGovernance.isLoading}
                  isError={organizationGovernance.isError}
                  onRefresh={organizationGovernance.refetch}
                  rollup={organizationGovernance.rollup}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {workspaces?.map(workspace => (
                    <WorkspaceCard
                      key={workspace.id}
                      workspace={workspace}
                      onSelect={() => handleWorkspaceSelect(workspace.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

interface WorkspaceCardProps {
  workspace: { id: string; name: string };
  onSelect: () => void;
}

function WorkspaceCard({ workspace, onSelect }: WorkspaceCardProps) {
  const t = useTranslations('auth');
  return (
    <div
      data-testid={`workspace-select__card--${workspace.id}`}
      onClick={onSelect}
      className="relative group bg-surface border border-border rounded-md p-6 transition-colors duration-200 hover:bg-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 rounded-sm bg-surface-high flex items-center justify-center">
          <Building2 className="w-6 h-6 text-icon-default" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">{workspace.name}</h3>
          <p className="text-sm text-tertiary">{workspace.id}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-tertiary">
        <span className="flex items-center gap-1">
          <FolderKanban className="w-4 h-4" />
          {t('projects_count', { count: 0 })}
        </span>
      </div>
    </div>
  );
}

interface OrganizationGovernanceOverviewProps {
  locale: string;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => Promise<void>;
  rollup: ReturnType<typeof useOrganizationGovernanceRollup>['rollup'];
}

function OrganizationGovernanceOverview(props: OrganizationGovernanceOverviewProps) {
  const t = useTranslations('auth');

  if (props.isLoading) {
    return (
      <div className="rounded-md border border-subtle bg-surface p-4" data-testid="workspace-select__org-governance-loading">
        <p className="text-sm text-tertiary">{t('org_governance_loading')}</p>
      </div>
    );
  }

  if (props.isError) {
    return (
      <div className="rounded-md border border-warning/30 bg-surface p-4" data-testid="workspace-select__org-governance-error">
        <p className="text-sm font-medium text-foreground">{t('org_governance_error_title')}</p>
        <p className="mt-1 text-sm text-tertiary">{t('org_governance_error_description')}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => void props.onRefresh()}
          data-testid="workspace-select__org-governance-retry"
        >
          {t('workspace_retry')}
        </Button>
      </div>
    );
  }

  if (!props.rollup) {
    return null;
  }

  return (
    <section className="rounded-md border border-border bg-surface p-4 md:p-5" data-testid="workspace-select__org-governance-overview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('org_governance_eyebrow')}</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{t('org_governance_title')}</h2>
          <p className="mt-1 text-sm text-tertiary">{t('org_governance_subtitle')}</p>
        </div>
        <StatusBadge status={props.rollup.summary.readiness}>
          {t(`org_governance_status_${props.rollup.summary.readiness}`)}
        </StatusBadge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric label={t('org_governance_metric_workspaces')} value={props.rollup.summary.totalWorkspaces} />
        <SummaryMetric label={t('org_governance_metric_risky_workspaces')} value={props.rollup.summary.riskyWorkspaces} />
        <SummaryMetric label={t('org_governance_metric_blocked_workspaces')} value={props.rollup.summary.blockedWorkspaces} />
        <SummaryMetric label={t('org_governance_metric_risky_projects')} value={props.rollup.summary.totalRiskyProjects} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="rounded-md border border-subtle bg-bg-base/20 p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('org_governance_workspace_ranking')}</p>
          <div className="mt-2 space-y-2">
            {props.rollup.workspaceRanking.slice(0, 5).map((workspace) => (
              <div
                key={workspace.workspaceId}
                className="flex items-center justify-between gap-3 rounded-sm border border-subtle bg-surface px-3 py-2"
                data-testid={`workspace-select__org-governance-rank--${workspace.workspaceId}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{workspace.workspaceName}</p>
                  <p className="text-xs text-tertiary">
                    {t('org_governance_workspace_risk_meta', {
                      blocked: workspace.blockedItems,
                      warning: workspace.warningItems,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={workspace.readiness}>{t(`org_governance_status_${workspace.readiness}`)}</StatusBadge>
                  <Link
                    href={`/${props.locale}/workspaces/${workspace.workspaceId}/settings`}
                    className={cn(
                      'inline-flex h-8 items-center rounded-sm border border-subtle px-2.5 text-xs font-medium text-foreground transition-colors',
                      'hover:bg-hover',
                    )}
                    data-testid={`workspace-select__org-governance-open-settings--${workspace.workspaceId}`}
                  >
                    {t('org_governance_open_workspace')}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-subtle bg-bg-base/20 p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('org_governance_attention_feed')}</p>
          {props.rollup.attention.length === 0 ? (
            <p className="mt-3 text-sm text-tertiary">{t('org_governance_attention_empty')}</p>
          ) : (
            <div className="mt-2 space-y-2">
              {props.rollup.attention.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="rounded-sm border border-subtle bg-surface px-3 py-2"
                  data-testid={`workspace-select__org-governance-attention--${item.id.replace(':', '--')}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{item.workspaceName}</p>
                    <StatusBadge status={item.severity}>{t(`org_governance_status_${item.severity}`)}</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-tertiary">{item.title}</p>
                  {item.projectId ? (
                    <Link
                      href={`/${props.locale}/workspaces/${item.workspaceId}/projects/${item.projectId}/audit`}
                      className={cn(
                        'mt-2 inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                        'hover:bg-hover',
                      )}
                      data-testid={`workspace-select__org-governance-open-audit--${item.id.replace(':', '--')}`}
                    >
                      {t('org_governance_open_project_audit')}
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-subtle bg-bg-base/20 p-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
