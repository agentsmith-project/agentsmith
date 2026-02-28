import { http, HttpResponse } from 'msw';
import { recordRuntimeUsageFact } from '../state/runtime-usage';

const providers: Array<Record<string, unknown>> = [];
const models: Array<Record<string, unknown>> = [];
const aliases: Array<Record<string, unknown>> = [];
const combos: Array<Record<string, unknown>> = [];
const pricingByProject = new Map<string, Record<string, unknown>>();
const pricingVersions: Array<Record<string, unknown>> = [];

function nowIso() {
  return new Date().toISOString();
}

function projectKey(params: Record<string, string | readonly string[] | undefined>) {
  return `${params.ws ?? 'ws'}:${params.prj ?? 'prj'}`;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
}

function currentEndUserId() {
  return 'user_001';
}

function resolvePricingStack(key: string) {
  const [workspaceId] = key.split(':', 2);
  const projectVersion = pricingVersions.find((item) => item.scope_type === 'project' && item._scope === key && item.status === 'active');
  const workspaceVersion = pricingVersions.find((item) => item.scope_type === 'workspace' && item.workspace_id === workspaceId && item.status === 'active');
  const globalVersion = pricingVersions.find((item) => item.scope_type === 'global' && item.status === 'active');
  const effectiveVersion = projectVersion ?? workspaceVersion ?? globalVersion;
  const legacyPricing = pricingByProject.get(key) as Record<string, unknown> | undefined;
  return {
    projectVersion,
    workspaceVersion,
    globalVersion,
    effectiveVersion,
    effectivePricing: (effectiveVersion?.pricing_map as Record<string, Record<string, Record<string, number>>> | undefined)
      ?? (legacyPricing as Record<string, Record<string, Record<string, number>>> | undefined),
  };
}

function getPricingEntry(
  pricingMap: Record<string, Record<string, Record<string, number>>> | undefined,
  provider: string,
  model: string,
) {
  return pricingMap?.[provider]?.[model];
}

function collectReferencedTargets(key: string) {
  const scopedModels = models.filter((item) => item._scope === key);
  const scopedAliases = aliases.filter((item) => item._scope === key);
  const scopedCombos = combos.filter((item) => item._scope === key);
  const seen = new Set<string>();
  const targets: Array<{ provider: string; model: string }> = [];
  const push = (provider: string, model: string) => {
    const targetKey = `${provider}:${model}`;
    if (seen.has(targetKey)) return;
    seen.add(targetKey);
    targets.push({ provider, model });
  };

  for (const item of scopedModels) push(String(item.provider), String(item.model_id));
  for (const item of scopedAliases) push(String(item.target_provider), String(item.target_model));
  for (const item of scopedCombos) {
    const comboTargets = Array.isArray(item.targets) ? item.targets : [];
    for (const target of comboTargets) {
      if (target && typeof target === 'object') {
        const provider = asString((target as Record<string, unknown>).provider);
        const model = asString((target as Record<string, unknown>).model);
        if (provider && model) push(provider, model);
      }
    }
  }
  return {
    targets,
    scopedModels,
  };
}

function evaluatePricingVersionReadiness(params: {
  key: string;
  scopeType: string;
  candidateMap: Record<string, Record<string, Record<string, number>>>;
}) {
  const stack = resolvePricingStack(params.key);
  const effectivePricing: Record<string, Record<string, Record<string, number>>> = {};
  const mergeMap = (pricingMap: Record<string, Record<string, Record<string, number>>> | undefined) => {
    if (!pricingMap) return;
    for (const [provider, modelMap] of Object.entries(pricingMap)) {
      effectivePricing[provider] ??= {};
      for (const [model, pricing] of Object.entries(modelMap)) {
        effectivePricing[provider]![model] = pricing;
      }
    }
  };
  mergeMap(stack.globalVersion?.pricing_map as Record<string, Record<string, Record<string, number>>> | undefined);
  mergeMap(stack.workspaceVersion?.pricing_map as Record<string, Record<string, Record<string, number>>> | undefined);
  mergeMap(stack.projectVersion?.pricing_map as Record<string, Record<string, Record<string, number>>> | undefined);
  if (params.scopeType === 'global' || params.scopeType === 'workspace' || params.scopeType === 'project') {
    mergeMap(params.candidateMap);
  }
  const { targets, scopedModels } = collectReferencedTargets(params.key);
  const missingTargets = targets.filter((target) => {
    if (getPricingEntry(effectivePricing, target.provider, target.model)) return false;
    const catalog = scopedModels.find((item) => item.provider === target.provider && item.model_id === target.model);
    return !catalog?.pricing;
  });
  return {
    release_readiness: missingTargets.length > 0 ? 'blocked' : 'ready',
    missing_targets: missingTargets,
    blockers: missingTargets.length > 0 ? ['runtime_pricing_activation_missing_price'] : [],
  } as const;
}

export const runtimeHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/providers', ({ params }) => {
    const key = projectKey(params);
    const items = providers.filter((item) => item._scope === key).map(({ _scope, ...rest }) => rest);
    return HttpResponse.json({ items });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/providers', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const item = {
      id: `rpc_${Date.now()}`,
      workspace_id: params.ws,
      project_id: params.prj,
      provider: body.provider ?? 'openai',
      auth_mode: body.auth_mode ?? 'api_key',
      base_url: body.base_url ?? 'https://api.openai.com/v1',
      credential_ref: body.credential_ref,
      priority: body.priority,
      status: body.status ?? 'active',
      created_at: nowIso(),
      updated_at: nowIso(),
      _scope: key,
    };
    providers.push(item);
    const { _scope, ...responseItem } = item;
    return HttpResponse.json(responseItem, { status: 201 });
  }),

  http.put('/api/v1/workspaces/:ws/projects/:prj/runtime/providers/:id', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const idx = providers.findIndex((item) => item.id === params.id && item._scope === key);
    if (idx < 0) return HttpResponse.json({ error_code: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    providers[idx] = { ...providers[idx], ...body, updated_at: nowIso() };
    const { _scope, ...responseItem } = providers[idx];
    return HttpResponse.json(responseItem);
  }),

  http.delete('/api/v1/workspaces/:ws/projects/:prj/runtime/providers/:id', ({ params }) => {
    const key = projectKey(params);
    const idx = providers.findIndex((item) => item.id === params.id && item._scope === key);
    if (idx >= 0) providers.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/models', ({ params }) => {
    const key = projectKey(params);
    const items = models.filter((item) => item._scope === key).map(({ _scope, ...rest }) => rest);
    return HttpResponse.json({ items });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/models', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    if (models.some((item) => item._scope === key && item.provider === body.provider && item.model_id === body.model_id)) {
      return HttpResponse.json({ error_code: 'CONFLICT', message: 'runtime_model_already_exists' }, { status: 409 });
    }
    const item = {
      id: nowId('rmc'),
      workspace_id: params.ws,
      project_id: params.prj,
      provider: body.provider ?? 'openai',
      model_id: body.model_id ?? 'gpt-4o',
      display_name: body.display_name ?? body.model_id,
      capabilities: body.capabilities ?? ['chat_completion'],
      pricing: body.pricing,
      created_at: nowIso(),
      updated_at: nowIso(),
      _scope: key,
    };
    models.push(item);
    const { _scope, ...responseItem } = item;
    return HttpResponse.json(responseItem, { status: 201 });
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/providers/:provider/models/:modelId', ({ params }) => {
    const key = projectKey(params);
    const item = models.find((entry) => entry._scope === key && entry.provider === params.provider && entry.model_id === params.modelId);
    if (!item) return HttpResponse.json({ error_code: 'NOT_FOUND' }, { status: 404 });
    const { _scope, ...responseItem } = item;
    return HttpResponse.json(responseItem);
  }),

  http.put('/api/v1/workspaces/:ws/projects/:prj/runtime/providers/:provider/models/:modelId', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const idx = models.findIndex((entry) => entry._scope === key && entry.provider === params.provider && entry.model_id === params.modelId);
    if (idx < 0) return HttpResponse.json({ error_code: 'NOT_FOUND' }, { status: 404 });
    models[idx] = {
      ...models[idx],
      ...body,
      model_id: models[idx].model_id,
      updated_at: nowIso(),
    };
    const { _scope, ...responseItem } = models[idx];
    return HttpResponse.json(responseItem);
  }),

  http.delete('/api/v1/workspaces/:ws/projects/:prj/runtime/providers/:provider/models/:modelId', ({ params }) => {
    const key = projectKey(params);
    const idx = models.findIndex((entry) => entry._scope === key && entry.provider === params.provider && entry.model_id === params.modelId);
    if (idx < 0) return HttpResponse.json({ error_code: 'NOT_FOUND' }, { status: 404 });
    models.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/aliases', ({ params }) => {
    const key = projectKey(params);
    const items = aliases.filter((item) => item._scope === key).map(({ _scope, ...rest }) => rest);
    return HttpResponse.json({ items });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/dry-run', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const modelRaw = asString(body.model);
    if (!modelRaw) {
      return HttpResponse.json(
        { error_code: 'VALIDATION_ERROR', message: 'runtime_unified_chat_model_required' },
        { status: 422 },
      );
    }

    const scopedProviders = providers.filter((item) => item._scope === key);
    const scopedModels = models.filter((item) => item._scope === key);
    const scopedAliases = aliases.filter((item) => item._scope === key);
    const scopedCombos = combos.filter((item) => item._scope === key);
    const resolvedPricing = resolvePricingStack(key);
    const pricing = resolvedPricing.effectivePricing;

    let routedBy: 'direct' | 'alias' | 'combo' = 'direct';
    let aliasName: string | undefined;
    let comboName: string | undefined;
    let fallbackPolicy: Record<string, unknown> | undefined;
    let attempts: Array<{ provider: string; model: string }> = [];

    if (modelRaw.startsWith('combo:')) {
      comboName = modelRaw.slice('combo:'.length).trim();
      const combo = scopedCombos.find((item) => item.name === comboName);
      if (!combo || !Array.isArray(combo.targets) || combo.targets.length === 0) {
        return HttpResponse.json({ error_code: 'VALIDATION_ERROR', message: 'runtime_combo_not_found' }, { status: 422 });
      }
      routedBy = 'combo';
      fallbackPolicy = combo.fallback_policy as Record<string, unknown>;
      attempts = combo.targets as Array<{ provider: string; model: string }>;
    } else if (modelRaw.includes('/')) {
      const [provider, model] = modelRaw.split('/', 2);
      if (!provider || !model) {
        return HttpResponse.json({ error_code: 'VALIDATION_ERROR', message: 'runtime_model_format_invalid' }, { status: 422 });
      }
      attempts = [{ provider, model }];
    } else {
      const alias = scopedAliases.find((item) => item.alias === modelRaw);
      if (!alias) {
        return HttpResponse.json({ error_code: 'VALIDATION_ERROR', message: 'runtime_alias_not_found' }, { status: 422 });
      }
      routedBy = 'alias';
      aliasName = String(alias.alias);
      attempts = [{
        provider: String(alias.target_provider),
        model: String(alias.target_model),
      }];
    }

    const issues = new Set<string>();
    const plannedAttempts = attempts.map((attempt, index) => {
      const providerConnections = scopedProviders
        .filter((item) => item.provider === attempt.provider)
        .sort((a, b) => Number(a.priority ?? Number.MAX_SAFE_INTEGER) - Number(b.priority ?? Number.MAX_SAFE_INTEGER));
      const activeConnection = providerConnections.find((item) => item.status === 'active');
      const fallbackConnection = activeConnection ?? providerConnections[0];
      const modelEntry = scopedModels.find((item) => item.provider === attempt.provider && item.model_id === attempt.model);
      const projectPricing = pricing?.[attempt.provider]?.[attempt.model];
      const modelPricing = modelEntry?.pricing as Record<string, number> | undefined;
      const pricingSource = projectPricing
        ? (resolvedPricing.projectVersion
          ? 'project_override'
          : resolvedPricing.workspaceVersion
            ? 'workspace_default'
            : resolvedPricing.globalVersion
              ? 'global_default'
              : 'project_override')
        : modelPricing ? 'model_catalog' : 'missing';

      if (!modelEntry) issues.add('runtime_model_not_registered');
      if (pricingSource === 'missing') issues.add('runtime_pricing_missing');
      if (!fallbackConnection) issues.add('runtime_provider_connection_missing');
      else if (fallbackConnection.status !== 'active') issues.add('runtime_provider_connection_disabled');
      else if (!fallbackConnection.credential_ref) issues.add('runtime_provider_credential_missing');

      return {
        index,
        provider: attempt.provider,
        model: attempt.model,
        provider_connection_id: fallbackConnection?.id as string | undefined,
        provider_connection_status: !fallbackConnection ? 'missing' : (fallbackConnection.status === 'active' ? 'active' : 'disabled'),
        connection_priority: fallbackConnection?.priority as number | undefined,
        connection_base_url: fallbackConnection?.base_url as string | undefined,
        pricing_source: pricingSource,
        pricing: projectPricing ?? modelPricing,
      };
    });

    return HttpResponse.json({
      model: modelRaw,
      routed_by: routedBy,
      alias: aliasName,
      combo_name: comboName,
      fallback_policy: fallbackPolicy,
      attempts: plannedAttempts,
      issues: Array.from(issues),
      guardrails: {
        release_readiness: issues.size > 0 ? 'blocked' : 'ready',
        blockers: [
          ...(issues.has('runtime_pricing_missing') ? ['runtime_guardrail_primary_pricing_missing'] : []),
          ...((issues.has('runtime_provider_connection_missing') || issues.has('runtime_provider_connection_disabled'))
            ? ['runtime_guardrail_primary_connection_unavailable']
            : []),
          ...(issues.has('runtime_model_not_registered') ? ['runtime_guardrail_model_not_registered'] : []),
          ...(issues.has('runtime_provider_credential_missing') ? ['runtime_guardrail_primary_credential_missing'] : []),
        ],
        warnings: [],
      },
    });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/impact-preview', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const modelRaw = asString(body.model);
    if (!modelRaw) {
      return HttpResponse.json({ error_code: 'VALIDATION_ERROR', message: 'runtime_unified_chat_model_required' }, { status: 422 });
    }
    return HttpResponse.json({
      model: modelRaw,
      lookback_window: {
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString(),
        lookback_hours: 168,
      },
      sample: {
        request_count: 42,
        total_estimated_cost: 0.1812,
        avg_estimated_cost: 0.004314,
        avg_tokens_in: 812.5,
        avg_tokens_out: 296.25,
        avg_tokens_total: 1108.75,
      },
      planned_route: {
        model: modelRaw,
        routed_by: modelRaw.startsWith('combo:') ? 'combo' : modelRaw.includes('/') ? 'direct' : 'alias',
        combo_name: modelRaw.startsWith('combo:') ? modelRaw.slice('combo:'.length) : undefined,
        alias: !modelRaw.startsWith('combo:') && !modelRaw.includes('/') ? modelRaw : undefined,
        attempts: [
          {
            index: 0,
            provider: 'openai',
            model: 'gpt-4o',
            provider_connection_id: 'rpc_1',
            provider_connection_status: 'active',
            pricing_source: 'project_override',
            pricing: { input: 2, output: 10 },
          },
          {
            index: 1,
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            provider_connection_id: 'rpc_2',
            provider_connection_status: 'active',
            pricing_source: 'model_catalog',
            pricing: { input: 3, output: 15 },
          },
        ],
        issues: [],
        guardrails: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [],
        },
      },
      projected_cost: {
        primary_avg_cost: 0.004587,
        primary_total_cost: 0.192654,
        range_avg_cost: {
          low: 0.004587,
          high: 0.006881,
        },
        range_total_cost: {
          low: 0.192654,
          high: 0.28899,
        },
      },
      assumptions: [
        'impact_preview_uses_recent_endpoint_usage_facts',
        'impact_preview_applies_average_token_mix_to_planned_pricing',
        'impact_preview_does_not_model_runtime_fallback_probability',
      ],
      guardrails: {
        release_readiness: 'ready',
        blockers: [],
        warnings: [],
      },
    });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/aliases', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    if (aliases.some((item) => item._scope === key && item.alias === body.alias)) {
      return HttpResponse.json({ error_code: 'CONFLICT', message: 'runtime_alias_already_exists' }, { status: 409 });
    }
    const item = {
      id: nowId('rma'),
      workspace_id: params.ws,
      project_id: params.prj,
      alias: body.alias ?? 'prod-chat',
      target_provider: body.target_provider ?? 'openai',
      target_model: body.target_model ?? 'gpt-4o',
      release: { status: 'draft' },
      created_at: nowIso(),
      updated_at: nowIso(),
      _scope: key,
    };
    aliases.push(item);
    const { _scope, ...responseItem } = item;
    return HttpResponse.json(responseItem, { status: 201 });
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/aliases/:alias', ({ params }) => {
    const key = projectKey(params);
    const item = aliases.find((entry) => entry._scope === key && entry.alias === params.alias);
    if (!item) return HttpResponse.json({ error_code: 'NOT_FOUND' }, { status: 404 });
    const { _scope, ...responseItem } = item;
    return HttpResponse.json(responseItem);
  }),

  http.put('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/aliases/:alias', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const idx = aliases.findIndex((entry) => entry._scope === key && entry.alias === params.alias);
    if (idx < 0) return HttpResponse.json({ error_code: 'NOT_FOUND' }, { status: 404 });
    aliases[idx] = {
      ...aliases[idx],
      ...body,
      alias: aliases[idx].alias,
      release: { status: 'draft' },
      updated_at: nowIso(),
    };
    const { _scope, ...responseItem } = aliases[idx];
    return HttpResponse.json(responseItem);
  }),

  http.delete('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/aliases/:alias', ({ params }) => {
    const key = projectKey(params);
    const idx = aliases.findIndex((entry) => entry._scope === key && entry.alias === params.alias);
    if (idx < 0) return HttpResponse.json({ error_code: 'NOT_FOUND' }, { status: 404 });
    aliases.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/aliases/:alias/publish', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const item = aliases.find((entry) => entry._scope === key && entry.alias === params.alias);
    if (!item) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'runtime_alias_not_found' }, { status: 404 });
    const approval = (body.approval_checklist ?? {}) as Record<string, unknown>;
    if (!(approval.owner_verified === true && approval.observability_verified === true && approval.rollback_verified === true)) {
      return HttpResponse.json({ error_code: 'CONFLICT', message: 'runtime_route_approval_incomplete' }, { status: 409 });
    }
    const resolvedPricing = resolvePricingStack(key);
    const scopedProviders = providers.filter((entry) => entry._scope === key);
    const providerConnections = scopedProviders.filter((entry) => entry.provider === item.target_provider);
    const connection = providerConnections.find((entry) => entry.status === 'active') ?? providerConnections[0];
    const pricing = resolvedPricing.effectivePricing?.[String(item.target_provider)]?.[String(item.target_model)];
    const blockers = [
      ...(!connection || connection.status !== 'active' ? ['runtime_guardrail_primary_connection_unavailable'] : []),
      ...(!pricing ? ['runtime_guardrail_primary_pricing_missing'] : []),
    ];
    const guardrails = { release_readiness: blockers.length > 0 ? 'blocked' as const : 'ready' as const, blockers, warnings: [] as string[] };
    if (guardrails.release_readiness === 'blocked') {
      return HttpResponse.json({ error_code: 'CONFLICT', message: 'runtime_route_publish_blocked', guardrails }, { status: 409 });
    }
    item.release = {
      status: 'published',
      approval_checklist: approval as never,
      rollout_policy: (body.rollout_policy ?? { mode: 'full' }) as never,
      published_at: nowIso(),
    };
    item.updated_at = nowIso();
    const { _scope, ...responseItem } = item;
    return HttpResponse.json({ item: responseItem, guardrails });
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/combos', ({ params }) => {
    const key = projectKey(params);
    const items = combos.filter((item) => item._scope === key).map(({ _scope, ...rest }) => rest);
    return HttpResponse.json({ items });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/combos', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    if (combos.some((item) => item._scope === key && item.name === body.name)) {
      return HttpResponse.json({ error_code: 'CONFLICT', message: 'runtime_combo_already_exists' }, { status: 409 });
    }
    const item = {
      id: nowId('rmco'),
      workspace_id: params.ws,
      project_id: params.prj,
      name: body.name ?? 'prod-chat',
      targets: body.targets ?? [],
      fallback_policy: body.fallback_policy ?? { max_hops: 2, retryable_error_classes: ['provider_retryable'] },
      release: { status: 'draft' },
      created_at: nowIso(),
      updated_at: nowIso(),
      _scope: key,
    };
    combos.push(item);
    const { _scope, ...responseItem } = item;
    return HttpResponse.json(responseItem, { status: 201 });
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/combos/:combo', ({ params }) => {
    const key = projectKey(params);
    const item = combos.find((entry) => entry._scope === key && entry.name === params.combo);
    if (!item) return HttpResponse.json({ error_code: 'NOT_FOUND' }, { status: 404 });
    const { _scope, ...responseItem } = item;
    return HttpResponse.json(responseItem);
  }),

  http.put('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/combos/:combo', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const idx = combos.findIndex((entry) => entry._scope === key && entry.name === params.combo);
    if (idx < 0) return HttpResponse.json({ error_code: 'NOT_FOUND' }, { status: 404 });
    combos[idx] = {
      ...combos[idx],
      ...body,
      name: combos[idx].name,
      release: { status: 'draft' },
      updated_at: nowIso(),
    };
    const { _scope, ...responseItem } = combos[idx];
    return HttpResponse.json(responseItem);
  }),

  http.delete('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/combos/:combo', ({ params }) => {
    const key = projectKey(params);
    const idx = combos.findIndex((entry) => entry._scope === key && entry.name === params.combo);
    if (idx < 0) return HttpResponse.json({ error_code: 'NOT_FOUND' }, { status: 404 });
    combos.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/combos/:combo/publish', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const item = combos.find((entry) => entry._scope === key && entry.name === params.combo);
    if (!item) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'runtime_combo_not_found' }, { status: 404 });
    const approval = (body.approval_checklist ?? {}) as Record<string, unknown>;
    if (!(approval.owner_verified === true && approval.observability_verified === true && approval.rollback_verified === true)) {
      return HttpResponse.json({ error_code: 'CONFLICT', message: 'runtime_route_approval_incomplete' }, { status: 409 });
    }
    const resolvedPricing = resolvePricingStack(key);
    const scopedProviders = providers.filter((entry) => entry._scope === key);
    const primary = Array.isArray(item.targets) ? item.targets[0] as Record<string, unknown> | undefined : undefined;
    const primaryProvider = asString(primary?.provider);
    const primaryModel = asString(primary?.model);
    const providerConnections = scopedProviders.filter((entry) => entry.provider === primaryProvider);
    const connection = providerConnections.find((entry) => entry.status === 'active') ?? providerConnections[0];
    const pricing = primaryProvider && primaryModel ? resolvedPricing.effectivePricing?.[primaryProvider]?.[primaryModel] : undefined;
    const blockers = [
      ...(!connection || connection.status !== 'active' ? ['runtime_guardrail_primary_connection_unavailable'] : []),
      ...(!pricing ? ['runtime_guardrail_primary_pricing_missing'] : []),
    ];
    const guardrails = { release_readiness: blockers.length > 0 ? 'blocked' as const : 'ready' as const, blockers, warnings: [] as string[] };
    if (guardrails.release_readiness === 'blocked') {
      return HttpResponse.json({ error_code: 'CONFLICT', message: 'runtime_route_publish_blocked', guardrails }, { status: 409 });
    }
    item.release = {
      status: 'published',
      approval_checklist: approval as never,
      rollout_policy: (body.rollout_policy ?? { mode: 'full' }) as never,
      published_at: nowIso(),
    };
    item.updated_at = nowIso();
    const { _scope, ...responseItem } = item;
    return HttpResponse.json({ item: responseItem, guardrails });
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/pricing', ({ params }) => {
    const key = projectKey(params);
    return HttpResponse.json(resolvePricingStack(key).effectivePricing ?? {});
  }),

  http.patch('/api/v1/workspaces/:ws/projects/:prj/runtime/pricing', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    pricingByProject.set(key, body);
    return HttpResponse.json(body);
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/pricing/versions', ({ params }) => {
    const key = projectKey(params);
    const [workspaceId, projectId] = key.split(':', 2);
    const items = pricingVersions
      .filter((item) => item.scope_type === 'global'
        || (item.scope_type === 'workspace' && item.workspace_id === workspaceId && !item.project_id)
        || (item.scope_type === 'project' && item._scope === key && item.project_id === projectId))
      .map(({ _scope, ...rest }) => rest);
    const resolvedPricing = resolvePricingStack(key);
    return HttpResponse.json({
      items,
      active_versions: {
        global: resolvedPricing.globalVersion?.id ?? null,
        workspace: resolvedPricing.workspaceVersion?.id ?? null,
        project: resolvedPricing.projectVersion?.id ?? null,
      },
      effective_version: resolvedPricing.effectiveVersion
        ? {
          id: resolvedPricing.effectiveVersion.id,
          version_name: resolvedPricing.effectiveVersion.version_name,
          scope_type: resolvedPricing.effectiveVersion.scope_type,
        }
        : null,
    });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/pricing/versions', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const scopeType = asString(body.scope_type) ?? 'project';
    const pricingMap = (body.pricing_map ?? {}) as Record<string, Record<string, Record<string, number>>>;
    if (body.activate === true) {
      const readiness = evaluatePricingVersionReadiness({
        key,
        scopeType,
        candidateMap: pricingMap,
      });
      if (readiness.release_readiness === 'blocked') {
        return HttpResponse.json(
          {
            error_code: 'CONFLICT',
            message: 'runtime_pricing_activation_missing_price',
            readiness,
          },
          { status: 409 },
        );
      }
    }
    const item = {
      id: nowId('rpv'),
      scope_type: scopeType,
      workspace_id: scopeType === 'global' ? undefined : params.ws,
      project_id: scopeType === 'project' ? params.prj : undefined,
      version_name: asString(body.version_name) ?? nowId('pricing'),
      description: asString(body.description),
      pricing_map: pricingMap,
      status: body.activate === true ? 'active' : 'draft',
      created_at: nowIso(),
      updated_at: nowIso(),
      activated_at: body.activate === true ? nowIso() : undefined,
      _scope: key,
    };
    if (body.activate === true) {
      for (const existing of pricingVersions.filter((candidate) => candidate.scope_type === scopeType && (
        scopeType === 'global'
          || (scopeType === 'workspace' && candidate.workspace_id === params.ws)
          || (scopeType === 'project' && candidate._scope === key)
      ) && candidate.status === 'active')) {
        existing.status = 'archived';
        existing.updated_at = nowIso();
      }
    }
    pricingVersions.push(item);
    const { _scope, ...responseItem } = item;
    return HttpResponse.json(responseItem, { status: 201 });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/pricing/versions/:versionId/activate', ({ params }) => {
    const key = projectKey(params);
    const item = pricingVersions.find((candidate) => candidate.id === params.versionId && (
      candidate.scope_type === 'global'
        || (candidate.scope_type === 'workspace' && candidate.workspace_id === params.ws)
        || (candidate.scope_type === 'project' && candidate._scope === key)
    ));
    if (!item) return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'runtime_pricing_version_not_found' }, { status: 404 });
    const readiness = evaluatePricingVersionReadiness({
      key,
      scopeType: String(item.scope_type),
      candidateMap: (item.pricing_map ?? {}) as Record<string, Record<string, Record<string, number>>>,
    });
    if (readiness.release_readiness === 'blocked') {
      return HttpResponse.json(
        {
          error_code: 'CONFLICT',
          message: 'runtime_pricing_activation_missing_price',
          readiness,
        },
        { status: 409 },
      );
    }
    for (const existing of pricingVersions.filter((candidate) => candidate.scope_type === item.scope_type && candidate.id !== item.id && (
      item.scope_type === 'global'
        || (item.scope_type === 'workspace' && candidate.workspace_id === params.ws)
        || (item.scope_type === 'project' && candidate._scope === key)
    ) && candidate.status === 'active')) {
      existing.status = 'archived';
      existing.updated_at = nowIso();
    }
    item.status = 'active';
    item.activated_at = nowIso();
    item.updated_at = nowIso();
    const { _scope, ...responseItem } = item;
    return HttpResponse.json({
      version: responseItem,
      readiness,
    });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/pricing/compare', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const baseline = pricingVersions.find((item) => item.id === body.baseline_version_id);
    const candidate = pricingVersions.find((item) => item.id === body.candidate_version_id);
    if (!baseline || !candidate) {
      return HttpResponse.json({ error_code: 'NOT_FOUND', message: 'runtime_pricing_version_not_found' }, { status: 404 });
    }
    const keys = new Set<string>();
    for (const [provider, modelsMap] of Object.entries((baseline.pricing_map ?? {}) as Record<string, Record<string, number>>)) {
      for (const model of Object.keys(modelsMap)) keys.add(`${provider}:${model}`);
    }
    for (const [provider, modelsMap] of Object.entries((candidate.pricing_map ?? {}) as Record<string, Record<string, number>>)) {
      for (const model of Object.keys(modelsMap)) keys.add(`${provider}:${model}`);
    }
    const items = Array.from(keys).sort().map((value) => {
      const [provider, model] = value.split(':', 2);
      const baselineEntry = (baseline.pricing_map as Record<string, Record<string, Record<string, number>>> | undefined)?.[provider!]?.[model!];
      const candidateEntry = (candidate.pricing_map as Record<string, Record<string, Record<string, number>>> | undefined)?.[provider!]?.[model!];
      const changeType = !baselineEntry
        ? 'added'
        : !candidateEntry
          ? 'removed'
          : JSON.stringify(baselineEntry) === JSON.stringify(candidateEntry)
            ? 'unchanged'
            : 'changed';
      return { provider, model, change_type: changeType, baseline: baselineEntry ?? null, candidate: candidateEntry ?? null };
    });
    return HttpResponse.json({
      baseline_version: {
        id: baseline.id,
        version_name: baseline.version_name,
        scope_type: baseline.scope_type,
      },
      candidate_version: {
        id: candidate.id,
        version_name: candidate.version_name,
        scope_type: candidate.scope_type,
      },
      summary: {
        added: items.filter((item) => item.change_type === 'added').length,
        removed: items.filter((item) => item.change_type === 'removed').length,
        changed: items.filter((item) => item.change_type === 'changed').length,
        unchanged: items.filter((item) => item.change_type === 'unchanged').length,
      },
      items,
    });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/llm/chat/completions', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const modelRaw = asString(body.model);
    if (!modelRaw) {
      return HttpResponse.json(
        { error_code: 'VALIDATION_ERROR', message: 'runtime_unified_chat_model_required' },
        { status: 422 },
      );
    }

    const scopedProviders = providers.filter((item) => item._scope === key && item.status === 'active');
    const scopedAliases = aliases.filter((item) => item._scope === key);
    const scopedCombos = combos.filter((item) => item._scope === key);
    const resolvedPricing = resolvePricingStack(key);
    const pricing = resolvedPricing.effectivePricing;

    const attempts: Array<{ provider: string; model: string }> = [];
    const attemptTrace: Array<Record<string, unknown>> = [];
    if (modelRaw.startsWith('combo:')) {
      const comboName = modelRaw.slice('combo:'.length).trim();
      const combo = scopedCombos.find((item) => item.name === comboName);
      if (!combo || !Array.isArray(combo.targets) || combo.targets.length === 0) {
        return HttpResponse.json({ error_code: 'VALIDATION_ERROR', message: 'runtime_combo_not_found' }, { status: 422 });
      }
      attempts.push(...(combo.targets as Array<{ provider: string; model: string }>));
    } else if (modelRaw.includes('/')) {
      const [provider, model] = modelRaw.split('/', 2);
      if (!provider || !model) {
        return HttpResponse.json({ error_code: 'VALIDATION_ERROR', message: 'runtime_model_format_invalid' }, { status: 422 });
      }
      attempts.push({ provider, model });
    } else {
      const alias = scopedAliases.find((item) => item.alias === modelRaw);
      if (!alias) {
        return HttpResponse.json({ error_code: 'VALIDATION_ERROR', message: 'runtime_alias_not_found' }, { status: 422 });
      }
      attempts.push({
        provider: String(alias.target_provider),
        model: String(alias.target_model),
      });
    }

    for (let idx = 0; idx < attempts.length; idx += 1) {
      const attempt = attempts[idx]!;
      const provider = scopedProviders.find((item) => item.provider === attempt.provider);
      if (!provider) {
        attemptTrace.push({
          index: idx,
          provider: attempt.provider,
          model: attempt.model,
          outcome: 'provider_connection_missing',
          reason: 'runtime_provider_connection_not_found',
          durationMs: 0,
        });
        continue;
      }
      const baseUrl = asString(provider.base_url) ?? '';
      if (baseUrl.includes('nonretryable')) {
        attemptTrace.push({
          index: idx,
          provider: attempt.provider,
          model: attempt.model,
          providerConnectionId: String(provider.id),
          outcome: 'terminal_upstream_error',
          statusCode: 400,
          errorClass: 'provider_non_retryable',
          reason: 'runtime_upstream_error',
          durationMs: 0,
        });
        return HttpResponse.json(
          {
            error_code: 'UPSTREAM_400',
            message: 'runtime_upstream_non_retryable',
            runtime: {
              provider: attempt.provider,
              resolved_model: attempt.model,
              fallback_hops: idx,
              attempts: attemptTrace,
            },
          },
          { status: 400 },
        );
      }
      if (baseUrl.includes('retryable') && idx < attempts.length - 1) {
        attemptTrace.push({
          index: idx,
          provider: attempt.provider,
          model: attempt.model,
          providerConnectionId: String(provider.id),
          outcome: 'fallback_upstream_error',
          statusCode: 429,
          errorClass: 'provider_retryable',
          reason: 'runtime_upstream_error_recovered',
          durationMs: 0,
        });
        continue;
      }
      const inputTokens = 1000;
      const outputTokens = 500;
      const inRate = pricing?.[attempt.provider]?.[attempt.model]?.input ?? 0;
      const outRate = pricing?.[attempt.provider]?.[attempt.model]?.output ?? 0;
      const estimatedCost = Number((((inputTokens * inRate) + (outputTokens * outRate)) / 1_000_000).toFixed(6));
      const requestId = nowId('req_runtime');
      attemptTrace.push({
        index: idx,
        provider: attempt.provider,
        model: attempt.model,
        providerConnectionId: String(provider.id),
        outcome: 'success',
        statusCode: 200,
        reason: 'runtime_upstream_ok',
        durationMs: 0,
      });
      recordRuntimeUsageFact({
        id: nowId('usgf'),
        timestamp: nowIso(),
        workspace_id: String(params.ws ?? 'ws_default'),
        project_id: String(params.prj ?? 'proj_001'),
        resource_type: 'endpoint',
        resource_id: String(provider.id),
        end_user_id: currentEndUserId(),
        request_id: requestId,
        requests: 1,
        duration_ms: 0,
        bytes_in: 2048,
        bytes_out: 4096,
        tokens_in: inputTokens,
        tokens_out: outputTokens,
        tokens_total: inputTokens + outputTokens,
        result: 'ok',
        runtime: {
          provider: attempt.provider,
          resolved_model: attempt.model,
          fallback_hops: idx,
          pricing_version: resolvedPricing.effectiveVersion?.version_name ?? (pricing ? 'runtime-pricing-mock' : null),
          estimated_cost: estimatedCost,
          missing_price: estimatedCost === 0,
          attempts: attemptTrace,
        },
        metadata_json: {
          provider: attempt.provider,
          resolved_model: attempt.model,
          fallback_hops: idx,
          pricing_version: resolvedPricing.effectiveVersion?.version_name ?? (pricing ? 'runtime-pricing-mock' : null),
          estimated_cost: estimatedCost,
          attempt_trace: attemptTrace,
        },
      });
      return HttpResponse.json({
        id: nowId('chatcmpl'),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
        runtime: {
          provider: attempt.provider,
          resolved_model: attempt.model,
          fallback_hops: idx,
          pricing_version: resolvedPricing.effectiveVersion?.version_name ?? (pricing ? 'runtime-pricing-mock' : null),
          estimated_cost: estimatedCost,
          attempts: attemptTrace,
        },
      });
    }

    recordRuntimeUsageFact({
      id: nowId('usgf'),
      timestamp: nowIso(),
      workspace_id: String(params.ws ?? 'ws_default'),
      project_id: String(params.prj ?? 'proj_001'),
      resource_type: 'endpoint',
      resource_id: undefined,
      end_user_id: currentEndUserId(),
      request_id: nowId('req_runtime'),
      requests: 1,
      duration_ms: 0,
      bytes_in: 2048,
      bytes_out: 0,
      tokens_in: 0,
      tokens_out: 0,
      tokens_total: 0,
      result: 'error',
      error_code: 'RUNTIME_PROVIDER_CONNECTION_NOT_FOUND',
      runtime: {
        fallback_hops: attemptTrace.filter((item) => String(item.outcome).startsWith('fallback_')).length,
        pricing_version: null,
        estimated_cost: null,
        missing_price: true,
        attempts: attemptTrace,
      },
      metadata_json: {
        fallback_hops: attemptTrace.filter((item) => String(item.outcome).startsWith('fallback_')).length,
        missing_price: true,
        attempt_trace: attemptTrace,
      },
    });
    return HttpResponse.json(
      {
        error_code: 'RUNTIME_PROVIDER_CONNECTION_NOT_FOUND',
        message: 'runtime_provider_connection_not_found',
        runtime: {
          fallback_hops: attemptTrace.filter((item) => String(item.outcome).startsWith('fallback_')).length,
          pricing_version: null,
          estimated_cost: null,
          attempts: attemptTrace,
        },
      },
      { status: 502 },
    );
  }),
];
