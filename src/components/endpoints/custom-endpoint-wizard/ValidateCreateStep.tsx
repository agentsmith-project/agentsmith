'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  CustomEndpointWizardFormState,
  ErrorCategoryFormatter,
  ValidationResultState,
  WizardTranslator,
} from './types';
import { getProtocolFallbackLabel, getProtocolI18nLabel } from './utils';

interface CredentialOption {
  id: string;
  name: string;
  fingerprint: string;
}

export function ValidateCreateStep(args: {
  t: WizardTranslator;
  form: CustomEndpointWizardFormState;
  credentials: CredentialOption[];
  validationState: ValidationResultState;
  onValidate: () => void;
  formatErrorCategory: ErrorCategoryFormatter;
}) {
  const { t, form, credentials, validationState, onValidate, formatErrorCategory } = args;
  const { result: validationResult, isValidating } = validationState;

  return (
    <div className="space-y-4">
      <div className="rounded-sm bg-surface-low p-4">
        <h3 className="mb-3 font-medium text-foreground">{t('config_summary')}</h3>
        <div className="space-y-2 text-sm">
          <SummaryRow label={t('summary_name')} value={<span className="font-medium text-foreground">{form.name}</span>} />
          <SummaryRow
            label={t('summary_protocol')}
            value={
              <span className="font-medium text-foreground">
                {getProtocolI18nLabel(t, form.protocol, getProtocolFallbackLabel(form.protocol))}
              </span>
            }
          />
          <SummaryRow label={t('summary_base_url')} value={<span className="font-mono text-sm text-foreground">{form.baseUrl}</span>} />
          <SummaryRow label={t('summary_model_id')} value={<span className="font-mono text-sm text-foreground">{form.modelId}</span>} />
          <SummaryRow label={t('summary_capability')} value={<span className="text-foreground">{t(`capabilities.${form.capability}`)}</span>} />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          {t('check_button')}
        </label>
        <Button
          type="button"
          variant="secondary"
          onClick={onValidate}
          disabled={isValidating}
          className="w-full"
          data-testid="wizard-check-button"
        >
          {isValidating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('validating')}
            </>
          ) : (
            t('check_button')
          )}
        </Button>
      </div>

      {validationResult && (
        <div className={`rounded-sm p-4 ${
          validationResult.valid
            ? 'bg-success/10 text-success'
            : 'bg-error/10 text-error'
        }`}>
          <div className="flex items-start gap-3">
            {validationResult.valid ? (
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
            ) : (
              <XCircle className="h-5 w-5 flex-shrink-0" />
            )}
            <div className="flex-1">
              {validationResult.valid ? (
                <>
                  <p className="font-medium">{t('validation.success', { latency: validationResult.healthCheck?.latencyMs ?? 0 })}</p>
                  <p className="text-sm opacity-80">{t('endpoint_ready')}</p>
                </>
              ) : (
                <>
                  <p className="font-medium">{t('validation.failed')}</p>
                  {validationResult.healthCheck?.errorCategory && (
                    <p className="mt-1 text-sm">
                      <strong>{t('error_type')}:</strong> {formatErrorCategory(validationResult.healthCheck.errorCategory)}
                    </p>
                  )}
                  {validationResult.error && (
                    <p className="mt-1 text-sm opacity-80">{validationResult.error}</p>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onValidate}
                    className="mt-2"
                  >
                    {t('validation.retry')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {credentials.length === 0 && (
        <div className="flex items-start gap-3 rounded-sm bg-warning/10 p-4 text-warning">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-medium">{t('no_credentials')}</p>
            <p className="text-sm opacity-80">{t('create_credential_first')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow(args: { label: string; value: React.ReactNode }) {
  const { label, value } = args;
  return (
    <div className="flex justify-between">
      <span className="text-tertiary">{label}:</span>
      {value}
    </div>
  );
}
