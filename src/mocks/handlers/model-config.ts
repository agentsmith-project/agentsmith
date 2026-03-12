import { http, HttpResponse } from 'msw';
import { recordRequestUsageFact } from '../state/request-usage';

type ProjectPricingMap = Record<string, Record<string, Record<string, number>>>;

type CatalogProvider = {
  provider: string;
  family: string;
  label: string;
  default_base_url: string;
  protocol: string;
  compatibility_interface: string;
};

type CatalogModel = {
  provider: string;
  model_id: string;
  name: string;
  capabilities: string[];
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: Record<string, number | Record<string, number>>;
};

const catalogProviders: CatalogProvider[] = [
  {
    provider: 'openai',
    family: 'openai',
    label: 'OpenAI',
    default_base_url: 'https://api.openai.com/v1',
    protocol: 'openai',
    compatibility_interface: 'openai',
  },
  {
    provider: 'anthropic',
    family: 'anthropic',
    label: 'Anthropic',
    default_base_url: 'https://api.anthropic.com/v1',
    protocol: 'anthropic',
    compatibility_interface: 'anthropic',
  },
  {
    provider: 'deepseek',
    family: 'deepseek',
    label: 'DeepSeek',
    default_base_url: 'https://api.deepseek.com',
    protocol: 'openai_compatible',
    compatibility_interface: 'openai',
  },
];

const catalogModels: CatalogModel[] = [
  {
    provider: 'openai',
    model_id: 'gpt-4o',
    name: 'GPT-4o',
    capabilities: ['chat_completion', 'multimodal_completion'],
    limit: { context: 128000, output: 16384 },
    cost: { input: 2.5, output: 10 },
  },
  {
    provider: 'openai',
    model_id: 'gpt-4.1-mini',
    name: 'GPT-4.1 mini',
    capabilities: ['chat_completion'],
    limit: { context: 128000, output: 16384 },
    cost: { input: 0.4, output: 1.6 },
  },
  {
    provider: 'anthropic',
    model_id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    capabilities: ['chat_completion'],
    limit: { context: 200000, output: 8192 },
    cost: { input: 3, output: 15 },
  },
  {
    provider: 'deepseek',
    model_id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    capabilities: ['chat_completion'],
    limit: { context: 64000, output: 8192 },
    cost: { input: 0.27, output: 1.1 },
  },
  {
    provider: 'openai',
    model_id: 'text-embedding-3-large',
    name: 'text-embedding-3-large',
    capabilities: ['embedding'],
    limit: { context: 8192, output: 0 },
    cost: { input: 0.13, output: 0 },
  },
];

const pricingByProject = new Map<string, ProjectPricingMap>();
let catalogSyncedAt = new Date('2026-03-11T00:00:00.000Z').toISOString();

function nowIso() {
  return new Date().toISOString();
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
}

function projectKey(params: Record<string, string | readonly string[] | undefined>) {
  return `${params.ws ?? 'ws'}:${params.prj ?? 'prj'}`;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function currentEndUserId() {
  return 'user_001';
}

function getDefaultPricing(): ProjectPricingMap {
  const pricing: ProjectPricingMap = {};
  for (const item of catalogModels) {
    const entry = item.cost;
    if (!entry) continue;
    pricing[item.provider] ??= {};
    pricing[item.provider]![item.model_id] = {
      input: typeof entry.input === 'number' ? entry.input : 0,
      output: typeof entry.output === 'number' ? entry.output : 0,
    };
  }
  return pricing;
}

function getEffectivePricing(key: string): ProjectPricingMap {
  return pricingByProject.get(key) ?? getDefaultPricing();
}

function getCatalogVersion() {
  return {
    version: 'model-catalog-mock-v1',
    synced_at: catalogSyncedAt,
    provider_count: catalogProviders.length,
    model_count: catalogModels.length,
  };
}

export const modelConfigHandlers = [
  http.get('/api/v1/workspaces/:ws/projects/:prj/model-catalog/providers', () => {
    return HttpResponse.json({
      version: getCatalogVersion(),
      items: catalogProviders,
    });
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/model-catalog/models', ({ request }) => {
    const url = new URL(request.url);
    const provider = asString(url.searchParams.get('provider'));
    const capability = asString(url.searchParams.get('capability'));
    const query = asString(url.searchParams.get('q'))?.toLowerCase();

    const items = catalogModels.filter((item) => {
      if (provider && item.provider !== provider) return false;
      if (capability && !item.capabilities.includes(capability)) return false;
      if (query) {
        const haystack = `${item.provider} ${item.model_id} ${item.name}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    return HttpResponse.json({
      version: getCatalogVersion(),
      items,
      total: items.length,
    });
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/model-catalog/sync', () => {
    catalogSyncedAt = nowIso();
    return HttpResponse.json({
      version: getCatalogVersion(),
    });
  }),

  http.get('/api/v1/workspaces/:ws/projects/:prj/project-pricing', ({ params }) => {
    return HttpResponse.json(getEffectivePricing(projectKey(params)));
  }),

  http.patch('/api/v1/workspaces/:ws/projects/:prj/project-pricing', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as ProjectPricingMap;
    pricingByProject.set(projectKey(params), body);
    return HttpResponse.json(body);
  }),

  http.post('/api/v1/workspaces/:ws/projects/:prj/llm/chat/completions', async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const modelRaw = asString(body.model);
    if (!modelRaw) {
      return HttpResponse.json(
        { error_code: 'VALIDATION_ERROR', message: 'model_request_model_required' },
        { status: 422 },
      );
    }

    const key = projectKey(params);
    const [provider, model] = modelRaw.includes('/')
      ? modelRaw.split('/', 2)
      : ['openai', modelRaw];
    const pricing = getEffectivePricing(key)?.[provider!]?.[model!] ?? { input: 0, output: 0 };
    const inputTokens = 1000;
    const outputTokens = 500;
    const estimatedCost = Number((((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1_000_000).toFixed(6));
    const requestId = nowId('req_model');

    recordRequestUsageFact({
      id: nowId('usgf'),
      timestamp: nowIso(),
      workspace_id: String(params.ws ?? 'ws_default'),
      project_id: String(params.prj ?? 'proj_001'),
      resource_type: 'endpoint',
      resource_id: `${provider}:${model}`,
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
      request_details: {
        provider,
        resolved_model: model,
        fallback_hops: 0,
        pricing_source: 'project-pricing-mock-v1',
        estimated_cost: estimatedCost,
        missing_price: estimatedCost === 0,
        attempts: [
          {
            index: 0,
            provider,
            model,
            outcome: 'success',
            statusCode: 200,
            reason: 'model_upstream_ok',
            durationMs: 0,
          },
        ],
      },
      metadata_json: {
        provider,
        resolved_model: model,
        fallback_hops: 0,
        pricing_source: 'project-pricing-mock-v1',
        estimated_cost: estimatedCost,
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
      request_details: {
        provider,
        resolved_model: model,
        fallback_hops: 0,
        pricing_source: 'project-pricing-mock-v1',
        estimated_cost: estimatedCost,
      },
    });
  }),
];
