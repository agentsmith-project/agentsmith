import type http from 'node:http';
import {
  buildResponsesSsePayload,
  translateChatCompletionResponseToResponses,
  translateResponsesRequestToChat,
} from './responses-chat-compat.js';
import { pipeTranslatedChatSseAsResponses } from './responses-sse-translate.js';

function debugEndpointProxy(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_ENDPOINT_PROXY !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[endpoint-proxy] ${message}${suffix}\n`);
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
    'Content-Type, Authorization, Idempotency-Key',
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
    model?: string;
    timeoutSeconds?: number;
    responsesFallbackToChat?: boolean;
  },
): Promise<{ upstream_status: number; tokens_total?: number }> {
  const method = req.method ?? 'POST';
  const isBodyAllowed = method !== 'GET' && method !== 'HEAD';
  const rawBody = isBodyAllowed ? await readBody(req) : {};
  const body =
    rawBody && typeof rawBody === 'object'
      ? ({ ...(rawBody as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  if (options.model) {
    body.model = options.model;
  }

  const useResponsesFallback = options.responsesFallbackToChat === true && method === 'POST';

  const requestedResponsesStream = useResponsesFallback && body.stream === true;

  const upstreamUrl = useResponsesFallback
    ? options.upstreamUrl.replace(/\/responses\/?$/i, '/chat/completions')
    : options.upstreamUrl;
  const upstreamBody = useResponsesFallback ? translateResponsesRequestToChat(body) : body;

  const abortController = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutSeconds ?? 120) * 1000;
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  debugEndpointProxy('proxy_json_request', {
    method,
    use_responses_fallback: useResponsesFallback,
    requested_responses_stream: requestedResponsesStream,
    upstream_url: upstreamUrl,
    timeout_ms: timeoutMs,
    request_summary: summarizeChatLikeBody(upstreamBody),
  });

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: isBodyAllowed ? JSON.stringify(upstreamBody) : undefined,
      signal: abortController.signal,
    });
    const isStreamingChatUpstream =
      useResponsesFallback
      && requestedResponsesStream
      && upstreamRes.ok
      && (upstreamRes.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
    debugEndpointProxy('upstream_response', {
      status: upstreamRes.status,
      content_type: upstreamRes.headers.get('content-type') ?? null,
      streaming_chat_upstream: isStreamingChatUpstream,
      use_responses_fallback: useResponsesFallback,
    });

    if (isStreamingChatUpstream && upstreamRes.body) {
      res.statusCode = upstreamRes.status;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      await pipeTranslatedChatSseAsResponses(upstreamRes.body, res, upstreamBody, {
        upstreamUrl,
        fallbackMode: useResponsesFallback,
        debug: debugEndpointProxy,
      });
      return { upstream_status: upstreamRes.status };
    }

    let payload = Buffer.from(await upstreamRes.arrayBuffer());
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
    if (useResponsesFallback && upstreamRes.ok) {
      const translatedResponse = translateChatCompletionResponseToResponses(payload.toString('utf-8'), upstreamBody);
      if (requestedResponsesStream) {
        payload = Buffer.from(buildResponsesSsePayload(translatedResponse), 'utf-8');
        contentType = 'text/event-stream; charset=utf-8';
      } else {
        payload = Buffer.from(JSON.stringify(translatedResponse));
      }
    }
    res.statusCode = upstreamRes.status;
    res.setHeader('content-type', contentType);
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
    clearTimeout(timeout);
  }
}
