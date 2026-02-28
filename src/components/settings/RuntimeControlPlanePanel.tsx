'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import type {
  RuntimeAttemptTrace,
  RuntimeUnifiedChatResponse,
  RuntimeUnifiedChatResult,
  UnifiedChatRuntimeMetadata,
} from '@/lib/api';
import {
  useCreateRuntimeAlias,
  useCreateRuntimeCombo,
  useCreateRuntimeModel,
  useCreateRuntimeProvider,
  usePatchRuntimePricing,
  useRuntimeAliases,
  useRuntimeCombos,
  useRuntimeModels,
  useRuntimePricing,
  useRuntimeProviders,
  useRuntimeUnifiedChatProbe,
} from '@/lib/hooks/use-runtime';
import { cn } from '@/lib/utils';

type RuntimeControlPlanePanelProps = {
  workspaceId: string;
  projectId: string;
  disabled?: boolean;
};

const DEFAULT_COMBO_JSON = JSON.stringify(
  {
    name: 'prod-chat',
    targets: [{ provider: 'openai', model: 'gpt-4o' }],
    fallback_policy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
  },
  null,
  2,
);

const DEFAULT_PRICING_JSON = JSON.stringify(
  {
    openai: {
      'gpt-4o': {
        input: 2,
        output: 10,
      },
    },
  },
  null,
  2,
);

function getRuntimeMetadata(result: RuntimeUnifiedChatResult | null): UnifiedChatRuntimeMetadata | undefined {
  const data = result?.data as { runtime?: UnifiedChatRuntimeMetadata } | undefined;
  return data?.runtime;
}

function getResponsePreview(result: RuntimeUnifiedChatResult | null): string | null {
  if (!result?.ok) return null;
  const payload = result.data as RuntimeUnifiedChatResponse;
  const content = payload.choices
    .map((choice) => {
      const message = typeof choice.message === 'object' && choice.message
        ? choice.message as Record<string, unknown>
        : null;
      const rawContent = message?.content;
      if (typeof rawContent === 'string') return rawContent;
      if (Array.isArray(rawContent)) {
        return rawContent
          .map((item) => (typeof item === 'string'
            ? item
            : (typeof item === 'object' && item && typeof (item as { text?: unknown }).text === 'string'
              ? String((item as { text?: unknown }).text)
              : '')))
          .filter(Boolean)
          .join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return content || null;
}

function formatUsd(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `$${value.toFixed(6)}`;
}

function summarizeProbeState(result: RuntimeUnifiedChatResult | null, runtime: UnifiedChatRuntimeMetadata | undefined) {
  if (!result) return 'idle';
  if (result.ok && (runtime?.fallback_hops ?? 0) > 0) return 'recovered';
  if (result.ok) return 'completed';
  return 'terminal';
}

function attemptTone(attempt: RuntimeAttemptTrace) {
  if (attempt.outcome === 'success') {
    return {
      badgeVariant: 'outline' as const,
      badgeClassName: 'border-success/30 bg-success/10 text-success',
      containerClassName: 'border-success/20 bg-success/5',
      labelKey: 'runtime_probe_attempt_status_success',
    };
  }
  if (attempt.outcome.startsWith('fallback_')) {
    return {
      badgeVariant: 'default' as const,
      badgeClassName: '',
      containerClassName: 'border-accent/30 bg-accent/5',
      labelKey: 'runtime_probe_attempt_status_recovered',
    };
  }
  return {
    badgeVariant: 'destructive' as const,
    badgeClassName: '',
    containerClassName: 'border-error/25 bg-error/5',
    labelKey: 'runtime_probe_attempt_status_terminal',
  };
}

function mapAttemptReason(t: ReturnType<typeof useTranslations>, attempt: RuntimeAttemptTrace): string {
  const keyMap: Record<string, string> = {
    runtime_upstream_ok: 'runtime_probe_reason_runtime_upstream_ok',
    runtime_upstream_error_recovered: 'runtime_probe_reason_runtime_upstream_error_recovered',
    runtime_upstream_error: 'runtime_probe_reason_runtime_upstream_error',
    runtime_upstream_network_error_recovered: 'runtime_probe_reason_runtime_upstream_network_error_recovered',
    runtime_upstream_network_error: 'runtime_probe_reason_runtime_upstream_network_error',
    runtime_provider_connection_not_found: 'runtime_probe_reason_runtime_provider_connection_not_found',
    runtime_provider_credential_missing: 'runtime_probe_reason_runtime_provider_credential_missing',
    runtime_provider_credential_not_found: 'runtime_probe_reason_runtime_provider_credential_not_found',
  };
  const translatedKey = keyMap[attempt.reason];
  if (!translatedKey) {
    return attempt.reason.replaceAll('_', ' ');
  }
  return t(translatedKey);
}

export function RuntimeControlPlanePanel({ workspaceId, projectId, disabled = false }: RuntimeControlPlanePanelProps) {
  const t = useTranslations('settings');
  const [provider, setProvider] = useState('openai');
  const [providerBaseUrl, setProviderBaseUrl] = useState('https://api.openai.com/v1');
  const [providerCredentialRef, setProviderCredentialRef] = useState('');
  const [modelProvider, setModelProvider] = useState('openai');
  const [modelId, setModelId] = useState('gpt-4o');
  const [modelCapabilities, setModelCapabilities] = useState('chat');
  const [alias, setAlias] = useState('assistant-main');
  const [aliasTargetProvider, setAliasTargetProvider] = useState('openai');
  const [aliasTargetModel, setAliasTargetModel] = useState('gpt-4o');
  const [comboJson, setComboJson] = useState(DEFAULT_COMBO_JSON);
  const [pricingJson, setPricingJson] = useState(DEFAULT_PRICING_JSON);
  const [probeModel, setProbeModel] = useState('combo:prod-chat');
  const [probePrompt, setProbePrompt] = useState('Summarize the runtime recovery path in one sentence.');
  const [probeResult, setProbeResult] = useState<RuntimeUnifiedChatResult | null>(null);

  const providersQuery = useRuntimeProviders(workspaceId, projectId);
  const modelsQuery = useRuntimeModels(workspaceId, projectId);
  const aliasesQuery = useRuntimeAliases(workspaceId, projectId);
  const combosQuery = useRuntimeCombos(workspaceId, projectId);
  const pricingQuery = useRuntimePricing(workspaceId, projectId);

  const createProvider = useCreateRuntimeProvider(workspaceId, projectId);
  const createModel = useCreateRuntimeModel(workspaceId, projectId);
  const createAlias = useCreateRuntimeAlias(workspaceId, projectId);
  const createCombo = useCreateRuntimeCombo(workspaceId, projectId);
  const patchPricing = usePatchRuntimePricing(workspaceId, projectId);
  const probeRuntime = useRuntimeUnifiedChatProbe(workspaceId, projectId);

  const pricingPretty = useMemo(() => {
    if (!pricingQuery.data || Object.keys(pricingQuery.data).length === 0) return null;
    return JSON.stringify(pricingQuery.data, null, 2);
  }, [pricingQuery.data]);

  const runtimeMetadata = getRuntimeMetadata(probeResult);
  const responsePreview = getResponsePreview(probeResult);
  const probeState = summarizeProbeState(probeResult, runtimeMetadata);

  const handleCreateProvider = async () => {
    try {
      await createProvider.mutateAsync({
        provider,
        auth_mode: 'api_key',
        base_url: providerBaseUrl,
        credential_ref: providerCredentialRef || undefined,
      });
      toast.success(t('runtime_provider_created'));
    } catch {
      toast.error(t('runtime_provider_create_failed'));
    }
  };

  const handleCreateModel = async () => {
    try {
      await createModel.mutateAsync({
        provider: modelProvider,
        model_id: modelId,
        capabilities: modelCapabilities.split(',').map((v) => v.trim()).filter(Boolean),
      });
      toast.success(t('runtime_model_created'));
    } catch {
      toast.error(t('runtime_model_create_failed'));
    }
  };

  const handleCreateAlias = async () => {
    try {
      await createAlias.mutateAsync({
        alias,
        target_provider: aliasTargetProvider,
        target_model: aliasTargetModel,
      });
      toast.success(t('runtime_alias_created'));
    } catch {
      toast.error(t('runtime_alias_create_failed'));
    }
  };

  const handleCreateCombo = async () => {
    try {
      const payload = JSON.parse(comboJson) as {
        name: string;
        targets: Array<{ provider: string; model: string }>;
        fallback_policy: { max_hops: number; retryable_error_classes: string[] };
      };
      await createCombo.mutateAsync(payload);
      toast.success(t('runtime_combo_created'));
    } catch {
      toast.error(t('runtime_combo_create_failed'));
    }
  };

  const handleSavePricing = async () => {
    try {
      const payload = JSON.parse(pricingJson) as Record<string, Record<string, Record<string, number>>>;
      await patchPricing.mutateAsync(payload);
      toast.success(t('runtime_pricing_updated'));
    } catch {
      toast.error(t('runtime_pricing_update_failed'));
    }
  };

  const handleRunProbe = async () => {
    try {
      const result = await probeRuntime.mutateAsync({
        model: probeModel.trim(),
        stream: false,
        messages: [{ role: 'user', content: probePrompt.trim() }],
      });
      setProbeResult(result);
    } catch {
      toast.error(t('runtime_probe_run_failed'));
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface-high/70 p-4" data-testid="settings-runtime__panel">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('runtime_panel_title')}</h3>
          <p className="text-xs text-tertiary">{t('runtime_panel_subtitle')}</p>
        </div>
        <div className="text-xs text-tertiary" data-testid="settings-runtime__counts">
          P {providersQuery.data?.items.length ?? 0} · M {modelsQuery.data?.items.length ?? 0} · A {aliasesQuery.data?.items.length ?? 0} · C {combosQuery.data?.items.length ?? 0}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="text-xs font-medium text-primary">{t('runtime_create_provider_title')}</div>
          <Input value={provider} onChange={(e) => setProvider(e.target.value)} disabled={disabled} data-testid="settings-runtime__provider-name" />
          <Input value={providerBaseUrl} onChange={(e) => setProviderBaseUrl(e.target.value)} disabled={disabled} data-testid="settings-runtime__provider-base-url" />
          <Input value={providerCredentialRef} onChange={(e) => setProviderCredentialRef(e.target.value)} placeholder="credential_ref" disabled={disabled} data-testid="settings-runtime__provider-credential-ref" />
          <Button onClick={handleCreateProvider} disabled={disabled || createProvider.isPending} size="sm" data-testid="settings-runtime__provider-create">
            {t('runtime_action_create')}
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="text-xs font-medium text-primary">{t('runtime_create_model_title')}</div>
          <Input value={modelProvider} onChange={(e) => setModelProvider(e.target.value)} disabled={disabled} data-testid="settings-runtime__model-provider" />
          <Input value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={disabled} data-testid="settings-runtime__model-id" />
          <Input value={modelCapabilities} onChange={(e) => setModelCapabilities(e.target.value)} placeholder="chat,tools" disabled={disabled} data-testid="settings-runtime__model-capabilities" />
          <Button onClick={handleCreateModel} disabled={disabled || createModel.isPending} size="sm" data-testid="settings-runtime__model-create">
            {t('runtime_action_create')}
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="text-xs font-medium text-primary">{t('runtime_create_alias_title')}</div>
          <Input value={alias} onChange={(e) => setAlias(e.target.value)} disabled={disabled} data-testid="settings-runtime__alias-name" />
          <Input value={aliasTargetProvider} onChange={(e) => setAliasTargetProvider(e.target.value)} disabled={disabled} data-testid="settings-runtime__alias-target-provider" />
          <Input value={aliasTargetModel} onChange={(e) => setAliasTargetModel(e.target.value)} disabled={disabled} data-testid="settings-runtime__alias-target-model" />
          <Button onClick={handleCreateAlias} disabled={disabled || createAlias.isPending} size="sm" data-testid="settings-runtime__alias-create">
            {t('runtime_action_create')}
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <div className="text-xs font-medium text-primary">{t('runtime_create_combo_title')}</div>
          <Textarea value={comboJson} onChange={(e) => setComboJson(e.target.value)} className="font-mono text-xs" rows={6} disabled={disabled} data-testid="settings-runtime__combo-json" />
          <Button onClick={handleCreateCombo} disabled={disabled || createCombo.isPending} size="sm" data-testid="settings-runtime__combo-create">
            {t('runtime_action_create')}
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-primary">{t('runtime_pricing_overrides_title')}</div>
          {pricingPretty ? <div className="text-[11px] text-tertiary">{t('runtime_pricing_loaded')}</div> : null}
        </div>
        <Textarea value={pricingJson} onChange={(e) => setPricingJson(e.target.value)} className="font-mono text-xs" rows={7} disabled={disabled} data-testid="settings-runtime__pricing-json" />
        <Button onClick={handleSavePricing} disabled={disabled || patchPricing.isPending} size="sm" data-testid="settings-runtime__pricing-save">
          {t('runtime_action_save')}
        </Button>
      </div>

      <Card className="border-border/70 bg-surface shadow-sm" data-testid="settings-runtime__probe">
        <CardHeader className="pb-4">
          <CardTitle>{t('runtime_probe_title')}</CardTitle>
          <p className="text-sm text-tertiary">{t('runtime_probe_description')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
            <div className="space-y-3 rounded-xl border border-border/60 bg-surface-high/50 p-4">
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-tertiary">{t('runtime_probe_route_label')}</div>
                <Input
                  value={probeModel}
                  onChange={(e) => setProbeModel(e.target.value)}
                  disabled={disabled || probeRuntime.isPending}
                  placeholder="combo:prod-chat"
                  data-testid="settings-runtime__probe-model"
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-tertiary">{t('runtime_probe_prompt_label')}</div>
                <Textarea
                  value={probePrompt}
                  onChange={(e) => setProbePrompt(e.target.value)}
                  rows={8}
                  disabled={disabled || probeRuntime.isPending}
                  placeholder={t('runtime_probe_prompt_placeholder')}
                  data-testid="settings-runtime__probe-prompt"
                />
              </div>
              <div className="rounded-lg border border-dashed border-border/70 bg-surface p-3 text-xs text-tertiary">
                {t('runtime_probe_hint')}
              </div>
              <Button
                onClick={handleRunProbe}
                disabled={disabled || probeRuntime.isPending || !probeModel.trim() || !probePrompt.trim()}
                data-testid="settings-runtime__probe-run"
              >
                {probeRuntime.isPending ? t('runtime_probe_running') : t('runtime_probe_run')}
              </Button>
            </div>

            <div className="space-y-4">
              <div
                className="rounded-xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] p-4"
                data-testid="settings-runtime__probe-summary"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-tertiary">{t('runtime_probe_result_title')}</div>
                    <div className="mt-1 text-sm text-tertiary">
                      {probeState === 'idle' ? t('runtime_probe_result_idle_description') : t('runtime_probe_result_ready_description')}
                    </div>
                  </div>
                  {probeState !== 'idle' ? (
                    <Badge
                      variant={probeState === 'terminal' ? 'destructive' : probeState === 'recovered' ? 'default' : 'outline'}
                      className={probeState === 'completed' ? 'border-success/30 bg-success/10 text-success' : undefined}
                      data-testid="settings-runtime__probe-status"
                    >
                      {probeState === 'completed'
                        ? t('runtime_probe_status_completed')
                        : probeState === 'recovered'
                          ? t('runtime_probe_status_recovered')
                          : t('runtime_probe_status_terminal')}
                    </Badge>
                  ) : null}
                </div>

                {probeState === 'idle' ? (
                  <div className="mt-6 rounded-lg border border-dashed border-border/70 bg-surface-high/40 p-4" data-testid="settings-runtime__probe-empty">
                    <div className="text-sm font-medium text-foreground">{t('runtime_probe_result_idle_title')}</div>
                    <div className="mt-1 text-sm text-tertiary">{t('runtime_probe_result_idle_description')}</div>
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-border/60 bg-surface p-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('runtime_probe_provider')}</div>
                      <div className="mt-2 truncate font-mono text-sm text-foreground">{runtimeMetadata?.provider ?? '--'}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-surface p-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('runtime_probe_model')}</div>
                      <div className="mt-2 truncate font-mono text-sm text-foreground">{runtimeMetadata?.resolved_model ?? '--'}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-surface p-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('runtime_probe_fallback_hops')}</div>
                      <div className="mt-2 text-sm font-semibold text-foreground">{runtimeMetadata?.fallback_hops ?? 0}</div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-surface p-3">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('runtime_probe_estimated_cost')}</div>
                      <div className="mt-2 text-sm font-semibold text-foreground">{formatUsd(runtimeMetadata?.estimated_cost)}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border/70 bg-surface-high/35 p-4" data-testid="settings-runtime__probe-response">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-tertiary">{t('runtime_probe_response_title')}</div>
                <div className="mt-3 rounded-lg border border-border/60 bg-surface p-4">
                  {responsePreview ? (
                    <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">{responsePreview}</div>
                  ) : (
                    <div className="text-sm text-tertiary">
                      {probeResult && !probeResult.ok
                        ? (probeResult.data as { message?: string }).message
                        : t('runtime_probe_response_empty')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-surface p-4" data-testid="settings-runtime__probe-timeline">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-tertiary">{t('runtime_probe_timeline_title')}</div>
                <div className="mt-1 text-sm text-tertiary">{t('runtime_probe_timeline_description')}</div>
              </div>
              {runtimeMetadata?.attempts?.length ? (
                <Badge variant="secondary">{runtimeMetadata.attempts.length}</Badge>
              ) : null}
            </div>

            {runtimeMetadata?.attempts?.length ? (
              <div className="mt-4 space-y-3">
                {runtimeMetadata.attempts.map((attempt) => {
                  const tone = attemptTone(attempt);
                  return (
                    <div
                      key={`${attempt.index}-${attempt.provider}-${attempt.model}`}
                      className={cn('rounded-lg border p-4', tone.containerClassName)}
                      data-testid={`settings-runtime__probe-attempt-${attempt.index}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.14em] text-tertiary">
                            {t('runtime_probe_attempt_label', { index: attempt.index + 1 })}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <code className="rounded bg-surface px-2 py-1 text-xs text-foreground">{attempt.provider}</code>
                            <span className="text-tertiary">/</span>
                            <code className="rounded bg-surface px-2 py-1 text-xs text-foreground">{attempt.model}</code>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={tone.badgeVariant} className={tone.badgeClassName}>
                            {t(tone.labelKey)}
                          </Badge>
                          {typeof attempt.statusCode === 'number' ? (
                            <Badge variant="secondary">HTTP {attempt.statusCode}</Badge>
                          ) : null}
                          {typeof attempt.durationMs === 'number' ? (
                            <Badge variant="outline">{attempt.durationMs}ms</Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-tertiary md:grid-cols-[minmax(0,1fr)_auto]">
                        <div>{mapAttemptReason(t, attempt)}</div>
                        {attempt.errorClass ? (
                          <code className="justify-self-start rounded bg-surface px-2 py-1 text-xs text-tertiary md:justify-self-end">
                            {attempt.errorClass}
                          </code>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-surface-high/40 p-4 text-sm text-tertiary">
                {t('runtime_probe_timeline_empty')}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
