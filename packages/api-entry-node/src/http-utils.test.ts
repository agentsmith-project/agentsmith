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
      return new Response(JSON.stringify({ ok: true, usage: { total_tokens: 123 } }), {
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

    const result = await proxyJsonRequest(req, res, {
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
    expect(result.tokens_total).toBe(123);

    vi.unstubAllGlobals();
  });

  it('falls back responses API requests to chat completions for openai-compatible providers', async () => {
    const upstream = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://example.com/v1/chat/completions');
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        model?: string;
        messages?: Array<{ role: string; content: string }>;
      };
      expect(body.model).toBe('glm-4.7');
      expect(body.messages?.[0]?.role).toBe('system');
      expect(body.messages?.[0]?.content).toBe('You are helpful');
      expect(body.messages?.[1]?.role).toBe('user');
      expect(body.messages?.[1]?.content).toBe('Hello');

      return new Response(
        JSON.stringify({
          id: 'chatcmpl_123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'glm-4.7',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hi there' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(
          JSON.stringify({
            model: 'glm-4.7',
            instructions: 'You are helpful',
            input: [
              {
                role: 'user',
                content: [{ type: 'input_text', text: 'Hello' }],
              },
            ],
          }),
        );
      },
    } as unknown as import('node:http').IncomingMessage;

    const headers = new Map<string, string>();
    let responseBody = '';
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      end(payload?: string | Buffer) {
        responseBody = Buffer.isBuffer(payload) ? payload.toString('utf-8') : String(payload ?? '');
      },
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/responses',
      apiKey: 'test-key',
      timeoutSeconds: 5,
      responsesFallbackToChat: true,
    });

    expect(upstream).toHaveBeenCalledTimes(1);
    const translated = JSON.parse(responseBody) as {
      object: string;
      output_text?: string;
      output?: Array<{ type: string; role: string }>;
    };
    expect(translated.object).toBe('response');
    expect(translated.output_text).toBe('Hi there');
    expect(translated.output?.[0]?.type).toBe('message');
    expect(translated.output?.[0]?.role).toBe('assistant');
    expect(headers.get('content-type')).toContain('application/json');

    vi.unstubAllGlobals();
  });

  it('maps responses function_call_output items into chat tool messages', async () => {
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        messages?: Array<Record<string, unknown>>;
      };
      expect(body.messages).toEqual([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"ok":true}',
        },
      ]);
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_x',
          object: 'chat.completion',
          created: 1,
          model: 'glm-4.7',
          choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(
          JSON.stringify({
            model: 'glm-4.7',
            input: [
              { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.txt"}' },
              { type: 'function_call_output', call_id: 'call_1', output: { ok: true } },
            ],
          }),
        );
      },
    } as unknown as import('node:http').IncomingMessage;

    const res = {
      statusCode: 0,
      setHeader() {},
      end() {},
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/chat/completions',
      apiKey: 'test-key',
      responsesFallbackToChat: true,
    });

    expect(upstream).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('maps chat tool_calls into responses function_call output items', async () => {
    const upstream = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_tools',
          object: 'chat.completion',
          created: 123,
          model: 'glm-4.7',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_abc',
                    type: 'function',
                    function: { name: 'shell', arguments: '{"cmd":"pwd"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ model: 'glm-4.7', input: 'hi' }));
      },
    } as unknown as import('node:http').IncomingMessage;

    let responseBody = '';
    const res = {
      statusCode: 0,
      setHeader() {},
      end(payload?: string | Buffer) {
        responseBody = Buffer.isBuffer(payload) ? payload.toString('utf-8') : String(payload ?? '');
      },
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/chat/completions',
      apiKey: 'test-key',
      responsesFallbackToChat: true,
    });

    const translated = JSON.parse(responseBody) as {
      output?: Array<Record<string, unknown>>;
      output_text?: string;
    };
    expect(Array.isArray(translated.output)).toBe(true);
    expect(translated.output_text).toBe('');
    const fc = translated.output?.find((item) => item.type === 'function_call');
    expect(fc).toBeTruthy();
    expect(fc?.call_id).toBe('call_abc');
    expect(fc?.name).toBe('shell');

    vi.unstubAllGlobals();
  });

  it('drops unsupported built-in responses tools when translating to chat tools', async () => {
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        tools?: Array<Record<string, unknown>>;
        tool_choice?: unknown;
      };
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.tools?.length).toBe(1);
      expect(body.tools?.[0]?.type).toBe('function');
      expect(body.tool_choice).toBe('auto');
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_ok',
          object: 'chat.completion',
          created: 1,
          model: 'glm-4.7',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(
          JSON.stringify({
            model: 'glm-4.7',
            input: 'hi',
            tools: [
              { type: 'web_search' },
              { type: 'function', name: 'shell', parameters: { type: 'object', properties: {} } },
            ],
            tool_choice: { type: 'function', name: 'web_search' },
          }),
        );
      },
    } as unknown as import('node:http').IncomingMessage;

    const res = {
      statusCode: 0,
      setHeader() {},
      end() {},
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/chat/completions',
      apiKey: 'test-key',
      responsesFallbackToChat: true,
    });

    expect(upstream).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('normalizes developer role to system when translating responses input to chat messages', async () => {
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      expect(body.messages?.[0]?.role).toBe('system');
      expect(body.messages?.[1]?.role).toBe('user');
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_dev',
          object: 'chat.completion',
          created: 1,
          model: 'glm-4.7',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(
          JSON.stringify({
            model: 'glm-4.7',
            input: [
              { role: 'developer', content: [{ type: 'input_text', text: 'internal policy' }] },
              { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
            ],
          }),
        );
      },
    } as unknown as import('node:http').IncomingMessage;

    const res = {
      statusCode: 0,
      setHeader() {},
      end() {},
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/responses',
      apiKey: 'test-key',
      responsesFallbackToChat: true,
    });

    expect(upstream).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('preserves function tool_choice when target function survives tool filtering', async () => {
    const upstream = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        tool_choice?: unknown;
        tools?: Array<Record<string, unknown>>;
      };
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.tools?.length).toBe(1);
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'shell' } });
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_tool_choice',
          object: 'chat.completion',
          created: 1,
          model: 'glm-4.7',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(
          JSON.stringify({
            model: 'glm-4.7',
            input: 'hi',
            tools: [{ type: 'function', name: 'shell', parameters: { type: 'object', properties: {} } }],
            tool_choice: { type: 'function', name: 'shell' },
          }),
        );
      },
    } as unknown as import('node:http').IncomingMessage;

    const res = {
      statusCode: 0,
      setHeader() {},
      end() {},
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/responses',
      apiKey: 'test-key',
      responsesFallbackToChat: true,
    });

    expect(upstream).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('translates upstream chat SSE into responses SSE in real streaming mode', async () => {
    const encoder = new TextEncoder();
    const sseText = [
      'data: {"id":"chatcmpl_stream","object":"chat.completion.chunk","created":123,"model":"glm-4.7","choices":[{"index":0,"delta":{"role":"assistant","content":"chain "},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl_stream","object":"chat.completion.chunk","created":123,"model":"glm-4.7","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const upstream = vi.fn(async (_url: string, _init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sseText));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(
          JSON.stringify({
            model: 'glm-4.7',
            stream: true,
            input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
          }),
        );
      },
    } as unknown as import('node:http').IncomingMessage;

    const headers = new Map<string, string>();
    let sseOut = '';
    const res = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      write(chunk: string) {
        sseOut += chunk;
      },
      end(chunk?: string | Buffer) {
        if (chunk) {
          sseOut += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
        }
      },
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/responses',
      apiKey: 'test-key',
      responsesFallbackToChat: true,
    });

    expect(headers.get('content-type')).toContain('text/event-stream');
    expect(sseOut).toContain('event: response.created');
    expect(sseOut).toContain('event: response.output_text.delta');
    expect(sseOut).toContain('chain ');
    expect(sseOut).toContain('event: response.completed');

    vi.unstubAllGlobals();
  });

  it('supports CRLF SSE separators when translating streaming chat to responses SSE', async () => {
    const encoder = new TextEncoder();
    const sseText = [
      'data: {"id":"chatcmpl_stream","created":123,"model":"glm-4.7","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\r\n');

    const upstream = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sseText));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ model: 'glm-4.7', stream: true, input: 'hi' }));
      },
    } as unknown as import('node:http').IncomingMessage;

    let out = '';
    const res = {
      statusCode: 0,
      setHeader() {},
      write(chunk: string) {
        out += chunk;
      },
      end(chunk?: string | Buffer) {
        if (chunk) out += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
      },
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/responses',
      apiKey: 'k',
      responsesFallbackToChat: true,
    });

    expect(out).toContain('event: response.completed');
    expect(out).toContain('"output_text":"ok"');
    vi.unstubAllGlobals();
  });

  it('streams tool_call argument deltas and finalizes merged arguments across chunks', async () => {
    const encoder = new TextEncoder();
    const sseText = [
      'data: {"id":"chatcmpl_tools_stream","created":123,"model":"glm-4.7","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_shell","function":{"name":"shell","arguments":"{\\"cmd\\":"}}]},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl_tools_stream","created":123,"model":"glm-4.7","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"pwd\\"}"}}]},"finish_reason":"tool_calls"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const upstream = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sseText));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ model: 'glm-4.7', stream: true, input: 'hi' }));
      },
    } as unknown as import('node:http').IncomingMessage;

    let out = '';
    const res = {
      statusCode: 0,
      setHeader() {},
      write(chunk: string) {
        out += chunk;
      },
      end(chunk?: string | Buffer) {
        if (chunk) out += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
      },
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/responses',
      apiKey: 'k',
      responsesFallbackToChat: true,
    });

    expect(out).toContain('event: response.function_call_arguments.delta');
    expect(out).toContain('event: response.function_call_arguments.done');
    expect(out).toContain('"name":"shell"');
    expect(out).toContain('"arguments":"{\\"cmd\\":\\"pwd\\"}"');
    expect(out).toContain('event: response.completed');
    vi.unstubAllGlobals();
  });

  it('emits terminal responses event on upstream SSE error payload', async () => {
    const encoder = new TextEncoder();
    const sseText = [
      'data: {"error":{"message":"upstream bad"}}',
      '',
    ].join('\n');

    const upstream = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sseText));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', upstream);

    const req = {
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ model: 'glm-4.7', stream: true, input: 'hi' }));
      },
    } as unknown as import('node:http').IncomingMessage;

    let out = '';
    const res = {
      statusCode: 0,
      setHeader() {},
      write(chunk: string) {
        out += chunk;
      },
      end(chunk?: string | Buffer) {
        if (chunk) out += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
      },
      get writableEnded() {
        return false;
      },
    } as unknown as import('node:http').ServerResponse;

    await proxyJsonRequest(req, res, {
      upstreamUrl: 'http://example.com/v1/responses',
      apiKey: 'k',
      responsesFallbackToChat: true,
    });

    expect(out).toContain('event: response.completed');
    expect(out).toContain('UPSTREAM_STREAM_ERROR');
    expect(out).toContain('upstream bad');
    vi.unstubAllGlobals();
  });
});
