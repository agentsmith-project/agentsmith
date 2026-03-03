'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import Image from 'next/image';
import { useLocale } from 'next-intl';
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
import { Loader2, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EndpointAPI, CredentialsAPI, RuntimeAPI, getApiClient } from '@/lib/api';
import type { CreateEndpointRequest } from '@/lib/api/endpoints/endpoints';
import type { EndpointCapabilityType } from '@/lib/api/types';
import {
  APIError,
  resolveApiErrorPresentation,
  resolveErrorMessageByCode,
} from '@/lib/api/errors';
import {
  ENDPOINT_PROVIDER_OPTIONS,
  getModelsByCapability,
  getProviderOption,
  type ProviderOption,
} from '@/lib/endpoints/provider-catalog';
import { resolveEndpointProtocolLabel } from '@/lib/endpoints/protocol-utils';
import { toast } from '@/components/ui/toast';
import { CustomEndpointWizard } from './CustomEndpointWizard';

export interface CreateEndpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  onSuccess?: () => void;
}

export function CreateEndpointDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  onSuccess,
}: CreateEndpointDialogProps) {
  const t = useTranslations('endpoints');
  const tErrors = useTranslations('errors');
  const commonT = useTranslations('common');
  const locale = useLocale();
  const tWizard = useTranslations('endpoints.custom_wizard');
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

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [openaiModel, setOpenaiModel] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [provider, setProvider] = React.useState<ProviderOption>('openai');
  const [capability, setCapability] = React.useState<CapabilityOption>('chat_completion');
  const [credentialRef, setCredentialRef] = React.useState<string>('');
  const [limitsExpanded, setLimitsExpanded] = React.useState(false);
  const [maxRequestsPerMinute, setMaxRequestsPerMinute] = React.useState<string>('');
  const [timeoutSeconds, setTimeoutSeconds] = React.useState<string>('');

  // Custom wizard state
  const [showCustomWizard, setShowCustomWizard] = React.useState(false);

  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);
  const credentialsAPI = React.useMemo(() => new CredentialsAPI(getApiClient()), []);
  const runtimeAPI = React.useMemo(() => new RuntimeAPI(getApiClient()), []);
  const selectedProvider = React.useMemo(() => getProviderOption(provider), [provider]);
  const requiresManualBaseUrl = selectedProvider.default_base_url.length === 0;
  const fallbackProviderModels = React.useMemo<CatalogModelOption[]>(
    () => getModelsByCapability(selectedProvider, capability),
    [selectedProvider, capability],
  );

  const { data: runtimeCatalogModelsData } = useQuery({
    queryKey: ['runtime-catalog-models', workspaceId, projectId, provider, capability],
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

  const { data: existingEndpoints = [] } = useQuery({
    queryKey: ['endpoints', workspaceId, projectId, 'name-check'],
    queryFn: async () => {
      const res = await endpointAPI.list(workspaceId, projectId, { page: 1, page_size: 500 });
      return res.items ?? [];
    },
    enabled: open && !!workspaceId && !!projectId,
  });

  const normalizedName = name.trim().toLowerCase();
  const duplicateNameExists = normalizedName.length > 0
    && existingEndpoints.some((endpoint) => endpoint.name.trim().toLowerCase() === normalizedName);

  const createMutation = useMutation({
    mutationFn: async (data: CreateEndpointRequest) => {
      return endpointAPI.create(workspaceId, projectId, data);
    },
    onSuccess: () => {
      onOpenChange(false);
      resetForm();
      toast.success(t('create_dialog.success'));
      onSuccess?.();
    },
    onError: (error: unknown) => {
      if (error instanceof APIError) {
        const overrideMessage = resolveErrorMessageByCode(
          error.errorCode,
          {
            ENDPOINT_MODEL_CONFLICT: t('create_dialog.model_conflict'),
          },
          '',
        );
        if (overrideMessage) {
          toast.error(overrideMessage);
          return;
        }
        const resolved = resolveApiErrorPresentation({
          error,
          t: tErrors,
          fallbackMessage: t('create_dialog.failed'),
        });
        toast.error(`${resolved.title}: ${resolved.description}`);
        return;
      }
      if (error instanceof Error) {
        toast.error(error.message || t('create_dialog.failed'));
        return;
      }
      toast.error(t('create_dialog.failed'));
    },
  });

  const resetForm = () => {
    setName('');
    setDescription('');
    setOpenaiModel('');
    setBaseUrl('');
    setProvider('openai');
    setCapability('chat_completion');
    setCredentialRef('');
    setLimitsExpanded(false);
    setMaxRequestsPerMinute('');
    setTimeoutSeconds('');
  };

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !openaiModel.trim() || !credentialRef) {
      if (!credentialRef) {
        toast.error(t('create_dialog.credential_required'));
      }
      return;
    }
    if (duplicateNameExists) {
      toast.error(t('create_dialog.name_conflict'));
      return;
    }
    if (requiresManualBaseUrl && !baseUrl.trim()) {
      toast.error(t('create_dialog.base_url_required'));
      return;
    }

    const url = baseUrl.trim() || selectedProvider.default_base_url || '';

    const data: CreateEndpointRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      openai_model: openaiModel.trim(),
      type: provider === 'openai' ? 'openai' : 'custom',
      base_url: url,
      credential_ref: credentialRef,
      provider_family: selectedProvider.family,
      protocol: selectedProvider.protocol,
      meta: {
        compatibility_interface: selectedProvider.compatibility_interface,
      },
      capabilities: [{ type: capability, enabled: true, default_model_id: openaiModel.trim() }],
      models: [{ capability, model_id: openaiModel.trim(), display_name: openaiModel.trim() }],
      defaults: capability === 'chat_completion'
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
      runtime_profile: provider === 'custom'
        ? {
          max_context_tokens: 128000,
          max_output_tokens: 8192,
          supports_file: capability === 'multimodal_completion',
          supports_tool_call: true,
          supports_reasoning: false,
          price_input_per_1m: 0,
          price_output_per_1m: 0,
          cache_read_discount_ratio: 0,
          cache_write_discount_ratio: 0,
        }
        : undefined,
    };

    if (limitsExpanded && (maxRequestsPerMinute || timeoutSeconds)) {
      data.limits = {};
      if (maxRequestsPerMinute.trim()) {
        data.limits.max_requests_per_minute = parseInt(maxRequestsPerMinute, 10);
      }
      if (timeoutSeconds.trim()) {
        data.limits.timeout_seconds = parseInt(timeoutSeconds, 10);
      }
    }

    createMutation.mutate(data);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !createMutation.isPending) {
      onOpenChange(next);
    }
  };

  const canSubmit =
    name.trim().length > 0 &&
    !duplicateNameExists &&
    openaiModel.trim().length > 0 &&
    credentialRef.length > 0 &&
    (!requiresManualBaseUrl || baseUrl.trim().length > 0) &&
    !createMutation.isPending;

  return (
    <>
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right-wide"
        className="flex h-full flex-col gap-0 overflow-hidden p-0"
        data-testid="endpoints__create-dialog"
      >
        <SheetHeader className="border-b border-subtle px-6 py-4">
          <SheetTitle>{t('create_dialog.title')}</SheetTitle>
          <SheetDescription>{t('create_dialog.description')}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 flex flex-col gap-4 overflow-y-auto px-6 py-4">
          <div className="space-y-2 order-4">
            <label htmlFor="endpoint-name" className="text-sm font-medium text-foreground">
              {t('create_dialog.name')} <span className="text-error">*</span>
            </label>
            <Input
              id="endpoint-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create_dialog.name_placeholder')}
              disabled={createMutation.isPending}
              required
            />
            <p className="text-xs text-tertiary">{t('create_dialog.name_hint')}</p>
            {duplicateNameExists ? (
              <p className="text-xs text-error">{t('create_dialog.name_conflict')}</p>
            ) : null}
          </div>

          <div className="space-y-2 order-5">
            <label htmlFor="endpoint-description" className="text-sm font-medium text-foreground">
              {t('create_dialog.description')}
            </label>
            <textarea
              id="endpoint-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={commonT('placeholders.enter_description')}
              rows={2}
              disabled={createMutation.isPending}
              className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          <div className="space-y-2 order-6">
            <label htmlFor="endpoint-model" className="text-sm font-medium text-foreground">
              {t('create_dialog.model_id')} <span className="text-error">*</span>
            </label>
            <Input
              id="endpoint-model"
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              placeholder={t('create_dialog.model_id_placeholder')}
              disabled={createMutation.isPending}
              required
              className="font-mono"
            />
          </div>

          <div className="space-y-2 order-2">
            <label className="text-sm font-medium text-foreground">
              {t('create_dialog.capability')} <span className="text-error">*</span>
            </label>
            <Select
              value={capability}
              onValueChange={(v) => setCapability(v as CapabilityOption)}
              disabled={createMutation.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat_completion">{t('create_dialog.capability_chat_completion')}</SelectItem>
                <SelectItem value="multimodal_completion">{t('create_dialog.capability_multimodal_completion')}</SelectItem>
                <SelectItem value="embedding">{t('create_dialog.capability_embedding')}</SelectItem>
                <SelectItem value="rerank">{t('create_dialog.capability_rerank')}</SelectItem>
                <SelectItem value="image_generation">{t('create_dialog.capability_image_generation')}</SelectItem>
                <SelectItem value="video_generation">{t('create_dialog.capability_video_generation')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 order-1">
            <label className="text-sm font-medium text-foreground">
              {t('create_dialog.provider')} <span className="text-error">*</span>
            </label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as ProviderOption)}
              disabled={createMutation.isPending}
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
                <SelectItem value="custom">
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    {t('create_dialog.provider_custom')}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 order-2">
            <label className="text-sm font-medium text-foreground">
              {t('create_dialog.compatibility_interface')}
            </label>
            <div className="rounded-sm border border-subtle bg-surface-low px-3 py-2 text-sm text-foreground">
              {resolveEndpointProtocolLabel(t, selectedProvider.protocol)}
            </div>
          </div>

          {/* Show wizard button for custom provider */}
          {provider === 'custom' && (
            <div className="space-y-2 order-8">
              <div className="rounded-sm bg-accent/5 border border-accent/20 p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-accent mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {tWizard('title')}
                    </p>
                    <p className="text-xs text-tertiary mt-1">
                      {t('create_dialog.wizard_description')}
                    </p>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      className="mt-3"
                      onClick={() => setShowCustomWizard(true)}
                    >
                      {t('create_dialog.open_wizard_button')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2 order-7">
            <div className="flex items-center justify-between">
              <label htmlFor="endpoint-base-url" className="text-sm font-medium text-foreground">
                {t('create_dialog.base_url')}
                {provider === 'custom' && <span className="text-error"> *</span>}
              </label>
              {(provider === 'openai' || selectedProvider.default_base_url) && (
                <button
                  type="button"
                  onClick={() => setBaseUrl(
                    provider === 'openai'
                      ? 'https://api.openai.com/v1'
                      : selectedProvider.default_base_url
                  )}
                  className="text-xs text-accent hover:underline"
                  data-testid="endpoint-use-default-url"
                >
                  {tWizard('use_default')}
                </button>
              )}
            </div>
            <Input
              id="endpoint-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                provider === 'openai'
                  ? 'https://api.openai.com/v1'
                  : selectedProvider.default_base_url || 'https://your-api.example.com/v1'
              }
              disabled={createMutation.isPending}
              className="font-mono text-sm"
            />
          </div>

          {providerModels.length > 0 && (
            <div className="space-y-2 order-3">
              <label className="text-sm font-medium text-foreground">{t('create_dialog.catalog_models')}</label>
              <Select
                value={openaiModel}
                onValueChange={setOpenaiModel}
                disabled={createMutation.isPending}
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

          <div className="space-y-2 order-9">
            <label className="text-sm font-medium text-foreground">
              {t('create_dialog.credential')} <span className="text-error">*</span>
            </label>
            {credentials.length === 0 ? (
              <div className="rounded-sm border border-subtle bg-surface-low p-4 text-sm text-tertiary">
                {t('create_dialog.no_credentials')}{' '}
                <Link
                  href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/credentials`}
                  className="text-accent hover:underline"
                >
                  {t('create_dialog.create_credential_first')}
                </Link>
              </div>
            ) : (
              <Select
                value={credentialRef}
                onValueChange={setCredentialRef}
                disabled={createMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={commonT('placeholders.select')} />
                </SelectTrigger>
                <SelectContent>
                  {credentials.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.fingerprint})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2 order-10">
            <button
              type="button"
              onClick={() => setLimitsExpanded((v) => !v)}
              className="flex items-center gap-2 text-sm text-primary hover:text-foreground"
            >
              {limitsExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              {t('create_dialog.limits')}
            </button>
            {limitsExpanded && (
              <div className="grid grid-cols-2 gap-4 pl-6">
                <div className="space-y-1">
                  <label htmlFor="endpoint-rpm" className="text-xs text-tertiary">
                    {t('create_dialog.max_rpm')}
                  </label>
                  <Input
                    id="endpoint-rpm"
                    type="number"
                    min={1}
                    value={maxRequestsPerMinute}
                    onChange={(e) => setMaxRequestsPerMinute(e.target.value)}
                    placeholder={commonT('placeholders.optional')}
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="endpoint-timeout" className="text-xs text-tertiary">
                    {t('create_dialog.timeout_seconds')}
                  </label>
                  <Input
                    id="endpoint-timeout"
                    type="number"
                    min={1}
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(e.target.value)}
                    placeholder={commonT('placeholders.optional')}
                    disabled={createMutation.isPending}
                  />
                </div>
              </div>
            )}
          </div>

          </div>

          <div className="flex flex-shrink-0 justify-end gap-2 border-t border-subtle px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={createMutation.isPending}
            >
              {commonT('cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!canSubmit || credentials.length === 0}
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                commonT('create')
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>

    {/* Custom Endpoint Wizard */}
    <CustomEndpointWizard
      open={showCustomWizard}
      onOpenChange={(isOpen) => {
        setShowCustomWizard(isOpen);
        if (isOpen) {
          onOpenChange(false); // Close main dialog when wizard opens
        } else {
          onOpenChange(true); // Reopen main dialog when wizard closes
        }
      }}
      workspaceId={workspaceId}
      projectId={projectId}
      onSuccess={() => {
        setShowCustomWizard(false);
        onSuccess?.();
      }}
    />
  </>
  );
}
