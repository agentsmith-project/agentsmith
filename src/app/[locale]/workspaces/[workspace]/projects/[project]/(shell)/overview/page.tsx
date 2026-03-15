'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ShieldCheck, Sparkles, Workflow, Wrench } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { useCanReadAudit, useCanReadProjectSettings, useHasPermission } from '@/lib/hooks/use-permissions';
import { OverviewLinkSection } from './_components/OverviewLinkSection';
import {
  buildGovernanceLinks,
  buildOverviewPaths,
  buildWorkLinks,
  createOverviewErrorContent,
} from './overview-page-utils';

export default function OverviewPage() {
  const params = useParams();
  const tNav = useTranslations('nav');
  const tOverview = useTranslations('overview');
  const tWorkspace = useTranslations('workspace');
  const tProjects = useTranslations('projects');
  const tErrors = useTranslations('errors');
  const canUseProject = useHasPermission('project:endpoint:use');
  const canReadAudit = useCanReadAudit();
  const canManageGovernance = useHasPermission('project:governance:update');
  const canManageMembership = useHasPermission('project:membership:update');
  const canReadProjectSettings = useCanReadProjectSettings();
  const canManageAgents = useHasPermission('project:agent:manage');

  const workspaceId = validateWorkspaceParam(params.workspace);
  const projectId = validateProjectParam(params.project);
  const locale = (params.locale as string) || 'en-US';

  if (!workspaceId || !projectId) {
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

  const { basePath, workspaceBasePath } = buildOverviewPaths(locale, workspaceId, projectId);
  const workLinks = buildWorkLinks(tNav, basePath);
  const governanceLinks = buildGovernanceLinks(tNav, basePath, {
    canManageAgents,
    canManageGovernance,
    canManageMembership,
    canReadAudit,
    canReadProjectSettings,
    canUseProject,
  });

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
            <CardContent className="space-y-6" data-testid="project-hub__quick-links">
              <div className="grid gap-3 md:grid-cols-3">
                <OverviewSummaryCard
                  icon={<Workflow className="h-4 w-4" />}
                  label={tWorkspace('workspace_home_projects_title')}
                  value={String(workLinks.length)}
                  helper={tOverview('subtitle')}
                />
                <OverviewSummaryCard
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label={tWorkspace('workspace_home_admin_title')}
                  value={String(governanceLinks.length)}
                  helper={governanceLinks.length > 0 ? tWorkspace('workspace_home_open_settings') : tErrors('permission_denied_hint')}
                />
                <OverviewSummaryCard
                  icon={<Wrench className="h-4 w-4" />}
                  label={tNav('overview')}
                  value={projectId}
                  helper={workspaceId}
                />
              </div>

              <OverviewLinkSection
                items={workLinks}
                testId="project-hub__work-links"
                title={tWorkspace('workspace_home_projects_title')}
              />

              {governanceLinks.length > 0 ? (
                <OverviewLinkSection
                  items={governanceLinks}
                  testId="project-hub__governance-links"
                  title={tWorkspace('workspace_home_admin_title')}
                />
              ) : null}
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
