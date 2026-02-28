import type {
  RuntimeModelAliasRecord,
  RuntimeModelCatalogEntryRecord,
  RuntimeModelComboRecord,
  RuntimePricingScopeType,
  RuntimePricingVersionRecord,
} from './runtime-store.js';

type PricingMap = RuntimePricingVersionRecord['pricing_map'];

function getEntry(pricingMap: PricingMap, provider: string, model: string): Record<string, number> | undefined {
  return pricingMap[provider]?.[model];
}

export function mergePricingMaps(
  maps: Array<PricingMap | undefined>,
): PricingMap {
  const merged: PricingMap = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [provider, models] of Object.entries(map)) {
      merged[provider] ??= {};
      for (const [model, pricing] of Object.entries(models)) {
        merged[provider]![model] = pricing;
      }
    }
  }
  return merged;
}

export function buildEffectivePricingMap(params: {
  projectMap?: PricingMap;
  workspaceMap?: PricingMap;
  globalMap?: PricingMap;
}): PricingMap {
  return mergePricingMaps([
    params.globalMap,
    params.workspaceMap,
    params.projectMap,
  ]);
}

function collectReferencedTargets(params: {
  models: RuntimeModelCatalogEntryRecord[];
  aliases: RuntimeModelAliasRecord[];
  combos: RuntimeModelComboRecord[];
}): Array<{ provider: string; model: string }> {
  const keys = new Set<string>();
  const targets: Array<{ provider: string; model: string }> = [];
  const push = (provider: string, model: string) => {
    const key = `${provider}:${model}`;
    if (keys.has(key)) return;
    keys.add(key);
    targets.push({ provider, model });
  };

  for (const model of params.models) push(model.provider, model.model_id);
  for (const alias of params.aliases) push(alias.target_provider, alias.target_model);
  for (const combo of params.combos) {
    for (const target of combo.targets) push(target.provider, target.model);
  }
  return targets;
}

export function evaluatePricingActivationReadiness(params: {
  scopeType: RuntimePricingScopeType;
  candidateMap: PricingMap;
  activeProjectMap?: PricingMap;
  activeWorkspaceMap?: PricingMap;
  activeGlobalMap?: PricingMap;
  models: RuntimeModelCatalogEntryRecord[];
  aliases: RuntimeModelAliasRecord[];
  combos: RuntimeModelComboRecord[];
}): {
  release_readiness: 'ready' | 'blocked';
  missing_targets: Array<{ provider: string; model: string }>;
  blockers: string[];
} {
  const effective = buildEffectivePricingMap({
    projectMap: params.scopeType === 'project' ? params.candidateMap : params.activeProjectMap,
    workspaceMap: params.scopeType === 'workspace' ? params.candidateMap : params.activeWorkspaceMap,
    globalMap: params.scopeType === 'global' ? params.candidateMap : params.activeGlobalMap,
  });
  const missingTargets = collectReferencedTargets({
    models: params.models,
    aliases: params.aliases,
    combos: params.combos,
  }).filter((target) => {
    if (getEntry(effective, target.provider, target.model)) return false;
    const catalogModel = params.models.find((item) => item.provider === target.provider && item.model_id === target.model);
    return !catalogModel?.pricing;
  });

  return {
    release_readiness: missingTargets.length > 0 ? 'blocked' : 'ready',
    missing_targets: missingTargets,
    blockers: missingTargets.length > 0 ? ['runtime_pricing_activation_missing_price'] : [],
  };
}

export function comparePricingVersions(params: {
  baseline: RuntimePricingVersionRecord;
  candidate: RuntimePricingVersionRecord;
}) {
  const keys = new Set<string>();
  for (const [provider, models] of Object.entries(params.baseline.pricing_map)) {
    for (const model of Object.keys(models)) keys.add(`${provider}:${model}`);
  }
  for (const [provider, models] of Object.entries(params.candidate.pricing_map)) {
    for (const model of Object.keys(models)) keys.add(`${provider}:${model}`);
  }

  const items = Array.from(keys)
    .sort()
    .map((key) => {
      const [provider, model] = key.split(':', 2);
      const baselineEntry = getEntry(params.baseline.pricing_map, provider!, model!);
      const candidateEntry = getEntry(params.candidate.pricing_map, provider!, model!);
      const changeType = !baselineEntry
        ? 'added'
        : !candidateEntry
          ? 'removed'
          : JSON.stringify(baselineEntry) === JSON.stringify(candidateEntry)
            ? 'unchanged'
            : 'changed';
      return {
        provider: provider!,
        model: model!,
        change_type: changeType,
        baseline: baselineEntry ?? null,
        candidate: candidateEntry ?? null,
      };
    });

  return {
    baseline_version: {
      id: params.baseline.id,
      version_name: params.baseline.version_name,
      scope_type: params.baseline.scope_type,
    },
    candidate_version: {
      id: params.candidate.id,
      version_name: params.candidate.version_name,
      scope_type: params.candidate.scope_type,
    },
    summary: {
      added: items.filter((item) => item.change_type === 'added').length,
      removed: items.filter((item) => item.change_type === 'removed').length,
      changed: items.filter((item) => item.change_type === 'changed').length,
      unchanged: items.filter((item) => item.change_type === 'unchanged').length,
    },
    items,
  };
}
