'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';

export default function OverviewPage() {
  const params = useParams();
  const tNav = useTranslations('nav');
  const tGuide = useTranslations('use_guide');
  const tProject = useTranslations('project');
  const tErrors = useTranslations('errors');
  const canUseProject = useHasPermission('project:endpoint:use');
  const canManageGovernance = useHasPermission('project:governance:update');
  const canManageProject = useHasPermission('project:manage');
  const canManageAgents = useHasPermission('project:agent:manage');

  const workspaceId = validateWorkspaceParam(params.workspace);
  const projectId = validateProjectParam(params.project);
  const locale = (params.locale as string) || 'en-US';

  if (!workspaceId || !projectId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canUseProject) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  const workspaceBasePath = `/${locale}/workspaces/${workspaceId}`;
  const workLinks = [
    { label: tNav('chat'), href: `${basePath}/chat` },
    { label: tNav('notebook'), href: `${basePath}/notebook` },
    { label: tNav('files'), href: `${basePath}/files` },
    { label: tNav('endpoints'), href: `${basePath}/endpoints` },
    { label: tNav('usage'), href: `${basePath}/usage` },
    { label: tNav('audit'), href: `${basePath}/audit` },
    { label: tNav('api_access_guide'), href: `${basePath}/use-guide` },
  ];
  const governanceLinks = [
    ...(canManageAgents ? [{ label: tNav('agents'), href: `${basePath}/agents` }] : []),
    ...(canManageGovernance
      ? [
          { label: tNav('resource_policy'), href: `${basePath}/resource-policy` },
          { label: tNav('credentials'), href: `${basePath}/credentials` },
        ]
      : []),
    ...(canManageProject
      ? [
          { label: tNav('members'), href: `${basePath}/members` },
          { label: tNav('settings'), href: `${basePath}/settings` },
        ]
      : []),
  ];

  return (
    <PageState state="success">
      <PageLayout header={<PageHeader title={tNav('overview')} />}>
        <div className="space-y-4" data-testid="project-hub__page">
          <Link
            href={workspaceBasePath}
            className="inline-flex items-center gap-2 text-sm text-tertiary transition-colors hover:text-foreground"
            data-testid="project-hub__back-to-workspace"
          >
            <ArrowLeft className="h-4 w-4" />
            {tGuide('back_to_workspace')}
          </Link>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tGuide('quick_links.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4" data-testid="project-hub__quick-links">
              <section className="space-y-2" data-testid="project-hub__work-links">
                <h2 className="text-sm font-semibold text-foreground">{tProject('workspace_home_projects_title')}</h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {workLinks.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-sm border border-subtle px-3 py-2 text-sm text-foreground transition-colors hover:bg-hover"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </section>

              {governanceLinks.length > 0 ? (
                <section className="space-y-2" data-testid="project-hub__governance-links">
                  <h2 className="text-sm font-semibold text-foreground">{tProject('workspace_home_admin_title')}</h2>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {governanceLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="rounded-sm border border-subtle px-3 py-2 text-sm text-foreground transition-colors hover:bg-hover"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </PageState>
  );
}
