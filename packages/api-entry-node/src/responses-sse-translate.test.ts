import { describe, expect, it } from 'vitest';
import type http from 'node:http';
import { pipeTranslatedChatSseAsResponses } from './responses-sse-translate.js';

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function createFakeResponse() {
  const writes: string[] = [];
  const res = {
    writableEnded: false,
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end() {
      (res as { writableEnded: boolean }).writableEnded = true;
      return res as unknown as http.ServerResponse;
    },
  } as unknown as http.ServerResponse & { writableEnded: boolean };
  return { res, writes };
}

describe('responses-sse-translate', () => {
  it('translates simple chat SSE content into responses SSE events', async () => {
    const upstream = [
      'data: {"id":"chatcmpl_1","created":1,"model":"placeholder-model","choices":[{"delta":{"content":"hi"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const { res, writes } = createFakeResponse();

    await pipeTranslatedChatSseAsResponses(streamFromText(upstream), res, { model: 'placeholder-model' });

    const payload = writes.join('');
    expect(payload).toContain('event: response.created');
    expect(payload).toContain('event: response.output_text.delta');
    expect(payload).toContain('"delta":"hi"');
    expect(payload).toContain('event: response.completed');
  });

  it('emits terminal completed response with error when upstream SSE contains error payload', async () => {
    const upstream = [
      'data: {"error":{"message":"upstream busy"}}',
      '',
    ].join('\n');
    const { res, writes } = createFakeResponse();

    await pipeTranslatedChatSseAsResponses(streamFromText(upstream), res, { model: 'placeholder-model' });

    const payload = writes.join('');
    expect(payload).toContain('event: response.completed');
    expect(payload).toContain('"UPSTREAM_STREAM_ERROR"');
    expect(payload).toContain('upstream busy');
  });
});

