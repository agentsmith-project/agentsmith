import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PlugZap, Settings2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { CredentialsAPI, EndpointAPI, ModelConfigAPI, getApiClient } from '@/lib/api';
import type { Endpoint } from '@/lib/api/types';
import {
  buildModelCatalogProviderOptions,
  CUSTOM_MODEL_CATALOG_PROVIDER_OPTION,
} from '@/lib/endpoints/model-catalog-provider-options';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';
import { EndpointDialogFooter } from './create-endpoint-dialog/EndpointDialogFooter';
import type { CapabilityOption, CatalogModelOption } from './create-endpoint-dialog/types';
import { buildProviderModels } from './create-endpoint-dialog/utils';
import { EditEndpointForm } from './edit-endpoint-dialog/EditEndpointForm';
import { buildEditEndpointPayload } from './edit-endpoint-dialog/utils';

export interface EditEndpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  endpoint: Endpoint;
  onSuccess?: () => void;
}

export function EditEndpointDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  endpoint,
  onSuccess,
}: EditEndpointDialogProps) {
  const t = useTranslations('endpoints');
  const commonT = useTranslations('common');
  const { handleError } = useApiError();

  const isEndpointCustom = endpoint.type === 'custom';
  const [provider, setProvider] = React.useState<string>('openai');
  const [capability, setCapability] = React.useState<CapabilityOption>('chat_completion');
  const [upstreamProtocol, setUpstreamProtocol] = React.useState(endpoint.upstream_protocol);
  const [name, setName] = React.useState(endpoint.name);
  const [description, setDescription] = React.useState(endpoint.description ?? '');
  const [selectedModel, setSelectedModel] = React.useState(endpoint.model);
  const [baseUrl, setBaseUrl] = React.useState(endpoint.base_url);
  const [status, setStatus] = React.useState<'active' | 'disabled'>(endpoint.status);
  const [credentialRef, setCredentialRef] = React.useState(endpoint.credential_ref ?? '');
  const [maxContextTokens, setMaxContextTokens] = React.useState(String(endpoint.model_profile?.max_context_tokens ?? 128000));
  const [maxOutputTokens, setMaxOutputTokens] = React.useState(String(endpoint.model_profile?.max_output_tokens ?? 8192));
  const [supportsFile, setSupportsFile] = React.useState(endpoint.model_profile?.supports_file ?? false);
  const [supportsToolCall, setSupportsToolCall] = React.useState(endpoint.model_profile?.supports_tool_call ?? true);
  const [supportsReasoning, setSupportsReasoning] = React.useState(endpoint.model_profile?.supports_reasoning ?? false);
  const [priceInputPer1m, setPriceInputPer1m] = React.useState(String(endpoint.model_profile?.price_input_per_1m ?? 0));
  const [priceOutputPer1m, setPriceOutputPer1m] = React.useState(String(endpoint.model_profile?.price_output_per_1m ?? 0));
  const [cacheReadDiscountRatio, setCacheReadDiscountRatio] = React.useState(String(endpoint.model_profile?.cache_read_discount_ratio ?? 0));
  const [cacheWriteDiscountRatio, setCacheWriteDiscountRatio] = React.useState(String(endpoint.model_profile?.cache_write_discount_ratio ?? 0));
  const [isSaving, setIsSaving] = React.useState(false);

  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);
  const credentialsAPI = React.useMemo(() => new CredentialsAPI(getApiClient()), []);
  const modelConfigAPI = React.useMemo(() => new ModelConfigAPI(getApiClient()), []);
  const { data: modelCatalogProvidersData } = useQuery({
    queryKey: ['model-catalog-providers', workspaceId, projectId, 'edit'],
    queryFn: () => modelConfigAPI.listModelCatalogProviders(workspaceId, projectId),
    enabled: open && !!workspaceId && !!projectId && !isEndpointCustom,
  });
  const providerOptions = React.useMemo(
    () => buildModelCatalogProviderOptions(modelCatalogProvidersData?.items ?? []),
    [modelCatalogProvidersData?.items],
  );
  const selectedProvider = React.useMemo(
    () => providerOptions.find((item) => item.key === provider) ?? CUSTOM_MODEL_CATALOG_PROVIDER_OPTION,
    [providerOptions, provider],
  );
  const isCustomProvider = isEndpointCustom || provider === 'custom';

  const { data: modelCatalogModelsData } = useQuery({
    queryKey: ['model-catalog-models', workspaceId, projectId, provider, capability, 'edit'],
    queryFn: () =>
      modelConfigAPI.listModelCatalogModels(workspaceId, projectId, {
        provider: isCustomProvider ? undefined : provider,
        capability,
      }),
    enabled: open && !!workspaceId && !!projectId && !isCustomProvider,
  });

  const providerModels = React.useMemo<CatalogModelOption[]>(
    () => buildProviderModels(modelCatalogModelsData?.items ?? []),
    [modelCatalogModelsData?.items],
  );

  const selectedCatalogModel = React.useMemo(
    () => providerModels.find((item) => item.model_id === selectedModel),
    [providerModels, selectedModel],
  );

  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials', workspaceId, projectId],
    queryFn: () => credentialsAPI.list(workspaceId, projectId),
    enabled: open && !!workspaceId && !!projectId,
  });

  React.useEffect(() => {
    if (!open) return;
    setUpstreamProtocol(endpoint.upstream_protocol);
    setName(endpoint.name);
    setDescription(endpoint.description ?? '');
    setSelectedModel(endpoint.model);
    setBaseUrl(endpoint.base_url);
    setStatus(endpoint.status);
    setCredentialRef(endpoint.credential_ref ?? '');
    setMaxContextTokens(String(endpoint.model_profile?.max_context_tokens ?? 128000));
    setMaxOutputTokens(String(endpoint.model_profile?.max_output_tokens ?? 8192));
    setSupportsFile(endpoint.model_profile?.supports_file ?? false);
    setSupportsToolCall(endpoint.model_profile?.supports_tool_call ?? true);
    setSupportsReasoning(endpoint.model_profile?.supports_reasoning ?? false);
    setPriceInputPer1m(String(endpoint.model_profile?.price_input_per_1m ?? 0));
    setPriceOutputPer1m(String(endpoint.model_profile?.price_output_per_1m ?? 0));
    setCacheReadDiscountRatio(String(endpoint.model_profile?.cache_read_discount_ratio ?? 0));
    setCacheWriteDiscountRatio(String(endpoint.model_profile?.cache_write_discount_ratio ?? 0));
    const catalogProviderKey = endpoint.meta?.catalog_provider_key;
    setProvider(isEndpointCustom ? 'custom' : (catalogProviderKey ?? endpoint.provider_family ?? 'openai'));
    const selectedCapability =
      endpoint.capabilities?.find((item) => item.enabled)?.type ??
      endpoint.models?.[0]?.capability ??
      'chat_completion';
    setCapability(selectedCapability);
  }, [open, endpoint, isEndpointCustom]);

  React.useEffect(() => {
    if (!open || isEndpointCustom || providerOptions.length === 0) return;
    if (provider === 'custom' || providerOptions.some((item) => item.key === provider)) return;
    const preferred = providerOptions.find((item) => item.key === 'openai')?.key ?? providerOptions[0]?.key ?? 'custom';
    setProvider(preferred);
  }, [open, provider, providerOptions, isEndpointCustom]);

  React.useEffect(() => {
    if (!open || isCustomProvider || providerModels.length === 0) return;
    if (providerModels.some((item) => item.model_id === selectedModel)) return;
    setSelectedModel(providerModels[0]?.model_id ?? '');
  }, [open, isCustomProvider, providerModels, selectedModel]);

  const applyModelProfileDefaults = React.useCallback(() => {
    setMaxContextTokens('128000');
    setMaxOutputTokens('8192');
    setPriceInputPer1m('0');
    setPriceOutputPer1m('0');
    setCacheReadDiscountRatio('0');
    setCacheWriteDiscountRatio('0');
    setSupportsFile(capability === 'multimodal_completion');
    setSupportsToolCall(true);
    setSupportsReasoning(false);
  }, [capability]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedBaseUrl = isCustomProvider
      ? baseUrl.trim()
      : selectedProvider.default_base_url.trim() || baseUrl.trim();
    if (!name.trim() || !selectedModel.trim() || !resolvedBaseUrl || !credentialRef.trim()) return;
    setIsSaving(true);
    try {
      await endpointAPI.update(workspaceId, projectId, endpoint.id, {
        ...buildEditEndpointPayload({
          baseUrl: resolvedBaseUrl,
          cacheReadDiscountRatio,
          cacheWriteDiscountRatio,
          capability,
          credentialRef,
          description,
          endpoint,
          isCustomProvider,
          maxContextTokens,
          maxOutputTokens,
          name,
          priceInputPer1m,
          priceOutputPer1m,
          provider,
          type: isEndpointCustom ? 'custom' : 'catalog',
          upstreamProtocol: isEndpointCustom ? upstreamProtocol : selectedProvider.upstream_protocol,
          selectedModel,
          selectedProvider,
          status,
          supportsFile,
          supportsReasoning,
          supportsToolCall,
        }),
      });
      toast.success(t('edit_dialog.success'));
      onSuccess?.();
      onOpenChange(false);
    } catch (error) {
      handleError(error, { context: t('edit_dialog.title') });
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !isSaving) onOpenChange(next);
  };

  const canSubmit =
    name.trim().length > 0 &&
    selectedModel.trim().length > 0 &&
    (isCustomProvider ? baseUrl.trim().length > 0 : (selectedProvider.default_base_url.trim().length > 0 || baseUrl.trim().length > 0)) &&
    credentialRef.trim().length > 0 &&
    !isSaving;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex h-full flex-col gap-0 overflow-hidden p-0"
        data-testid="endpoints__edit-dialog"
      >
        <SheetHeader className="border-b border-subtle px-6 py-5">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <PlugZap className="h-3.5 w-3.5" />
            Endpoint
          </div>
          <SheetTitle>{t('edit_dialog.title')}</SheetTitle>
          <SheetDescription>{t('edit_dialog.description')}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-subtle px-6 py-4">
            <div className="rounded-lg border border-subtle bg-surface-low p-4">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                  <Settings2 className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{endpoint.name}</p>
                  <p className="text-sm leading-6 text-secondary">
                    {t('edit_dialog.description')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <EditEndpointForm
            baseUrl={baseUrl}
            cacheReadDiscountRatio={cacheReadDiscountRatio}
            cacheWriteDiscountRatio={cacheWriteDiscountRatio}
            capability={capability}
            commonT={commonT}
            credentialRef={credentialRef}
            credentials={credentials}
            description={description}
            isCustomProvider={isCustomProvider}
            isEndpointCustom={isEndpointCustom}
            isSaving={isSaving}
            maxContextTokens={maxContextTokens}
            maxOutputTokens={maxOutputTokens}
            name={name}
            priceInputPer1m={priceInputPer1m}
            priceOutputPer1m={priceOutputPer1m}
            provider={provider}
            providerModels={providerModels}
            providerOptions={providerOptions}
            selectedCatalogModel={selectedCatalogModel ?? null}
            selectedModel={selectedModel}
            selectedProvider={selectedProvider}
            status={status}
            supportsFile={supportsFile}
            supportsReasoning={supportsReasoning}
            supportsToolCall={supportsToolCall}
            t={t}
            upstreamProtocol={upstreamProtocol}
            onApplyModelProfileDefaults={applyModelProfileDefaults}
            onBaseUrlChange={setBaseUrl}
            onCacheReadDiscountRatioChange={setCacheReadDiscountRatio}
            onCacheWriteDiscountRatioChange={setCacheWriteDiscountRatio}
            onCapabilityChange={setCapability}
            onCredentialRefChange={setCredentialRef}
            onDescriptionChange={setDescription}
            onMaxContextTokensChange={setMaxContextTokens}
            onMaxOutputTokensChange={setMaxOutputTokens}
            onNameChange={setName}
            onPriceInputPer1mChange={setPriceInputPer1m}
            onPriceOutputPer1mChange={setPriceOutputPer1m}
            onProviderChange={setProvider}
            onSelectedModelChange={setSelectedModel}
            onStatusChange={setStatus}
            onSupportsFileChange={setSupportsFile}
            onUpstreamProtocolChange={setUpstreamProtocol}
            onSupportsReasoningChange={setSupportsReasoning}
            onSupportsToolCallChange={setSupportsToolCall}
          />

          <EndpointDialogFooter
            canSubmit={canSubmit}
            createPending={isSaving}
            hasCredentials={credentials.length > 0}
            commonT={(key) => key === 'create' ? t('edit_dialog.save') : t('edit_dialog.cancel')}
            onCancel={() => handleOpenChange(false)}
          />
        </form>
      </SheetContent>
    </Sheet>
  );
}
