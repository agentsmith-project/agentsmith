import type { AddressInfo } from 'node:net';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { apiFetch } from './test-support.js';

const upstreamServers: Server[] = [];

type ParsedDefaultSseBlock = {
  id: string | null;
  payload: Record<string, unknown> | null;
};

function allocateTestPort(): number {
  const raw = execFileSync(
    'python3',
    ['-c', 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'],
    { encoding: 'utf8' },
  ).trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid_test_port:${raw}`);
  }
  return port;
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

export function startOpenAICompatibleUpstreamServer(): {
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
} {
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
  const port = allocateTestPort();
  server.listen(port, '127.0.0.1');
  upstreamServers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${port}/v1`, lastBody: () => body };
}

export function startUniversalProxyChatServer(): {
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
  lastPath: () => string;
  lastHeaders: () => IncomingHttpHeaders;
} {
  let body: unknown = null;
  let path = '';
  let headers: IncomingHttpHeaders = {};
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

      const configMatch = path.match(/^\/admin\/namespaces\/([^/]+)\/config$/);
      if (req.method === 'POST' && configMatch) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'applied' }));
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
  const port = allocateTestPort();
  server.listen(port, '127.0.0.1');
  upstreamServers.push(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    lastBody: () => body,
    lastPath: () => path,
    lastHeaders: () => headers,
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  upstreamServers.push(server);
  return {
    server,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    lastBody: () => body,
    lastPath: () => path,
  };
}

export function startSlowOpenAICompatibleUpstreamServer(): {
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
} {
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
  const port = allocateTestPort();
  server.listen(port, '127.0.0.1');
  upstreamServers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${port}/v1`, lastBody: () => body };
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
