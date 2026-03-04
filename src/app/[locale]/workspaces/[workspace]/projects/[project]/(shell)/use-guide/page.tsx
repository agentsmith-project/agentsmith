'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';

interface UseGuidePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UseGuidePage({ params }: UseGuidePageProps) {
  const t = useTranslations('use_guide');
  const tErrors = useTranslations('errors');
  const canUseProject = useHasPermission('project:endpoint:use');
  const [resolvedParams, setResolvedParams] = useState<{
    workspace?: string;
    project?: string;
    locale?: string;
  } | null>(null);

  useEffect(() => {
    params.then((p) =>
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        locale: p.locale,
      }),
    );
  }, [params]);

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  const workspaceId = resolvedParams.workspace ?? '';
  const projectId = resolvedParams.project ?? '';
  const locale = resolvedParams.locale ?? 'en-US';

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

  const endpointProxyBase = `http://localhost:20000/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints/{endpoint_id}/proxy`;

  const codexSample = `export OPENAI_BASE_URL=${endpointProxyBase}\nexport OPENAI_API_KEY=<YOUR_PERSONAL_API_KEY>\n\ncodex --model <endpoint-model-name>`;
  const claudeSample = `export ANTHROPIC_BASE_URL=${endpointProxyBase}\nexport ANTHROPIC_API_KEY=<YOUR_PERSONAL_API_KEY>\n\nclaude --model <endpoint-model-name>`;

  return (
    <PageState state="success">
      <PageLayout
        header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}
      >
        <div className="space-y-4" data-testid="use-guide__page">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('steps.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-tertiary">
              <p>{t('steps.step_1')}</p>
              <p>{t('steps.step_2')}</p>
              <p>{t('steps.step_3')}</p>
              <p>{t('steps.step_4')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('codex.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md border border-subtle bg-bg-base/40 p-3 text-xs text-foreground" data-testid="use-guide__codex-sample">
                {codexSample}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('claude.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md border border-subtle bg-bg-base/40 p-3 text-xs text-foreground" data-testid="use-guide__claude-sample">
                {claudeSample}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('quick_links.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3 text-sm">
              <Link href={`/${locale}/user/api-keys`} className="text-accent hover:underline" data-testid="use-guide__link-api-keys">
                {t('quick_links.api_keys')}
              </Link>
              <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/endpoints`} className="text-accent hover:underline" data-testid="use-guide__link-endpoints">
                {t('quick_links.endpoints')}
              </Link>
              <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage`} className="text-accent hover:underline" data-testid="use-guide__link-usage">
                {t('quick_links.usage')}
              </Link>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </PageState>
  );
}
