import { createHash } from 'node:crypto';
import type http from 'node:http';
import { createAbortError, createDownstreamAbortController, throwIfAborted } from './downstream-abort.js';
import type { EndpointRecord, EndpointUpstreamProtocol } from './resource-models.js';

type RuntimeUpstreamConfig = {
  name: string;
  api_root: string;
  fixed_upstream_format?: 'openai-completion' | 'openai-responses' | 'anthropic' | 'google';
  upstream_headers: Array<[string, string]>;
  limits?: EffectiveEndpointModelRuntimeConfig['limits'];
  surface_defaults?: EffectiveEndpointModelRuntimeConfig['surface_defaults'];
};

type EndpointModelModality = 'text' | 'image' | 'audio' | 'pdf' | 'file' | 'video';
type EndpointApplyPatchTransport = 'function' | 'freeform';

export type EffectiveEndpointModelRuntimeConfig = {
  limits?: {
    context_window?: number;
    max_output_tokens?: number;
  };
  surface_defaults: {
    modalities: {
      input: EndpointModelModality[];
      output: EndpointModelModality[];
    };
    tools: {
      supports_search: false;
      supports_view_image: false;
      apply_patch_transport: EndpointApplyPatchTransport;
      supports_parallel_calls: false;
    };
  };
  model_catalog: {
    input_modalities: EndpointModelModality[];
    supports_search_tool: false;
    supports_parallel_tool_calls: false;
    apply_patch_tool_type: EndpointApplyPatchTransport;
  };
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
  providerCredential: string;
  passthroughHeaders?: Record<string, string>;
  signal?: AbortSignal;
};

type ProxyForwardOptions = {
  req: http.IncomingMessage;
  namespace: string;
  proxyPath: string;
  model: string;
  requestBody: unknown;
  providerCredential: string;
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
const DATA_PLANE_PASSTHROUGH_HEADER_ALLOWLIST = new Set([
  'anthropic-beta',
  'anthropic-version',
  'x-request-id',
  'x-stainless-helper-method',
]);

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
  return null;
}

function requestAllowsAutomaticReplay(method: string | undefined, _proxyPath: string): boolean {
  const normalizedMethod = (method ?? 'POST').trim().toUpperCase();
  return normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
}

function fixedUpstreamFormat(protocol: EndpointUpstreamProtocol): RuntimeUpstreamConfig['fixed_upstream_format'] | undefined {
  if (protocol === 'anthropic_messages') return 'anthropic';
  if (protocol === 'openai_chat_completions') return 'openai-completion';
  if (protocol === 'openai_responses') return 'openai-responses';
  return undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function addModality(modalities: EndpointModelModality[], modality: EndpointModelModality): void {
  if (!modalities.includes(modality)) {
    modalities.push(modality);
  }
}

export function deriveEndpointEffectiveModelRuntimeConfig(endpoint: EndpointRecord): EffectiveEndpointModelRuntimeConfig {
  const contextWindow = readPositiveInteger(endpoint.model_profile?.max_context_tokens);
  const maxOutputTokens = readPositiveInteger(endpoint.model_profile?.max_output_tokens);
  const inputModalities: EndpointModelModality[] = ['text'];
  const outputModalities: EndpointModelModality[] = ['text'];

  for (const capability of endpoint.capabilities ?? []) {
    if (capability.enabled !== true) continue;
    if (capability.type === 'multimodal_completion') {
      addModality(inputModalities, 'image');
    }
    if (capability.type === 'image_generation') {
      addModality(outputModalities, 'image');
    }
    if (capability.type === 'video_generation') {
      addModality(outputModalities, 'video');
    }
  }

  if (endpoint.model_profile?.supports_file === true) {
    addModality(inputModalities, 'file');
  }

  const applyPatchTransport: EndpointApplyPatchTransport =
    endpoint.upstream_protocol === 'openai_responses' ? 'freeform' : 'function';
  const limits =
    contextWindow || maxOutputTokens
      ? {
          ...(contextWindow ? { context_window: contextWindow } : {}),
          ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
        }
      : undefined;
  const surfaceDefaults: EffectiveEndpointModelRuntimeConfig['surface_defaults'] = {
    modalities: {
      input: [...inputModalities],
      output: [...outputModalities],
    },
    tools: {
      supports_search: false,
      supports_view_image: false,
      apply_patch_transport: applyPatchTransport,
      supports_parallel_calls: false,
    },
  };

  return {
    ...(limits ? { limits } : {}),
    surface_defaults: surfaceDefaults,
    model_catalog: {
      input_modalities: [...inputModalities],
      supports_search_tool: false,
      supports_parallel_tool_calls: false,
      apply_patch_tool_type: applyPatchTransport,
    },
  };
}

function sanitizeDataPlanePassthroughHeaders(headers?: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    const name = rawName.trim().toLowerCase();
    const value = rawValue.trim();
    if (!value || !DATA_PLANE_PASSTHROUGH_HEADER_ALLOWLIST.has(name)) {
      continue;
    }
    sanitized[name] = value;
  }
  return sanitized;
}

function buildRuntimeConfig(endpoint: EndpointRecord): RuntimeNamespaceConfig {
  const effectiveModelConfig = deriveEndpointEffectiveModelRuntimeConfig(endpoint);
  return {
    listen: '0.0.0.0:8080',
    upstream_timeout_secs: endpoint.limits?.timeout_seconds ?? 120,
    upstreams: [{
      name: 'primary',
      api_root: normalizeEndpointApiRoot(endpoint),
      fixed_upstream_format: fixedUpstreamFormat(endpoint.upstream_protocol),
      upstream_headers: [],
      ...(effectiveModelConfig.limits ? { limits: effectiveModelConfig.limits } : {}),
      surface_defaults: effectiveModelConfig.surface_defaults,
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

async function delayWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  if (signal?.aborted) {
    throw createAbortError('universal_proxy_request_aborted');
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
      reject(createAbortError('universal_proxy_request_aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // best-effort cancellation
  }
}

function createAbortableResponse(response: Response, signal?: AbortSignal): Response {
  if (!signal || !response.body) {
    return response;
  }

  const upstreamReader = response.body.getReader();
  let settled = false;
  let cleanupAbortListener = () => {};

  const releaseReader = () => {
    try {
      upstreamReader.releaseLock();
    } catch {
      // ignore lock release races after cancellation/error
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const handleAbort = () => {
        cleanupAbortListener();
        void cancelResponseReader(upstreamReader, signal.reason).finally(() => {
          if (settled) {
            return;
          }
          settled = true;
          controller.error(createAbortError('universal_proxy_response_aborted'));
          releaseReader();
        });
      };

      if (signal.aborted) {
        handleAbort();
        return;
      }

      signal.addEventListener('abort', handleAbort, { once: true });
      cleanupAbortListener = () => {
        signal.removeEventListener('abort', handleAbort);
        cleanupAbortListener = () => {};
      };
    },
    async pull(controller) {
      try {
        if (signal.aborted) {
          throw createAbortError('universal_proxy_response_aborted');
        }
        const { done, value } = await upstreamReader.read();
        if (done) {
          if (!settled) {
            settled = true;
            cleanupAbortListener();
            controller.close();
          }
          releaseReader();
          return;
        }
        if (value) {
          controller.enqueue(value);
        }
      } catch (error) {
        if (settled) {
          cleanupAbortListener();
          releaseReader();
          return;
        }
        settled = true;
        cleanupAbortListener();
        controller.error(
          signal.aborted
            ? createAbortError('universal_proxy_response_aborted')
            : (error instanceof Error ? error : new Error(String(error))),
        );
        releaseReader();
      }
    },
    async cancel(reason) {
      if (!settled) {
        settled = true;
      }
      cleanupAbortListener();
      await cancelResponseReader(upstreamReader, reason);
      releaseReader();
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
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
  ): Promise<string> {
    const namespace = this.buildNamespace(workspaceId, projectId, endpoint.id);
    const config = buildRuntimeConfig(endpoint);
    const desiredConfigHash = buildConfigHash(config);
    await this.reconcileNamespaceConfig(namespace, config, desiredConfigHash);
    return namespace;
  }

  async proxyJsonRequest(options: ProxyOptions): Promise<ProxyResult> {
    const downstreamAbort = options.signal
      ? { signal: options.signal, cleanup: () => {} }
      : createDownstreamAbortController({
        req: options.req,
        res: options.res,
        requestAbortedMessage: 'universal_proxy_request_aborted',
        requestClosedMessage: 'universal_proxy_request_closed',
        responseClosedMessage: 'universal_proxy_response_closed',
      });

    try {
      const upstreamResponse = await this.forwardRequest({
        ...options,
        signal: downstreamAbort.signal,
      });
      throwIfAborted(downstreamAbort.signal, 'universal_proxy_request_aborted');

      options.res.statusCode = upstreamResponse.status;
      const contentType = upstreamResponse.headers.get('content-type');
      if (contentType) {
        options.res.setHeader('content-type', contentType);
      }
      const isStream = (contentType ?? '').toLowerCase().includes('text/event-stream');
      if (isStream && upstreamResponse.body) {
        const reader = upstreamResponse.body.getReader();
        while (true) {
          throwIfAborted(downstreamAbort.signal, 'universal_proxy_response_closed');
          const chunk = await reader.read();
          if (chunk.done) break;
          throwIfAborted(downstreamAbort.signal, 'universal_proxy_response_closed');
          if (chunk.value) {
            options.res.write(Buffer.from(chunk.value));
          }
        }
        throwIfAborted(downstreamAbort.signal, 'universal_proxy_response_closed');
        options.res.end();
        return { upstream_status: upstreamResponse.status };
      }

      const text = await upstreamResponse.text();
      throwIfAborted(downstreamAbort.signal, 'universal_proxy_response_closed');
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
    } finally {
      downstreamAbort.cleanup();
    }
  }

  async forwardRequest(options: ProxyForwardOptions): Promise<Response> {
    const routePath = routePathForProxyPath(options.proxyPath);
    if (!routePath) {
      throw new Error(`unsupported_universal_proxy_path:${options.proxyPath}`);
    }
    const allowsAutomaticReplay = requestAllowsAutomaticReplay(options.req.method, options.proxyPath);
    const url = `${sanitizeBaseUrl(this.baseUrl)}/namespaces/${encodeURIComponent(options.namespace)}${routePath}`;
    const init: RequestInit = {
      method: options.req.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        ...sanitizeDataPlanePassthroughHeaders(options.passthroughHeaders),
        Authorization: `Bearer ${options.providerCredential}`,
      },
      body: JSON.stringify({
        ...(typeof options.requestBody === 'object' && options.requestBody !== null ? options.requestBody as Record<string, unknown> : {}),
        model: options.model,
      }),
      signal: options.signal,
    };

    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(options.signal, 'universal_proxy_request_aborted');
      const response = await fetch(url, init);
      if (attempt >= this.options.maxTransientProviderRetries) {
        return createAbortableResponse(response, options.signal);
      }
      const retryDecision = await this.getTransientProviderRetryDecision(response);
      if (!retryDecision.shouldRetry) {
        return createAbortableResponse(response, options.signal);
      }
      if (!allowsAutomaticReplay) {
        return createAbortableResponse(response, options.signal);
      }
      await delayWithAbort(retryDecision.retryDelayMs, options.signal);
    }
  }

  private async getTransientProviderRetryDecision(response: Response): Promise<TransientRetryDecision> {
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
