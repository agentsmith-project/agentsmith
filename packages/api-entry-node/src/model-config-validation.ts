import type { ProjectPricingRecord } from './model-config-store.js';

type ValidationErrorMessage =
  | 'project_pricing_payload_invalid'
  | 'model_request_model_required'
  | 'model_request_model_format_invalid';

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: ValidationErrorMessage };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isPricingMap(value: unknown): value is ProjectPricingRecord['pricing_map'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((providerEntry) => {
    if (!providerEntry || typeof providerEntry !== 'object' || Array.isArray(providerEntry)) return false;
    return Object.values(providerEntry as Record<string, unknown>).every((modelEntry) => {
      if (!modelEntry || typeof modelEntry !== 'object' || Array.isArray(modelEntry)) return false;
      return Object.values(modelEntry as Record<string, unknown>).every((metric) => typeof metric === 'number' && Number.isFinite(metric));
    });
  });
}

export function parseModelRequestRef(raw: unknown): ValidationResult<{ provider: string; model: string }> {
  const body = asObject(raw);
  const modelRaw = asNonEmptyString(body?.model);
  if (!modelRaw) return { ok: false, message: 'model_request_model_required' };
  const [provider, model] = modelRaw.split('/', 2);
  if (!provider || !model) {
    return { ok: false, message: 'model_request_model_format_invalid' };
  }
  return { ok: true, value: { provider, model } };
}

export function parseProjectPricingPayload(raw: unknown): ValidationResult<ProjectPricingRecord['pricing_map']> {
  if (!isPricingMap(raw)) {
    return { ok: false, message: 'project_pricing_payload_invalid' };
  }
  return { ok: true, value: raw };
}
