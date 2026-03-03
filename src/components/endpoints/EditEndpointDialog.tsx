import * as React from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { CredentialsAPI, EndpointAPI, RuntimeAPI, getApiClient } from '@/lib/api';
import type { Endpoint, EndpointCapabilityType } from '@/lib/api/types';
import {
  ENDPOINT_PROVIDER_OPTIONS,
  getModelsByCapability,
  getProviderOption,
  type ProviderOption,
} from '@/lib/endpoints/provider-catalog';
import { resolveEndpointProtocolLabel } from '@/lib/endpoints/protocol-utils';
import { toast } from '@/components/ui/toast';
import { useApiError } from '@/lib/hooks/use-api-error';

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
  type CapabilityOption = EndpointCapabilityType;
  type CatalogModelOption = {
    model_id: string;
    name: string;
    capabilities: EndpointCapabilityType[];
    limit?: {
      context?: number;
      output?: number;
    };
    cost?: Record<string, number | Record<string, number>>;
  };

  const [provider, setProvider] = React.useState<ProviderOption>('openai');
  const [capability, setCapability] = React.useState<CapabilityOption>('chat_completion');
  const [name, setName] = React.useState(endpoint.name);
  const [description, setDescription] = React.useState(endpoint.description ?? '');
  const [openaiModel, setOpenaiModel] = React.useState(endpoint.openai_model);
  const [baseUrl, setBaseUrl] = React.useState(endpoint.base_url);
  const [status, setStatus] = React.useState<'active' | 'disabled'>(endpoint.status);
  const [credentialRef, setCredentialRef] = React.useState(endpoint.credential_ref ?? '');
  const [maxContextTokens, setMaxContextTokens] = React.useState(String(endpoint.runtime_profile?.max_context_tokens ?? 128000));
  const [maxOutputTokens, setMaxOutputTokens] = React.useState(String(endpoint.runtime_profile?.max_output_tokens ?? 8192));
  const [supportsFile, setSupportsFile] = React.useState(endpoint.runtime_profile?.supports_file ?? false);
  const [supportsToolCall, setSupportsToolCall] = React.useState(endpoint.runtime_profile?.supports_tool_call ?? true);
  const [supportsReasoning, setSupportsReasoning] = React.useState(endpoint.runtime_profile?.supports_reasoning ?? false);
  const [priceInputPer1m, setPriceInputPer1m] = React.useState(String(endpoint.runtime_profile?.price_input_per_1m ?? 0));
  const [priceOutputPer1m, setPriceOutputPer1m] = React.useState(String(endpoint.runtime_profile?.price_output_per_1m ?? 0));
  const [cacheReadDiscountRatio, setCacheReadDiscountRatio] = React.useState(String(endpoint.runtime_profile?.cache_read_discount_ratio ?? 0));
  const [cacheWriteDiscountRatio, setCacheWriteDiscountRatio] = React.useState(String(endpoint.runtime_profile?.cache_write_discount_ratio ?? 0));
  const [isSaving, setIsSaving] = React.useState(false);

  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);
  const credentialsAPI = React.useMemo(() => new CredentialsAPI(getApiClient()), []);
  const runtimeAPI = React.useMemo(() => new RuntimeAPI(getApiClient()), []);
  const selectedProvider = React.useMemo(() => getProviderOption(provider), [provider]);
  const fallbackProviderModels = React.useMemo<CatalogModelOption[]>(
    () => getModelsByCapability(selectedProvider, capability),
    [selectedProvider, capability],
  );

  const { data: runtimeCatalogModelsData } = useQuery({
    queryKey: ['runtime-catalog-models', workspaceId, projectId, provider, capability, 'edit'],
    queryFn: () =>
      runtimeAPI.listCatalogModels(workspaceId, projectId, {
        provider: provider === 'custom' ? undefined : provider,
        capability,
      }),
    enabled: open && !!workspaceId && !!projectId && provider !== 'custom',
  });

  const providerModels = React.useMemo<CatalogModelOption[]>(() => {
    const runtimeItems = runtimeCatalogModelsData?.items ?? [];
    if (runtimeItems.length === 0) return fallbackProviderModels;
    return runtimeItems.map((item) => ({
      model_id: item.model_id,
      name: item.name || item.model_id,
      capabilities: item.capabilities as EndpointCapabilityType[],
      limit: item.limit,
      cost: item.cost,
    }));
  }, [runtimeCatalogModelsData?.items, fallbackProviderModels]);

  const selectedCatalogModel = React.useMemo(
    () => providerModels.find((item) => item.model_id === openaiModel),
    [providerModels, openaiModel],
  );

  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials', workspaceId, projectId],
    queryFn: () => credentialsAPI.list(workspaceId, projectId),
    enabled: open && !!workspaceId && !!projectId,
  });

  React.useEffect(() => {
    if (!open) return;
    setName(endpoint.name);
    setDescription(endpoint.description ?? '');
    setOpenaiModel(endpoint.openai_model);
    setBaseUrl(endpoint.base_url);
    setStatus(endpoint.status);
    setCredentialRef(endpoint.credential_ref ?? '');
    setMaxContextTokens(String(endpoint.runtime_profile?.max_context_tokens ?? 128000));
    setMaxOutputTokens(String(endpoint.runtime_profile?.max_output_tokens ?? 8192));
    setSupportsFile(endpoint.runtime_profile?.supports_file ?? false);
    setSupportsToolCall(endpoint.runtime_profile?.supports_tool_call ?? true);
    setSupportsReasoning(endpoint.runtime_profile?.supports_reasoning ?? false);
    setPriceInputPer1m(String(endpoint.runtime_profile?.price_input_per_1m ?? 0));
    setPriceOutputPer1m(String(endpoint.runtime_profile?.price_output_per_1m ?? 0));
    setCacheReadDiscountRatio(String(endpoint.runtime_profile?.cache_read_discount_ratio ?? 0));
    setCacheWriteDiscountRatio(String(endpoint.runtime_profile?.cache_write_discount_ratio ?? 0));
    const family = endpoint.provider_family ?? 'openai';
    setProvider(
      family === 'anthropic' ||
      family === 'deepseek' ||
      family === 'minimax' ||
      family === 'kimi' ||
      family === 'google' ||
      family === 'glm' ||
      family === 'alibaba' ||
      family === 'custom'
        ? family
        : 'openai',
    );
    const selectedCapability =
      endpoint.capabilities?.find((item) => item.enabled)?.type ??
      endpoint.models?.[0]?.capability ??
      'chat_completion';
    setCapability(selectedCapability);
  }, [open, endpoint]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !openaiModel.trim() || !baseUrl.trim() || !credentialRef.trim()) return;
    setIsSaving(true);
    try {
      await endpointAPI.update(workspaceId, projectId, endpoint.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        openai_model: openaiModel.trim(),
        base_url: baseUrl.trim(),
        status,
        credential_ref: credentialRef,
        provider_family: selectedProvider.family,
        protocol: selectedProvider.protocol,
        meta: {
          compatibility_interface: selectedProvider.compatibility_interface,
        },
        capabilities: [{ type: capability, enabled: true, default_model_id: openaiModel.trim() }],
        models: [{ capability, model_id: openaiModel.trim(), display_name: openaiModel.trim() }],
        defaults:
          capability === 'chat_completion'
            ? { chat_model_id: openaiModel.trim() }
            : capability === 'multimodal_completion'
              ? { multimodal_model_id: openaiModel.trim() }
            : capability === 'embedding'
              ? { embedding_model_id: openaiModel.trim() }
              : capability === 'rerank'
                ? { rerank_model_id: openaiModel.trim() }
                : capability === 'image_generation'
                ? { image_model_id: openaiModel.trim() }
                : { video_model_id: openaiModel.trim() },
        runtime_profile: {
          max_context_tokens: Number(maxContextTokens),
          max_output_tokens: Number(maxOutputTokens),
          supports_file: supportsFile,
          supports_tool_call: supportsToolCall,
          supports_reasoning: supportsReasoning,
          price_input_per_1m: Number(priceInputPer1m),
          price_output_per_1m: Number(priceOutputPer1m),
          cache_read_discount_ratio: Number(cacheReadDiscountRatio),
          cache_write_discount_ratio: Number(cacheWriteDiscountRatio),
        },
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
    openaiModel.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    credentialRef.trim().length > 0 &&
    !isSaving;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex h-full flex-col gap-0 overflow-hidden p-0"
        data-testid="endpoints__edit-dialog"
      >
        <SheetHeader className="border-b border-subtle px-6 py-4">
          <SheetTitle>{t('edit_dialog.title')}</SheetTitle>
          <SheetDescription>{t('edit_dialog.description')}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-2">
              <label htmlFor="endpoint-name" className="text-sm font-medium text-foreground">
                {t('create_dialog.name')} <span className="text-error">*</span>
              </label>
              <Input
                id="endpoint-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSaving}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="endpoint-description" className="text-sm font-medium text-foreground">
                {t('create_dialog.description')}
              </label>
              <textarea
                id="endpoint-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                disabled={isSaving}
                className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Endpoint Capability <span className="text-error">*</span>
              </label>
              <Select
                value={capability}
                onValueChange={(v) => setCapability(v as CapabilityOption)}
                disabled={isSaving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat_completion">Chat Completion</SelectItem>
                  <SelectItem value="multimodal_completion">Multimodal Completion</SelectItem>
                  <SelectItem value="embedding">Embedding</SelectItem>
                  <SelectItem value="rerank">Reranker</SelectItem>
                  <SelectItem value="image_generation">Image Generation</SelectItem>
                  <SelectItem value="video_generation">Video Generation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t('create_dialog.provider')} <span className="text-error">*</span>
              </label>
              <Select
                value={provider}
                onValueChange={(v) => setProvider(v as ProviderOption)}
                disabled={isSaving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENDPOINT_PROVIDER_OPTIONS.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      <span className="flex items-center gap-2">
                        {item.logo_path ? (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-white/90 p-[2px] ring-1 ring-black/10">
                            <Image
                              src={item.logo_path}
                              alt={item.display_name}
                              width={14}
                              height={14}
                              className="object-contain"
                            />
                          </span>
                        ) : null}
                        <span>{item.display_name}</span>
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">{t('create_dialog.provider_custom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t('create_dialog.compatibility_interface')}
              </label>
              <div className="rounded-sm border border-subtle bg-surface-low px-3 py-2 text-sm text-foreground">
                {resolveEndpointProtocolLabel(t, selectedProvider.protocol)}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="endpoint-model" className="text-sm font-medium text-foreground">
                {t('create_dialog.model_id')} <span className="text-error">*</span>
              </label>
              <Input
                id="endpoint-model"
                value={openaiModel}
                onChange={(e) => setOpenaiModel(e.target.value)}
                disabled={isSaving}
                required
              />
            </div>

            {providerModels.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t('create_dialog.catalog_models')}</label>
                <Select
                  value={openaiModel}
                  onValueChange={setOpenaiModel}
                  disabled={isSaving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('create_dialog.select_from_catalog')} />
                  </SelectTrigger>
                  <SelectContent>
                    {providerModels.slice(0, 100).map((model) => (
                      <SelectItem key={model.model_id} value={model.model_id}>
                        {model.name} ({model.model_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCatalogModel && (
                  <div className="rounded-sm border border-subtle bg-surface-low p-3 text-xs text-secondary">
                    <p>
                      {t('create_dialog.catalog_context_tokens')}: {selectedCatalogModel.limit?.context ?? '-'}
                    </p>
                    <p>
                      {t('create_dialog.catalog_output_tokens')}: {selectedCatalogModel.limit?.output ?? '-'}
                    </p>
                    <p>
                      {t('create_dialog.catalog_input_price')}: {typeof selectedCatalogModel.cost?.input === 'number' ? selectedCatalogModel.cost?.input : '-'}
                    </p>
                    <p>
                      {t('create_dialog.catalog_output_price')}: {typeof selectedCatalogModel.cost?.output === 'number' ? selectedCatalogModel.cost?.output : '-'}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="endpoint-base-url" className="text-sm font-medium text-foreground">
                {t('create_dialog.base_url')} <span className="text-error">*</span>
              </label>
              <Input
                id="endpoint-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={isSaving}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t('create_dialog.credential')} <span className="text-error">*</span>
              </label>
              <Select value={credentialRef} onValueChange={setCredentialRef} disabled={isSaving}>
                <SelectTrigger>
                  <SelectValue placeholder={commonT('placeholders.select')} />
                </SelectTrigger>
                <SelectContent>
                  {credentials.map((credential) => (
                    <SelectItem key={credential.id} value={credential.id}>
                      {credential.name} ({credential.fingerprint})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="endpoint-status" className="text-sm font-medium text-foreground">
                {t('status')}
              </label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'disabled')}>
                <SelectTrigger id="endpoint-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('status_active')}</SelectItem>
                  <SelectItem value="disabled">{t('status_disabled')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3 rounded-sm border border-subtle p-3">
              <p className="text-sm font-medium text-foreground">{t('custom_wizard.runtime_profile.title')}</p>
              <div className="grid grid-cols-2 gap-3">
                <Input value={maxContextTokens} onChange={(e) => setMaxContextTokens(e.target.value)} />
                <Input value={maxOutputTokens} onChange={(e) => setMaxOutputTokens(e.target.value)} />
                <Input value={priceInputPer1m} onChange={(e) => setPriceInputPer1m(e.target.value)} />
                <Input value={priceOutputPer1m} onChange={(e) => setPriceOutputPer1m(e.target.value)} />
                <Input value={cacheReadDiscountRatio} onChange={(e) => setCacheReadDiscountRatio(e.target.value)} />
                <Input value={cacheWriteDiscountRatio} onChange={(e) => setCacheWriteDiscountRatio(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Select value={String(supportsFile)} onValueChange={(v) => setSupportsFile(v === 'true')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">{t('custom_wizard.runtime_profile.yes')}</SelectItem>
                    <SelectItem value="false">{t('custom_wizard.runtime_profile.no')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={String(supportsToolCall)} onValueChange={(v) => setSupportsToolCall(v === 'true')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">{t('custom_wizard.runtime_profile.yes')}</SelectItem>
                    <SelectItem value="false">{t('custom_wizard.runtime_profile.no')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={String(supportsReasoning)} onValueChange={(v) => setSupportsReasoning(v === 'true')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">{t('custom_wizard.runtime_profile.yes')}</SelectItem>
                    <SelectItem value="false">{t('custom_wizard.runtime_profile.no')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex flex-shrink-0 justify-end gap-2 border-t border-subtle px-6 py-4">
            <Button variant="ghost" type="button" onClick={() => handleOpenChange(false)}>
              {t('edit_dialog.cancel')}
            </Button>
            <Button variant="primary" type="submit" disabled={!canSubmit}>
              {t('edit_dialog.save')}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
