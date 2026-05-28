import type http from 'node:http';
import {
  buildProxyBridgePlan,
  translateProxyResponsePayload,
} from './protocol-bridge.js';
import {
  pipeAnthropicSseAsResponses,
  pipeAnthropicSseAsOpenAiChat,
  pipeOpenAiChatSseAsAnthropic,
} from './anthropic-sse-translate.js';
import { createDownstreamAbortController, throwIfAborted } from './downstream-abort.js';
import { pipeTranslatedChatSseAsResponses } from './responses-sse-translate.js';

function debugEndpointProxy(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_ENDPOINT_PROXY !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[endpoint-proxy] ${message}${suffix}\n`);
}

function readDefaultEndpointProxyTimeoutSeconds(): number {
  const raw = process.env.MBOS_ENDPOINT_PROXY_DEFAULT_TIMEOUT_SECONDS;
  const parsed = Number.parseInt(raw ?? '', 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 120;
}

function summarizeChatLikeBody(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const roleCounts: Record<string, number> = {};
  for (const raw of messages) {
    const item = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    const role = typeof item?.role === 'string' ? item.role : 'unknown';
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  }
  return {
    model: typeof body.model === 'string' ? body.model : null,
    stream: body.stream === true,
    message_count: messages.length,
    roles: roleCounts,
    tool_count: tools.length,
    tool_choice:
      typeof body.tool_choice === 'string'
        ? body.tool_choice
        : (typeof body.tool_choice === 'object' && body.tool_choice !== null ? 'object' : null),
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
  };
}

function inferProxyPathFromUpstreamUrl(upstreamUrl: string): string {
  const normalized = upstreamUrl.replace(/\?.*$/, '').replace(/\/+$/, '').toLowerCase();
  if (normalized.endsWith('/chat/completions')) return 'chat/completions';
  if (normalized.endsWith('/responses')) return 'responses';
  if (normalized.endsWith('/messages')) return 'messages';
  return upstreamUrl.split('/').slice(-2).join('/');
}

function isDeepSeekUpstreamUrl(upstreamUrl: string): boolean {
  try {
    const url = new URL(upstreamUrl);
    return url.hostname === 'api.deepseek.com' || url.hostname.endsWith('.deepseek.com');
  } catch {
    return false;
  }
}

function normalizeAttachmentFilename(filename: string): string {
  const sanitized = filename
    .replace(/[\u0000-\u001F\u007F]+/g, '')
    .trim()
    .split(/[\\/]/)
    .at(-1)
    ?.trim();
  return sanitized && sanitized.length > 0 ? sanitized : 'download';
}

function splitAsciiExtension(filename: string): { base: string; extension: string } {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return { base: filename, extension: '' };
  }
  const extension = filename.slice(lastDot);
  if (!/^\.[A-Za-z0-9._-]+$/.test(extension)) {
    return { base: filename, extension: '' };
  }
  return {
    base: filename.slice(0, lastDot),
    extension,
  };
}

function buildAsciiAttachmentFilenameFallback(filename: string): string {
  const normalized = normalizeAttachmentFilename(filename);
  const { base, extension } = splitAsciiExtension(normalized);
  const preserveLeadingDot = base.startsWith('.');
  const asciiBase = Array.from(base.normalize('NFKD'))
    .flatMap((char) => {
      if (/[\u0300-\u036f]/.test(char)) {
        return [];
      }
      if (char >= ' ' && char <= '~' && char !== '"' && char !== '\\') {
        return [char];
      }
      return ['_'];
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .trim();
  const trimmedAsciiBase = preserveLeadingDot
    ? asciiBase.replace(/^[ ]+|[. ]+$/g, '')
    : asciiBase.replace(/^[. ]+|[. ]+$/g, '');
  const normalizedAsciiBase = preserveLeadingDot
    && trimmedAsciiBase.length > 0
    && !trimmedAsciiBase.startsWith('.')
    ? `.${trimmedAsciiBase}`
    : trimmedAsciiBase;

  if (!normalizedAsciiBase) {
    return `download${extension}`;
  }
  return `${normalizedAsciiBase}${extension}`;
}

function encodeRfc5987FilenameValue(filename: string): string {
  return encodeURIComponent(filename)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function buildAttachmentContentDisposition(filename: string): string {
  const normalized = normalizeAttachmentFilename(filename);
  const fallback = buildAsciiAttachmentFilenameFallback(normalized)
    .replace(/(["\\])/g, '\\$1');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987FilenameValue(normalized)}`;
}

export function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function unauthorized(res: http.ServerResponse): void {
  json(res, 401, { error_code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' });
}

export function applyCors(res: http.ServerResponse): void {
  const allowOrigin = process.env.CORS_ALLOW_ORIGIN ?? '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Idempotency-Key, X-API-Key, anthropic-version, anthropic-beta',
  );
}

export async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw) as unknown;
}

export async function proxyJsonRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: {
    upstreamUrl: string;
    apiKey: string;
    endpointProtocol?: string;
    proxyPath?: string;
    model?: string;
    timeoutSeconds?: number;
    requestBody?: unknown;
    passthroughHeaders?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<{ upstream_status: number; tokens_total?: number }> {
  const method = req.method ?? 'POST';
  const isBodyAllowed = method !== 'GET' && method !== 'HEAD';
  const rawBody = isBodyAllowed
    ? (typeof options.requestBody !== 'undefined' ? options.requestBody : await readBody(req))
    : {};
  const body =
    rawBody && typeof rawBody === 'object'
      ? ({ ...(rawBody as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  if (options.model) {
    body.model = options.model;
  }

  const normalizedProxyPath =
    typeof options.proxyPath === 'string' && options.proxyPath.trim()
      ? options.proxyPath.trim()
      : inferProxyPathFromUpstreamUrl(options.upstreamUrl);
  const bridgePlan = buildProxyBridgePlan({
    endpointProtocol: options.endpointProtocol,
    proxyPath: normalizedProxyPath,
    upstreamUrl: options.upstreamUrl,
    body,
  });
  res.setHeader('x-agentsmith-proxy-source-protocol', bridgePlan.sourceProtocol);
  res.setHeader('x-agentsmith-proxy-target-protocol', bridgePlan.targetProtocol);
  res.setHeader(
    'x-agentsmith-proxy-converted',
    bridgePlan.sourceProtocol === bridgePlan.targetProtocol ? '0' : '1',
  );
  const useResponsesFallback =
    bridgePlan.sourceProtocol === 'openai_responses' && bridgePlan.targetProtocol === 'openai_completion';
  const requestedResponsesStream = bridgePlan.isStreamingRequest;
  const unsupportedCrossProtocolStream =
    bridgePlan.isStreamingRequest
    && bridgePlan.sourceProtocol !== bridgePlan.targetProtocol
    && !(bridgePlan.sourceProtocol === 'anthropic' && bridgePlan.targetProtocol === 'openai_completion')
    && !(bridgePlan.sourceProtocol === 'openai_completion' && bridgePlan.targetProtocol === 'anthropic')
    && !(bridgePlan.sourceProtocol === 'openai_responses' && bridgePlan.targetProtocol === 'anthropic')
    && !bridgePlan.canTranslateStreamingResponse;
  if (unsupportedCrossProtocolStream) {
    json(res, 422, {
      error_code: 'PROTOCOL_STREAM_CONVERSION_NOT_SUPPORTED',
      message: 'streaming_protocol_conversion_not_supported',
      source_protocol: bridgePlan.sourceProtocol,
      target_protocol: bridgePlan.targetProtocol,
    });
    return { upstream_status: 422 };
  }

  const upstreamUrl = bridgePlan.upstreamUrl;
  const upstreamBody = bridgePlan.upstreamBody;
  if (
    useResponsesFallback
    && isDeepSeekUpstreamUrl(upstreamUrl)
    && upstreamBody.thinking === undefined
  ) {
    upstreamBody.thinking = { type: 'disabled' };
  }

  const timeoutMs = Math.max(1, options.timeoutSeconds ?? readDefaultEndpointProxyTimeoutSeconds()) * 1000;
  const upstreamAbort = options.signal
    ? createDownstreamAbortController({
      parentSignal: options.signal,
      parentAbortMessage: 'endpoint_proxy_request_aborted',
      timeoutMs,
      timeoutMessage: 'endpoint_proxy_timeout',
    })
    : createDownstreamAbortController({
      req,
      res,
      timeoutMs,
      timeoutMessage: 'endpoint_proxy_timeout',
      requestAbortedMessage: 'endpoint_proxy_request_aborted',
      requestClosedMessage: 'endpoint_proxy_request_closed',
      responseClosedMessage: 'endpoint_proxy_response_closed',
    });
  debugEndpointProxy('proxy_json_request', {
    method,
    use_responses_fallback: useResponsesFallback,
    requested_responses_stream: requestedResponsesStream,
    upstream_url: upstreamUrl,
    timeout_ms: timeoutMs,
    request_summary: summarizeChatLikeBody(upstreamBody),
  });

  try {
    throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_request_aborted');
    const upstreamRes = await fetch(upstreamUrl, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        ...(options.passthroughHeaders ?? {}),
      },
      body: isBodyAllowed ? JSON.stringify(upstreamBody) : undefined,
      signal: upstreamAbort.signal,
    });
    throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_request_aborted');
    const isStreamingChatUpstream =
      useResponsesFallback
      && requestedResponsesStream
      && upstreamRes.ok
      && (upstreamRes.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
    const isStreamingPassthrough =
      bridgePlan.sourceProtocol === bridgePlan.targetProtocol
      && bridgePlan.isStreamingRequest
      && upstreamRes.ok
      && (upstreamRes.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
    debugEndpointProxy('upstream_response', {
      status: upstreamRes.status,
      content_type: upstreamRes.headers.get('content-type') ?? null,
      streaming_chat_upstream: isStreamingChatUpstream,
      streaming_passthrough: isStreamingPassthrough,
      use_responses_fallback: useResponsesFallback,
      source_protocol: bridgePlan.sourceProtocol,
      target_protocol: bridgePlan.targetProtocol,
    });

    if (isStreamingChatUpstream && upstreamRes.body) {
      res.statusCode = upstreamRes.status;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      await pipeTranslatedChatSseAsResponses(upstreamRes.body, res, upstreamBody, {
        upstreamUrl,
        fallbackMode: useResponsesFallback,
        debug: debugEndpointProxy,
      });
      throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_response_closed');
      return { upstream_status: upstreamRes.status };
    }

    const isStreamingAnthropicToOpenAi =
      bridgePlan.sourceProtocol === 'openai_completion'
      && bridgePlan.targetProtocol === 'anthropic'
      && bridgePlan.isStreamingRequest
      && upstreamRes.ok
      && (upstreamRes.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
    if (isStreamingAnthropicToOpenAi && upstreamRes.body) {
      res.statusCode = upstreamRes.status;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      await pipeAnthropicSseAsOpenAiChat(upstreamRes.body, res, upstreamBody);
      throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_response_closed');
      return { upstream_status: upstreamRes.status };
    }

    const isStreamingAnthropicToResponses =
      bridgePlan.sourceProtocol === 'openai_responses'
      && bridgePlan.targetProtocol === 'anthropic'
      && bridgePlan.isStreamingRequest
      && upstreamRes.ok
      && (upstreamRes.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
    if (isStreamingAnthropicToResponses && upstreamRes.body) {
      res.statusCode = upstreamRes.status;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      await pipeAnthropicSseAsResponses(upstreamRes.body, res, upstreamBody);
      throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_response_closed');
      return { upstream_status: upstreamRes.status };
    }

    const isStreamingOpenAiToAnthropic =
      bridgePlan.sourceProtocol === 'anthropic'
      && bridgePlan.targetProtocol === 'openai_completion'
      && bridgePlan.isStreamingRequest
      && upstreamRes.ok
      && (upstreamRes.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
    if (isStreamingOpenAiToAnthropic && upstreamRes.body) {
      res.statusCode = upstreamRes.status;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      await pipeOpenAiChatSseAsAnthropic(upstreamRes.body, res, upstreamBody);
      throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_response_closed');
      return { upstream_status: upstreamRes.status };
    }

    if (isStreamingPassthrough && upstreamRes.body) {
      res.statusCode = upstreamRes.status;
      res.setHeader('content-type', upstreamRes.headers.get('content-type') ?? 'text/event-stream; charset=utf-8');
      const reader = upstreamRes.body.getReader();
      while (true) {
        throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_response_closed');
        const next = await reader.read();
        if (next.done) break;
        throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_response_closed');
        if (next.value) {
          res.write(next.value);
        }
      }
      throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_response_closed');
      res.end();
      return { upstream_status: upstreamRes.status };
    }

    let payload = Buffer.from(await upstreamRes.arrayBuffer());
    throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_response_closed');
    let contentType = upstreamRes.headers.get('content-type') ?? 'application/json';
    let tokensTotal: number | undefined;
    try {
      const parsed = JSON.parse(payload.toString('utf-8')) as { usage?: { total_tokens?: unknown } };
      const maybeTotal = parsed?.usage?.total_tokens;
      if (typeof maybeTotal === 'number' && Number.isFinite(maybeTotal) && maybeTotal >= 0) {
        tokensTotal = Math.floor(maybeTotal);
      }
    } catch {
      // Non-JSON or partial payloads are still proxied; usage extraction is best-effort.
    }
    if (upstreamRes.ok && bridgePlan.sourceProtocol !== bridgePlan.targetProtocol) {
      payload = Buffer.from(translateProxyResponsePayload(payload.toString('utf-8'), bridgePlan), 'utf-8');
      contentType = 'application/json; charset=utf-8';
    }
    res.statusCode = upstreamRes.status;
    res.setHeader('content-type', contentType);
    throwIfAborted(upstreamAbort.signal, 'endpoint_proxy_response_closed');
    res.end(payload);
    debugEndpointProxy('proxy_json_request_done', {
      status: upstreamRes.status,
      content_type: contentType,
      translated_non_stream_response: useResponsesFallback && upstreamRes.ok,
      payload_bytes: payload.byteLength,
      tokens_total: tokensTotal ?? null,
    });
    return { upstream_status: upstreamRes.status, tokens_total: tokensTotal };
  } finally {
    upstreamAbort.cleanup();
  }
}
