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
    const item = {
      id: `rmc_${Date.now()}`,
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

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/aliases', ({ params }) => {
    const key = projectKey(params);
    const items = aliases.filter((item) => item._scope === key).map(({ _scope, ...rest }) => rest);
    return HttpResponse.json({ items });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/aliases', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const item = {
      id: `rma_${Date.now()}`,
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

  http.get('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/combos', ({ params }) => {
    const key = projectKey(params);
    const items = combos.filter((item) => item._scope === key).map(({ _scope, ...rest }) => rest);
    return HttpResponse.json({ items });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/runtime/routing/combos', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const key = projectKey(params);
    const item = {
      id: `rmco_${Date.now()}`,
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

  http.post('/api/v1/workspaces/:ws/projects/:prj/llm/chat/completions', () => {
    return HttpResponse.json(
      {
        error_code: 'NOT_IMPLEMENTED',
        message: 'llm_unified_chat_not_implemented',
      },
      { status: 501 },
    );
  }),
];
