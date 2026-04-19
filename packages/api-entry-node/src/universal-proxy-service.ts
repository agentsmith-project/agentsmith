import { createHash } from 'node:crypto';
import type http from 'node:http';
import type { EndpointRecord, EndpointUpstreamProtocol } from './resource-models.js';

type RuntimeUpstreamConfig = {
  name: string;
  api_root: string;
  fixed_upstream_format?: 'openai-completion' | 'openai-responses' | 'anthropic' | 'google';
  fallback_credential_actual: string;
  auth_policy: 'force_server';
  upstream_headers: Array<[string, string]>;
};

type RuntimeConfigSnapshot = {
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

type RuntimeNamespaceConfig = RuntimeConfigSnapshot['config'];

type NamespaceReconcileState = {
  desiredConfigHash?: string;
  serverRevision?: string;
  inflight?: Promise<void>;
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

type ProxyForwardOptions = {
  req: http.IncomingMessage;
  namespace: string;
  proxyPath: string;
  model: string;
  requestBody: unknown;
  passthroughHeaders?: Record<string, string>;
  signal?: AbortSignal;
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

  if (endpoint.upstream_protocol === 'anthropic_messages' && !/\/v\d+$/i.test(normalized)) {
    return `${normalized}/v1`;
  }

  return normalized;
}

function normalizeProxyPath(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/^v1\//i, '').replace(/\/+$/, '');
}

function routePathForProxyPath(proxyPath: string): string | null {
  const normalized = normalizeProxyPath(proxyPath);
  if (normalized === 'openai/chat/completions') return '/openai/v1/chat/completions';
  if (normalized === 'openai/responses') return '/openai/v1/responses';
  if (normalized === 'anthropic/messages') return '/anthropic/v1/messages';
  if (normalized === 'anthropic/messages/count_tokens') return '/anthropic/v1/messages/count_tokens';
  return null;
}

function fixedUpstreamFormat(protocol: EndpointUpstreamProtocol): RuntimeUpstreamConfig['fixed_upstream_format'] | undefined {
  if (protocol === 'anthropic_messages') return 'anthropic';
  if (protocol === 'openai_chat_completions') return 'openai-completion';
  if (protocol === 'openai_responses') return 'openai-responses';
  return undefined;
}

function buildRuntimeConfig(endpoint: EndpointRecord, apiKey: string): RuntimeNamespaceConfig {
  return {
    listen: '0.0.0.0:8080',
    upstream_timeout_secs: endpoint.limits?.timeout_seconds ?? 120,
    upstreams: [{
      name: 'primary',
      api_root: normalizeEndpointApiRoot(endpoint),
      fixed_upstream_format: fixedUpstreamFormat(endpoint.upstream_protocol),
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
  };
}

function buildConfigHash(config: RuntimeNamespaceConfig): string {
  return createHash('sha256')
    .update(JSON.stringify(config))
    .digest('hex');
}

async function readJsonRecord(response: Response): Promise<{ text: string; json: Record<string, unknown> | null }> {
  const text = await response.text();
  if (!text) {
    return { text, json: {} };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { text, json: parsed as Record<string, unknown> };
    }
  } catch {
    // Keep the raw text for error reporting when the response is not JSON.
  }
  return { text, json: null };
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
  private readonly namespaceReconcileStates = new Map<string, NamespaceReconcileState>();

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
    return fixedUpstreamFormat(endpoint.upstream_protocol) !== undefined;
  }

  buildNamespace(workspaceId: string, projectId: string, endpointId: string): string {
    return `${workspaceId}__${projectId}__${endpointId}`.replace(/[^a-zA-Z0-9_.-]+/g, '-');
  }

  private getNamespaceReconcileState(namespace: string): NamespaceReconcileState {
    let state = this.namespaceReconcileStates.get(namespace);
    if (!state) {
      state = {};
      this.namespaceReconcileStates.set(namespace, state);
    }
    return state;
  }

  private async reconcileNamespaceConfig(
    namespace: string,
    config: RuntimeNamespaceConfig,
    desiredConfigHash: string,
  ): Promise<void> {
    const state = this.getNamespaceReconcileState(namespace);

    while (true) {
      if (state.desiredConfigHash === desiredConfigHash && state.serverRevision) {
        return;
      }
      if (state.inflight) {
        await state.inflight;
        continue;
      }

      const inflight = this.pushNamespaceConfig(namespace, config, desiredConfigHash, state);
      state.inflight = inflight;

      try {
        await inflight;
        return;
      } finally {
        if (state.inflight === inflight) {
          state.inflight = undefined;
        }
      }
    }
  }

  private async pushNamespaceConfig(
    namespace: string,
    config: RuntimeNamespaceConfig,
    desiredConfigHash: string,
    state: NamespaceReconcileState,
  ): Promise<void> {
    const maxAttempts = 2;
    let ifRevision: string | null = state.serverRevision ?? null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await fetch(
        `${sanitizeBaseUrl(this.baseUrl)}/admin/namespaces/${encodeURIComponent(namespace)}/config`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            if_revision: ifRevision,
            config,
          }),
        },
      );

      if (response.status === 412) {
        const conflict = await readJsonRecord(response);
        const currentRevision = conflict.json?.current_revision;
        if (currentRevision === null) {
          state.serverRevision = undefined;
          ifRevision = null;
          if (attempt + 1 < maxAttempts) {
            continue;
          }
          throw new Error(`universal_proxy_config_push_conflict_exhausted:${namespace}`);
        }
        if (typeof currentRevision !== 'string' || currentRevision.length === 0) {
          throw new Error(
            `universal_proxy_config_push_failed:${response.status}:${conflict.text || 'missing_current_revision'}`,
          );
        }
        state.serverRevision = currentRevision;
        ifRevision = currentRevision;
        if (attempt + 1 < maxAttempts) {
          continue;
        }
        throw new Error(`universal_proxy_config_push_conflict_exhausted:${namespace}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`universal_proxy_config_push_failed:${response.status}:${errorText}`);
      }

      const success = await readJsonRecord(response);
      const revision = success.json?.revision;
      if (typeof revision !== 'string' || revision.length === 0) {
        throw new Error('universal_proxy_config_push_missing_revision');
      }

      state.serverRevision = revision;
      state.desiredConfigHash = desiredConfigHash;
      return;
    }
  }

  async ensureEndpointNamespace(
    workspaceId: string,
    projectId: string,
    endpoint: EndpointRecord,
    apiKey: string,
  ): Promise<string> {
    const namespace = this.buildNamespace(workspaceId, projectId, endpoint.id);
    const config = buildRuntimeConfig(endpoint, apiKey);
    const desiredConfigHash = buildConfigHash(config);
    await this.reconcileNamespaceConfig(namespace, config, desiredConfigHash);
    return namespace;
  }

  async proxyJsonRequest(options: ProxyOptions): Promise<ProxyResult> {
    const upstreamResponse = await this.forwardRequest(options);

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

  async forwardRequest(options: ProxyForwardOptions): Promise<Response> {
    const routePath = routePathForProxyPath(options.proxyPath);
    if (!routePath) {
      throw new Error(`unsupported_universal_proxy_path:${options.proxyPath}`);
    }
    return fetch(
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
        signal: options.signal,
      },
    );
  }
}
