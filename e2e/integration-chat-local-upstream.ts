import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function startOpenAICompatibleUpstream(): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
}> {
  return startOpenAICompatibleUpstreamWith({
    replyText: 'Hello from integration upstream.',
  });
}

export async function startOpenAICompatibleUpstreamWith(args: {
  replyText: string;
  delayMs?: number;
  statusCode?: number;
  errorMessage?: string;
  errorCode?: string;
}): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
}> {
  const {
    replyText,
    delayMs = 0,
    statusCode = 200,
    errorMessage = 'upstream_error',
    errorCode = 'UPSTREAM_ERROR',
  } = args;
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      requestCount += 1;

      if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (statusCode >= 400) {
        res.statusCode = statusCode;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error_code: errorCode,
            message: errorMessage,
          }),
        );
        return;
      }

      const rawBody = Buffer.concat(chunks).toString('utf-8');
      const requestBody = rawBody
        ? (JSON.parse(rawBody) as { stream?: unknown })
        : {};
      const isStreaming = requestBody.stream === true;

      if (isStreaming) {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl_integration',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'integration-chat-model',
            choices: [{ index: 0, delta: { content: replyText }, finish_reason: null }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl_integration',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'integration-chat-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { total_tokens: Math.max(replyText.length, 1) },
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'chatcmpl_integration',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'integration-chat-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: replyText },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    })().catch((error) => {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'integration_upstream_failed', message: error instanceof Error ? error.message : 'unknown_error' }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    getRequestCount: () => requestCount,
  };
}

export async function startOpenAIStreamingUpstreamWith(args: {
  chunks: string[];
  chunkDelayMs?: number;
}): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
}> {
  const { chunks, chunkDelayMs = 500 } = args;
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    void (async () => {
      const bodyChunks: Buffer[] = [];
      for await (const chunk of req) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      requestCount += 1;

      if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');

      for (const chunk of chunks) {
        const payload = JSON.stringify({
          id: 'chatcmpl_stream_integration',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'integration-chat-model',
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        });
        res.write(`data: ${payload}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
      }

      res.write('data: [DONE]\n\n');
      res.end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    getRequestCount: () => requestCount,
  };
}
