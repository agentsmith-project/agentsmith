'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Copy, KeyRound, LinkIcon, ServerCog } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { useEndpointPageCapabilities } from '@/lib/hooks/use-permissions';
import { useResolvedProjectRoute } from '@/lib/hooks/use-resolved-project-route';
import { buildPublicApiUrl } from '@/lib/public-runtime-config';
import { useApiAccessGuideData } from '@/lib/use-guide/use-api-access-guide-data';
import type { Endpoint } from '@/lib/api/types';

interface UseGuidePageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

type ProtocolTab = 'openai' | 'anthropic';

function getGuideModelName(endpoint: Endpoint | null): string {
  if (!endpoint) {
    return '<project-model-name>';
  }

  return endpoint.defaults?.chat_model_id
    ?? endpoint.defaults?.multimodal_model_id
    ?? endpoint.models?.find((item) =>
      item.capability === 'chat_completion' || item.capability === 'multimodal_completion',
    )?.model_id
    ?? endpoint.model
    ?? '<project-model-name>';
}

function getEndpointProtocolSupport(endpoint: Endpoint | null): Record<ProtocolTab, boolean> {
  if (!endpoint) {
    return { openai: true, anthropic: true };
  }

  // Endpoint protocol describes the upstream wire format.
  // Downstream clients should always be able to choose either protocol because
  // AgentSmith routes everything through the universal proxy for conversion.
  return { openai: true, anthropic: true };
}

function getDefaultProtocol(_endpoint: Endpoint | null): ProtocolTab {
  return 'openai';
}

function getEndpointStatusTone(endpoint: Endpoint): 'default' | 'secondary' | 'outline' {
  if (endpoint.protocol === 'anthropic_compatible') return 'outline';
  if (endpoint.protocol === 'openai_compatible') return 'default';
  return 'secondary';
}

function CopyValueButton({
  value,
  label,
  testId,
}: {
  value: string;
  label: string;
  testId: string;
}) {
  const tCommon = useTranslations('common');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(tCommon('toast.copied'));
    } catch {
      toast.error(tCommon('toast.copy_failed'));
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={handleCopy} data-testid={testId}>
      <Copy className="mr-1.5 h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

function GuideCodeBlock({
  title,
  value,
  copyLabel,
  testId,
}: {
  title: string;
  value: string;
  copyLabel: string;
  testId: string;
}) {
  return (
    <div className="rounded-[18px] border border-subtle bg-bg-base/40 p-4" data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wide text-secondary">{title}</div>
        <CopyValueButton value={value} label={copyLabel} testId={`${testId}__copy`} />
      </div>
      <pre className="overflow-x-auto text-xs leading-6 text-foreground whitespace-pre-wrap break-all">{value}</pre>
    </div>
  );
}

export default function UseGuidePage({ params }: UseGuidePageProps) {
  const t = useTranslations('use_guide');
  const tErrors = useTranslations('errors');
  const tCommon = useTranslations('common');
  const { canUse: canUseProject, canRead: canReadEndpoints } = useEndpointPageCapabilities();
  const resolvedParams = useResolvedProjectRoute(params);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = resolvedParams.workspace ?? '';
  const projectId = resolvedParams.project ?? '';
  const locale = resolvedParams.locale ?? 'en-US';

  const routeReady = resolvedParams.isReady;
  const routeValid = resolvedParams.isValid && workspaceId.length > 0 && projectId.length > 0;

  const {
    activeApiKeyCount,
    apiKeysLoading,
    hasActiveApiKey,
    endpointsLoading,
    usableEndpoints,
  } = useApiAccessGuideData({
    workspaceId,
    projectId,
    canUseProject,
    canReadEndpoints,
  });

  const requestedEndpointId = searchParams.get('endpoint')?.trim() || '';
  const selectedEndpoint = usableEndpoints.find((item) => item.id === requestedEndpointId) ?? usableEndpoints[0] ?? null;
  const protocolSupport = getEndpointProtocolSupport(selectedEndpoint);
  const requestedProtocol = searchParams.get('protocol') === 'anthropic' ? 'anthropic' : searchParams.get('protocol') === 'openai' ? 'openai' : null;
  const effectiveProtocol: ProtocolTab = requestedProtocol && protocolSupport[requestedProtocol]
    ? requestedProtocol
    : getDefaultProtocol(selectedEndpoint);

  const updateQuery = (updates: Partial<Record<'endpoint' | 'protocol', string | null>>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (!routeReady || !routeValid || !canUseProject) {
      return;
    }
    const nextEndpointId = selectedEndpoint?.id ?? null;
    if (requestedEndpointId !== (nextEndpointId ?? '')) {
      updateQuery({ endpoint: nextEndpointId });
      return;
    }
    if (requestedProtocol !== effectiveProtocol) {
      updateQuery({ protocol: effectiveProtocol });
    }
  }, [
    canUseProject,
    effectiveProtocol,
    requestedEndpointId,
    requestedProtocol,
    routeReady,
    routeValid,
    selectedEndpoint?.id,
  ]);

  if (!routeReady) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!routeValid) {
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

  const endpointProxyRootUrl = buildPublicApiUrl(
    `workspaces/${workspaceId}/projects/${projectId}/endpoints/${selectedEndpoint?.id ?? '<endpoint-id>'}/proxy`,
  );
  const openAiBaseUrl = `${endpointProxyRootUrl}/openai`;
  const anthropicBaseUrl = `${endpointProxyRootUrl}/anthropic`;
  const selectedModelName = getGuideModelName(selectedEndpoint);

  const codexSample = `AGENTSMITH_API_KEY=<YOUR_PERSONAL_API_KEY> \\
codex exec --model ${selectedModelName} \\
  -c 'model_provider="agentsmith"' \\
  -c 'provider="agentsmith"' \\
  -c 'model_providers.agentsmith.name="AgentSmith"' \\
  -c 'model_providers.agentsmith.base_url="${openAiBaseUrl}"' \\
  -c 'model_providers.agentsmith.env_key="AGENTSMITH_API_KEY"' \\
  -c 'model_providers.agentsmith.wire_api="responses"' \\
  -c 'model_context_window=200000' \\
  -c 'model_auto_compact_token_limit=176000' \\
  "Reply exactly: ok"`;

  const claudeSample = `CLAUDE_SETTINGS=$(jq -nc \\
  --arg base '${anthropicBaseUrl}' \\
  --arg key '<YOUR_PERSONAL_API_KEY>' \\
  '{env:{ANTHROPIC_BASE_URL:$base,ANTHROPIC_API_KEY:$key,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:"1",CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:"1"}}') \\
claude --bare --settings "$CLAUDE_SETTINGS" -p --model ${selectedModelName} "Reply exactly: ok"`;

  const openAiCompletionCurl = `curl ${openAiBaseUrl}/chat/completions \\
  -H "Authorization: Bearer <YOUR_PERSONAL_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${selectedModelName}",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": false
  }'`;

  const openAiResponsesCurl = `curl ${openAiBaseUrl}/responses \\
  -H "Authorization: Bearer <YOUR_PERSONAL_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${selectedModelName}",
    "input": "hello"
  }'`;

  const anthropicCurl = `curl ${anthropicBaseUrl}/messages \\
  -H "Authorization: Bearer <YOUR_PERSONAL_API_KEY>" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${selectedModelName}",
    "max_tokens": 512,
    "messages": [{"role": "user", "content": [{"type": "text", "text": "hello"}]}]
  }'`;

  const apiKeyStatus = apiKeysLoading
    ? t('readiness.states.info')
    : hasActiveApiKey
      ? t('readiness.api_keys.ready', { count: activeApiKeyCount })
      : t('readiness.api_keys.pending');

  const endpointStatus = endpointsLoading
    ? t('readiness.endpoint.loading')
    : selectedEndpoint
      ? t('readiness.endpoint.ready', { name: selectedEndpoint.name })
      : canReadEndpoints
        ? t('readiness.endpoint.pending')
        : t('readiness.endpoint.unavailable');

  return (
    <PageState state="success">
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} variant="compact" />}>
        <div className="mx-auto max-w-5xl space-y-6" data-testid="use-guide__page">
          <section className="rounded-[28px] border border-subtle bg-surface/95 px-6 py-6 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl space-y-3">
                <h2 className="text-lg font-semibold text-foreground">{t('selection.title')}</h2>
                <p className="text-sm leading-6 text-tertiary">{t('selection.description')}</p>
                <div className="flex flex-wrap gap-3 text-sm">
                  <Link href={`/${locale}/user/api-keys`} className="inline-flex items-center gap-2 rounded-full border border-subtle px-4 py-2 text-foreground transition hover:border-strong hover:bg-bg-base/60" data-testid="use-guide__link-api-keys">
                    <KeyRound className="h-4 w-4 text-secondary" />
                    {t('quick_links.api_keys')}
                  </Link>
                  <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/endpoints`} className="inline-flex items-center gap-2 rounded-full border border-subtle px-4 py-2 text-foreground transition hover:border-strong hover:bg-bg-base/60" data-testid="use-guide__link-endpoints">
                    <ServerCog className="h-4 w-4 text-secondary" />
                    {t('quick_links.endpoints')}
                  </Link>
                  <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/resource-policy`} className="inline-flex items-center gap-2 rounded-full border border-subtle px-4 py-2 text-foreground transition hover:border-strong hover:bg-bg-base/60" data-testid="use-guide__link-resource-policy">
                    <LinkIcon className="h-4 w-4 text-secondary" />
                    {t('quick_links.resource_policy')}
                  </Link>
                </div>
              </div>

              <div className="min-w-0 rounded-[22px] border border-subtle bg-bg-base/40 px-4 py-4 lg:w-[22rem]">
                <div className="space-y-3 text-sm">
                  <div data-testid="use-guide__status-api-keys">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-secondary">{t('readiness.api_keys.title')}</span>
                      <Badge variant={hasActiveApiKey ? 'default' : apiKeysLoading ? 'secondary' : 'destructive'}>
                        {apiKeysLoading ? t('readiness.states.info') : hasActiveApiKey ? t('readiness.states.ready') : t('readiness.states.action_needed')}
                      </Badge>
                    </div>
                    <p className="mt-2 text-tertiary">{apiKeyStatus}</p>
                  </div>

                  <div className="border-t border-subtle pt-3">
                    <div data-testid="use-guide__status-endpoint">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-secondary">{t('readiness.endpoint.title')}</span>
                        <Badge variant={selectedEndpoint ? 'default' : endpointsLoading ? 'secondary' : 'destructive'}>
                          {endpointsLoading ? t('readiness.states.info') : selectedEndpoint ? t('readiness.states.ready') : t('readiness.states.action_needed')}
                        </Badge>
                      </div>
                      <p className="mt-2 text-tertiary">{endpointStatus}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-secondary">{t('selection.title')}</div>
              {canReadEndpoints ? (
                selectedEndpoint || endpointsLoading ? (
                  <Select
                    value={selectedEndpoint?.id ?? ''}
                    onValueChange={(value) => updateQuery({ endpoint: value })}
                    disabled={endpointsLoading || usableEndpoints.length === 0}
                  >
                    <SelectTrigger className="h-12 rounded-[18px] border-subtle bg-surface/95 text-left shadow-[0_10px_30px_rgba(0,0,0,0.12)]" data-testid="use-guide__endpoint-select">
                      <SelectValue placeholder={t('selection.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {usableEndpoints.map((endpoint) => (
                        <SelectItem key={endpoint.id} value={endpoint.id}>
                          {endpoint.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="rounded-[18px] border border-dashed border-subtle bg-bg-base/30 p-4 text-sm text-tertiary" data-testid="use-guide__endpoint-empty">
                    {t('selection.empty')}
                  </div>
                )
              ) : (
                <div className="rounded-[18px] border border-dashed border-subtle bg-bg-base/30 p-4 text-sm text-tertiary" data-testid="use-guide__endpoint-unavailable">
                  {t('selection.no_read_access')}
                </div>
              )}
            </div>

            {selectedEndpoint ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="use-guide__endpoint-summary">
                <Badge variant="outline">{selectedEndpoint.name}</Badge>
                <Badge variant={getEndpointStatusTone(selectedEndpoint)}>{selectedEndpoint.protocol ?? 'custom'}</Badge>
                <Badge variant="secondary">{selectedModelName}</Badge>
              </div>
            ) : null}
          </section>

          <section className="rounded-[28px] border border-subtle bg-surface/95 px-6 py-6 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
            <div className="mb-5 space-y-2">
              <h2 className="text-lg font-semibold text-foreground">{t('api_examples.title')}</h2>
              <p className="text-sm leading-6 text-tertiary">{t('gateway.description')}</p>
              <div className="text-sm text-tertiary">{t('protocols.helper')}</div>
            </div>

            <div className="space-y-4 rounded-[22px] border border-subtle bg-bg-base/30 p-4">
              <Tabs value={effectiveProtocol} onValueChange={(value) => updateQuery({ protocol: value as ProtocolTab })}>
                <TabsList className="mb-4 grid h-auto w-full grid-cols-2 rounded-[16px] bg-bg-base/70 p-1">
                  <TabsTrigger value="openai" disabled={!protocolSupport.openai} data-testid="use-guide__tab-openai">
                    {t('protocols.openai.title')}
                  </TabsTrigger>
                  <TabsTrigger value="anthropic" disabled={!protocolSupport.anthropic} data-testid="use-guide__tab-anthropic">
                    {t('protocols.anthropic.title')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="openai" className="space-y-4" data-testid="use-guide__protocol-openai">
                  <p className="text-sm text-tertiary">{t('protocols.openai.description')}</p>
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
                    <div className="space-y-4">
                      <GuideCodeBlock
                        title={t('protocols.openai.base_url_label')}
                        value={openAiBaseUrl}
                        copyLabel={tCommon('copy')}
                        testId="use-guide__openai-base-url"
                      />
                      <GuideCodeBlock
                        title={t('protocols.model_label')}
                        value={selectedModelName}
                        copyLabel={tCommon('copy')}
                        testId="use-guide__model-name"
                      />
                    </div>
                    <div className="space-y-4">
                      <GuideCodeBlock
                        title={t('protocols.openai.codex_label')}
                        value={codexSample}
                        copyLabel={tCommon('copy')}
                        testId="use-guide__codex-sample"
                      />
                      <GuideCodeBlock
                        title={t('protocols.openai.responses_label')}
                        value={openAiResponsesCurl}
                        copyLabel={tCommon('copy')}
                        testId="use-guide__openai-responses-curl"
                      />
                      <GuideCodeBlock
                        title={t('protocols.openai.chat_label')}
                        value={openAiCompletionCurl}
                        copyLabel={tCommon('copy')}
                        testId="use-guide__openai-chat-curl"
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="anthropic" className="space-y-4" data-testid="use-guide__protocol-anthropic">
                  <p className="text-sm text-tertiary">{t('protocols.anthropic.description')}</p>
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
                    <div className="space-y-4">
                      <GuideCodeBlock
                        title={t('protocols.anthropic.base_url_label')}
                        value={anthropicBaseUrl}
                        copyLabel={tCommon('copy')}
                        testId="use-guide__anthropic-base-url"
                      />
                      <GuideCodeBlock
                        title={t('protocols.model_label')}
                        value={selectedModelName}
                        copyLabel={tCommon('copy')}
                        testId="use-guide__model-name-anthropic"
                      />
                    </div>
                    <div className="space-y-4">
                      <GuideCodeBlock
                        title={t('protocols.anthropic.claude_label')}
                        value={claudeSample}
                        copyLabel={tCommon('copy')}
                        testId="use-guide__claude-sample"
                      />
                      <GuideCodeBlock
                        title={t('protocols.anthropic.messages_label')}
                        value={anthropicCurl}
                        copyLabel={tCommon('copy')}
                        testId="use-guide__anthropic-curl"
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="mt-6 space-y-3 border-t border-subtle pt-6">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-secondary">{t('gateway.title')}</div>
              <GuideCodeBlock
                title={t('gateway.title')}
                value={endpointProxyRootUrl}
                copyLabel={tCommon('copy')}
                testId="use-guide__gateway-base-url"
              />
            </div>
          </section>

          <section className="space-y-4 border-t border-subtle pt-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('troubleshooting.title')}</h2>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
                {(['auth', 'endpoint', 'rate_limit', 'protocol'] as const).map((key) => (
                  <div key={key} className="rounded-[18px] border border-subtle bg-bg-base/30 p-4 space-y-1" data-testid={`use-guide__troubleshooting__${key}`}>
                    <div className="text-sm font-semibold text-foreground">{t(`troubleshooting.items.${key}.title`)}</div>
                    <p className="text-sm text-tertiary">{t(`troubleshooting.items.${key}.description`)}</p>
                  </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage`} className="text-accent hover:underline" data-testid="use-guide__link-usage">
                {t('quick_links.usage')}
              </Link>
            </div>
          </section>
        </div>
      </PageLayout>
    </PageState>
  );
}
