import { http, HttpResponse } from 'msw';

const providers: Array<Record<string, unknown>> = [];
const models: Array<Record<string, unknown>> = [];
const aliases: Array<Record<string, unknown>> = [];
const combos: Array<Record<string, unknown>> = [];
const pricingByProject = new Map<string, Record<string, unknown>>();

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
    const pricing = pricingByProject.get(key) as Record<string, Record<string, Record<string, number>>> | undefined;

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
      const pricingSource = projectPricing ? 'project_override' : modelPricing ? 'model_catalog' : 'missing';

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

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/pricing', ({ params }) => {
    const key = projectKey(params);
    return HttpResponse.json(pricingByProject.get(key) ?? {});
  }),

  http.patch('/api/v1/workspaces/:ws/projects/:prj/runtime/pricing', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    pricingByProject.set(key, body);
    return HttpResponse.json(body);
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
    const pricing = pricingByProject.get(key) as Record<string, Record<string, Record<string, number>>> | undefined;

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
          estimated_cost: estimatedCost,
          attempts: attemptTrace,
        },
      });
    }

    return HttpResponse.json(
      {
        error_code: 'RUNTIME_PROVIDER_CONNECTION_NOT_FOUND',
        message: 'runtime_provider_connection_not_found',
        runtime: {
          fallback_hops: attemptTrace.filter((item) => String(item.outcome).startsWith('fallback_')).length,
          attempts: attemptTrace,
        },
      },
      { status: 502 },
    );
  }),
];
