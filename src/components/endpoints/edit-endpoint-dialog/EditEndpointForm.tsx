'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CUSTOM_PROTOCOL_OPTIONS } from '@/lib/endpoints/provider-catalog';
import { resolveEndpointProtocolLabel } from '@/lib/endpoints/protocol-utils';

import type { CapabilityOption, CatalogModelOption, EndpointProviderSelection } from '../create-endpoint-dialog/types';

interface EditEndpointFormProps {
  baseUrl: string;
  cacheReadDiscountRatio: string;
  cacheWriteDiscountRatio: string;
  capability: CapabilityOption;
  commonT: (key: string) => string;
  credentialRef: string;
  credentials: Array<{ id: string; name: string; fingerprint?: string }>;
  description: string;
  isCustomProvider: boolean;
  isEndpointCustom: boolean;
  isSaving: boolean;
  maxContextTokens: string;
  maxOutputTokens: string;
  name: string;
  priceInputPer1m: string;
  priceOutputPer1m: string;
  provider: string;
  providerModels: CatalogModelOption[];
  providerOptions: Array<{ key: string; display_name: string }>;
  selectedCatalogModel: CatalogModelOption | null;
  selectedModel: string;
  selectedProvider: EndpointProviderSelection & { default_base_url?: string };
  status: 'active' | 'disabled';
  supportsFile: boolean;
  supportsReasoning: boolean;
  supportsToolCall: boolean;
  t: (key: string) => string;
  upstreamProtocol: EndpointProviderSelection['upstream_protocol'];
  onApplyModelProfileDefaults: () => void;
  onBaseUrlChange: (value: string) => void;
  onCacheReadDiscountRatioChange: (value: string) => void;
  onCacheWriteDiscountRatioChange: (value: string) => void;
  onCapabilityChange: (value: CapabilityOption) => void;
  onCredentialRefChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onMaxContextTokensChange: (value: string) => void;
  onMaxOutputTokensChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onPriceInputPer1mChange: (value: string) => void;
  onPriceOutputPer1mChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onSelectedModelChange: (value: string) => void;
  onStatusChange: (value: 'active' | 'disabled') => void;
  onSupportsFileChange: (value: boolean) => void;
  onUpstreamProtocolChange: (value: EndpointProviderSelection['upstream_protocol']) => void;
  onSupportsReasoningChange: (value: boolean) => void;
  onSupportsToolCallChange: (value: boolean) => void;
}

export function EditEndpointForm({
  baseUrl,
  cacheReadDiscountRatio,
  cacheWriteDiscountRatio,
  capability,
  commonT,
  credentialRef,
  credentials,
  description,
  isCustomProvider,
  isEndpointCustom,
  isSaving,
  maxContextTokens,
  maxOutputTokens,
  name,
  priceInputPer1m,
  priceOutputPer1m,
  provider,
  providerModels,
  providerOptions,
  selectedCatalogModel,
  selectedModel,
  selectedProvider,
  status,
  supportsFile,
  supportsReasoning,
  supportsToolCall,
  t,
  upstreamProtocol,
  onApplyModelProfileDefaults,
  onBaseUrlChange,
  onCacheReadDiscountRatioChange,
  onCacheWriteDiscountRatioChange,
  onCapabilityChange,
  onCredentialRefChange,
  onDescriptionChange,
  onMaxContextTokensChange,
  onMaxOutputTokensChange,
  onNameChange,
  onPriceInputPer1mChange,
  onPriceOutputPer1mChange,
  onProviderChange,
  onSelectedModelChange,
  onStatusChange,
  onSupportsFileChange,
  onUpstreamProtocolChange,
  onSupportsReasoningChange,
  onSupportsToolCallChange,
}: EditEndpointFormProps) {
  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
      <div className="space-y-2">
        <label htmlFor="endpoint-name" className="text-sm font-medium text-foreground">
          {t('create_dialog.name')} <span className="text-error">*</span>
        </label>
        <Input id="endpoint-name" value={name} onChange={(event) => onNameChange(event.target.value)} disabled={isSaving} required />
      </div>

      <div className="space-y-2">
        <label htmlFor="endpoint-description" className="text-sm font-medium text-foreground">
          {t('create_dialog.description')}
        </label>
        <textarea
          id="endpoint-description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={2}
          disabled={isSaving}
          className="w-full px-3 py-2 rounded-sm border border-subtle bg-surface-high text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t('create_dialog.capability')} <span className="text-error">*</span>
        </label>
        <Select value={capability} onValueChange={(value) => onCapabilityChange(value as CapabilityOption)} disabled={isSaving}>
          <SelectTrigger><SelectValue /></SelectTrigger>
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

      {!isEndpointCustom ? (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {t('create_dialog.provider')} <span className="text-error">*</span>
          </label>
          <Select value={provider} onValueChange={onProviderChange} disabled={isSaving}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {providerOptions.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  <span className="flex items-center gap-2"><span>{item.display_name}</span></span>
                </SelectItem>
              ))}
              <SelectItem value="custom">{t('create_dialog.provider_custom')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {isEndpointCustom ? (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('create_dialog.upstream_protocol')}</label>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {CUSTOM_PROTOCOL_OPTIONS.map((option) => (
              <button
                key={option.upstreamProtocol}
                type="button"
                onClick={() => onUpstreamProtocolChange(option.upstreamProtocol)}
                className={`rounded-md border px-3 py-3 text-left transition-colors ${
                  upstreamProtocol === option.upstreamProtocol
                    ? 'border-accent bg-accent/5'
                    : 'border-subtle hover:bg-surface-low'
                }`}
              >
                <div className="text-sm font-medium text-foreground">
                  {resolveEndpointProtocolLabel(t, option.upstreamProtocol)}
                </div>
                {option.description ? (
                  <div className="mt-1 text-xs text-tertiary">{option.description}</div>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('create_dialog.upstream_protocol')}</label>
          <div className="rounded-sm border border-subtle bg-surface-low px-3 py-2 text-sm text-foreground">
            {resolveEndpointProtocolLabel(t, selectedProvider.upstream_protocol)}
          </div>
        </div>
      )}

      {isCustomProvider ? (
        <div className="space-y-2">
          <label htmlFor="endpoint-model" className="text-sm font-medium text-foreground">
            {t('create_dialog.model_id')} <span className="text-error">*</span>
          </label>
          <Input id="endpoint-model" value={selectedModel} onChange={(event) => onSelectedModelChange(event.target.value)} disabled={isSaving} required />
        </div>
      ) : null}

      {!isCustomProvider && providerModels.length > 0 ? (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('create_dialog.catalog_models')}</label>
          <Select value={selectedModel} onValueChange={onSelectedModelChange} disabled={isSaving}>
            <SelectTrigger><SelectValue placeholder={t('create_dialog.select_from_catalog')} /></SelectTrigger>
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
      ) : null}

      {isCustomProvider ? (
        <div className="space-y-2">
          <label htmlFor="endpoint-base-url" className="text-sm font-medium text-foreground">
            {t('create_dialog.base_url')} <span className="text-error">*</span>
          </label>
          <Input id="endpoint-base-url" value={baseUrl} onChange={(event) => onBaseUrlChange(event.target.value)} disabled={isSaving} required />
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t('create_dialog.base_url')}</label>
          <div className="rounded-sm border border-subtle bg-surface-low px-3 py-2 font-mono text-sm text-foreground">
            {selectedProvider.default_base_url || baseUrl}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t('create_dialog.credential')} <span className="text-error">*</span>
        </label>
        <Select value={credentialRef} onValueChange={onCredentialRefChange} disabled={isSaving}>
          <SelectTrigger><SelectValue placeholder={commonT('placeholders.select')} /></SelectTrigger>
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
        <label htmlFor="endpoint-status" className="text-sm font-medium text-foreground">{t('status')}</label>
        <Select value={status} onValueChange={(value) => onStatusChange(value as 'active' | 'disabled')}>
          <SelectTrigger id="endpoint-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t('status_active')}</SelectItem>
            <SelectItem value="disabled">{t('status_disabled')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isCustomProvider ? (
        <div className="space-y-3 rounded-sm border border-subtle p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">{t('custom_wizard.model_profile.title')}</p>
            <button type="button" className="text-xs text-accent hover:underline" onClick={onApplyModelProfileDefaults}>
              {t('custom_wizard.use_default')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-secondary">{t('custom_wizard.model_profile.max_context_tokens')}</label>
              <Input value={maxContextTokens} onChange={(event) => onMaxContextTokensChange(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-secondary">{t('custom_wizard.model_profile.max_output_tokens')}</label>
              <Input value={maxOutputTokens} onChange={(event) => onMaxOutputTokensChange(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-secondary">{t('custom_wizard.model_profile.price_input_per_1m')}</label>
              <Input value={priceInputPer1m} onChange={(event) => onPriceInputPer1mChange(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-secondary">{t('custom_wizard.model_profile.price_output_per_1m')}</label>
              <Input value={priceOutputPer1m} onChange={(event) => onPriceOutputPer1mChange(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-secondary">{t('custom_wizard.model_profile.cache_read_discount_ratio')}</label>
              <Input value={cacheReadDiscountRatio} onChange={(event) => onCacheReadDiscountRatioChange(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-secondary">{t('custom_wizard.model_profile.cache_write_discount_ratio')}</label>
              <Input value={cacheWriteDiscountRatio} onChange={(event) => onCacheWriteDiscountRatioChange(event.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-secondary">{t('custom_wizard.model_profile.supports_file')}</label>
              <Select value={String(supportsFile)} onValueChange={(value) => onSupportsFileChange(value === 'true')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">{t('custom_wizard.model_profile.yes')}</SelectItem>
                  <SelectItem value="false">{t('custom_wizard.model_profile.no')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-secondary">{t('custom_wizard.model_profile.supports_tool_call')}</label>
              <Select value={String(supportsToolCall)} onValueChange={(value) => onSupportsToolCallChange(value === 'true')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">{t('custom_wizard.model_profile.yes')}</SelectItem>
                  <SelectItem value="false">{t('custom_wizard.model_profile.no')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-secondary">{t('custom_wizard.model_profile.supports_reasoning')}</label>
              <Select value={String(supportsReasoning)} onValueChange={(value) => onSupportsReasoningChange(value === 'true')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">{t('custom_wizard.model_profile.yes')}</SelectItem>
                  <SelectItem value="false">{t('custom_wizard.model_profile.no')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
