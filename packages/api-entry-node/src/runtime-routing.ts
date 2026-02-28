export type RuntimeErrorClass = 'provider_retryable' | 'provider_non_retryable' | 'system_error';

export type RuntimeRoutingAttempt = {
  provider: string;
  model: string;
};

export type RuntimeFallbackPolicy = {
  max_hops: number;
  retryable_error_classes: string[];
};

export type RuntimeRoutingAlias = {
  alias: string;
  target_provider: string;
  target_model: string;
};

export type RuntimeRoutingCombo = {
  name: string;
  targets: RuntimeRoutingAttempt[];
  fallback_policy: RuntimeFallbackPolicy;
};

export type RuntimeRoutingSuccess = {
  attempts: RuntimeRoutingAttempt[];
  routedBy: 'direct' | 'alias' | 'combo';
  aliasName?: string;
  comboName?: string;
  fallbackPolicy?: RuntimeFallbackPolicy;
};

export type RuntimeRoutingFailure = {
  errorCode: 'VALIDATION_ERROR';
  message:
    | 'runtime_unified_chat_model_required'
    | 'runtime_combo_not_found'
    | 'runtime_model_format_invalid'
    | 'runtime_alias_not_found'
    | 'runtime_routing_target_required';
};

export function resolveRoutingPlan(params: {
  modelRaw: string;
  aliases: RuntimeRoutingAlias[];
  combos: RuntimeRoutingCombo[];
}): RuntimeRoutingSuccess | RuntimeRoutingFailure {
  const modelRaw = params.modelRaw.trim();
  if (!modelRaw) {
    return { errorCode: 'VALIDATION_ERROR', message: 'runtime_unified_chat_model_required' };
  }

  if (modelRaw.startsWith('combo:')) {
    const comboName = modelRaw.slice('combo:'.length).trim();
    const combo = params.combos.find((item) => item.name === comboName);
    if (!combo || combo.targets.length === 0) {
      return { errorCode: 'VALIDATION_ERROR', message: 'runtime_combo_not_found' };
    }
    return {
      attempts: combo.targets,
      routedBy: 'combo',
      comboName,
      fallbackPolicy: combo.fallback_policy,
    };
  }

  if (modelRaw.includes('/')) {
    const [provider, model] = modelRaw.split('/', 2);
    if (!provider || !model) {
      return { errorCode: 'VALIDATION_ERROR', message: 'runtime_model_format_invalid' };
    }
    return {
      attempts: [{ provider, model }],
      routedBy: 'direct',
    };
  }

  const alias = params.aliases.find((item) => item.alias === modelRaw);
  if (!alias) {
    return { errorCode: 'VALIDATION_ERROR', message: 'runtime_alias_not_found' };
  }
  return {
    attempts: [{ provider: alias.target_provider, model: alias.target_model }],
    routedBy: 'alias',
    aliasName: alias.alias,
  };
}

export function classifyUpstreamStatus(status: number): RuntimeErrorClass {
  if (status === 429 || status >= 500) return 'provider_retryable';
  if (status >= 400) return 'provider_non_retryable';
  return 'system_error';
}

export function shouldFallbackByPolicy(params: {
  errorClass: RuntimeErrorClass;
  hopAfterFallback: number;
  policy?: RuntimeFallbackPolicy;
}): boolean {
  const { errorClass, hopAfterFallback, policy } = params;
  if (!policy) return errorClass === 'provider_retryable';
  if (hopAfterFallback > policy.max_hops) return false;
  return policy.retryable_error_classes.includes(errorClass);
}
