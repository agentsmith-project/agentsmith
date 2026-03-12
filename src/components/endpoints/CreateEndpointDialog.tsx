'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
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
import { Loader2, Sparkles } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EndpointAPI, CredentialsAPI, ModelConfigAPI, getApiClient } from '@/lib/api';
import type { CreateEndpointRequest } from '@/lib/api/endpoints/endpoints';
import type { EndpointCapabilityType } from '@/lib/api/types';
import {
  APIError,
  resolveApiErrorPresentation,
  resolveErrorMessageByCode,
} from '@/lib/api/errors';
import {
  buildModelCatalogProviderOptions,
  CUSTOM_MODEL_CATALOG_PROVIDER_OPTION,
} from '@/lib/endpoints/model-catalog-provider-options';
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
  const [selectedModel, setSelectedModel] = React.useState('');
  const [provider, setProvider] = React.useState<string>('openai');
  const [capability, setCapability] = React.useState<CapabilityOption>('chat_completion');
  const [credentialRef, setCredentialRef] = React.useState<string>('');
  const [baseUrl, setBaseUrl] = React.useState('');

  // Custom wizard state
  const [showCustomWizard, setShowCustomWizard] = React.useState(false);

  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);
  const credentialsAPI = React.useMemo(() => new CredentialsAPI(getApiClient()), []);
  const modelConfigAPI = React.useMemo(() => new ModelConfigAPI(getApiClient()), []);
  const { data: modelCatalogProvidersData } = useQuery({
    queryKey: ['model-catalog-providers', workspaceId, projectId],
    queryFn: () => modelConfigAPI.listModelCatalogProviders(workspaceId, projectId),
    enabled: open && !!workspaceId && !!projectId,
  });
  const providerOptions = React.useMemo(
    () => buildModelCatalogProviderOptions(modelCatalogProvidersData?.items ?? []),
    [modelCatalogProvidersData?.items],
  );
  const matchedProvider = React.useMemo(
    () => providerOptions.find((item) => item.key === provider) ?? null,
    [providerOptions, provider],
  );
  const selectedProvider = matchedProvider ?? CUSTOM_MODEL_CATALOG_PROVIDER_OPTION;

  const { data: modelCatalogModelsData } = useQuery({
    queryKey: ['model-catalog-models', workspaceId, projectId, provider, capability],
    queryFn: () =>
      modelConfigAPI.listModelCatalogModels(workspaceId, projectId, {
        provider,
        capability,
      }),
    enabled: open && !!workspaceId && !!projectId,
  });

  const providerModels = React.useMemo<CatalogModelOption[]>(() => {
    const catalogItems = modelCatalogModelsData?.items ?? [];
    if (catalogItems.length === 0) return [];
    return catalogItems.map((item) => ({
      model_id: item.model_id,
      name: item.name || item.model_id,
      capabilities: item.capabilities as EndpointCapabilityType[],
      limit: item.limit,
      cost: item.cost,
    }));
  }, [modelCatalogModelsData?.items]);

  const selectedCatalogModel = React.useMemo(
    () => providerModels.find((item) => item.model_id === selectedModel),
    [providerModels, selectedModel],
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
    setSelectedModel('');
    setProvider('openai');
    setCapability('chat_completion');
    setCredentialRef('');
    setBaseUrl('');
  };

  React.useEffect(() => {
    if (open) {
      resetForm();
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || providerOptions.length === 0) return;
    const preferredProvider =
      matchedProvider
      ?? providerOptions.find((item) => item.key === 'openai')
      ?? providerOptions[0]
      ?? null;
    if (!preferredProvider) return;

    if (provider !== preferredProvider.key) {
      setProvider(preferredProvider.key);
    }

    setBaseUrl(preferredProvider.default_base_url.trim());
  }, [open, providerOptions, matchedProvider, provider]);

  React.useEffect(() => {
    if (!open) return;
    if (providerModels.length === 0) {
      setSelectedModel('');
      return;
    }
    if (!providerModels.some((item) => item.model_id === selectedModel)) {
      setSelectedModel(providerModels[0]?.model_id ?? '');
    }
  }, [open, providerModels, selectedModel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !selectedModel.trim() || !credentialRef) {
      if (!credentialRef) {
        toast.error(t('create_dialog.credential_required'));
      }
      return;
    }
    if (duplicateNameExists) {
      toast.error(t('create_dialog.name_conflict'));
      return;
    }
    if (!baseUrl.trim()) {
      toast.error(t('create_dialog.base_url_required'));
      return;
    }

    const url = baseUrl.trim();

    const data: CreateEndpointRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      model: selectedModel.trim(),
      type: provider === 'openai' ? 'openai' : 'custom',
      base_url: url,
      credential_ref: credentialRef,
      provider_family: selectedProvider.family,
      protocol: selectedProvider.protocol,
      meta: {
        compatibility_interface: selectedProvider.compatibility_interface,
        catalog_provider_key: provider,
      },
      capabilities: [{ type: capability, enabled: true, default_model_id: selectedModel.trim() }],
      models: [{ capability, model_id: selectedModel.trim(), display_name: selectedModel.trim() }],
      defaults: capability === 'chat_completion'
        ? { chat_model_id: selectedModel.trim() }
        : capability === 'multimodal_completion'
          ? { multimodal_model_id: selectedModel.trim() }
        : capability === 'embedding'
          ? { embedding_model_id: selectedModel.trim() }
          : capability === 'rerank'
            ? { rerank_model_id: selectedModel.trim() }
            : capability === 'image_generation'
              ? { image_model_id: selectedModel.trim() }
              : { video_model_id: selectedModel.trim() },
      model_profile: undefined,
    };

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
    selectedModel.trim().length > 0 &&
    credentialRef.length > 0 &&
    baseUrl.trim().length > 0 &&
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
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">
                {t('create_dialog.provider')} <span className="text-error">*</span>
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowCustomWizard(true)}
                disabled={createMutation.isPending}
              >
                <Sparkles className="mr-1 h-4 w-4" />
                {t('create_dialog.open_wizard_button')}
              </Button>
            </div>
            <Select
              value={provider}
              onValueChange={setProvider}
              disabled={createMutation.isPending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    <span className="flex items-center gap-2">
                      <span>{item.display_name}</span>
                    </span>
                  </SelectItem>
                ))}
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

          {providerModels.length > 0 && (
            <div className="space-y-2 order-3">
              <label className="text-sm font-medium text-foreground">{t('create_dialog.catalog_models')}</label>
              <p className="text-xs text-tertiary">{t('create_dialog.model_id_hint')}</p>
              <Select
                value={selectedModel}
                onValueChange={setSelectedModel}
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

          {providerModels.length === 0 && (
            <div className="order-3 rounded-sm border border-subtle bg-surface-low p-3 text-xs text-secondary">
              {t('create_dialog.select_from_catalog')}
            </div>
          )}

          <div className="space-y-2 order-8">
            <label htmlFor="endpoint-base-url" className="text-sm font-medium text-foreground">
              {t('create_dialog.base_url')} <span className="text-error">*</span>
            </label>
            <Input
              id="endpoint-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              disabled={createMutation.isPending}
              required
            />
          </div>

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
