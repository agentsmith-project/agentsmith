'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { resolveEndpointProtocolLabel } from '@/lib/endpoints/protocol-utils';

import type { CapabilityOption, CatalogModelOption, EndpointProviderSelection } from './types';

interface EndpointBasicsFormProps {
  baseUrl: string;
  capability: CapabilityOption;
  commonT: (key: string) => string;
  createPending: boolean;
  credentialRef: string;
  credentials: Array<{ id: string; name: string; fingerprint?: string }>;
  description: string;
  duplicateNameExists: boolean;
  locale: string;
  name: string;
  projectId: string;
  provider: string;
  providerModels: CatalogModelOption[];
  providerOptions: Array<{ key: string; display_name: string }>;
  selectedCatalogModel: CatalogModelOption | null;
  selectedModel: string;
  selectedProvider: EndpointProviderSelection;
  t: (key: string) => string;
  workspaceId: string;
  onBaseUrlChange: (value: string) => void;
  onCapabilityChange: (value: CapabilityOption) => void;
  onCredentialRefChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onOpenWizard: () => void;
  onProviderChange: (value: string) => void;
  onSelectedModelChange: (value: string) => void;
}

export function EndpointBasicsForm({
  baseUrl,
  capability,
  commonT,
  createPending,
  credentialRef,
  credentials,
  description,
  duplicateNameExists,
  locale,
  name,
  projectId,
  provider,
  providerModels,
  providerOptions,
  selectedCatalogModel,
  selectedModel,
  selectedProvider,
  t,
  workspaceId,
  onBaseUrlChange,
  onCapabilityChange,
  onCredentialRefChange,
  onDescriptionChange,
  onNameChange,
  onOpenWizard,
  onProviderChange,
  onSelectedModelChange,
}: EndpointBasicsFormProps) {
  return (
    <div className="flex-1 flex flex-col gap-4 overflow-y-auto px-6 py-4">
      <div className="space-y-2 order-4">
        <label htmlFor="endpoint-name" className="text-sm font-medium text-foreground">
          {t('create_dialog.name')} <span className="text-error">*</span>
        </label>
        <Input
          id="endpoint-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t('create_dialog.name_placeholder')}
          disabled={createPending}
          required
        />
        <p className="text-xs text-tertiary">{t('create_dialog.name_hint')}</p>
        {duplicateNameExists ? <p className="text-xs text-error">{t('create_dialog.name_conflict')}</p> : null}
      </div>

      <div className="space-y-2 order-5">
        <label htmlFor="endpoint-description" className="text-sm font-medium text-foreground">
          {t('create_dialog.description')}
        </label>
        <textarea
          id="endpoint-description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder={commonT('placeholders.enter_description')}
          rows={2}
          disabled={createPending}
          className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>

      <div className="space-y-2 order-2">
        <label className="text-sm font-medium text-foreground">
          {t('create_dialog.capability')} <span className="text-error">*</span>
        </label>
        <Select value={capability} onValueChange={(value) => onCapabilityChange(value as CapabilityOption)} disabled={createPending}>
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
          <Button type="button" variant="secondary" size="sm" onClick={onOpenWizard} disabled={createPending}>
            <Sparkles className="mr-1 h-4 w-4" />
            {t('create_dialog.open_wizard_button')}
          </Button>
        </div>
        <Select value={provider} onValueChange={onProviderChange} disabled={createPending}>
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

      {providerModels.length > 0 ? (
        <div className="space-y-2 order-3">
          <label className="text-sm font-medium text-foreground">{t('create_dialog.catalog_models')}</label>
          <p className="text-xs text-tertiary">{t('create_dialog.model_id_hint')}</p>
          <Select value={selectedModel} onValueChange={onSelectedModelChange} disabled={createPending}>
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
          {selectedCatalogModel ? (
            <div className="rounded-sm border border-subtle bg-surface-low p-3 text-xs text-secondary">
              <p>{t('create_dialog.catalog_context_tokens')}: {selectedCatalogModel.limit?.context ?? '-'}</p>
              <p>{t('create_dialog.catalog_output_tokens')}: {selectedCatalogModel.limit?.output ?? '-'}</p>
              <p>{t('create_dialog.catalog_input_price')}: {typeof selectedCatalogModel.cost?.input === 'number' ? selectedCatalogModel.cost?.input : '-'}</p>
              <p>{t('create_dialog.catalog_output_price')}: {typeof selectedCatalogModel.cost?.output === 'number' ? selectedCatalogModel.cost?.output : '-'}</p>
            </div>
          ) : null}
        </div>
      ) : (
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
          onChange={(event) => onBaseUrlChange(event.target.value)}
          placeholder="https://api.example.com/v1"
          disabled={createPending}
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
          <Select value={credentialRef} onValueChange={onCredentialRefChange} disabled={createPending}>
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
        )}
      </div>
    </div>
  );
}
