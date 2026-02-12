import { describe, expect, it, vi } from 'vitest';
import { applyCors, proxyJsonRequest } from './http-utils.js';

describe('http-utils', () => {
  it('applyCors includes PUT in allowed methods', () => {
    const headers = new Map<string, string>();
    const res = {
      setHeader: (name: string, value: string) => {
        headers.set(name, value);
      },
    } as unknown as import('node:http').ServerResponse;

    applyCors(res);

    expect(headers.get('Access-Control-Allow-Methods')).toContain('PUT');
  });

  it('proxyJsonRequest overrides request model when model option is provided', async () => {
    const upstream = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ model: 'from-client', prompt: 'hello' }));
      },
    } as unknown as import('node:http').IncomingMessage;

    const headers = new Map<string, string>();
    const resLike = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      end: vi.fn(),
    };
    const res = resLike as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/chat/completions',
      apiKey: 'test-key',
      model: 'forced-model',
      timeoutSeconds: 5,
    });

    expect(upstream).toHaveBeenCalledTimes(1);
    const firstCall = upstream.mock.calls[0];
    expect(firstCall).toBeTruthy();
    const init = firstCall?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    expect(body.model).toBe('forced-model');

    vi.unstubAllGlobals();
  });
});
