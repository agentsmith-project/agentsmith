'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { useCurrentPermissions, useProjectOverviewCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { buildProjectSurfacePath, type ProjectSurfaceHref } from '@/lib/projects/project-surface-access';
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
          { href: `/${locale}/workspaces/overview`, label: tProjects('back_to_workspace') },
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
          { href: `/${locale}/workspaces/${workspaceId}`, label: tProjects('back_to_workspace') },
        )}
      </PageState>
    );
  }

  const { workspaceBasePath } = buildOverviewPaths(locale, workspaceId, projectId);
  const accessiblePolicies = listAccessibleSidebarProjectRoutePolicies(currentPermissions);
  const nextStepEntries = buildOverviewNextStepEntries(accessiblePolicies, tNav, tContextStore, tOverview);
  const nextStepHrefs = nextStepEntries.map((entry) => entry.href);
  const remainingSurfaceSummary = buildOverviewSurfaceSummary(
    accessiblePolicies,
    tNav,
    tContextStore,
    nextStepHrefs,
  );
  const noSurfaceLabel = tOverview('signals.not_available');

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

          <section className="space-y-6 border-t border-subtle pt-5" data-testid="project-hub__summary">
            <p className="type-body-ui max-w-3xl text-secondary">
              {tWorkspace('workspace_home_next_steps_description')}
            </p>

            <div className="space-y-3" data-testid="project-hub__next-steps">
              <p className="type-system-caption text-tertiary">{tWorkspace('workspace_home_next_steps_title')}</p>
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

            <div className="grid gap-5 md:grid-cols-3">
              <section data-testid="project-hub__use-summary">
                <OverviewSummaryList
                  items={remainingSurfaceSummary.useLabels}
                  title={tOverview('signals.execution_title')}
                  emptyLabel={noSurfaceLabel}
                  locale={locale}
                  workspaceId={workspaceId}
                  projectId={projectId}
                />
              </section>
              <section data-testid="project-hub__governance-summary">
                <OverviewSummaryList
                  items={remainingSurfaceSummary.governLabels}
                  title={tOverview('signals.governance_title')}
                  emptyLabel={noSurfaceLabel}
                  locale={locale}
                  workspaceId={workspaceId}
                  projectId={projectId}
                />
              </section>
              <section data-testid="project-hub__develop-summary">
                <OverviewSummaryList
                  items={remainingSurfaceSummary.developLabels}
                  title={tOverview('signals.develop_title')}
                  emptyLabel={noSurfaceLabel}
                  locale={locale}
                  workspaceId={workspaceId}
                  projectId={projectId}
                />
              </section>
            </div>
          </section>
        </div>
      </PageLayout>
    </PageState>
  );
}

function OverviewSummaryList({
  items,
  title,
  emptyLabel,
  locale,
  workspaceId,
  projectId,
}: {
  items: Array<{ href: ProjectSurfaceHref; label: string }>;
  title: string;
  emptyLabel: string;
  locale: string;
  workspaceId: string;
  projectId: string;
}) {
  return (
    <div className="space-y-3">
      <div className="type-system-caption text-tertiary">{title}</div>
      {items.length > 0 ? (
        <ul className="divide-y divide-subtle">
          {items.map((item) => (
            <li key={item.href} className="px-0 py-3 text-sm text-secondary">
              <Link
                href={buildProjectSurfacePath(locale, workspaceId, projectId, item.href)}
                className="inline-flex max-w-full items-center text-sm text-secondary transition-colors hover:text-foreground"
              >
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-tertiary">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}
