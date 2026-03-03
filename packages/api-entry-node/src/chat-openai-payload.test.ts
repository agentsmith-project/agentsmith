import { describe, expect, it } from 'vitest';
import {
  parseOpenAIStreamChunk,
  safeAssistantContent,
  safeAssistantFinishReason,
  safeAssistantUsageTokens,
} from './chat-openai-payload.js';

describe('chat-openai-payload', () => {
  it('parses anthropic SSE text delta and stop event', () => {
    const stream = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
      '',
    ].join('\n');
    const chunks = parseOpenAIStreamChunk(stream);

    expect(chunks.some((item) => item.delta === 'Hello')).toBe(true);
    expect(chunks.some((item) => item.done && item.finishReason === 'stop')).toBe(true);
  });

  it('extracts content/finish/usage from anthropic non-stream response', () => {
    const payload = {
      id: 'msg_1',
      type: 'message',
      content: [{ type: 'text', text: 'Anthropic says hi.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 15 },
    };

    expect(safeAssistantContent(payload)).toBe('Anthropic says hi.');
    expect(safeAssistantFinishReason(payload)).toBe('stop');
    expect(safeAssistantUsageTokens(payload)).toBe(25);
  });
});
