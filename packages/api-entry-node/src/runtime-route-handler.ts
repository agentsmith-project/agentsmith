import type http from 'node:http';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import {
  validateAliasTargetExists,
  validateComboTargetsExist,
  validateModelDeletionAllowed,
  validateModelProviderMutationAllowed,
} from './runtime-domain.js';
import { executeRuntimeUnifiedChat } from './runtime-unified-chat.js';
import { previewRuntimeImpact } from './runtime-impact-preview.js';
import {
  comparePricingVersions,
  evaluatePricingActivationReadiness,
} from './runtime-pricing-governance.js';
import {
  createDraftRuntimeRelease,
  isApprovalChecklistComplete,
  normalizeRuntimeRolloutPolicy,
} from './runtime-release-controls.js';
import { dryRunRuntimeRouting } from './runtime-routing-dry-run.js';
import {
  createRuntimeStore,
  type RuntimeCatalogModelProjectionRecord,
  type RuntimeModelAliasRecord,
  type RuntimeModelCatalogEntryRecord,
  type RuntimeModelComboRecord,
  type RuntimePricingRecord,
  type RuntimePricingVersionRecord,
  type RuntimeProviderConnectionRecord,
} from './runtime-store.js';
import {
  listRuntimeCatalogJobs,
  readActiveCatalogSnapshot,
  syncRuntimeCatalogFromModelsDev,
} from './runtime-catalog-service.js';
import {
  parseRuntimeAliasPayload,
  parseRuntimeAliasUpdatePayload,
  parseRuntimeComboPayload,
  parseRuntimeComboUpdatePayload,
  parseRuntimeModelCreatePayload,
  parseRuntimeModelUpdatePayload,
  parseRuntimePricingPayload,
  parseRuntimePricingVersionComparePayload,
  parseRuntimePricingVersionCreatePayload,
  parseRuntimeRoutePublishPayload,
  parseRuntimeProviderCreatePayload,
  parseRuntimeProviderUpdatePayload,
} from './runtime-validation.js';

interface AnyRoute {
  kind: string;
  workspaceId?: string;
  projectId?: string;
  providerConnectionId?: string;
  pricingVersionId?: string;
  provider?: string;
  modelId?: string;
  alias?: string;
  combo?: string;
}

interface RuntimeHandlerArgs {
  route: AnyRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

function requireProjectScope(
  route: AnyRoute,
  json: RuntimeHandlerArgs['json'],
  res: http.ServerResponse,
): { workspaceId: string; projectId: string } | null {
  if (!route.workspaceId || !route.projectId) {
    json(res, 400, { error_code: 'BAD_REQUEST', message: 'workspace_and_project_required' });
    return null;
  }
  return { workspaceId: route.workspaceId, projectId: route.projectId };
}

async function evaluateRoutePublishGuardrails(params: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  model: string;
}) {
  const result = await dryRunRuntimeRouting({
    deps: params.deps,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    rawBody: { model: params.model },
  });
  if (result.statusCode !== 200) {
    return null;
  }
  return 'guardrails' in result.body ? result.body.guardrails : null;
}

export async function handleRuntimeRoute(args: RuntimeHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, json, readBody } = args;

  const scope = requireProjectScope(route, json, res);
  if (!scope) return false;
  const { workspaceId, projectId } = scope;
  const runtimeStore = createRuntimeStore(deps.docStore);
  const projectScope = { workspaceId, projectId };

  const filterCatalogModels = (
    items: RuntimeCatalogModelProjectionRecord[],
    reqUrl: string | undefined,
  ): RuntimeCatalogModelProjectionRecord[] => {
    const url = new URL(reqUrl ?? '', 'http://localhost');
    const provider = url.searchParams.get('provider');
    const capability = url.searchParams.get('capability');
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    return items.filter((item) => {
      if (provider && item.provider_key !== provider && item.provider_id !== provider) return false;
      if (capability && !item.capabilities.includes(capability)) return false;
      if (q && !`${item.provider_name} ${item.model_id} ${item.name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  };

  if (route.kind === 'llmUnifiedChat' && method === 'POST') {
    const result = await executeRuntimeUnifiedChat({
      deps,
      workspaceId,
      projectId,
      rawBody: await readBody(req),
      endUserId: user.id,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
    });
    if (typeof result.body !== 'undefined') {
      json(res, result.statusCode, result.body);
      return true;
    }
    res.statusCode = result.statusCode;
    res.setHeader('content-type', result.contentType ?? 'application/octet-stream');
    res.end(result.text ?? '');
    return true;
  }

  if (route.kind === 'runtimeRoutingDryRun' && method === 'POST') {
    const result = await dryRunRuntimeRouting({
      deps,
      workspaceId,
      projectId,
      rawBody: await readBody(req),
    });
    json(res, result.statusCode, result.body);
    return true;
  }

  if (route.kind === 'runtimeImpactPreview' && method === 'POST') {
    const result = await previewRuntimeImpact({
      deps,
      workspaceId,
      projectId,
      rawBody: await readBody(req),
    });
    json(res, result.statusCode, result.body);
    return true;
  }

  if (route.kind === 'runtimeCatalogStatus' && method === 'GET') {
    const snapshot = await readActiveCatalogSnapshot(deps.docStore);
    const jobs = await listRuntimeCatalogJobs(deps.docStore);
    json(res, 200, {
      initialized: Boolean(snapshot.version),
      active_version: snapshot.version,
      provider_count: snapshot.providers.length,
      model_count: snapshot.models.length,
      last_job: jobs[0] ?? null,
    });
    return true;
  }

  if (route.kind === 'runtimeCatalogProviders' && method === 'GET') {
    const snapshot = await readActiveCatalogSnapshot(deps.docStore);
    if (!snapshot.version) {
      json(res, 503, { error_code: 'CATALOG_NOT_INITIALIZED', message: 'runtime_catalog_not_initialized' });
      return true;
    }
    json(res, 200, {
      version: snapshot.version,
      items: snapshot.providers.sort((a, b) => a.name.localeCompare(b.name)),
    });
    return true;
  }

  if (route.kind === 'runtimeCatalogModels' && method === 'GET') {
    const snapshot = await readActiveCatalogSnapshot(deps.docStore);
    if (!snapshot.version) {
      json(res, 503, { error_code: 'CATALOG_NOT_INITIALIZED', message: 'runtime_catalog_not_initialized' });
      return true;
    }
    const items = filterCatalogModels(snapshot.models, req.url);
    json(res, 200, {
      version: snapshot.version,
      items,
      total: items.length,
    });
    return true;
  }

  if (route.kind === 'runtimeCatalogJobs' && method === 'GET') {
    const jobs = await listRuntimeCatalogJobs(deps.docStore);
    json(res, 200, { items: jobs });
    return true;
  }

  if (route.kind === 'runtimeCatalogSync' && method === 'POST') {
    const version = await syncRuntimeCatalogFromModelsDev(deps.docStore, user.id);
    json(res, 201, { version });
    return true;
  }

  if (route.kind === 'runtimeProviders' && method === 'GET') {
    const items = await runtimeStore.listProviders(projectScope);
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'runtimeProviders' && method === 'POST') {
    const parsedProvider = parseRuntimeProviderCreatePayload(await readBody(req));
    if (!parsedProvider.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedProvider.message });
      return true;
    }
    const providerPayload = parsedProvider.value;

    const record: RuntimeProviderConnectionRecord = {
      id: runtimeStore.createId('rpc'),
      workspace_id: workspaceId,
      project_id: projectId,
      provider: providerPayload.provider,
      auth_mode: providerPayload.auth_mode,
      base_url: providerPayload.base_url,
      credential_ref: providerPayload.credential_ref,
      priority: providerPayload.priority,
      status: providerPayload.status,
      created_at: runtimeStore.nowIso(),
      updated_at: runtimeStore.nowIso(),
    };

    await runtimeStore.upsertProvider(record);
    json(res, 201, record);
    return true;
  }

  if (route.kind === 'runtimeProviderItem' && route.providerConnectionId && method === 'PUT') {
    const existing = await runtimeStore.getProvider(route.providerConnectionId);
    if (!existing || existing.workspace_id !== workspaceId || existing.project_id !== projectId) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'runtime_provider_not_found' });
      return true;
    }

    const parsedProviderUpdate = parseRuntimeProviderUpdatePayload(await readBody(req));
    if (!parsedProviderUpdate.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedProviderUpdate.message });
      return true;
    }
    const providerUpdate = parsedProviderUpdate.value;

    const updated: RuntimeProviderConnectionRecord = {
      ...existing,
      base_url: providerUpdate.base_url || existing.base_url,
      credential_ref: providerUpdate.credential_ref ?? existing.credential_ref,
      priority: providerUpdate.priority ?? existing.priority,
      status: providerUpdate.status ?? existing.status,
      updated_at: runtimeStore.nowIso(),
    };

    await runtimeStore.upsertProvider(updated);
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'runtimeProviderItem' && route.providerConnectionId && method === 'DELETE') {
    const existing = await runtimeStore.getProvider(route.providerConnectionId);
    if (!existing || existing.workspace_id !== workspaceId || existing.project_id !== projectId) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'runtime_provider_not_found' });
      return true;
    }
    await runtimeStore.deleteProvider(route.providerConnectionId);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'runtimeModels' && method === 'GET') {
    const items = await runtimeStore.listModels(projectScope);
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'runtimeModels' && method === 'POST') {
    const parsedModel = parseRuntimeModelCreatePayload(await readBody(req));
    if (!parsedModel.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedModel.message });
      return true;
    }
    const modelPayload = parsedModel.value;
    const existing = await runtimeStore.listModels(projectScope);
    if (existing.some((item) => item.provider === modelPayload.provider && item.model_id === modelPayload.model_id)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'runtime_model_already_exists' });
      return true;
    }

    const record: RuntimeModelCatalogEntryRecord = {
      id: runtimeStore.createId('rmc'),
      workspace_id: workspaceId,
      project_id: projectId,
      provider: modelPayload.provider,
      model_id: modelPayload.model_id,
      display_name: modelPayload.display_name,
      capabilities: modelPayload.capabilities,
      context_window: modelPayload.context_window,
      max_tokens: modelPayload.max_tokens,
      pricing: modelPayload.pricing,
      created_at: runtimeStore.nowIso(),
      updated_at: runtimeStore.nowIso(),
    };

    await runtimeStore.upsertModel(record);
    json(res, 201, record);
    return true;
  }

  if (route.kind === 'runtimeModelItem' && method === 'GET') {
    if (!route.provider || !route.modelId) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_model_locator_required' });
      return true;
    }
    const item = await runtimeStore.findModel(projectScope, route.provider, route.modelId);
    if (!item) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_model_not_found' });
      return true;
    }
    json(res, 200, item);
    return true;
  }

  if (route.kind === 'runtimeModelItem' && method === 'PUT') {
    if (!route.provider || !route.modelId) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_model_locator_required' });
      return true;
    }
    const existing = await runtimeStore.findModel(projectScope, route.provider, route.modelId);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_model_not_found' });
      return true;
    }
    const parsedModelUpdate = parseRuntimeModelUpdatePayload(await readBody(req), existing.capabilities);
    if (!parsedModelUpdate.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedModelUpdate.message });
      return true;
    }
    const modelUpdate = parsedModelUpdate.value;
    const nextProvider = modelUpdate.provider || existing.provider;
    if (nextProvider !== existing.provider) {
      const [aliases, combos] = await Promise.all([
        runtimeStore.listAliases(projectScope),
        runtimeStore.listCombos(projectScope),
      ]);
      const providerMutationCheck = validateModelProviderMutationAllowed({
        current: existing,
        nextProvider,
        aliases,
        combos,
      });
      if (!providerMutationCheck.ok) {
        json(res, 409, { error_code: 'CONFLICT', message: providerMutationCheck.message });
        return true;
      }
    }
    const updated: RuntimeModelCatalogEntryRecord = {
      ...existing,
      provider: nextProvider,
      display_name: modelUpdate.display_name ?? existing.display_name,
      capabilities: modelUpdate.capabilities,
      context_window: modelUpdate.context_window ?? existing.context_window,
      max_tokens: modelUpdate.max_tokens ?? existing.max_tokens,
      pricing: modelUpdate.pricing ?? existing.pricing,
      updated_at: runtimeStore.nowIso(),
    };
    await runtimeStore.upsertModel(updated);
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'runtimeModelItem' && method === 'DELETE') {
    if (!route.provider || !route.modelId) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_model_locator_required' });
      return true;
    }
    const existing = await runtimeStore.findModel(projectScope, route.provider, route.modelId);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_model_not_found' });
      return true;
    }
    const [aliases, combos] = await Promise.all([
      runtimeStore.listAliases(projectScope),
      runtimeStore.listCombos(projectScope),
    ]);
    const deletionCheck = validateModelDeletionAllowed({
      model: existing,
      aliases,
      combos,
    });
    if (!deletionCheck.ok) {
      json(res, 409, { error_code: 'CONFLICT', message: deletionCheck.message });
      return true;
    }
    await runtimeStore.deleteModel(existing.id);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'runtimeRoutingAliases' && method === 'GET') {
    const items = await runtimeStore.listAliases(projectScope);
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'runtimeRoutingAliases' && method === 'POST') {
    const parsedAlias = parseRuntimeAliasPayload(await readBody(req));
    if (!parsedAlias.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedAlias.message });
      return true;
    }
    const aliasPayload = parsedAlias.value;
    const [existing, models] = await Promise.all([
      runtimeStore.listAliases(projectScope),
      runtimeStore.listModels(projectScope),
    ]);
    if (existing.some((item) => item.alias === aliasPayload.alias)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'runtime_alias_already_exists' });
      return true;
    }
    const aliasTargetCheck = validateAliasTargetExists({
      models,
      targetProvider: aliasPayload.target_provider,
      targetModel: aliasPayload.target_model,
    });
    if (!aliasTargetCheck.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: aliasTargetCheck.message });
      return true;
    }

    const record: RuntimeModelAliasRecord = {
      id: runtimeStore.createId('rma'),
      workspace_id: workspaceId,
      project_id: projectId,
      alias: aliasPayload.alias,
      target_provider: aliasPayload.target_provider,
      target_model: aliasPayload.target_model,
      release: createDraftRuntimeRelease(),
      created_at: runtimeStore.nowIso(),
      updated_at: runtimeStore.nowIso(),
    };

    await runtimeStore.upsertAlias(record);
    json(res, 201, record);
    return true;
  }

  if (route.kind === 'runtimeRoutingAliasItem' && method === 'GET') {
    if (!route.alias) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_alias_required' });
      return true;
    }
    const existing = await runtimeStore.findAlias(projectScope, route.alias);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_alias_not_found' });
      return true;
    }
    json(res, 200, existing);
    return true;
  }

  if (route.kind === 'runtimeRoutingAliasItem' && method === 'PUT') {
    if (!route.alias) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_alias_required' });
      return true;
    }
    const existing = await runtimeStore.findAlias(projectScope, route.alias);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_alias_not_found' });
      return true;
    }
    const parsedAliasUpdate = parseRuntimeAliasUpdatePayload(await readBody(req));
    if (!parsedAliasUpdate.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedAliasUpdate.message });
      return true;
    }
    const aliasUpdate = parsedAliasUpdate.value;
    const nextTargetProvider = aliasUpdate.target_provider || existing.target_provider;
    const nextTargetModel = aliasUpdate.target_model || existing.target_model;
    const models = await runtimeStore.listModels(projectScope);
    const aliasTargetCheck = validateAliasTargetExists({
      models,
      targetProvider: nextTargetProvider,
      targetModel: nextTargetModel,
    });
    if (!aliasTargetCheck.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: aliasTargetCheck.message });
      return true;
    }
    const updated: RuntimeModelAliasRecord = {
      ...existing,
      target_provider: nextTargetProvider,
      target_model: nextTargetModel,
      release: createDraftRuntimeRelease(existing.release),
      updated_at: runtimeStore.nowIso(),
    };
    await runtimeStore.upsertAlias(updated);
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'runtimeRoutingAliasPublish' && method === 'POST') {
    if (!route.alias) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_alias_required' });
      return true;
    }
    const existing = await runtimeStore.findAlias(projectScope, route.alias);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_alias_not_found' });
      return true;
    }
    const parsedPublish = parseRuntimeRoutePublishPayload(await readBody(req));
    if (!parsedPublish.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedPublish.message });
      return true;
    }
    if (!isApprovalChecklistComplete(parsedPublish.value.approval_checklist)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'runtime_route_approval_incomplete' });
      return true;
    }
    const guardrails = await evaluateRoutePublishGuardrails({
      deps,
      workspaceId,
      projectId,
      model: existing.alias,
    });
    if (!guardrails || guardrails.release_readiness === 'blocked') {
      json(res, 409, {
        error_code: 'CONFLICT',
        message: 'runtime_route_publish_blocked',
        guardrails,
      });
      return true;
    }
    const published: RuntimeModelAliasRecord = {
      ...existing,
      release: {
        status: 'published',
        approval_checklist: parsedPublish.value.approval_checklist,
        rollout_policy: normalizeRuntimeRolloutPolicy(parsedPublish.value.rollout_policy),
        published_at: runtimeStore.nowIso(),
      },
      updated_at: runtimeStore.nowIso(),
    };
    await runtimeStore.upsertAlias(published);
    json(res, 200, { item: published, guardrails });
    return true;
  }

  if (route.kind === 'runtimeRoutingAliasItem' && method === 'DELETE') {
    if (!route.alias) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_alias_required' });
      return true;
    }
    const existing = await runtimeStore.findAlias(projectScope, route.alias);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_alias_not_found' });
      return true;
    }
    await runtimeStore.deleteAlias(existing.id);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'runtimeRoutingCombos' && method === 'GET') {
    const items = await runtimeStore.listCombos(projectScope);
    json(res, 200, { items });
    return true;
  }

  if (route.kind === 'runtimeRoutingCombos' && method === 'POST') {
    const parsedCombo = parseRuntimeComboPayload(await readBody(req));
    if (!parsedCombo.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedCombo.message });
      return true;
    }
    const comboPayload = parsedCombo.value;
    const [existing, models] = await Promise.all([
      runtimeStore.listCombos(projectScope),
      runtimeStore.listModels(projectScope),
    ]);
    if (existing.some((item) => item.name === comboPayload.name)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'runtime_combo_already_exists' });
      return true;
    }
    const comboTargetCheck = validateComboTargetsExist({
      models,
      targets: comboPayload.targets,
    });
    if (!comboTargetCheck.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: comboTargetCheck.message });
      return true;
    }

    const record: RuntimeModelComboRecord = {
      id: runtimeStore.createId('rmco'),
      workspace_id: workspaceId,
      project_id: projectId,
      name: comboPayload.name,
      targets: comboPayload.targets,
      fallback_policy: comboPayload.fallback_policy,
      release: createDraftRuntimeRelease(),
      created_at: runtimeStore.nowIso(),
      updated_at: runtimeStore.nowIso(),
    };

    await runtimeStore.upsertCombo(record);
    json(res, 201, record);
    return true;
  }

  if (route.kind === 'runtimeRoutingComboItem' && method === 'GET') {
    if (!route.combo) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_combo_required' });
      return true;
    }
    const existing = await runtimeStore.findCombo(projectScope, route.combo);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_combo_not_found' });
      return true;
    }
    json(res, 200, existing);
    return true;
  }

  if (route.kind === 'runtimeRoutingComboItem' && method === 'PUT') {
    if (!route.combo) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_combo_required' });
      return true;
    }
    const existing = await runtimeStore.findCombo(projectScope, route.combo);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_combo_not_found' });
      return true;
    }
    const parsedComboUpdate = parseRuntimeComboUpdatePayload(await readBody(req), existing);
    if (!parsedComboUpdate.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedComboUpdate.message });
      return true;
    }
    const comboUpdate = parsedComboUpdate.value;
    const models = await runtimeStore.listModels(projectScope);
    const comboTargetCheck = validateComboTargetsExist({
      models,
      targets: comboUpdate.targets,
    });
    if (!comboTargetCheck.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: comboTargetCheck.message });
      return true;
    }
    const updated: RuntimeModelComboRecord = {
      ...existing,
      targets: comboUpdate.targets,
      fallback_policy: comboUpdate.fallback_policy,
      release: createDraftRuntimeRelease(existing.release),
      updated_at: runtimeStore.nowIso(),
    };
    await runtimeStore.upsertCombo(updated);
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'runtimeRoutingComboPublish' && method === 'POST') {
    if (!route.combo) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_combo_required' });
      return true;
    }
    const existing = await runtimeStore.findCombo(projectScope, route.combo);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_combo_not_found' });
      return true;
    }
    const parsedPublish = parseRuntimeRoutePublishPayload(await readBody(req));
    if (!parsedPublish.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedPublish.message });
      return true;
    }
    if (!isApprovalChecklistComplete(parsedPublish.value.approval_checklist)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'runtime_route_approval_incomplete' });
      return true;
    }
    const guardrails = await evaluateRoutePublishGuardrails({
      deps,
      workspaceId,
      projectId,
      model: `combo:${existing.name}`,
    });
    if (!guardrails || guardrails.release_readiness === 'blocked') {
      json(res, 409, {
        error_code: 'CONFLICT',
        message: 'runtime_route_publish_blocked',
        guardrails,
      });
      return true;
    }
    const published: RuntimeModelComboRecord = {
      ...existing,
      release: {
        status: 'published',
        approval_checklist: parsedPublish.value.approval_checklist,
        rollout_policy: normalizeRuntimeRolloutPolicy(parsedPublish.value.rollout_policy),
        published_at: runtimeStore.nowIso(),
      },
      updated_at: runtimeStore.nowIso(),
    };
    await runtimeStore.upsertCombo(published);
    json(res, 200, { item: published, guardrails });
    return true;
  }

  if (route.kind === 'runtimeRoutingComboItem' && method === 'DELETE') {
    if (!route.combo) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_combo_required' });
      return true;
    }
    const existing = await runtimeStore.findCombo(projectScope, route.combo);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_combo_not_found' });
      return true;
    }
    await runtimeStore.deleteCombo(existing.id);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'runtimePricing' && method === 'GET') {
    const resolved = await runtimeStore.resolvePricing(projectScope);
    json(res, 200, resolved.pricing_map ?? {});
    return true;
  }

  if (route.kind === 'runtimePricing' && method === 'PATCH') {
    const parsedPricing = parseRuntimePricingPayload(await readBody(req));
    if (!parsedPricing.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsedPricing.message });
      return true;
    }

    const record: RuntimePricingRecord = {
      id: runtimeStore.pricingRecordId(projectScope),
      workspace_id: workspaceId,
      project_id: projectId,
      pricing_map: parsedPricing.value,
      updated_at: runtimeStore.nowIso(),
    };

    await runtimeStore.upsertPricing(record);
    json(res, 200, record.pricing_map);
    return true;
  }

  if (route.kind === 'runtimePricingVersions' && method === 'GET') {
    const items = await runtimeStore.listScopedPricingVersions(projectScope);
    const resolved = await runtimeStore.resolvePricing(projectScope);
    json(res, 200, {
      items: items.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      active_versions: {
        global: resolved.active_versions.global?.id ?? null,
        workspace: resolved.active_versions.workspace?.id ?? null,
        project: resolved.active_versions.project?.id ?? null,
      },
      effective_version: resolved.pricing_version_id
        ? {
          id: resolved.pricing_version_id,
          version_name: resolved.pricing_version_name ?? resolved.pricing_version_id,
          scope_type: resolved.pricing_scope_type,
        }
        : null,
    });
    return true;
  }

  if (route.kind === 'runtimePricingVersions' && method === 'POST') {
    const parsed = parseRuntimePricingVersionCreatePayload(await readBody(req));
    if (!parsed.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsed.message });
      return true;
    }
    const payload = parsed.value;
    const existing = await runtimeStore.listScopedPricingVersions(projectScope);
    const duplicate = existing.find((item) => item.scope_type === payload.scope_type && item.version_name === payload.version_name);
    if (duplicate) {
      json(res, 409, { error_code: 'CONFLICT', message: 'runtime_pricing_version_already_exists' });
      return true;
    }

    const record: RuntimePricingVersionRecord = {
      id: runtimeStore.createId('rpv'),
      scope_type: payload.scope_type,
      workspace_id: payload.scope_type === 'global' ? undefined : workspaceId,
      project_id: payload.scope_type === 'project' ? projectId : undefined,
      version_name: payload.version_name,
      description: payload.description,
      pricing_map: payload.pricing_map,
      status: payload.activate ? 'active' : 'draft',
      created_at: runtimeStore.nowIso(),
      updated_at: runtimeStore.nowIso(),
      activated_at: payload.activate ? runtimeStore.nowIso() : undefined,
    };

    if (payload.activate) {
      const resolved = await runtimeStore.resolvePricing(projectScope);
      const [models, aliases, combos, currentVersions] = await Promise.all([
        runtimeStore.listModels(projectScope),
        runtimeStore.listAliases(projectScope),
        runtimeStore.listCombos(projectScope),
        runtimeStore.listScopedPricingVersions(projectScope),
      ]);
      const workspaceVersion = currentVersions.find((item) => item.scope_type === 'workspace' && item.status === 'active');
      const globalVersion = currentVersions.find((item) => item.scope_type === 'global' && item.status === 'active');
      const projectVersion = currentVersions.find((item) => item.scope_type === 'project' && item.status === 'active');
      const readiness = evaluatePricingActivationReadiness({
        scopeType: payload.scope_type,
        candidateMap: payload.pricing_map,
        activeProjectMap: projectVersion?.pricing_map,
        activeWorkspaceMap: workspaceVersion?.pricing_map,
        activeGlobalMap: globalVersion?.pricing_map,
        models,
        aliases,
        combos,
      });
      if (readiness.release_readiness === 'blocked') {
        json(res, 409, {
          error_code: 'CONFLICT',
          message: 'runtime_pricing_activation_missing_price',
          readiness,
          effective_version: resolved.pricing_version_id,
        });
        return true;
      }
      for (const item of currentVersions.filter((version) => (
        version.scope_type === payload.scope_type
        && version.status === 'active'
        && (
          payload.scope_type === 'global'
          || version.workspace_id === workspaceId
        )
        && (
          payload.scope_type !== 'project'
          || version.project_id === projectId
        )
      ))) {
        await runtimeStore.upsertPricingVersion({
          ...item,
          status: 'archived',
          updated_at: runtimeStore.nowIso(),
        });
      }
    }

    await runtimeStore.upsertPricingVersion(record);
    json(res, 201, record);
    return true;
  }

  if (route.kind === 'runtimePricingVersionActivate' && method === 'POST') {
    if (!route.pricingVersionId) {
      json(res, 400, { error_code: 'BAD_REQUEST', message: 'runtime_pricing_version_required' });
      return true;
    }
    const version = await runtimeStore.getPricingVersion(route.pricingVersionId);
    if (!version) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_pricing_version_not_found' });
      return true;
    }
    if (version.scope_type !== 'global' && version.workspace_id !== workspaceId) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_pricing_version_not_found' });
      return true;
    }
    if (version.scope_type === 'project' && version.project_id !== projectId) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_pricing_version_not_found' });
      return true;
    }

    const [models, aliases, combos, currentVersions] = await Promise.all([
      runtimeStore.listModels(projectScope),
      runtimeStore.listAliases(projectScope),
      runtimeStore.listCombos(projectScope),
      runtimeStore.listScopedPricingVersions(projectScope),
    ]);
    const workspaceVersion = currentVersions.find((item) => item.scope_type === 'workspace' && item.status === 'active');
    const globalVersion = currentVersions.find((item) => item.scope_type === 'global' && item.status === 'active');
    const projectVersion = currentVersions.find((item) => item.scope_type === 'project' && item.status === 'active');
    const readiness = evaluatePricingActivationReadiness({
      scopeType: version.scope_type,
      candidateMap: version.pricing_map,
      activeProjectMap: projectVersion?.pricing_map,
      activeWorkspaceMap: workspaceVersion?.pricing_map,
      activeGlobalMap: globalVersion?.pricing_map,
      models,
      aliases,
      combos,
    });
    if (readiness.release_readiness === 'blocked') {
      json(res, 409, {
        error_code: 'CONFLICT',
        message: 'runtime_pricing_activation_missing_price',
        readiness,
      });
      return true;
    }
    for (const item of currentVersions.filter((candidate) => (
      candidate.scope_type === version.scope_type
      && candidate.status === 'active'
      && candidate.id !== version.id
      && (
        version.scope_type === 'global'
        || candidate.workspace_id === workspaceId
      )
      && (
        version.scope_type !== 'project'
        || candidate.project_id === projectId
      )
    ))) {
      await runtimeStore.upsertPricingVersion({
        ...item,
        status: 'archived',
        updated_at: runtimeStore.nowIso(),
      });
    }
    const updated: RuntimePricingVersionRecord = {
      ...version,
      status: 'active',
      activated_at: runtimeStore.nowIso(),
      updated_at: runtimeStore.nowIso(),
    };
    await runtimeStore.upsertPricingVersion(updated);
    json(res, 200, { version: updated, readiness });
    return true;
  }

  if (route.kind === 'runtimePricingCompare' && method === 'POST') {
    const parsed = parseRuntimePricingVersionComparePayload(await readBody(req));
    if (!parsed.ok) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: parsed.message });
      return true;
    }
    const [baseline, candidate] = await Promise.all([
      runtimeStore.getPricingVersion(parsed.value.baseline_version_id),
      runtimeStore.getPricingVersion(parsed.value.candidate_version_id),
    ]);
    if (!baseline || !candidate) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'runtime_pricing_version_not_found' });
      return true;
    }
    json(res, 200, comparePricingVersions({ baseline, candidate }));
    return true;
  }

  return false;
}
