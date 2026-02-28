import type {
  RuntimeModelAliasRecord,
  RuntimeModelCatalogEntryRecord,
  RuntimeModelComboRecord,
  RuntimePricingRecord,
  RuntimeRouteApprovalChecklist,
  RuntimeRouteRolloutPolicy,
  RuntimePricingScopeType,
  RuntimePricingVersionRecord,
  RuntimeProviderConnectionRecord,
} from './runtime-store.js';

type ValidationErrorMessage =
  | 'runtime_provider_payload_invalid'
  | 'runtime_provider_required_fields_missing'
  | 'runtime_model_payload_invalid'
  | 'runtime_model_required_fields_missing'
  | 'runtime_model_capabilities_required'
  | 'runtime_alias_payload_invalid'
  | 'runtime_alias_required_fields_missing'
  | 'runtime_combo_payload_invalid'
  | 'runtime_combo_required_fields_missing'
  | 'runtime_pricing_payload_invalid'
  | 'runtime_pricing_version_payload_invalid'
  | 'runtime_pricing_compare_payload_invalid'
  | 'runtime_route_publish_payload_invalid';

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: ValidationErrorMessage };

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseCapabilities(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function parseTargets(value: unknown): Array<{ provider: string; model: string }> {
  return Array.isArray(value)
    ? value
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        provider: asNonEmptyString(item.provider),
        model: asNonEmptyString(item.model),
      }))
      .filter((item): item is { provider: string; model: string } => Boolean(item.provider && item.model))
    : [];
}

function parseRetryableErrorClasses(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function parsePricingNumbers(value: unknown): Record<string, number> | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  const entries = Object.entries(obj).filter(([, entryValue]) => typeof entryValue === 'number' && Number.isFinite(entryValue));
  return entries.length > 0 ? Object.fromEntries(entries) as Record<string, number> : undefined;
}

function isPricingMap(value: unknown): value is RuntimePricingRecord['pricing_map'] {
  const providers = asObject(value);
  if (!providers) return false;
  for (const models of Object.values(providers)) {
    const modelMap = asObject(models);
    if (!modelMap) return false;
    for (const priceFields of Object.values(modelMap)) {
      const priceMap = asObject(priceFields);
      if (!priceMap) return false;
      for (const amount of Object.values(priceMap)) {
        if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
      }
    }
  }
  return true;
}

export function parseRuntimeProviderCreatePayload(
  raw: unknown,
): ValidationResult<Pick<RuntimeProviderConnectionRecord, 'provider' | 'auth_mode' | 'base_url' | 'credential_ref' | 'priority' | 'status'>> {
  const body = asObject(raw);
  if (!body) return { ok: false, message: 'runtime_provider_payload_invalid' };
  const provider = asNonEmptyString(body.provider);
  const authMode = asNonEmptyString(body.auth_mode) as RuntimeProviderConnectionRecord['auth_mode'] | undefined;
  const baseUrl = asNonEmptyString(body.base_url);
  if (!provider || !authMode || !baseUrl) {
    return { ok: false, message: 'runtime_provider_required_fields_missing' };
  }
  return {
    ok: true,
    value: {
      provider,
      auth_mode: authMode,
      base_url: baseUrl,
      credential_ref: asNonEmptyString(body.credential_ref),
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      status: ((asNonEmptyString(body.status) as RuntimeProviderConnectionRecord['status'] | undefined) ?? 'active'),
    },
  };
}

export function parseRuntimeProviderUpdatePayload(
  raw: unknown,
): ValidationResult<{
  base_url?: string;
  credential_ref?: string;
  priority?: number;
  status?: RuntimeProviderConnectionRecord['status'];
}> {
  const body = asObject(raw);
  if (!body) return { ok: false, message: 'runtime_provider_payload_invalid' };
  return {
    ok: true,
    value: {
      base_url: asNonEmptyString(body.base_url),
      credential_ref: asNonEmptyString(body.credential_ref),
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      status: asNonEmptyString(body.status) as RuntimeProviderConnectionRecord['status'] | undefined,
    },
  };
}

export function parseRuntimeModelCreatePayload(
  raw: unknown,
): ValidationResult<Pick<RuntimeModelCatalogEntryRecord, 'provider' | 'model_id' | 'display_name' | 'capabilities' | 'context_window' | 'max_tokens' | 'pricing'>> {
  const body = asObject(raw);
  if (!body) return { ok: false, message: 'runtime_model_payload_invalid' };
  const provider = asNonEmptyString(body.provider);
  const modelId = asNonEmptyString(body.model_id);
  const capabilities = parseCapabilities(body.capabilities);
  if (!provider || !modelId || capabilities.length === 0) {
    return { ok: false, message: 'runtime_model_required_fields_missing' };
  }
  return {
    ok: true,
    value: {
      provider,
      model_id: modelId,
      display_name: asNonEmptyString(body.display_name),
      capabilities,
      context_window: typeof body.context_window === 'number' ? body.context_window : undefined,
      max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
      pricing: parsePricingNumbers(body.pricing),
    },
  };
}

export function parseRuntimeModelUpdatePayload(
  raw: unknown,
  fallbackCapabilities: string[],
): ValidationResult<Pick<RuntimeModelCatalogEntryRecord, 'provider' | 'display_name' | 'capabilities' | 'context_window' | 'max_tokens' | 'pricing'>> {
  const body = asObject(raw);
  if (!body) return { ok: false, message: 'runtime_model_payload_invalid' };
  const capabilities = Array.isArray(body.capabilities) ? parseCapabilities(body.capabilities) : fallbackCapabilities;
  if (capabilities.length === 0) {
    return { ok: false, message: 'runtime_model_capabilities_required' };
  }
  return {
    ok: true,
    value: {
      provider: asNonEmptyString(body.provider) ?? '',
      display_name: asNonEmptyString(body.display_name),
      capabilities,
      context_window: typeof body.context_window === 'number' ? body.context_window : undefined,
      max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
      pricing: parsePricingNumbers(body.pricing),
    },
  };
}

export function parseRuntimeAliasPayload(
  raw: unknown,
): ValidationResult<Pick<RuntimeModelAliasRecord, 'alias' | 'target_provider' | 'target_model'>> {
  const body = asObject(raw);
  if (!body) return { ok: false, message: 'runtime_alias_payload_invalid' };
  const alias = asNonEmptyString(body.alias);
  const targetProvider = asNonEmptyString(body.target_provider);
  const targetModel = asNonEmptyString(body.target_model);
  if (!alias || !targetProvider || !targetModel) {
    return { ok: false, message: 'runtime_alias_required_fields_missing' };
  }
  return {
    ok: true,
    value: {
      alias,
      target_provider: targetProvider,
      target_model: targetModel,
    },
  };
}

export function parseRuntimeAliasUpdatePayload(
  raw: unknown,
): ValidationResult<Pick<RuntimeModelAliasRecord, 'target_provider' | 'target_model'>> {
  const body = asObject(raw);
  if (!body) return { ok: false, message: 'runtime_alias_payload_invalid' };
  return {
    ok: true,
    value: {
      target_provider: asNonEmptyString(body.target_provider) ?? '',
      target_model: asNonEmptyString(body.target_model) ?? '',
    },
  };
}

export function parseRuntimeComboPayload(
  raw: unknown,
): ValidationResult<Pick<RuntimeModelComboRecord, 'name' | 'targets' | 'fallback_policy'>> {
  const body = asObject(raw);
  if (!body) return { ok: false, message: 'runtime_combo_payload_invalid' };
  const name = asNonEmptyString(body.name);
  const targets = parseTargets(body.targets);
  const fallbackPolicy = asObject(body.fallback_policy);
  const maxHops = fallbackPolicy && typeof fallbackPolicy.max_hops === 'number'
    ? Math.max(1, Math.floor(fallbackPolicy.max_hops))
    : undefined;
  const retryableErrorClasses = parseRetryableErrorClasses(fallbackPolicy?.retryable_error_classes);
  if (!name || targets.length === 0 || !maxHops || retryableErrorClasses.length === 0) {
    return { ok: false, message: 'runtime_combo_required_fields_missing' };
  }
  return {
    ok: true,
    value: {
      name,
      targets,
      fallback_policy: {
        max_hops: maxHops,
        retryable_error_classes: retryableErrorClasses,
      },
    },
  };
}

export function parseRuntimeComboUpdatePayload(
  raw: unknown,
  existing: RuntimeModelComboRecord,
): ValidationResult<Pick<RuntimeModelComboRecord, 'targets' | 'fallback_policy'>> {
  const body = asObject(raw);
  if (!body) return { ok: false, message: 'runtime_combo_payload_invalid' };
  const targets = Array.isArray(body.targets) ? parseTargets(body.targets) : existing.targets;
  const fallbackPolicy = asObject(body.fallback_policy);
  const maxHops = fallbackPolicy && typeof fallbackPolicy.max_hops === 'number'
    ? Math.max(1, Math.floor(fallbackPolicy.max_hops))
    : existing.fallback_policy.max_hops;
  const retryableErrorClasses = fallbackPolicy
    ? parseRetryableErrorClasses(fallbackPolicy.retryable_error_classes)
    : existing.fallback_policy.retryable_error_classes;
  if (targets.length === 0 || retryableErrorClasses.length === 0) {
    return { ok: false, message: 'runtime_combo_required_fields_missing' };
  }
  return {
    ok: true,
    value: {
      targets,
      fallback_policy: {
        max_hops: maxHops,
        retryable_error_classes: retryableErrorClasses,
      },
    },
  };
}

export function parseRuntimePricingPayload(raw: unknown): ValidationResult<RuntimePricingRecord['pricing_map']> {
  if (!isPricingMap(raw)) {
    return { ok: false, message: 'runtime_pricing_payload_invalid' };
  }
  return { ok: true, value: raw };
}

export function parseRuntimePricingVersionCreatePayload(
  raw: unknown,
): ValidationResult<
  Pick<RuntimePricingVersionRecord, 'scope_type' | 'version_name' | 'description' | 'pricing_map'>
  & { activate: boolean }
> {
  const body = asObject(raw);
  if (!body) return { ok: false, message: 'runtime_pricing_payload_invalid' };
  const scopeType = asNonEmptyString(body.scope_type) as RuntimePricingScopeType | undefined;
  const versionName = asNonEmptyString(body.version_name);
  const description = asNonEmptyString(body.description);
  const activate = body.activate === true;
  if (
    (scopeType !== 'global' && scopeType !== 'workspace' && scopeType !== 'project')
    || !versionName
    || !isPricingMap(body.pricing_map)
  ) {
    return { ok: false, message: 'runtime_pricing_version_payload_invalid' };
  }
  return {
    ok: true,
    value: {
      scope_type: scopeType,
      version_name: versionName,
      description,
      pricing_map: body.pricing_map,
      activate,
    },
  };
}

export function parseRuntimePricingVersionComparePayload(
  raw: unknown,
): ValidationResult<{ baseline_version_id: string; candidate_version_id: string }> {
  const body = asObject(raw);
  const baselineVersionId = asNonEmptyString(body?.baseline_version_id);
  const candidateVersionId = asNonEmptyString(body?.candidate_version_id);
  if (!baselineVersionId || !candidateVersionId) {
    return { ok: false, message: 'runtime_pricing_compare_payload_invalid' };
  }
  return {
    ok: true,
    value: {
      baseline_version_id: baselineVersionId,
      candidate_version_id: candidateVersionId,
    },
  };
}

export function parseRuntimeRoutePublishPayload(
  raw: unknown,
): ValidationResult<{ approval_checklist: RuntimeRouteApprovalChecklist; rollout_policy: RuntimeRouteRolloutPolicy }> {
  const body = asObject(raw);
  const approval = asObject(body?.approval_checklist);
  const rollout = asObject(body?.rollout_policy);
  const mode = asNonEmptyString(rollout?.mode) as RuntimeRouteRolloutPolicy['mode'] | undefined;
  if (!approval || !rollout || (mode !== 'full' && mode !== 'canary')) {
    return { ok: false, message: 'runtime_route_publish_payload_invalid' };
  }
  return {
    ok: true,
    value: {
      approval_checklist: {
        owner_verified: approval.owner_verified === true,
        observability_verified: approval.observability_verified === true,
        rollback_verified: approval.rollback_verified === true,
      },
      rollout_policy: {
        mode,
        canary_percent: typeof rollout.canary_percent === 'number' ? rollout.canary_percent : undefined,
      },
    },
  };
}
