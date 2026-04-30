import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownstreamAbortController } from './downstream-abort.js';
import { proxyJsonRequest } from './http-utils.js';

type MockIncomingMessage = EventEmitter & http.IncomingMessage & {
  aborted: boolean;
  complete: boolean;
  destroyed: boolean;
  socket: EventEmitter & {
    destroyed: boolean;
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  };
};

type MockServerResponse = EventEmitter & http.ServerResponse & {
  destroyed: boolean;
  writableDestroyed: boolean;
  writableEnded: boolean;
  writableFinished: boolean;
  socket: EventEmitter & {
    destroyed: boolean;
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  };
};

function createMockRequest(overrides?: Partial<Pick<MockIncomingMessage, 'aborted' | 'complete' | 'destroyed'>>): MockIncomingMessage {
  const socket = new EventEmitter() as MockIncomingMessage['socket'];
  socket.destroyed = false;

  const request = new EventEmitter() as MockIncomingMessage;
  request.headers = {};
  request.method = 'POST';
  request.aborted = overrides?.aborted ?? false;
  request.complete = overrides?.complete ?? true;
  request.destroyed = overrides?.destroyed ?? false;
  request.socket = socket;
  return request;
}

function createMockResponse(): MockServerResponse {
  const socket = new EventEmitter() as MockServerResponse['socket'];
  socket.destroyed = false;

  const response = new EventEmitter() as MockServerResponse;
  response.statusCode = 200;
  response.destroyed = false;
  response.writableDestroyed = false;
  response.writableEnded = false;
  response.writableFinished = false;
  response.socket = socket;
  response.setHeader = vi.fn();
  response.write = vi.fn(() => true);
  response.end = vi.fn(() => {
    response.writableEnded = true;
    response.writableFinished = true;
    response.emit('finish');
    return response;
  });
  return response;
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createDownstreamAbortController', () => {
  it('ignores request close after the request body completed and keeps downstream response listeners active', () => {
    const req = createMockRequest({ complete: true });
    const res = createMockResponse();

    const downstreamAbort = createDownstreamAbortController({
      req,
      res,
      requestClosedMessage: 'client_request_closed_after_body_complete',
      responseClosedMessage: 'client_response_closed_while_pending',
    });

    expect(res.listenerCount('close')).toBe(1);
    expect(res.socket.listenerCount('close')).toBe(1);

    req.emit('close');

    expect(downstreamAbort.signal.aborted).toBe(false);
    expect(res.listenerCount('close')).toBe(1);
    expect(res.socket.listenerCount('close')).toBe(1);

    res.emit('close');

    expect(downstreamAbort.signal.aborted).toBe(true);
    expect(downstreamAbort.signal.reason).toMatchObject({
      name: 'AbortError',
      message: 'client_response_closed_while_pending',
    });
    expect(res.listenerCount('close')).toBe(0);
    expect(res.socket.listenerCount('close')).toBe(0);
  });

  it('aborts when request close arrives before the request body completes', () => {
    const req = createMockRequest({ complete: false });
    const res = createMockResponse();

    const downstreamAbort = createDownstreamAbortController({
      req,
      res,
      requestClosedMessage: 'client_request_closed_before_body_complete',
    });

    req.emit('close');

    expect(downstreamAbort.signal.aborted).toBe(true);
    expect(downstreamAbort.signal.reason).toMatchObject({
      name: 'AbortError',
      message: 'client_request_closed_before_body_complete',
    });
  });

  it('does not abort when the response already finished before request close arrives', () => {
    const req = createMockRequest({ complete: true });
    const res = createMockResponse();

    const downstreamAbort = createDownstreamAbortController({
      req,
      res,
      requestClosedMessage: 'client_request_closed_after_body_complete',
    });

    res.writableEnded = true;
    res.writableFinished = true;
    res.emit('finish');
    req.emit('close');

    expect(downstreamAbort.signal.aborted).toBe(false);
  });

  it('does not treat an already-complete destroyed request as aborted before any downstream close signal', () => {
    const req = createMockRequest({
      complete: true,
      destroyed: true,
    });
    const res = createMockResponse();

    const downstreamAbort = createDownstreamAbortController({
      req,
      res,
      requestClosedMessage: 'client_request_closed_after_body_complete',
    });

    expect(downstreamAbort.signal.aborted).toBe(false);
  });

  it('aborts the pending upstream fetch when a real HTTP client disconnects after sending the full body', async () => {
    let resolveFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    let resolveUpstreamAborted: (() => void) | undefined;
    const upstreamAborted = new Promise<void>((resolve) => {
      resolveUpstreamAborted = resolve;
    });
    let upstreamSignal: AbortSignal | null | undefined;

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      upstreamSignal = init?.signal;
      resolveFetchStarted?.();
      init?.signal?.addEventListener('abort', () => {
        resolveUpstreamAborted?.();
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    let resolveProxyResult: ((value: unknown) => void) | undefined;
    const proxyResult = new Promise<unknown>((resolve) => {
      resolveProxyResult = resolve;
    });

    const server = createServer((req, res) => {
      void proxyJsonRequest(req, res, {
        upstreamUrl: 'http://example.com/v1/chat/completions',
        apiKey: 'test-key',
        timeoutSeconds: 60,
      }).then(
        (value) => resolveProxyResult?.(value),
        (error) => resolveProxyResult?.(error),
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('downstream_abort_test_server_address_unavailable');
      }

      const client = httpRequest({
        host: '127.0.0.1',
        port: (address as AddressInfo).port,
        method: 'POST',
        path: '/',
      });
      client.on('error', () => {
        // The disconnect is intentional for this regression case.
      });

      client.write(JSON.stringify({ prompt: 'hello' }));
      client.end();

      await fetchStarted;
      client.destroy();

      await upstreamAborted;
      await expect(proxyResult).resolves.toMatchObject({ name: 'AbortError' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(upstreamSignal?.aborted).toBe(true);
    } finally {
      await closeServer(server);
    }
  });
});
