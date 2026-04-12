'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Bot, ShieldCheck, Workflow } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
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
      <PageLayout header={<PageHeader title={tNav('overview')} subtitle={tOverview('subtitle')} />}>
        <div className="space-y-5" data-testid="project-hub__page">
          <Link
            href={workspaceBasePath}
            className="inline-flex items-center gap-2 text-sm text-tertiary transition-colors hover:text-foreground"
            data-testid="project-hub__back-to-workspace"
          >
            <ArrowLeft className="h-4 w-4" />
            {tProjects('back_to_workspace')}
          </Link>

          <section className="border-b border-subtle pb-6" data-testid="project-hub__summary">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:items-start">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <p className="type-caption text-tertiary">{tOverview('title')}</p>
                  <p className="type-body-ui max-w-3xl text-secondary">
                    {tWorkspace('workspace_home_next_steps_description')}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <OverviewSignalCard
                    icon={<Workflow className="h-4 w-4" />}
                    label={tOverview('signals.execution_title')}
                    value={tOverview('signals.ready')}
                    helper={useSummary}
                  />
                  <OverviewSignalCard
                    icon={<ShieldCheck className="h-4 w-4" />}
                    label={tOverview('signals.governance_title')}
                    value={governanceReadiness ? tOverview('signals.available') : tOverview('signals.limited')}
                    helper={governSummary}
                  />
                  <OverviewSignalCard
                    icon={<Bot className="h-4 w-4" />}
                    label={tOverview('signals.develop_title')}
                    value={developReadiness ? tOverview('signals.available') : tOverview('signals.not_available')}
                    helper={developSummary}
                  />
                </div>
              </div>

              <div className="space-y-3" data-testid="project-hub__next-steps">
                <div className="space-y-1">
                  <p className="type-system-caption text-tertiary">{tWorkspace('workspace_home_next_steps_title')}</p>
                  <p className="type-body-ui text-secondary">{tWorkspace('workspace_home_next_steps_description')}</p>
                </div>
                <div className="divide-y divide-subtle border-y border-subtle">
                  {nextStepEntries.map((entry, index) => (
                    <Link
                      key={entry.href}
                      href={buildProjectSurfacePath(locale, workspaceId, projectId, entry.href)}
                      className="group flex items-start justify-between gap-4 px-0 py-4 transition-colors hover:text-foreground"
                      data-testid={entry.testId}
                    >
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                          {index === 0 ? tOverview('next_steps_primary_badge') : tOverview('next_steps_secondary_badge')}
                        </div>
                        <div className="type-system-heading text-[1rem] font-semibold text-foreground">{entry.label}</div>
                        <p className="text-sm leading-6 text-secondary">{entry.description}</p>
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-icon-default transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.9fr)]">
            <section className="border-t border-subtle pt-5" data-testid="project-hub__use-summary">
              <OverviewSummaryList
                items={surfaceSummary.useLabels}
                title={tOverview('signals.execution_title')}
              />
            </section>

            <div className="space-y-5">
              <section className="border-t border-subtle pt-5" data-testid="project-hub__governance-summary">
                <OverviewSummaryList
                  items={surfaceSummary.governLabels}
                  title={tOverview('signals.governance_title')}
                />
              </section>
              <section className="border-t border-subtle pt-5" data-testid="project-hub__develop-summary">
                <OverviewSummaryList
                  items={surfaceSummary.developLabels}
                  title={tOverview('signals.develop_title')}
                />
              </section>
            </div>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function OverviewSignalCard({
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
    <div className="space-y-1 border-l border-subtle pl-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
        {icon}
        {label}
      </div>
      <div className="text-base font-semibold text-foreground">{value}</div>
      <div className="text-sm leading-6 text-secondary">{helper}</div>
    </div>
  );
}

function OverviewSummaryList({
  items,
  title,
}: {
  items: string[];
  title: string;
}) {
  return (
    <div className="space-y-3">
      <div className="type-system-caption text-tertiary">{title}</div>
      {items.length > 0 ? (
        <ul className="divide-y divide-subtle">
          {items.map((item) => (
            <li
              key={item}
              className="px-0 py-3 text-sm text-secondary"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-tertiary">
          {title}
        </div>
      )}
    </div>
  );
}
