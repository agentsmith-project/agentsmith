'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Sparkles } from 'lucide-react';
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
  const tGuide = useTranslations('use_guide');
  const tProject = useTranslations('project');
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
            {tGuide('back_to_workspace')}
          </Link>

          <Card className="overflow-hidden">
            <CardContent className="border-b border-white/6 bg-[linear-gradient(180deg,rgba(124,160,255,0.10),rgba(124,160,255,0.02))] p-6 md:p-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                <Sparkles className="h-3.5 w-3.5" />
                Project Hub
              </div>
              <p className="mt-4 max-w-3xl text-sm text-secondary md:text-[15px]">
                {tGuide('subtitle')}
              </p>
            </CardContent>
            <CardHeader>
              <CardTitle className="text-lg">{tGuide('quick_links.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6" data-testid="project-hub__quick-links">
              <OverviewLinkSection
                items={workLinks}
                testId="project-hub__work-links"
                title={tProject('workspace_home_projects_title')}
              />

              {governanceLinks.length > 0 ? (
              <OverviewLinkSection
                items={governanceLinks}
                testId="project-hub__governance-links"
                title={tProject('workspace_home_admin_title')}
              />
              ) : null}
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </PageState>
  );
}
