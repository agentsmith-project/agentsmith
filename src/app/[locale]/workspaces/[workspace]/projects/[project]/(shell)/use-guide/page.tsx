'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useEndpointPageCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { buildPublicApiUrl } from '@/lib/public-runtime-config';

interface UseGuidePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

export default function UseGuidePage({ params }: UseGuidePageProps) {
  const t = useTranslations('use_guide');
  const tErrors = useTranslations('errors');
  const { canUse: canUseProject } = useEndpointPageCapabilities();
  const resolvedParams = useResolvedProjectRoute(params);

  if (!resolvedParams.isReady) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  const workspaceId = resolvedParams.workspace ?? '';
  const projectId = resolvedParams.project ?? '';
  const locale = resolvedParams.locale;

  if (!resolvedParams.isValid || !workspaceId || !projectId) {
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

  const gatewayBaseUrl = buildPublicApiUrl(`workspaces/${workspaceId}/projects/${projectId}/llm-gateway`);
  const openAiChatCompletionsUrl = `${gatewayBaseUrl}/chat/completions`;
  const openAiResponsesUrl = `${gatewayBaseUrl}/responses`;
  const anthropicMessagesUrl = `${gatewayBaseUrl}/messages`;

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

  const openAiCompletionCurl = `curl ${openAiChatCompletionsUrl} \\
  -H "Authorization: Bearer <YOUR_PERSONAL_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<project-model-name>",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": false
  }'`;

  const openAiResponsesCurl = `curl ${openAiResponsesUrl} \\
  -H "Authorization: Bearer <YOUR_PERSONAL_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "<project-model-name>",
    "input": "hello"
  }'`;

  const anthropicCurl = `curl ${anthropicMessagesUrl} \\
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
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} variant="compact" />}>
        <div className="space-y-4" data-testid="use-guide__page">
          <Card className="rounded-[24px] border-subtle bg-surface/95 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
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

          <Card className="rounded-[24px] border-subtle bg-surface/95 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
            <CardHeader>
              <CardTitle className="text-base">{t('gateway.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-tertiary">
              <p>{t('gateway.description')}</p>
              <p>{t('gateway.protocol_note')}</p>
              <pre className="overflow-x-auto rounded-[18px] border border-subtle bg-bg-base/40 p-4 text-xs text-foreground" data-testid="use-guide__gateway-base-url">
                {gatewayBaseUrl}
              </pre>
            </CardContent>
          </Card>

          <Card className="rounded-[24px] border-subtle bg-surface/95 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
            <CardHeader>
              <CardTitle className="text-base">{t('api_examples.title')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <section className="space-y-3" data-testid="use-guide__protocol-openai">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">{t('protocols.openai.title')}</h3>
                  <p className="text-sm text-tertiary">{t('protocols.openai.description')}</p>
                </div>
                <div className="rounded-[18px] border border-subtle bg-bg-base/40 p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-secondary">
                    {t('protocols.openai.base_url_label')}
                  </div>
                  <pre className="overflow-x-auto text-xs text-foreground" data-testid="use-guide__openai-base-url">
                    {gatewayBaseUrl}
                  </pre>
                </div>
                <pre className="overflow-x-auto rounded-[18px] border border-subtle bg-bg-base/40 p-4 text-xs text-foreground" data-testid="use-guide__codex-sample">
                  {codexSample}
                </pre>
                <pre className="overflow-x-auto rounded-[18px] border border-subtle bg-bg-base/40 p-4 text-xs text-foreground" data-testid="use-guide__openai-chat-curl">
                  {openAiCompletionCurl}
                </pre>
                <pre className="overflow-x-auto rounded-[18px] border border-subtle bg-bg-base/40 p-4 text-xs text-foreground" data-testid="use-guide__openai-responses-curl">
                  {openAiResponsesCurl}
                </pre>
              </section>

              <section className="space-y-3" data-testid="use-guide__protocol-anthropic">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">{t('protocols.anthropic.title')}</h3>
                  <p className="text-sm text-tertiary">{t('protocols.anthropic.description')}</p>
                </div>
                <div className="rounded-[18px] border border-subtle bg-bg-base/40 p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-secondary">
                    {t('protocols.anthropic.base_url_label')}
                  </div>
                  <pre className="overflow-x-auto text-xs text-foreground" data-testid="use-guide__anthropic-base-url">
                    {gatewayBaseUrl}
                  </pre>
                </div>
                <pre className="overflow-x-auto rounded-[18px] border border-subtle bg-bg-base/40 p-4 text-xs text-foreground" data-testid="use-guide__claude-sample">
                  {claudeEnvSample}
                </pre>
                <pre className="overflow-x-auto rounded-[18px] border border-subtle bg-bg-base/40 p-4 text-xs text-foreground" data-testid="use-guide__claude-json-sample">
                  {claudeJsonSample}
                </pre>
                <pre className="overflow-x-auto rounded-[18px] border border-subtle bg-bg-base/40 p-4 text-xs text-foreground" data-testid="use-guide__anthropic-curl">
                  {anthropicCurl}
                </pre>
              </section>
            </CardContent>
          </Card>

          <Card className="rounded-[24px] border-subtle bg-surface/95 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
            <CardHeader>
              <CardTitle className="text-base">{t('quick_links.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3 text-sm">
              <Link href={`/${locale}/user/api-keys`} className="text-accent hover:underline" data-testid="use-guide__link-api-keys">
                {t('quick_links.api_keys')}
              </Link>
              <Link href={`/${locale}/workspaces/${workspaceId}/connections`} className="text-accent hover:underline" data-testid="use-guide__link-third-party-accounts">
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
