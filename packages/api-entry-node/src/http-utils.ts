import type http from 'node:http';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
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
    sourceModel?: string;
    timeoutSeconds?: number;
  },
): Promise<void> {
  const method = req.method ?? 'POST';
  const isBodyAllowed = method !== 'GET' && method !== 'HEAD';
  const rawBody = isBodyAllowed ? await readBody(req) : {};
  const body =
    rawBody && typeof rawBody === 'object'
      ? ({ ...(rawBody as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  if (options.sourceModel) {
    body.model = options.sourceModel;
  }

  const abortController = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutSeconds ?? 120) * 1000;
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const upstreamRes = await fetch(options.upstreamUrl, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: isBodyAllowed ? JSON.stringify(body) : undefined,
      signal: abortController.signal,
    });
    const payload = Buffer.from(await upstreamRes.arrayBuffer());
    const contentType = upstreamRes.headers.get('content-type') ?? 'application/json';
    res.statusCode = upstreamRes.status;
    res.setHeader('content-type', contentType);
    res.end(payload);
  } finally {
    clearTimeout(timeout);
  }
}
