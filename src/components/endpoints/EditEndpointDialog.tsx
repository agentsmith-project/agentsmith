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
import { CredentialsAPI, EndpointAPI, getApiClient } from '@/lib/api';
import type { Endpoint, EndpointCapabilityType } from '@/lib/api/types';
import {
  ENDPOINT_PROVIDER_OPTIONS,
  getModelsByCapability,
  getProviderOption,
  type ProviderOption,
} from '@/lib/endpoints/provider-catalog';
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

  const [provider, setProvider] = React.useState<ProviderOption>('openai');
  const [capability, setCapability] = React.useState<CapabilityOption>('chat_completion');
  const [name, setName] = React.useState(endpoint.name);
  const [description, setDescription] = React.useState(endpoint.description ?? '');
  const [openaiModel, setOpenaiModel] = React.useState(endpoint.openai_model);
  const [baseUrl, setBaseUrl] = React.useState(endpoint.base_url);
  const [status, setStatus] = React.useState<'active' | 'disabled'>(endpoint.status);
  const [credentialRef, setCredentialRef] = React.useState(endpoint.credential_ref ?? '');
  const [isSaving, setIsSaving] = React.useState(false);

  const endpointAPI = React.useMemo(() => new EndpointAPI(getApiClient()), []);
  const credentialsAPI = React.useMemo(() => new CredentialsAPI(getApiClient()), []);
  const selectedProvider = React.useMemo(() => getProviderOption(provider), [provider]);
  const providerModels = React.useMemo(
    () => getModelsByCapability(selectedProvider, capability),
    [selectedProvider, capability],
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
                <label className="text-sm font-medium text-foreground">Catalog Models</label>
                <Select
                  value={openaiModel}
                  onValueChange={setOpenaiModel}
                  disabled={isSaving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select from catalog (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {providerModels.slice(0, 100).map((model) => (
                      <SelectItem key={model.model_id} value={model.model_id}>
                        {model.name} ({model.model_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
