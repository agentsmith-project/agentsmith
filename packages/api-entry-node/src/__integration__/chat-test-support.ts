import type { AddressInfo } from 'node:net';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import { apiFetch } from './test-support.js';

const upstreamServers: Server[] = [];

type ParsedDefaultSseBlock = {
  id: string | null;
  payload: Record<string, unknown> | null;
};

export type UniversalProxyAdminConfigRequest = {
  namespace: string;
  headers: IncomingHttpHeaders;
  body: unknown;
  responseStatus: number;
  responseBody: unknown;
  appliedRevision: string | null;
};

type UniversalProxyAdminHarnessOptions = {
  failConfigPush?: boolean;
};

type UniversalProxyAdminRequest = {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  path: string;
  body: unknown;
};

type UniversalProxyAdminHarness = {
  handleAdminRequest: (request: UniversalProxyAdminRequest) => boolean;
  configRequests: () => UniversalProxyAdminConfigRequest[];
  currentRevision: (namespace: string) => string | null;
  hasNamespace: (namespace: string) => boolean;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createUniversalProxyAdminHarness(
  options?: UniversalProxyAdminHarnessOptions,
): UniversalProxyAdminHarness {
  const configRequests: UniversalProxyAdminConfigRequest[] = [];
  const revisions = new Map<string, string>();
  let revisionCounter = 0;

  const nextRevision = (namespace: string): string => {
    revisionCounter += 1;
    return `${namespace}:srv-${String(revisionCounter).padStart(4, '0')}`;
  };

  return {
    handleAdminRequest({ req, res, path, body }) {
      const configMatch = path.match(/^\/admin\/namespaces\/([^/]+)\/config$/);
      if (req.method !== 'POST' || !configMatch) {
        return false;
      }

      const namespace = decodeURIComponent(configMatch[1] ?? '');
      let responseStatus = 200;
      let responseBody: unknown = { revision: '' };
      let appliedRevision: string | null = null;

      if (options?.failConfigPush) {
        responseStatus = 500;
        responseBody = { error: 'config_push_failed' };
      } else if (!isObjectRecord(body)) {
        responseStatus = 400;
        responseBody = { error: 'invalid_config_payload' };
      } else if (Object.prototype.hasOwnProperty.call(body, 'revision')) {
        responseStatus = 400;
        responseBody = {
          error: 'top_level_revision_forbidden',
          message: 'top_level_revision_forbidden',
        };
      } else {
        const currentRevision = revisions.get(namespace) ?? null;
        const hasIfRevision = Object.prototype.hasOwnProperty.call(body, 'if_revision');
        const ifRevision = hasIfRevision ? (body.if_revision as string | null) : undefined;

        if (!hasIfRevision || ifRevision !== currentRevision) {
          responseStatus = 412;
          responseBody = {
            error: 'revision_mismatch',
            current_revision: currentRevision,
          };
        } else {
          appliedRevision = nextRevision(namespace);
          revisions.set(namespace, appliedRevision);
          responseBody = { revision: appliedRevision };
        }
      }

      configRequests.push({
        namespace,
        headers: req.headers,
        body,
        responseStatus,
        responseBody,
        appliedRevision,
      });
      res.statusCode = responseStatus;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(responseBody));
      return true;
    },
    configRequests: () => configRequests,
    currentRevision: (namespace: string) => revisions.get(namespace) ?? null,
    hasNamespace: (namespace: string) => revisions.has(namespace),
  };
}

async function listenOnRandomLoopbackPort(server: Server, invalidPortError: string): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    try {
      server.listen(0, '127.0.0.1');
    } catch (error: unknown) {
      cleanup();
      reject(error instanceof Error ? error : new Error('chat_upstream_listen_failed'));
    }
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.closeAllConnections?.();
    server.closeIdleConnections?.();
    server.close();
    throw new Error(invalidPortError);
  }

  return address;
}

export async function cleanupChatUpstreamServers(): Promise<void> {
  await Promise.all(
    upstreamServers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.closeIdleConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
  upstreamServers.length = 0;
}

export async function startOpenAICompatibleUpstreamServer(): Promise<{
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
}> {
  let body: unknown = null;
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};

      if (req.url?.includes('/chat/completions')) {
        const request = body as { stream?: boolean };
        if (request.stream) {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/event-stream');
          res.write(
            'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
          );
          res.write(
            'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","choices":[{"delta":{"content":" from upstream."},"finish_reason":null}]}\n\n',
          );
          res.write(
            'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'chatcmpl_test',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'deepseek-chat',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello from upstream.' },
                finish_reason: 'stop',
              },
            ],
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });
  const address = await listenOnRandomLoopbackPort(server, 'invalid_chat_upstream_port');
  upstreamServers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, lastBody: () => body };
}

export async function startUniversalProxyChatServer(): Promise<{
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
  lastPath: () => string;
  lastHeaders: () => IncomingHttpHeaders;
  configRequests: () => UniversalProxyAdminConfigRequest[];
  currentRevision: (namespace: string) => string | null;
}> {
  let body: unknown = null;
  let path = '';
  let headers: IncomingHttpHeaders = {};
  const adminHarness = createUniversalProxyAdminHarness();
  const server = http.createServer((req, res) => {
    void (async () => {
      path = req.url ?? '';
      headers = req.headers;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};

      if (adminHarness.handleAdminRequest({ req, res, path, body })) {
        return;
      }

      const namespaceMatch = path.match(/^\/namespaces\/([^/]+)\/(.+)$/);
      const namespace = namespaceMatch ? decodeURIComponent(namespaceMatch[1] ?? '') : null;
      if (namespace && !adminHarness.hasNamespace(namespace)) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'namespace_not_found' }));
        return;
      }

      if (path.includes('/openai/v1/chat/completions')) {
        const request = body as { stream?: boolean };
        if (request.stream) {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/event-stream');
          res.write(
            'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
          );
          setTimeout(() => {
            res.write(
              'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{"content":" from universal proxy."},"finish_reason":null}]}\n\n',
            );
          }, 300);
          setTimeout(() => {
            res.write(
              'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":12}}\n\n',
            );
            res.write('data: [DONE]\n\n');
            res.end();
          }, 1200);
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'chatcmpl_test',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'placeholder-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello from universal proxy.' },
                finish_reason: 'stop',
              },
            ],
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });
  const address = await listenOnRandomLoopbackPort(server, 'invalid_universal_proxy_chat_port');
  upstreamServers.push(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    lastBody: () => body,
    lastPath: () => path,
    lastHeaders: () => headers,
    configRequests: () => adminHarness.configRequests(),
    currentRevision: (namespace: string) => adminHarness.currentRevision(namespace),
  };
}

export async function startPassthroughUpstreamServer(): Promise<{
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
  lastPath: () => string;
}> {
  let body: unknown = null;
  let path = '';
  const server = http.createServer((req, res) => {
    void (async () => {
      path = req.url ?? '';
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, echoed: body }));
    })();
  });
  const address = await listenOnRandomLoopbackPort(server, 'invalid_chat_passthrough_upstream_port');
  upstreamServers.push(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    lastBody: () => body,
    lastPath: () => path,
  };
}

export async function startSlowOpenAICompatibleUpstreamServer(): Promise<{
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
}> {
  let body: unknown = null;
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};

      if (!req.url?.includes('/chat/completions')) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.write(
        'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      );
      setTimeout(() => {
        res.write(
          'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n',
        );
      }, 300);
      setTimeout(() => {
        res.write(
          'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":12}}\n\n',
        );
        res.write('data: [DONE]\n\n');
        res.end();
      }, 1_200);
    })();
  });
  const address = await listenOnRandomLoopbackPort(server, 'invalid_slow_chat_upstream_port');
  upstreamServers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, lastBody: () => body };
}

export function parseDefaultSseBlocks(text: string): ParsedDefaultSseBlock[] {
  const blocks = text.split('\n\n').map((item) => item.trim()).filter(Boolean);
  const parsed: ParsedDefaultSseBlock[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const dataLine = lines.find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const idLine = lines.find((line) => line.startsWith('id:'));
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
    } catch {
      payload = null;
    }
    parsed.push({
      id: idLine ? idLine.slice('id:'.length).trim() : null,
      payload,
    });
  }
  return parsed;
}

export async function readSseBlocks(
  response: Response,
  minBlocks: number,
  timeoutMs = 1_000,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('missing_sse_reader');
  }
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;

  const countBlocks = (): number =>
    text
      .split('\n\n')
      .map((item) => item.trim())
      .filter(Boolean).length;

  while (countBlocks() < minBlocks) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed_out_waiting_for_sse_blocks_${minBlocks}`)), remaining),
      ),
    ]);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }

  await reader.cancel();
  return text;
}

export function parseSseEventPayload(text: string, event: string): Record<string, unknown> | null {
  const blocks = text.split('\n\n').map((item) => item.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event:'));
    if (!eventLine) continue;
    const name = eventLine.slice('event:'.length).trim();
    if (name !== event) continue;
    const dataLine = lines.find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    try {
      return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function buildMultipartBody(
  fields: Array<{ name: string; value: string }>,
  file: { fieldName: string; filename: string; contentType: string; content: Uint8Array },
): { body: Uint8Array; contentType: string } {
  const boundary = `----mbos-boundary-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const field of fields) {
    chunks.push(encoder.encode(`--${boundary}\r\n`));
    chunks.push(encoder.encode(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n`));
    chunks.push(encoder.encode(field.value));
    chunks.push(encoder.encode('\r\n'));
  }

  chunks.push(encoder.encode(`--${boundary}\r\n`));
  chunks.push(
    encoder.encode(
      `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n`,
    ),
  );
  chunks.push(encoder.encode(`Content-Type: ${file.contentType}\r\n\r\n`));
  chunks.push(file.content);
  chunks.push(encoder.encode('\r\n'));
  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  const size = chunks.reduce((acc, cur) => acc + cur.byteLength, 0);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export async function createChatSession(baseUrl: string, endpointBaseUrl: string): Promise<{
  endpointId: string;
  sessionId: string;
  userMessageId: string;
}> {
  const createCredential = await apiFetch(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'chat-key',
        type: 'api_key',
        value: 'sk-chat',
      }),
    },
  );
  if (createCredential.status !== 201) {
    throw new Error(`failed_to_create_chat_credential:${createCredential.status}`);
  }
  const credential = (await createCredential.json()) as { id: string };

  const createEndpoint = await apiFetch(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'chat-endpoint',
        model: 'deepseek-chat',
        type: 'custom',
        base_url: endpointBaseUrl,
        credential_ref: credential.id,
        provider_family: 'openai',
        upstream_protocol: 'openai_chat_completions',
        capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'deepseek-chat' }],
        models: [{ capability: 'chat_completion', model_id: 'deepseek-chat' }],
        defaults: { chat_model_id: 'deepseek-chat' },
      }),
    },
  );
  if (createEndpoint.status !== 201) {
    throw new Error(`failed_to_create_chat_endpoint:${createEndpoint.status}`);
  }
  const endpoint = (await createEndpoint.json()) as { id: string };

  const createSession = await apiFetch(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint_id: endpoint.id,
        model: 'deepseek-chat',
      }),
    },
  );
  if (createSession.status !== 201) {
    throw new Error(`failed_to_create_chat_session:${createSession.status}`);
  }
  const session = (await createSession.json()) as { id: string };

  const createUser = await apiFetch(
    baseUrl,
    `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'user',
        content: 'hello from user',
      }),
    },
  );
  if (createUser.status !== 201) {
    throw new Error(`failed_to_create_chat_user_message:${createUser.status}`);
  }
  const userMessage = (await createUser.json()) as { id: string };

  return {
    endpointId: endpoint.id,
    sessionId: session.id,
    userMessageId: userMessage.id,
  };
}
