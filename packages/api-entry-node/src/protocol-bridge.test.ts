import { describe, expect, it } from 'vitest';
import {
  anthropicRequestToOpenAiChat,
  anthropicResponseToOpenAiChat,
  buildProxyBridgePlan,
  detectProxyWireProtocol,
  openAiChatRequestToAnthropic,
  openAiChatResponseToAnthropic,
  translateProxyResponsePayload,
} from './protocol-bridge.js';

describe('protocol bridge', () => {
  it('detects known wire protocols from proxy path', () => {
    expect(detectProxyWireProtocol('chat/completions')).toBe('openai_completion');
    expect(detectProxyWireProtocol('/responses/')).toBe('openai_responses');
    expect(detectProxyWireProtocol('messages')).toBe('anthropic');
  });

  it('converts openai chat request to anthropic messages request', () => {
    const translated = openAiChatRequestToAnthropic({
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'system', content: 'policy' },
        { role: 'user', content: 'hello' },
      ],
      max_tokens: 256,
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
        },
      ],
      tool_choice: 'required',
    });

    expect(translated.system).toBe('policy');
    expect(Array.isArray(translated.messages)).toBe(true);
    expect((translated.messages as Array<{ role: string }>)[0]?.role).toBe('user');
    expect((translated.tools as Array<{ name: string }>)[0]?.name).toBe('read_file');
    expect(translated.tool_choice).toEqual({ type: 'any' });
  });

  it('converts anthropic messages request to openai chat request', () => {
    const translated = anthropicRequestToOpenAiChat({
      model: 'glm-5',
      system: 'you are helpful',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
        },
      ],
      max_tokens: 128,
      tool_choice: { type: 'auto' },
    });

    expect((translated.messages as Array<{ role: string }>)[0]?.role).toBe('system');
    expect((translated.messages as Array<{ role: string }>)[1]?.role).toBe('user');
    expect(translated.max_tokens).toBe(128);
    expect(translated.tool_choice).toBe('auto');
  });

  it('converts anthropic response to openai response by bridge plan', () => {
    const plan = buildProxyBridgePlan({
      endpointProtocol: 'anthropic_compatible',
      proxyPath: 'chat/completions',
      upstreamUrl: 'https://api.anthropic.com/v1/messages',
      body: {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    const translated = JSON.parse(
      translateProxyResponsePayload(
        JSON.stringify({
          id: 'msg_1',
          model: 'claude-sonnet-4-5',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 5 },
        }),
        plan,
      ),
    ) as { object: string; choices: Array<{ message: { content: string } }>; usage: { total_tokens: number } };

    expect(translated.object).toBe('chat.completion');
    expect(translated.choices[0]?.message.content).toBe('hello');
    expect(translated.usage.total_tokens).toBe(8);
  });

  it('supports round-trip response conversion helpers', () => {
    const openAi = anthropicResponseToOpenAiChat(
      {
        id: 'msg_1',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      { model: 'claude-sonnet-4-5' },
    );

    const anthropic = openAiChatResponseToAnthropic(openAi, { model: 'claude-sonnet-4-5' });
    expect(anthropic.type).toBe('message');
    expect(Array.isArray(anthropic.content)).toBe(true);
  });

  it('normalizes anthropic upstream url to /v1/messages when missing version segment', () => {
    const plan = buildProxyBridgePlan({
      endpointProtocol: 'anthropic_compatible',
      proxyPath: 'chat/completions',
      upstreamUrl: 'https://open.bigmodel.cn/api/anthropic',
      body: {
        model: 'glm-5',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });

    expect(plan.upstreamUrl).toBe('https://open.bigmodel.cn/api/anthropic/v1/messages');
  });
});
