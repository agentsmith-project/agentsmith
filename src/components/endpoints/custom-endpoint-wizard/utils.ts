import type { CreateEndpointRequest } from '@/lib/api/endpoints/endpoints';
import type {
  CustomEndpointProtocol,
  EndpointHealthErrorCategory,
  ValidateEndpointResponse,
} from '@/lib/api/types/endpoints';
import { CUSTOM_PROTOCOL_OPTIONS } from '@/lib/endpoints/provider-catalog';
import type {
  CustomEndpointWizardFormState,
  CustomEndpointWizardNumericProfile,
  ValidationError,
  WizardTranslator,
} from './types';

export const DEFAULT_WIZARD_FORM_STATE: CustomEndpointWizardFormState = {
  name: '',
  protocol: 'openai_chat_completions',
  baseUrl: '',
  modelId: '',
  capability: 'chat_completion',
  credentialRef: '',
  maxContextTokens: '128000',
  maxOutputTokens: '8192',
  supportsFile: false,
  supportsToolCall: true,
  supportsReasoning: false,
  priceInputPer1m: '0',
  priceOutputPer1m: '0',
  cacheReadDiscountRatio: '0',
  cacheWriteDiscountRatio: '0',
};

export const DEFAULT_MODEL_PROFILE_FIELDS = {
  maxContextTokens: '128000',
  maxOutputTokens: '8192',
  supportsFile: false,
  supportsToolCall: true,
  supportsReasoning: false,
  priceInputPer1m: '0',
  priceOutputPer1m: '0',
  cacheReadDiscountRatio: '0',
  cacheWriteDiscountRatio: '0',
} as const;

export function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getProtocolI18nLabel(
  t: WizardTranslator,
  protocol: CustomEndpointProtocol,
  fallback: string,
): string {
  const value = t(`protocol_options.${protocol}.name`);
  return value === `protocol_options.${protocol}.name` ? fallback : value;
}

export function getProtocolI18nDescription(
  t: WizardTranslator,
  protocol: CustomEndpointProtocol,
  fallback?: string,
): string | undefined {
  const key = `protocol_options.${protocol}.description`;
  const value = t(key);
  if (value === key) return fallback;
  return value;
}

export function getNumericProfile(form: CustomEndpointWizardFormState): CustomEndpointWizardNumericProfile {
  return {
    context: Number(form.maxContextTokens),
    output: Number(form.maxOutputTokens),
    inputPrice: Number(form.priceInputPer1m),
    outputPrice: Number(form.priceOutputPer1m),
    cacheRead: Number(form.cacheReadDiscountRatio),
    cacheWrite: Number(form.cacheWriteDiscountRatio),
  };
}

export function validateStep1(
  form: CustomEndpointWizardFormState,
  tErrors: WizardTranslator,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!form.name.trim()) {
    errors.push({ field: 'name', message: tErrors('name_required') });
  }
  if (!form.baseUrl.trim()) {
    errors.push({ field: 'baseUrl', message: tErrors('invalid_url') });
  } else if (!isValidHttpsUrl(form.baseUrl)) {
    errors.push({ field: 'baseUrl', message: tErrors('https_required') });
  }
  return errors;
}

export function validateStep2(
  form: CustomEndpointWizardFormState,
  tErrors: WizardTranslator,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const numeric = getNumericProfile(form);

  if (!form.modelId.trim()) {
    errors.push({ field: 'modelId', message: tErrors('model_required') });
  }
  if (!form.credentialRef) {
    errors.push({ field: 'credentialRef', message: tErrors('credential_required') });
  }
  if (!Number.isFinite(numeric.context) || numeric.context <= 0) {
    errors.push({ field: 'maxContextTokens', message: tErrors('invalid_number') });
  }
  if (!Number.isFinite(numeric.output) || numeric.output <= 0 || (Number.isFinite(numeric.context) && numeric.output > numeric.context)) {
    errors.push({ field: 'maxOutputTokens', message: tErrors('invalid_number') });
  }
  if (!Number.isFinite(numeric.inputPrice) || numeric.inputPrice < 0) {
    errors.push({ field: 'priceInputPer1m', message: tErrors('invalid_number') });
  }
  if (!Number.isFinite(numeric.outputPrice) || numeric.outputPrice < 0) {
    errors.push({ field: 'priceOutputPer1m', message: tErrors('invalid_number') });
  }
  if (!Number.isFinite(numeric.cacheRead) || numeric.cacheRead < 0 || numeric.cacheRead > 1) {
    errors.push({ field: 'cacheReadDiscountRatio', message: tErrors('invalid_number') });
  }
  if (!Number.isFinite(numeric.cacheWrite) || numeric.cacheWrite < 0) {
    errors.push({ field: 'cacheWriteDiscountRatio', message: tErrors('invalid_number') });
  }

  return errors;
}

export function getErrorForField(args: {
  field: string;
  step: 1 | 2 | 3;
  form: CustomEndpointWizardFormState;
  validationErrors: ValidationError[];
  tErrors: WizardTranslator;
}): string | undefined {
  const { field, step, form, validationErrors, tErrors } = args;
  const submitted = validationErrors.find((error) => error.field === field)?.message;
  if (submitted) return submitted;
  if (step !== 2) return undefined;

  const numeric = getNumericProfile(form);
  if (field === 'modelId' && !form.modelId.trim()) return tErrors('model_required');
  if (field === 'credentialRef' && !form.credentialRef) return tErrors('credential_required');
  if (field === 'maxContextTokens' && (!Number.isFinite(numeric.context) || numeric.context <= 0)) return tErrors('invalid_number');
  if (field === 'maxOutputTokens' && (!Number.isFinite(numeric.output) || numeric.output <= 0 || (Number.isFinite(numeric.context) && numeric.output > numeric.context))) {
    return tErrors('invalid_number');
  }
  if (field === 'priceInputPer1m' && (!Number.isFinite(numeric.inputPrice) || numeric.inputPrice < 0)) return tErrors('invalid_number');
  if (field === 'priceOutputPer1m' && (!Number.isFinite(numeric.outputPrice) || numeric.outputPrice < 0)) return tErrors('invalid_number');
  if (field === 'cacheReadDiscountRatio' && (!Number.isFinite(numeric.cacheRead) || numeric.cacheRead < 0 || numeric.cacheRead > 1)) {
    return tErrors('invalid_number');
  }
  if (field === 'cacheWriteDiscountRatio' && (!Number.isFinite(numeric.cacheWrite) || numeric.cacheWrite < 0)) {
    return tErrors('invalid_number');
  }
  return undefined;
}

export function runLocalValidation(
  baseUrl: string,
  tErrors: WizardTranslator,
): ValidateEndpointResponse {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'https:') {
      return {
        valid: false,
        error: tErrors('https_required'),
        healthCheck: {
          endpointId: 'validation',
          status: 'fail',
          checkedAt: new Date().toISOString(),
          errorCategory: 'auth',
        },
      };
    }
    const latencyMs = 50 + Math.floor(Math.random() * 200);
    return {
      valid: true,
      healthCheck: {
        endpointId: 'validation',
        status: 'pass',
        checkedAt: new Date().toISOString(),
        latencyMs,
      },
    };
  } catch {
    return {
      valid: false,
      error: tErrors('invalid_url'),
      healthCheck: {
        endpointId: 'validation',
        status: 'fail',
        checkedAt: new Date().toISOString(),
        errorCategory: 'unknown',
      },
    };
  }
}

export function buildCreateEndpointRequest(form: CustomEndpointWizardFormState): CreateEndpointRequest {
  return {
    name: form.name.trim(),
    type: 'custom',
    base_url: form.baseUrl.trim(),
    provider_family: 'custom',
    upstream_protocol: form.protocol,
    credential_ref: form.credentialRef,
    capabilities: [{ type: form.capability, enabled: true, default_model_id: form.modelId.trim() }],
    models: [{ capability: form.capability, model_id: form.modelId.trim(), display_name: form.modelId.trim() }],
    defaults: form.capability === 'chat_completion'
      ? { chat_model_id: form.modelId.trim() }
      : form.capability === 'multimodal_completion'
        ? { multimodal_model_id: form.modelId.trim() }
        : form.capability === 'embedding'
          ? { embedding_model_id: form.modelId.trim() }
          : form.capability === 'rerank'
            ? { rerank_model_id: form.modelId.trim() }
            : form.capability === 'image_generation'
              ? { image_model_id: form.modelId.trim() }
              : { video_model_id: form.modelId.trim() },
    model_profile: {
      max_context_tokens: Number(form.maxContextTokens),
      max_output_tokens: Number(form.maxOutputTokens),
      supports_file: form.supportsFile,
      supports_tool_call: form.supportsToolCall,
      supports_reasoning: form.supportsReasoning,
      price_input_per_1m: Number(form.priceInputPer1m),
      price_output_per_1m: Number(form.priceOutputPer1m),
      cache_read_discount_ratio: Number(form.cacheReadDiscountRatio),
      cache_write_discount_ratio: Number(form.cacheWriteDiscountRatio),
    },
  };
}

export function getErrorCategoryMessage(
  tErrors: WizardTranslator,
  category: EndpointHealthErrorCategory,
): string {
  const key = category as keyof typeof category;
  const message = tErrors(String(key));
  return message !== key ? message : tErrors('unknown');
}

export function getProtocolFallbackLabel(protocol: CustomEndpointProtocol): string {
  return CUSTOM_PROTOCOL_OPTIONS.find((option) => option.protocol === protocol)?.display_name ?? protocol;
}
