'use client';

import * as React from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EndpointCapabilityType } from '@/lib/api/types';
import type { CustomEndpointWizardFormState, WizardTranslator } from './types';
import { getProtocolFallbackLabel, getProtocolI18nLabel } from './utils';

interface CredentialOption {
  id: string;
  name: string;
  fingerprint: string;
}

export function ModelConfigStep(args: {
  t: WizardTranslator;
  locale: string;
  workspaceId: string;
  projectId: string;
  form: CustomEndpointWizardFormState;
  credentials: CredentialOption[];
  onChange: <K extends keyof CustomEndpointWizardFormState>(field: K, value: CustomEndpointWizardFormState[K]) => void;
  applyRecommendedDefaults: () => void;
  getErrorForField: (field: string) => string | undefined;
}) {
  const {
    t,
    locale,
    workspaceId,
    projectId,
    form,
    credentials,
    onChange,
    applyRecommendedDefaults,
    getErrorForField,
  } = args;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="wizard-model-id" className="text-sm font-medium text-foreground">
          {t('model_id')} <span className="text-error">*</span>
        </label>
        <Input
          id="wizard-model-id"
          value={form.modelId}
          onChange={(event) => onChange('modelId', event.target.value)}
          placeholder={t('model_id_placeholder')}
          className="font-mono text-sm"
          data-testid="wizard-model-id-input"
        />
        <p className="text-xs text-tertiary">{t('model_id_hint')}</p>
        {getErrorForField('modelId') && (
          <p className="text-sm text-error">{getErrorForField('modelId')}</p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t('capability')} <span className="text-error">*</span>
        </label>
        <Select
          value={form.capability}
          onValueChange={(value) => onChange('capability', value as EndpointCapabilityType)}
          data-testid="wizard-capability-select"
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="chat_completion">{t('capabilities.chat_completion')}</SelectItem>
            <SelectItem value="multimodal_completion">{t('capabilities.multimodal_completion')}</SelectItem>
            <SelectItem value="embedding">{t('capabilities.embedding')}</SelectItem>
            <SelectItem value="rerank">{t('capabilities.rerank')}</SelectItem>
            <SelectItem value="image_generation">{t('capabilities.image_generation')}</SelectItem>
            <SelectItem value="video_generation">{t('capabilities.video_generation')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t('credential')} <span className="text-error">*</span>
        </label>
        {credentials.length === 0 ? (
          <div className="rounded-sm border border-subtle bg-surface-low p-4 text-sm text-tertiary">
            {t('no_credentials')}{' '}
            <Link
              href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/credentials`}
              className="text-accent hover:underline"
            >
              {t('create_credential_first')}
            </Link>
          </div>
        ) : (
          <Select
            value={form.credentialRef}
            onValueChange={(value) => onChange('credentialRef', value)}
            data-testid="wizard-credential-select"
          >
            <SelectTrigger>
              <SelectValue placeholder={t('credential_placeholder')} />
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
        {getErrorForField('credentialRef') && (
          <p className="text-sm text-error">{getErrorForField('credentialRef')}</p>
        )}
      </div>

      <div className="space-y-3 rounded-sm border border-subtle p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">{t('model_profile.title')}</p>
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={applyRecommendedDefaults}
            data-testid="wizard-model-profile-defaults"
          >
            {t('use_default')}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumericField
            label={t('model_profile.max_context_tokens')}
            value={form.maxContextTokens}
            onChange={(value) => onChange('maxContextTokens', value)}
            error={getErrorForField('maxContextTokens')}
          />
          <NumericField
            label={t('model_profile.max_output_tokens')}
            value={form.maxOutputTokens}
            onChange={(value) => onChange('maxOutputTokens', value)}
            error={getErrorForField('maxOutputTokens')}
          />
          <NumericField
            label={t('model_profile.price_input_per_1m')}
            value={form.priceInputPer1m}
            onChange={(value) => onChange('priceInputPer1m', value)}
            error={getErrorForField('priceInputPer1m')}
          />
          <NumericField
            label={t('model_profile.price_output_per_1m')}
            value={form.priceOutputPer1m}
            onChange={(value) => onChange('priceOutputPer1m', value)}
            error={getErrorForField('priceOutputPer1m')}
          />
          <NumericField
            label={t('model_profile.cache_read_discount_ratio')}
            value={form.cacheReadDiscountRatio}
            onChange={(value) => onChange('cacheReadDiscountRatio', value)}
            error={getErrorForField('cacheReadDiscountRatio')}
          />
          <NumericField
            label={t('model_profile.cache_write_discount_ratio')}
            value={form.cacheWriteDiscountRatio}
            onChange={(value) => onChange('cacheWriteDiscountRatio', value)}
            error={getErrorForField('cacheWriteDiscountRatio')}
            testId="wizard-cache-write-discount-ratio-input"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <BooleanField
            label={t('model_profile.supports_file')}
            value={form.supportsFile}
            onChange={(value) => onChange('supportsFile', value)}
            yesLabel={t('model_profile.yes')}
            noLabel={t('model_profile.no')}
          />
          <BooleanField
            label={t('model_profile.supports_tool_call')}
            value={form.supportsToolCall}
            onChange={(value) => onChange('supportsToolCall', value)}
            yesLabel={t('model_profile.yes')}
            noLabel={t('model_profile.no')}
          />
          <BooleanField
            label={t('model_profile.supports_reasoning')}
            value={form.supportsReasoning}
            onChange={(value) => onChange('supportsReasoning', value)}
            yesLabel={t('model_profile.yes')}
            noLabel={t('model_profile.no')}
          />
        </div>
      </div>

      <div className="rounded-sm bg-surface-low p-4 text-sm">
        <p className="font-medium text-foreground">{t('summary_title')}</p>
        <p className="text-tertiary">{t('summary_name')}: {form.name}</p>
        <p className="text-tertiary">
          {t('summary_protocol')}: {getProtocolI18nLabel(t, form.upstreamProtocol, getProtocolFallbackLabel(form.upstreamProtocol))}
        </p>
        <p className="text-tertiary">{t('summary_base_url')}: {form.baseUrl}</p>
        <p className="text-tertiary">{t('summary_capability')}: {t(`capabilities.${form.capability}`)}</p>
        <p className="text-tertiary">{t('summary_model')}: {form.modelId || t('summary_model_id') || '(not set)'}</p>
      </div>
    </div>
  );
}

function NumericField(args: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  testId?: string;
}) {
  const { label, value, onChange, error, testId } = args;
  return (
    <div className="space-y-1">
      <label className="text-xs text-secondary">{label}</label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

function BooleanField(args: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  yesLabel: string;
  noLabel: string;
}) {
  const { label, value, onChange, yesLabel, noLabel } = args;
  return (
    <div className="space-y-1">
      <label className="text-xs text-secondary">{label}</label>
      <Select value={String(value)} onValueChange={(next) => onChange(next === 'true')}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{yesLabel}</SelectItem>
          <SelectItem value="false">{noLabel}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
