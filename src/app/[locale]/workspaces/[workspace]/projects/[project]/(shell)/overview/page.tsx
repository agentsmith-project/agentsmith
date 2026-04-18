'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { useCurrentPermissions, useProjectOverviewCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { buildProjectSurfacePath, type ProjectSurfaceHref } from '@/lib/projects/project-surface-access';
import {
  buildOverviewPaths,
  buildOverviewSurfaceSummary,
  buildOverviewNextStepEntries,
  createOverviewErrorContent,
  splitOverviewPrimaryStep,
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
  const { primaryStep, secondarySteps } = splitOverviewPrimaryStep(nextStepEntries);
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
      <PageLayout
        header={(
          <PageHeader
            title={tNav('overview')}
            subtitle={tOverview('subtitle')}
            actions={primaryStep ? (
              <Button asChild variant="primary">
                <Link
                  href={buildProjectSurfacePath(locale, workspaceId, projectId, primaryStep.href)}
                  data-testid="project-overview__primary-cta"
                >
                  {tOverview('next_steps.open')} {primaryStep.label}
                </Link>
              </Button>
            ) : null}
          />
        )}
      >
        <div className="space-y-6" data-testid="project-overview__page">
          <Link
            href={workspaceBasePath}
            className="inline-flex items-center gap-2 text-sm text-tertiary transition-colors hover:text-foreground"
            data-testid="project-overview__back-to-workspace"
          >
            <ArrowLeft className="h-4 w-4" />
            {tProjects('back_to_workspace')}
          </Link>

          <section className="grid gap-8 border-t border-subtle pt-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)] xl:items-start">
            <div className="space-y-8">
              {primaryStep ? (
                <section className="space-y-4" data-testid="project-overview__primary-task">
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                      {tOverview('next_steps.primary_badge')}
                    </p>
                    <div className="space-y-3">
                      <h2 className="type-section-heading text-foreground">{primaryStep.label}</h2>
                      <p className="type-body-ui max-w-2xl text-secondary">{primaryStep.description}</p>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="space-y-3" data-testid="project-overview__primary-task">
                  <p className="type-system-caption text-tertiary">{tWorkspace('workspace_home_next_steps_title')}</p>
                  <p className="type-body-ui max-w-2xl text-secondary">{tWorkspace('workspace_home_next_steps_description')}</p>
                </section>
              )}

              {secondarySteps.length > 0 ? (
                <section className="space-y-3" data-testid="project-overview__secondary-steps">
                  <p className="type-system-caption text-tertiary">{tWorkspace('workspace_home_next_steps_title')}</p>
                  <div className="divide-y divide-subtle border-y border-subtle">
                    {secondarySteps.map((entry, index) => (
                      <Link
                        key={entry.href}
                        href={buildProjectSurfacePath(locale, workspaceId, projectId, entry.href)}
                        className="group flex items-start justify-between gap-4 px-0 py-4 transition-colors hover:text-foreground"
                        data-testid={`project-overview__secondary-step--${entry.href}`}
                      >
                        <div className="space-y-1">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                            {tOverview('next_steps.secondary_badge')} {index + 1}
                          </div>
                          <div className="type-system-heading text-[1rem] font-semibold text-foreground">{entry.label}</div>
                          <p className="text-sm leading-6 text-secondary">{entry.description}</p>
                        </div>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-icon-default transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <aside
              className="space-y-5 border-t border-subtle pt-5 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0"
              data-testid="project-overview__available-surfaces"
            >
              <OverviewSurfaceGroup
                items={remainingSurfaceSummary.useLabels}
                title={tOverview('signals.execution_title')}
                emptyLabel={noSurfaceLabel}
                locale={locale}
                workspaceId={workspaceId}
                projectId={projectId}
                testId="project-overview__surface-group--use"
              />
              <OverviewSurfaceGroup
                items={remainingSurfaceSummary.governLabels}
                title={tOverview('signals.governance_title')}
                emptyLabel={noSurfaceLabel}
                locale={locale}
                workspaceId={workspaceId}
                projectId={projectId}
                testId="project-overview__surface-group--govern"
              />
              <OverviewSurfaceGroup
                items={remainingSurfaceSummary.developLabels}
                title={tOverview('signals.develop_title')}
                emptyLabel={noSurfaceLabel}
                locale={locale}
                workspaceId={workspaceId}
                projectId={projectId}
                testId="project-overview__surface-group--develop"
              />
            </aside>
          </section>
        </div>
      </PageLayout>
    </PageState>
  );
}

function OverviewSurfaceGroup({
  items,
  title,
  emptyLabel,
  locale,
  workspaceId,
  projectId,
  testId,
}: {
  items: Array<{ href: ProjectSurfaceHref; label: string }>;
  title: string;
  emptyLabel: string;
  locale: string;
  workspaceId: string;
  projectId: string;
  testId: string;
}) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <h3 className="type-system-caption text-tertiary">{title}</h3>
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
    </section>
  );
}
