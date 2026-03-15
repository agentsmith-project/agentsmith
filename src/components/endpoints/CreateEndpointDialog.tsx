'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { PlugZap, Sparkles } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EndpointAPI, CredentialsAPI, ModelConfigAPI, getApiClient } from '@/lib/api';
import type { CreateEndpointRequest } from '@/lib/api/endpoints/endpoints';
import {
  APIError,
  resolveApiErrorPresentation,
  resolveErrorMessageByCode,
} from '@/lib/api/errors';
import {
  buildModelCatalogProviderOptions,
  CUSTOM_MODEL_CATALOG_PROVIDER_OPTION,
} from '@/lib/endpoints/model-catalog-provider-options';
import { toast } from '@/components/ui/toast';
import { CustomEndpointWizard } from './CustomEndpointWizard';
import { EndpointBasicsForm } from './create-endpoint-dialog/EndpointBasicsForm';
import { EndpointDialogFooter } from './create-endpoint-dialog/EndpointDialogFooter';
import type { CapabilityOption, CatalogModelOption } from './create-endpoint-dialog/types';
import { buildCreateEndpointPayload, buildProviderModels } from './create-endpoint-dialog/utils';

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

    createMutation.mutate(buildCreateEndpointPayload({
      baseUrl,
      capability,
      credentialRef,
      description,
      name,
      provider,
      selectedProvider,
      selectedModel,
    }));
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
        <SheetHeader className="border-b border-subtle px-6 py-5">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <PlugZap className="h-3.5 w-3.5" />
            Endpoint
          </div>
          <SheetTitle>{t('create_dialog.title')}</SheetTitle>
          <SheetDescription>{t('create_dialog.description')}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-white/6 px-6 py-4">
            <div className="rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(124,160,255,0.08),rgba(124,160,255,0.02))] p-4">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{t('create_dialog.title')}</p>
                  <p className="text-sm leading-6 text-secondary">
                    {t('create_dialog.description')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <EndpointBasicsForm
            baseUrl={baseUrl}
            capability={capability}
            commonT={commonT}
            createPending={createMutation.isPending}
            credentialRef={credentialRef}
            credentials={credentials}
            description={description}
            duplicateNameExists={duplicateNameExists}
            locale={locale}
            name={name}
            projectId={projectId}
            provider={provider}
            providerModels={providerModels}
            providerOptions={providerOptions}
            selectedCatalogModel={selectedCatalogModel ?? null}
            selectedModel={selectedModel}
            selectedProvider={selectedProvider}
            t={t}
            workspaceId={workspaceId}
            onBaseUrlChange={setBaseUrl}
            onCapabilityChange={setCapability}
            onCredentialRefChange={setCredentialRef}
            onDescriptionChange={setDescription}
            onNameChange={setName}
            onOpenWizard={() => setShowCustomWizard(true)}
            onProviderChange={setProvider}
            onSelectedModelChange={setSelectedModel}
          />

          <EndpointDialogFooter
            canSubmit={canSubmit}
            createPending={createMutation.isPending}
            hasCredentials={credentials.length > 0}
            commonT={commonT}
            onCancel={() => handleOpenChange(false)}
          />
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
