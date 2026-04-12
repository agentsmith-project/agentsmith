'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Bot, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentPermissions, useProjectOverviewCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { buildProjectSurfacePath } from '@/lib/projects/project-surface-access';
import {
  buildOverviewPaths,
  buildOverviewSurfaceSummary,
  buildOverviewNextStepEntries,
  createOverviewErrorContent,
} from './overview-page-utils';
import { listAccessibleSidebarProjectRoutePolicies } from '@/lib/projects/project-surface-access';

interface OverviewPageProps {
  params?: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function OverviewPage({ params }: OverviewPageProps) {
  const routeParams = useParams();
  const paramsPromise = useMemo(() => (
    params
    ?? Promise.resolve({
      workspace: String(routeParams.workspace ?? ''),
      project: String(routeParams.project ?? ''),
      locale: String(routeParams.locale ?? 'en-US'),
    })
  ), [params, routeParams.locale, routeParams.project, routeParams.workspace]);
  const resolvedParams = useResolvedProjectRoute(paramsPromise);
  const tNav = useTranslations('nav');
  const tOverview = useTranslations('overview');
  const tWorkspace = useTranslations('workspace');
  const tContextStore = useTranslations('context_store');
  const tProjects = useTranslations('projects');
  const tErrors = useTranslations('errors');
  const currentPermissions = useCurrentPermissions();
  const {
    canUseProject,
  } = useProjectOverviewCapabilities();
  const workspaceId = resolvedParams.workspace;
  const projectId = resolvedParams.project;
  const locale = resolvedParams.locale;

  if (!resolvedParams.isReady) {
    return <PageState state="loading" />;
  }

  if (!resolvedParams.isValid || !workspaceId || !projectId) {
    return (
      <PageState state="error">
        {createOverviewErrorContent(
          tErrors('validation_error'),
          tErrors('badRequest.description'),
        )}
      </PageState>
    );
  }

  if (!canUseProject) {
    return (
      <PageState state="error">
        {createOverviewErrorContent(
          tErrors('permission_denied_title'),
          tErrors('permission_denied_hint'),
        )}
      </PageState>
    );
  }

  const { workspaceBasePath } = buildOverviewPaths(locale, workspaceId, projectId);
  const accessiblePolicies = listAccessibleSidebarProjectRoutePolicies(currentPermissions);
  const surfaceSummary = buildOverviewSurfaceSummary(accessiblePolicies, tNav, tContextStore);
  const nextStepEntries = buildOverviewNextStepEntries(accessiblePolicies, tNav, tContextStore, tOverview);
  const governanceReadiness = surfaceSummary.governLabels.length > 0;
  const developReadiness = surfaceSummary.developLabels.length > 0;
  const useSummary = surfaceSummary.useLabels.length > 0
    ? surfaceSummary.useLabels.join(', ')
    : tOverview('signals.not_available');
  const developSummary = surfaceSummary.developLabels.length > 0
    ? surfaceSummary.developLabels.join(', ')
    : tOverview('signals.not_available');
  const governSummary = surfaceSummary.governLabels.length > 0
    ? surfaceSummary.governLabels.join(', ')
    : tOverview('signals.not_available');

  return (
    <PageState state="success">
      <PageLayout header={<PageHeader title={tNav('overview')} />}>
        <div className="space-y-5" data-testid="project-hub__page">
          <Link
            href={workspaceBasePath}
            className="inline-flex items-center gap-2 text-sm text-tertiary transition-colors hover:text-foreground"
            data-testid="project-hub__back-to-workspace"
          >
            <ArrowLeft className="h-4 w-4" />
            {tProjects('back_to_workspace')}
          </Link>

          <Card className="overflow-hidden">
            <CardContent className="border-b border-white/6 bg-[linear-gradient(180deg,rgba(124,160,255,0.10),rgba(124,160,255,0.02))] p-6 md:p-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                <Sparkles className="h-3.5 w-3.5" />
                {tNav('overview')}
              </div>
              <p className="mt-4 max-w-3xl text-sm text-secondary md:text-[15px]">
                {tOverview('subtitle')}
              </p>
            </CardContent>
            <CardHeader className="space-y-2">
              <CardTitle className="text-lg">{tOverview('title')}</CardTitle>
              <p className="max-w-2xl text-sm text-secondary">
                {tWorkspace('workspace_home_next_steps_description')}
              </p>
            </CardHeader>
            <CardContent className="space-y-6" data-testid="project-hub__summary">
              <div className="space-y-3" data-testid="project-hub__next-steps">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-foreground">{tWorkspace('workspace_home_next_steps_title')}</div>
                    <p className="text-sm text-secondary">{tWorkspace('workspace_home_next_steps_description')}</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {nextStepEntries.map((entry, index) => (
                    <Link
                      key={entry.href}
                      href={buildProjectSurfacePath(locale, workspaceId, projectId, entry.href)}
                      className="group rounded-[18px] border border-white/6 bg-white/[0.03] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.12)] transition-colors hover:border-accent/30 hover:bg-white/[0.05]"
                      data-testid={entry.testId}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
                            {index === 0 ? tOverview('next_steps_primary_badge') : tOverview('next_steps_secondary_badge')}
                          </div>
                          <div className="mt-2 text-base font-semibold text-foreground">{entry.label}</div>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-secondary">{entry.description}</p>
                      <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent transition-transform group-hover:translate-x-0.5">
                        {tOverview('next_steps_open')}
                        <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <OverviewSummaryCard
                  icon={<Workflow className="h-4 w-4" />}
                  label={tOverview('signals.execution_title')}
                  value={tOverview('signals.ready')}
                  helper={useSummary}
                />
                <OverviewSummaryCard
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label={tOverview('signals.governance_title')}
                  value={governanceReadiness ? tOverview('signals.available') : tOverview('signals.limited')}
                  helper={governSummary}
                />
                <OverviewSummaryCard
                  icon={<Bot className="h-4 w-4" />}
                  label={tOverview('signals.develop_title')}
                  value={developReadiness ? tOverview('signals.available') : tOverview('signals.not_available')}
                  helper={developSummary}
                />
              </div>

              <OverviewSummaryList
                items={surfaceSummary.useLabels}
                testId="project-hub__use-summary"
                title={tOverview('signals.execution_title')}
              />

              <OverviewSummaryList
                items={surfaceSummary.governLabels}
                testId="project-hub__governance-summary"
                title={tOverview('signals.governance_title')}
              />

              <OverviewSummaryList
                items={surfaceSummary.developLabels}
                testId="project-hub__develop-summary"
                title={tOverview('signals.develop_title')}
              />
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </PageState>
  );
}

function OverviewSummaryCard({
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
    <div className="rounded-[18px] border border-white/6 bg-white/[0.03] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.12)]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
        {icon}
        {label}
      </div>
      <div className="mt-3 text-lg font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-sm text-secondary">{helper}</div>
    </div>
  );
}

function OverviewSummaryList({
  items,
  testId,
  title,
}: {
  items: string[];
  testId: string;
  title: string;
}) {
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={item}
              className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-xs text-secondary"
            >
              {item}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-white/8 bg-white/[0.02] px-4 py-3 text-sm text-tertiary">
          {title}
        </div>
      )}
    </div>
  );
}
