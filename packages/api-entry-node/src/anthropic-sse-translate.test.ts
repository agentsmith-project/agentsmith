import { describe, expect, it } from 'vitest';
import {
  pipeAnthropicSseAsResponses,
  pipeAnthropicSseAsOpenAiChat,
  pipeOpenAiChatSseAsAnthropic,
} from './anthropic-sse-translate.js';

function buildResCollector(): {
  res: import('node:http').ServerResponse;
  getOutput: () => string;
} {
  let out = '';
  const res = {
    write(chunk: string | Uint8Array) {
      out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    },
    end(chunk?: string | Uint8Array) {
      if (chunk) {
        out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
      }
    },
  } as unknown as import('node:http').ServerResponse;
  return { res, getOutput: () => out };
}

describe('anthropic SSE translators', () => {
  it('translates anthropic SSE into openai chat SSE', async () => {
    const encoder = new TextEncoder();
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-5","usage":{"input_tokens":3,"output_tokens":0}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    });

    const { res, getOutput } = buildResCollector();
    await pipeAnthropicSseAsOpenAiChat(stream, res, { model: 'claude-sonnet-4-5', stream: true });
    const output = getOutput();

    expect(output).toContain('"object":"chat.completion.chunk"');
    expect(output).toContain('"content":"Hello"');
    expect(output).toContain('"finish_reason":"stop"');
    expect(output).toContain('data: [DONE]');
  });

  it('translates openai chat SSE into anthropic SSE', async () => {
    const encoder = new TextEncoder();
    const sse = [
      'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"placeholder-model","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi "},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"placeholder-model","choices":[{"index":0,"delta":{"content":"there"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    });

    const { res, getOutput } = buildResCollector();
    await pipeOpenAiChatSseAsAnthropic(stream, res, { model: 'placeholder-model', stream: true });
    const output = getOutput();

    expect(output).toContain('event: message_start');
    expect(output).toContain('event: content_block_delta');
    expect(output).toContain('"text":"Hi "');
    expect(output).toContain('"text":"there"');
    expect(output).toContain('event: message_stop');
  });

  it('translates anthropic SSE into openai responses SSE', async () => {
    const encoder = new TextEncoder();
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_2","model":"claude-sonnet-4-5","usage":{"input_tokens":2,"output_tokens":0}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello responses"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse));
        controller.close();
      },
    });

    const { res, getOutput } = buildResCollector();
    await pipeAnthropicSseAsResponses(stream, res, { model: 'claude-sonnet-4-5', stream: true });
    const output = getOutput();

    expect(output).toContain('event: response.created');
    expect(output).toContain('event: response.output_text.delta');
    expect(output).toContain('Hello responses');
    expect(output).toContain('event: response.completed');
    expect(output).toContain('data: [DONE]');
  });
});
