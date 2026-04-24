import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function startOpenAICompatibleUpstream(): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
  getAbortedRequestCount: () => number;
  releasePendingResponses: () => void;
  setReplyText: (value: string) => void;
  setHoldResponseOpen: (value: boolean) => void;
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
  holdResponseOpen?: boolean;
}): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
  getAbortedRequestCount: () => number;
  releasePendingResponses: () => void;
  setReplyText: (value: string) => void;
  setHoldResponseOpen: (value: boolean) => void;
}> {
  const initialBehavior = {
    replyText: args.replyText,
    delayMs: args.delayMs ?? 0,
    statusCode: args.statusCode ?? 200,
    errorMessage: args.errorMessage ?? 'upstream_error',
    errorCode: args.errorCode ?? 'UPSTREAM_ERROR',
    holdResponseOpen: args.holdResponseOpen ?? false,
  };
  const behavior = { ...initialBehavior };
  let requestCount = 0;
  let abortedRequestCount = 0;
  const pendingResponseReleases = new Set<() => void>();

  function releasePendingResponses() {
    for (const release of Array.from(pendingResponseReleases)) {
      release();
    }
    pendingResponseReleases.clear();
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      requestCount += 1;
      let requestAborted = false;
      let responseCompleted = false;
      let resolveAbortWait: (() => void) | null = null;
      let releasePendingResponse: (() => void) | null = null;
      const abortWait = new Promise<void>((resolve) => {
        resolveAbortWait = resolve;
      });
      const markAborted = () => {
        if (requestAborted || responseCompleted) return;
        requestAborted = true;
        abortedRequestCount += 1;
        if (releasePendingResponse) {
          pendingResponseReleases.delete(releasePendingResponse);
          releasePendingResponse();
          releasePendingResponse = null;
        }
        resolveAbortWait?.();
        resolveAbortWait = null;
      };
      req.once('aborted', markAborted);
      res.once('close', markAborted);

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
        responseCompleted = true;
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const requestBehavior = { ...behavior };
      if (requestBehavior.holdResponseOpen && !requestAborted) {
        await new Promise<void>((resolve) => {
          releasePendingResponse = () => {
            if (releasePendingResponse) {
              pendingResponseReleases.delete(releasePendingResponse);
              releasePendingResponse = null;
            }
            resolve();
          };
          pendingResponseReleases.add(releasePendingResponse);
          if (requestAborted) {
            releasePendingResponse();
          }
        });
      }
      if (requestBehavior.delayMs > 0) {
        await Promise.race([
          new Promise((resolve) => setTimeout(resolve, requestBehavior.delayMs)),
          abortWait,
        ]);
      }
      if (requestAborted || res.destroyed || res.writableEnded) {
        return;
      }

      if (requestBehavior.statusCode >= 400) {
        responseCompleted = true;
        res.statusCode = requestBehavior.statusCode;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            error_code: requestBehavior.errorCode,
            message: requestBehavior.errorMessage,
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
        responseCompleted = true;
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
            choices: [{ index: 0, delta: { content: requestBehavior.replyText }, finish_reason: null }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl_integration',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'integration-chat-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { total_tokens: Math.max(requestBehavior.replyText.length, 1) },
          })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      responseCompleted = true;
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
              message: { role: 'assistant', content: requestBehavior.replyText },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    })().catch((error) => {
      responseCompleted = true;
      if (res.destroyed || res.writableEnded) {
        return;
      }
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
    getAbortedRequestCount: () => abortedRequestCount,
    releasePendingResponses,
    setReplyText: (value: string) => {
      behavior.replyText = value;
    },
    setHoldResponseOpen: (value: boolean) => {
      behavior.holdResponseOpen = value;
    },
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
