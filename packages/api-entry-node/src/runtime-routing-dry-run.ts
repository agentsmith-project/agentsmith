import { resolveRoutingPlan } from './runtime-routing.js';
import { selectProviderConnection } from './runtime-execution-policy.js';
import { createRuntimeStore } from './runtime-store.js';
import type { NodeApiDeps } from './node-api-deps.js';

type PricingSource = 'project_override' | 'model_catalog' | 'missing';

export type RuntimeRoutingDryRunAttempt = {
  index: number;
  provider: string;
  model: string;
  provider_connection_id?: string;
  provider_connection_status: 'active' | 'disabled' | 'missing';
  connection_priority?: number;
  connection_base_url?: string;
  pricing_source: PricingSource;
  pricing?: Record<string, number>;
};

export type RuntimeRoutingDryRunResponse = {
  model: string;
  routed_by: 'direct' | 'alias' | 'combo';
  alias?: string;
  combo_name?: string;
  fallback_policy?: {
    max_hops: number;
    retryable_error_classes: string[];
  };
  attempts: RuntimeRoutingDryRunAttempt[];
  issues: string[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export async function dryRunRuntimeRouting(params: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  rawBody: unknown;
}): Promise<{ statusCode: number; body: RuntimeRoutingDryRunResponse | { error_code: string; message: string } }> {
  const raw = asObject(params.rawBody);
  const modelRaw = asNonEmptyString(raw?.model);
  if (!raw || !modelRaw) {
    return {
      statusCode: 422,
      body: { error_code: 'VALIDATION_ERROR', message: 'runtime_unified_chat_model_required' },
    };
  }

  const runtimeStore = createRuntimeStore(params.deps.docStore);
  const projectScope = { workspaceId: params.workspaceId, projectId: params.projectId };
  const [providers, models, aliases, combos, pricing] = await Promise.all([
    runtimeStore.listProviders(projectScope),
    runtimeStore.listModels(projectScope),
    runtimeStore.listAliases(projectScope),
    runtimeStore.listCombos(projectScope),
    runtimeStore.getPricing(projectScope),
  ]);

  const routingPlan = resolveRoutingPlan({
    modelRaw,
    aliases: aliases.map((item) => ({
      alias: item.alias,
      target_provider: item.target_provider,
      target_model: item.target_model,
    })),
    combos: combos.map((item) => ({
      name: item.name,
      targets: item.targets,
      fallback_policy: item.fallback_policy,
    })),
  });

  if ('errorCode' in routingPlan) {
    return {
      statusCode: 422,
      body: { error_code: routingPlan.errorCode, message: routingPlan.message },
    };
  }

  const issues = new Set<string>();
  const attempts = routingPlan.attempts.map((attempt, index): RuntimeRoutingDryRunAttempt => {
    const modelEntry = models.find((item) => item.provider === attempt.provider && item.model_id === attempt.model);
    if (!modelEntry) {
      issues.add('runtime_model_not_registered');
    }

    const projectPricing = pricing?.pricing_map?.[attempt.provider]?.[attempt.model];
    const modelPricing = modelEntry?.pricing;
    const pricingSource: PricingSource = projectPricing
      ? 'project_override'
      : modelPricing
        ? 'model_catalog'
        : 'missing';
    if (pricingSource === 'missing') {
      issues.add('runtime_pricing_missing');
    }

    const selectedConnection = selectProviderConnection({ providers, attempt });
    if (!selectedConnection.ok) {
      if (selectedConnection.failure.message === 'runtime_provider_connection_not_found') {
        const disabledConnection = providers
          .filter((item) => item.provider === attempt.provider)
          .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER))[0];
        if (disabledConnection) {
          issues.add('runtime_provider_connection_disabled');
          return {
            index,
            provider: attempt.provider,
            model: attempt.model,
            provider_connection_id: disabledConnection.id,
            provider_connection_status: 'disabled',
            connection_priority: disabledConnection.priority,
            connection_base_url: disabledConnection.base_url,
            pricing_source: pricingSource,
            pricing: projectPricing ?? modelPricing,
          };
        }
        issues.add('runtime_provider_connection_missing');
        return {
          index,
          provider: attempt.provider,
          model: attempt.model,
          provider_connection_status: 'missing',
          pricing_source: pricingSource,
          pricing: projectPricing ?? modelPricing,
        };
      }
      issues.add(selectedConnection.failure.message);
      const fallbackConnection = providers
        .filter((item) => item.provider === attempt.provider && item.status === 'active')
        .sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER))[0];
      return {
        index,
        provider: attempt.provider,
        model: attempt.model,
        provider_connection_id: fallbackConnection?.id,
        provider_connection_status: fallbackConnection ? 'active' : 'missing',
        connection_priority: fallbackConnection?.priority,
        connection_base_url: fallbackConnection?.base_url,
        pricing_source: pricingSource,
        pricing: projectPricing ?? modelPricing,
      };
    }

    return {
      index,
      provider: attempt.provider,
      model: attempt.model,
      provider_connection_id: selectedConnection.providerConnection.id,
      provider_connection_status: 'active',
      connection_priority: selectedConnection.providerConnection.priority,
      connection_base_url: selectedConnection.providerConnection.base_url,
      pricing_source: pricingSource,
      pricing: projectPricing ?? modelPricing,
    };
  });

  return {
    statusCode: 200,
    body: {
      model: modelRaw,
      routed_by: routingPlan.routedBy,
      alias: routingPlan.aliasName,
      combo_name: routingPlan.comboName,
      fallback_policy: routingPlan.fallbackPolicy,
      attempts,
      issues: Array.from(issues),
    },
  };
}
