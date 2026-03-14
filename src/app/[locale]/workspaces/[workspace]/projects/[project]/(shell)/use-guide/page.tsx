'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BookOpen, KeySquare, Waypoints } from 'lucide-react';
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
    params.then((p) => {
      const nextParams = {
        workspace: validateWorkspaceParam(p.workspace),
        project: validateProjectParam(p.project),
        locale: p.locale,
      };
      setResolvedParams((previous) =>
        previous &&
        previous.workspace === nextParams.workspace &&
        previous.project === nextParams.project &&
        previous.locale === nextParams.locale
          ? previous
          : nextParams,
      );
    });
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

  const gatewayBaseUrl = `http://localhost:20000/api/v1/workspaces/${workspaceId}/projects/${projectId}/llm-gateway`;

  const claudeEnvSample = `export ANTHROPIC_BASE_URL=${gatewayBaseUrl}\nexport ANTHROPIC_AUTH_TOKEN=<YOUR_PERSONAL_API_KEY>\nexport ANTHROPIC_DEFAULT_HAIKU_MODEL=<project-model-name>\nexport ANTHROPIC_DEFAULT_SONNET_MODEL=<project-model-name>\nexport ANTHROPIC_DEFAULT_OPUS_MODEL=<project-model-name>\nexport CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\nexport CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`;

  const claudeJsonSample = `{
  "env": {
    "ANTHROPIC_BASE_URL": "${gatewayBaseUrl}",
    "ANTHROPIC_AUTH_TOKEN": "<YOUR_PERSONAL_API_KEY>",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "<project-model-name>",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "<project-model-name>",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "<project-model-name>",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1"
  }
}`;

  const codexSample = `export OPENAI_BASE_URL=${gatewayBaseUrl}\nexport OPENAI_API_KEY=<YOUR_PERSONAL_API_KEY>\n\ncodex --model <project-model-name>`;

  const openAiCompletionCurl = `curl ${gatewayBaseUrl}/chat/completions \\
  -H "Authorization: Bearer <YOUR_PERSONAL_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<project-model-name>",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": false
  }'`;

  const openAiResponsesCurl = `curl ${gatewayBaseUrl}/responses \\
  -H "Authorization: Bearer <YOUR_PERSONAL_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<project-model-name>",
    "input": "hello"
  }'`;

  const anthropicCurl = `curl ${gatewayBaseUrl}/messages \\
  -H "Authorization: Bearer <YOUR_PERSONAL_API_KEY>" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<project-model-name>",
    "max_tokens": 512,
    "messages": [{"role": "user", "content": [{"type": "text", "text": "hello"}]}]
  }'`;

  return (
    <PageState state="success">
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <div className="space-y-4" data-testid="use-guide__page">
          <div className="grid gap-3 md:grid-cols-3">
            <UseGuideSummaryCard
              icon={<BookOpen className="h-4 w-4" />}
              label={t('steps.title')}
              value={t('quick_links.title')}
              helper={t('subtitle')}
            />
            <UseGuideSummaryCard
              icon={<Waypoints className="h-4 w-4" />}
              label={t('gateway.title')}
              value={gatewayBaseUrl}
              helper={t('gateway.description')}
            />
            <UseGuideSummaryCard
              icon={<KeySquare className="h-4 w-4" />}
              label={t('quick_links.api_keys')}
              value={t('claude.title')}
              helper={t('codex.title')}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('steps.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-tertiary">
              <p>{t('steps.step_1')}</p>
              <p>{t('steps.step_2')}</p>
              <p>{t('steps.step_3')}</p>
              <p>{t('steps.step_4')}</p>
              <p>{t('steps.step_5')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('gateway.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-tertiary">
              <p>{t('gateway.description')}</p>
              <pre className="overflow-x-auto rounded-md border border-subtle bg-bg-base/40 p-3 text-xs text-foreground" data-testid="use-guide__gateway-base-url">
                {gatewayBaseUrl}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('claude.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <pre className="overflow-x-auto rounded-md border border-subtle bg-bg-base/40 p-3 text-xs text-foreground" data-testid="use-guide__claude-sample">
                {claudeEnvSample}
              </pre>
              <pre className="overflow-x-auto rounded-md border border-subtle bg-bg-base/40 p-3 text-xs text-foreground" data-testid="use-guide__claude-json-sample">
                {claudeJsonSample}
              </pre>
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
              <CardTitle className="text-base">{t('api_examples.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <pre className="overflow-x-auto rounded-md border border-subtle bg-bg-base/40 p-3 text-xs text-foreground" data-testid="use-guide__openai-chat-curl">
                {openAiCompletionCurl}
              </pre>
              <pre className="overflow-x-auto rounded-md border border-subtle bg-bg-base/40 p-3 text-xs text-foreground" data-testid="use-guide__openai-responses-curl">
                {openAiResponsesCurl}
              </pre>
              <pre className="overflow-x-auto rounded-md border border-subtle bg-bg-base/40 p-3 text-xs text-foreground" data-testid="use-guide__anthropic-curl">
                {anthropicCurl}
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
              <Link href={`/${locale}/user/third-party-accounts`} className="text-accent hover:underline" data-testid="use-guide__link-third-party-accounts">
                {t('quick_links.third_party_accounts')}
              </Link>
              <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/endpoints`} className="text-accent hover:underline" data-testid="use-guide__link-endpoints">
                {t('quick_links.endpoints')}
              </Link>
              <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/resource-policy`} className="text-accent hover:underline" data-testid="use-guide__link-resource-policy">
                {t('quick_links.resource_policy')}
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

function UseGuideSummaryCard({
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
      <div className="mt-3 break-all text-sm font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-secondary">{helper}</div>
    </div>
  );
}
