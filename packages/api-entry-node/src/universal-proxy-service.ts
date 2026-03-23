import { createHash } from 'node:crypto';
import type http from 'node:http';
import type { EndpointProtocol, EndpointRecord } from './resource-models.js';

type RuntimeUpstreamConfig = {
  name: string;
  api_root: string;
  fixed_upstream_format?: 'openai-completion' | 'openai-responses' | 'anthropic' | 'google';
  fallback_credential_actual: string;
  auth_policy: 'force_server';
  upstream_headers: Array<[string, string]>;
};

type RuntimeConfigSnapshot = {
  revision: string;
  config: {
    listen: string;
    upstream_timeout_secs: number;
    upstreams: RuntimeUpstreamConfig[];
    model_aliases: Record<string, { upstream_name: string; upstream_model: string }>;
    hooks: {
      max_pending_bytes: number;
      timeout_secs: number;
      failure_threshold: number;
      cooldown_secs: number;
      exchange: null;
      usage: null;
    };
  };
};

type ProxyOptions = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  namespace: string;
  proxyPath: string;
  model: string;
  requestBody: unknown;
  passthroughHeaders?: Record<string, string>;
};

type ProxyResult = { upstream_status: number; tokens_total?: number };

function sanitizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeEndpointApiRoot(endpoint: EndpointRecord): string {
  const normalized = sanitizeBaseUrl(endpoint.base_url)
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/responses$/i, '')
    .replace(/\/messages(?:\/count_tokens)?$/i, '');

  if (endpoint.protocol === 'anthropic_compatible' && !/\/v\d+$/i.test(normalized)) {
    return `${normalized}/v1`;
  }

  return normalized;
}

function normalizeProxyPath(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/^v1\//i, '').replace(/\/+$/, '');
}

function routePathForProxyPath(proxyPath: string): string | null {
  const normalized = normalizeProxyPath(proxyPath);
  if (normalized === 'chat/completions') return '/openai/v1/chat/completions';
  if (normalized === 'responses') return '/openai/v1/responses';
  if (normalized === 'messages') return '/anthropic/v1/messages';
  return null;
}

function fixedUpstreamFormat(protocol?: EndpointProtocol): RuntimeUpstreamConfig['fixed_upstream_format'] | undefined {
  if (protocol === 'anthropic_compatible') return 'anthropic';
  if (protocol === 'google_gemini') return 'google';
  return undefined;
}

function buildRevision(endpoint: EndpointRecord, apiKey: string): string {
  const normalizedApiRoot = normalizeEndpointApiRoot(endpoint);
  const upstreamFormat = fixedUpstreamFormat(endpoint.protocol) ?? null;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      endpoint_id: endpoint.id,
      base_url: endpoint.base_url,
      normalized_api_root: normalizedApiRoot,
      protocol: endpoint.protocol ?? null,
      upstream_format: upstreamFormat,
      model: endpoint.model,
      updated_at: endpoint.updated_at,
      api_key: apiKey,
    }))
    .digest('hex')
    .slice(0, 16);
  return `${endpoint.updated_at}:${fingerprint}`;
}

function parseTokenTotal(body: unknown): number | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const payload = body as Record<string, unknown>;
  const usage = payload.usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return undefined;
  const usageRecord = usage as Record<string, unknown>;
  const total = usageRecord.total_tokens;
  return typeof total === 'number' && Number.isFinite(total) ? total : undefined;
}

export class UniversalProxyService {
  constructor(private readonly baseUrl: string) {}

  static fromEnv(env: NodeJS.ProcessEnv): UniversalProxyService | undefined {
    const raw = env.MBOS_UNIVERSAL_PROXY_BASE_URL?.trim();
    if (!raw) return undefined;
    return new UniversalProxyService(raw);
  }

  supportsProxyPath(proxyPath: string): boolean {
    return routePathForProxyPath(proxyPath) !== null;
  }

  supportsEndpoint(endpoint: EndpointRecord): boolean {
    return endpoint.protocol === 'openai_compatible'
      || endpoint.protocol === 'anthropic_compatible'
      || endpoint.protocol === 'google_gemini'
      || !endpoint.protocol;
  }

  buildNamespace(workspaceId: string, projectId: string, endpointId: string): string {
    return `${workspaceId}__${projectId}__${endpointId}`.replace(/[^a-zA-Z0-9_.-]+/g, '-');
  }

  async ensureEndpointNamespace(
    workspaceId: string,
    projectId: string,
    endpoint: EndpointRecord,
    apiKey: string,
  ): Promise<string> {
    const namespace = this.buildNamespace(workspaceId, projectId, endpoint.id);
    const snapshot: RuntimeConfigSnapshot = {
      revision: buildRevision(endpoint, apiKey),
      config: {
        listen: '0.0.0.0:8080',
        upstream_timeout_secs: endpoint.limits?.timeout_seconds ?? 120,
        upstreams: [{
          name: 'primary',
          api_root: normalizeEndpointApiRoot(endpoint),
          fixed_upstream_format: fixedUpstreamFormat(endpoint.protocol),
          fallback_credential_actual: apiKey,
          auth_policy: 'force_server',
          upstream_headers: [],
        }],
        model_aliases: {},
        hooks: {
          max_pending_bytes: 104857600,
          timeout_secs: 30,
          failure_threshold: 3,
          cooldown_secs: 300,
          exchange: null,
          usage: null,
        },
      },
    };

    const response = await fetch(
      `${sanitizeBaseUrl(this.baseUrl)}/admin/namespaces/${encodeURIComponent(namespace)}/config`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(snapshot),
      },
    );
    if (!response.ok && response.status !== 409) {
      const errorText = await response.text();
      throw new Error(`universal_proxy_config_push_failed:${response.status}:${errorText}`);
    }
    return namespace;
  }

  async proxyJsonRequest(options: ProxyOptions): Promise<ProxyResult> {
    const routePath = routePathForProxyPath(options.proxyPath);
    if (!routePath) {
      throw new Error(`unsupported_universal_proxy_path:${options.proxyPath}`);
    }
    const upstreamResponse = await fetch(
      `${sanitizeBaseUrl(this.baseUrl)}/namespaces/${encodeURIComponent(options.namespace)}${routePath}`,
      {
        method: options.req.method ?? 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.passthroughHeaders ?? {}),
        },
        body: JSON.stringify({
          ...(typeof options.requestBody === 'object' && options.requestBody !== null ? options.requestBody as Record<string, unknown> : {}),
          model: options.model,
        }),
      },
    );

    options.res.statusCode = upstreamResponse.status;
    const contentType = upstreamResponse.headers.get('content-type');
    if (contentType) {
      options.res.setHeader('content-type', contentType);
    }
    const isStream = (contentType ?? '').toLowerCase().includes('text/event-stream');
    if (isStream && upstreamResponse.body) {
      const reader = upstreamResponse.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value) {
          options.res.write(Buffer.from(chunk.value));
        }
      }
      options.res.end();
      return { upstream_status: upstreamResponse.status };
    }

    const text = await upstreamResponse.text();
    options.res.end(text);
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    return {
      upstream_status: upstreamResponse.status,
      tokens_total: parseTokenTotal(parsed),
    };
  }
}
