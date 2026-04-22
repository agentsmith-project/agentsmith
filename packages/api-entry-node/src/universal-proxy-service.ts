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

type UniversalProxyServiceOptions = {
  maxTransientProviderRetries?: number;
  transientProviderRetryDelayMs?: number;
  maxTransientProviderRetryDelayMs?: number;
};

type ResolvedUniversalProxyServiceOptions = {
  maxTransientProviderRetries: number;
  transientProviderRetryDelayMs: number;
  maxTransientProviderRetryDelayMs: number;
};

type TransientRetryDecision = {
  shouldRetry: boolean;
  retryDelayMs: number;
};

const DEFAULT_MAX_TRANSIENT_PROVIDER_RETRIES = 1;
const DEFAULT_TRANSIENT_PROVIDER_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_TRANSIENT_PROVIDER_RETRY_DELAY_MS = 1_500;
const EXPLICIT_TRANSIENT_PROVIDER_HINT_PATTERN = /\b(provider_retryable|capacity|overload(?:ed)?|rate[_ -]?limit|too many requests|retry later|temporar(?:ily)? unavailable)\b/i;

function sanitizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function clampNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(value));
}

function resolveServiceOptions(options: UniversalProxyServiceOptions | undefined): ResolvedUniversalProxyServiceOptions {
  const maxTransientProviderRetries = clampNonNegativeInteger(
    options?.maxTransientProviderRetries,
    DEFAULT_MAX_TRANSIENT_PROVIDER_RETRIES,
  );
  const transientProviderRetryDelayMs = clampNonNegativeInteger(
    options?.transientProviderRetryDelayMs,
    DEFAULT_TRANSIENT_PROVIDER_RETRY_DELAY_MS,
  );
  const maxTransientProviderRetryDelayMs = Math.max(
    transientProviderRetryDelayMs,
    clampNonNegativeInteger(
      options?.maxTransientProviderRetryDelayMs,
      DEFAULT_MAX_TRANSIENT_PROVIDER_RETRY_DELAY_MS,
    ),
  );
  return {
    maxTransientProviderRetries,
    transientProviderRetryDelayMs,
    maxTransientProviderRetryDelayMs,
  };
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

function flattenStringValues(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || typeof value === 'undefined') return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStringValues(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => flattenStringValues(item, depth + 1));
  }
  return [];
}

function parseRetryAfterMs(value: string | null, maxDelayMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const seconds = Number.parseFloat(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(maxDelayMs, Math.round(seconds * 1000));
  }

  const retryAt = Date.parse(trimmed);
  if (!Number.isFinite(retryAt)) return null;
  return Math.min(maxDelayMs, Math.max(0, retryAt - Date.now()));
}

async function readRetryableProviderHint(response: Response): Promise<boolean> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('json')) {
    const text = await response.text();
    return EXPLICIT_TRANSIENT_PROVIDER_HINT_PATTERN.test(text);
  }

  const { text, json } = await readJsonRecord(response);
  if (EXPLICIT_TRANSIENT_PROVIDER_HINT_PATTERN.test(text)) {
    return true;
  }
  return flattenStringValues(json).some((value) => EXPLICIT_TRANSIENT_PROVIDER_HINT_PATTERN.test(value));
}

function createAbortError(): Error {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

async function delayWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  if (signal?.aborted) {
    throw createAbortError();
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    timer.unref?.();

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class UniversalProxyService {
  private readonly namespaceReconcileStates = new Map<string, NamespaceReconcileState>();
  private readonly options: ResolvedUniversalProxyServiceOptions;

  constructor(
    private readonly baseUrl: string,
    private readonly adminToken?: string,
    options?: UniversalProxyServiceOptions,
  ) {
    this.options = resolveServiceOptions(options);
  }

  static fromEnv(env: NodeJS.ProcessEnv): UniversalProxyService | undefined {
    const raw = env.MBOS_UNIVERSAL_PROXY_BASE_URL?.trim();
    if (!raw) return undefined;
    const adminToken = env.MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN?.trim() || undefined;
    return new UniversalProxyService(raw, adminToken);
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
            ...(this.adminToken ? { Authorization: `Bearer ${this.adminToken}` } : {}),
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
    const url = `${sanitizeBaseUrl(this.baseUrl)}/namespaces/${encodeURIComponent(options.namespace)}${routePath}`;
    const init: RequestInit = {
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
    };

    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, init);
      if (attempt >= this.options.maxTransientProviderRetries) {
        return response;
      }
      const retryDecision = await this.getTransientRetryDecision(response);
      if (!retryDecision.shouldRetry) {
        return response;
      }
      await delayWithAbort(retryDecision.retryDelayMs, options.signal);
    }
  }

  private async getTransientRetryDecision(response: Response): Promise<TransientRetryDecision> {
    if (response.ok) {
      return { shouldRetry: false, retryDelayMs: 0 };
    }

    const retryAfterMs = parseRetryAfterMs(
      response.headers.get('retry-after'),
      this.options.maxTransientProviderRetryDelayMs,
    ) ?? Math.min(
      this.options.transientProviderRetryDelayMs,
      this.options.maxTransientProviderRetryDelayMs,
    );

    if (response.status === 429 || response.status >= 500) {
      return {
        shouldRetry: true,
        retryDelayMs: retryAfterMs,
      };
    }

    if (response.status < 400) {
      return { shouldRetry: false, retryDelayMs: 0 };
    }

    const hasExplicitRetryableHint = await readRetryableProviderHint(response.clone());
    if (!hasExplicitRetryableHint) {
      return { shouldRetry: false, retryDelayMs: 0 };
    }

    return {
      shouldRetry: response.status !== 401 && response.status !== 403 && response.status !== 404 && response.status !== 422,
      retryDelayMs: retryAfterMs,
    };
  }
}
