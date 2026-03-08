'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const tErrors = useTranslations('errors');
  const canUseProject = useHasPermission('project:endpoint:use');

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
  const quickLinks = [
    { label: tNav('chat'), href: `${basePath}/chat` },
    { label: tNav('notebook'), href: `${basePath}/notebook` },
    { label: tNav('files'), href: `${basePath}/files` },
    { label: tNav('endpoints'), href: `${basePath}/endpoints` },
    { label: tNav('resource_policy'), href: `${basePath}/resource-policy` },
    { label: tNav('usage'), href: `${basePath}/usage` },
    { label: tNav('audit'), href: `${basePath}/audit` },
    { label: tNav('api_access_guide'), href: `${basePath}/use-guide` },
  ];

  return (
    <PageState state="success">
      <PageLayout header={<PageHeader title={tNav('overview')} subtitle={tGuide('subtitle')} />}>
        <div className="space-y-4" data-testid="project-hub__page">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tGuide('quick_links.title')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="project-hub__quick-links">
              {quickLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-sm border border-subtle px-3 py-2 text-sm text-foreground transition-colors hover:bg-hover"
                >
                  {item.label}
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tGuide('steps.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-tertiary" data-testid="project-hub__getting-started">
              <p>{tGuide('steps.step_1')}</p>
              <p>{tGuide('steps.step_2')}</p>
              <p>{tGuide('steps.step_3')}</p>
              <p>{tGuide('steps.step_4')}</p>
              <p>{tGuide('steps.step_5')}</p>
              <p>{tGuide('steps.step_6')}</p>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </PageState>
  );
}
