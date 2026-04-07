'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import {
  CUSTOM_PROTOCOL_OPTIONS,
  getCustomProtocolConfig,
} from '@/lib/endpoints/provider-catalog';
import type { CustomEndpointWizardFormState, WizardTranslator } from './types';
import {
  getProtocolI18nDescription,
  getProtocolI18nLabel,
  getProtocolFallbackLabel,
} from './utils';

export function BasicInfoStep(args: {
  t: WizardTranslator;
  form: CustomEndpointWizardFormState;
  onChange: <K extends keyof CustomEndpointWizardFormState>(field: K, value: CustomEndpointWizardFormState[K]) => void;
  getErrorForField: (field: string) => string | undefined;
}) {
  const { t, form, onChange, getErrorForField } = args;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="wizard-name" className="text-sm font-medium text-foreground">
          {t('name')} <span className="text-error">*</span>
        </label>
        <Input
          id="wizard-name"
          value={form.name}
          onChange={(event) => onChange('name', event.target.value)}
          placeholder={t('name_placeholder')}
          data-testid="wizard-name-input"
        />
        <p className="text-xs text-tertiary">{t('name_hint')}</p>
        {getErrorForField('name') && (
          <p className="text-sm text-error">{getErrorForField('name')}</p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t('upstream_protocol')} <span className="text-error">*</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {CUSTOM_PROTOCOL_OPTIONS.map((option) => (
            <button
              key={option.upstreamProtocol}
              type="button"
              onClick={() => onChange('upstreamProtocol', option.upstreamProtocol)}
              className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors ${
                form.upstreamProtocol === option.upstreamProtocol
                  ? 'border-accent bg-accent/5'
                  : 'border-subtle hover:bg-surface-low'
              }`}
              data-testid={`protocol-${option.upstreamProtocol}`}
            >
              <span className="font-medium">
                {getProtocolI18nLabel(t, option.upstreamProtocol, getProtocolFallbackLabel(option.upstreamProtocol))}
              </span>
              {getProtocolI18nDescription(t, option.upstreamProtocol, option.description) && (
                <span className="text-xs text-tertiary">
                  {getProtocolI18nDescription(t, option.upstreamProtocol, option.description)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="wizard-base-url" className="text-sm font-medium text-foreground">
            {t('base_url')} <span className="text-error">*</span>
          </label>
          {getCustomProtocolConfig(form.upstreamProtocol)?.default_base_url && (
            <button
              type="button"
              onClick={() => onChange('baseUrl', getCustomProtocolConfig(form.upstreamProtocol)?.default_base_url || '')}
              className="text-xs text-accent hover:underline"
              data-testid="wizard-use-default-url"
            >
              {t('use_default')}
            </button>
          )}
        </div>
        <Input
          id="wizard-base-url"
          value={form.baseUrl}
          onChange={(event) => onChange('baseUrl', event.target.value)}
          placeholder={t('base_url_placeholder')}
          className="font-mono text-sm"
          data-testid="wizard-base-url-input"
        />
        {getErrorForField('baseUrl') && (
          <p className="text-sm text-error">{getErrorForField('baseUrl')}</p>
        )}
      </div>
    </div>
  );
}
