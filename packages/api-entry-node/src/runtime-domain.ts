import type {
  RuntimeModelAliasRecord,
  RuntimeModelCatalogEntryRecord,
  RuntimeModelComboRecord,
} from './runtime-store.js';

type ModelTarget = {
  provider: string;
  model: string;
};

export type RuntimeDomainValidationResult =
  | { ok: true }
  | { ok: false; message: string };

function hasModelTarget(
  models: RuntimeModelCatalogEntryRecord[],
  target: ModelTarget,
): boolean {
  return models.some((item) => item.provider === target.provider && item.model_id === target.model);
}

export function validateAliasTargetExists(params: {
  models: RuntimeModelCatalogEntryRecord[];
  targetProvider: string;
  targetModel: string;
}): RuntimeDomainValidationResult {
  const { models, targetProvider, targetModel } = params;
  return hasModelTarget(models, { provider: targetProvider, model: targetModel })
    ? { ok: true }
    : { ok: false, message: 'runtime_alias_target_model_not_found' };
}

export function validateComboTargetsExist(params: {
  models: RuntimeModelCatalogEntryRecord[];
  targets: Array<{ provider: string; model: string }>;
}): RuntimeDomainValidationResult {
  const { models, targets } = params;
  return targets.every((target) => hasModelTarget(models, target))
    ? { ok: true }
    : { ok: false, message: 'runtime_combo_target_model_not_found' };
}

export function validateModelDeletionAllowed(params: {
  model: RuntimeModelCatalogEntryRecord;
  aliases: RuntimeModelAliasRecord[];
  combos: RuntimeModelComboRecord[];
}): RuntimeDomainValidationResult {
  const { model, aliases, combos } = params;
  if (aliases.some((item) => item.target_provider === model.provider && item.target_model === model.model_id)) {
    return { ok: false, message: 'runtime_model_referenced_by_alias' };
  }
  if (combos.some((item) => item.targets.some((target) => target.provider === model.provider && target.model === model.model_id))) {
    return { ok: false, message: 'runtime_model_referenced_by_combo' };
  }
  return { ok: true };
}

export function validateModelProviderMutationAllowed(params: {
  current: RuntimeModelCatalogEntryRecord;
  nextProvider: string;
  aliases: RuntimeModelAliasRecord[];
  combos: RuntimeModelComboRecord[];
}): RuntimeDomainValidationResult {
  const { current, nextProvider, aliases, combos } = params;
  if (current.provider === nextProvider) {
    return { ok: true };
  }
  const aliasReferenceExists = aliases.some((item) => item.target_provider === current.provider && item.target_model === current.model_id);
  if (aliasReferenceExists) {
    return { ok: false, message: 'runtime_model_provider_change_blocked_by_alias' };
  }
  const comboReferenceExists = combos.some((item) => item.targets.some((target) => target.provider === current.provider && target.model === current.model_id));
  if (comboReferenceExists) {
    return { ok: false, message: 'runtime_model_provider_change_blocked_by_combo' };
  }
  return { ok: true };
}
