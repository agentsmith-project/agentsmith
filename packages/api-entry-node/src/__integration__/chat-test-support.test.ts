import type { Server as HttpServer } from 'node:http';
import { Server as NetServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupChatUpstreamServers,
  startOpenAICompatibleUpstreamServer,
  startPassthroughUpstreamServer,
  startSlowOpenAICompatibleUpstreamServer,
  startUniversalProxyChatServer,
} from './chat-test-support.js';

type StartedUpstreamServer = {
  server: HttpServer;
  baseUrl: string;
};

type StartHelper = () => Promise<StartedUpstreamServer> | StartedUpstreamServer;

const upstreamHelpers = [
  {
    name: 'openai compatible upstream',
    expectedStatus: 404,
    start: () => startOpenAICompatibleUpstreamServer(),
  },
  {
    name: 'universal proxy upstream',
    expectedStatus: 404,
    start: () => startUniversalProxyChatServer(),
  },
  {
    name: 'passthrough upstream',
    expectedStatus: 200,
    start: () => startPassthroughUpstreamServer(),
  },
  {
    name: 'slow openai compatible upstream',
    expectedStatus: 404,
    start: () => startSlowOpenAICompatibleUpstreamServer(),
  },
] satisfies Array<{
  name: string;
  expectedStatus: number;
  start: StartHelper;
}>;

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupChatUpstreamServers();
});

describe('chat test support upstream helpers', () => {
  it.each(upstreamHelpers)('$name returns only after listening on an ephemeral loopback port', async ({
    expectedStatus,
    start,
  }) => {
    const originalListen = NetServer.prototype.listen;
    let releaseListen: (() => void) | null = null;

    const listenSpy = vi.spyOn(NetServer.prototype, 'listen').mockImplementation(function (
      this: NetServer,
      ...args: unknown[]
    ): NetServer {
      const [port, host] = args;
      if (typeof port !== 'number' || typeof host !== 'string') {
        throw new Error('unexpected_listen_signature');
      }
      releaseListen = () => {
        originalListen.call(this, port, host);
      };
      return this;
    });

    let resolved = false;
    const startedPromise = Promise.resolve(start()).then((started) => {
      resolved = true;
      return started;
    });

    await Promise.resolve();
    const resolvedBeforeListening = resolved;

    expect(listenSpy).toHaveBeenCalledTimes(1);
    expect(listenSpy.mock.calls[0]?.[0]).toBe(0);
    expect(listenSpy.mock.calls[0]?.[1]).toBe('127.0.0.1');
    expect(releaseListen).toBeTypeOf('function');

    releaseListen?.();
    const started = await startedPromise;

    expect(resolvedBeforeListening).toBe(false);

    const address = started.server.address();
    expect(address).not.toBeNull();
    expect(typeof address).not.toBe('string');
    if (!address || typeof address === 'string') {
      throw new Error('invalid_chat_test_server_address');
    }

    expect(new URL(started.baseUrl).port).toBe(String(address.port));

    const response = await fetch(`${started.baseUrl}/__ready__`);
    expect(response.status).toBe(expectedStatus);
  });
});
