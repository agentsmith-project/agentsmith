import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  buildEndpointProxyUrl,
  buildProxyRequestBody,
  requestChatProxyCompletion,
} from './proxy-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('proxy-client', () => {
  it('builds a chat completions proxy url from execution context', () => {
    expect(buildEndpointProxyUrl({
      api_base: 'http://localhost:20000/api/v1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      endpoint_id: 'ep_chat',
      wire_api: 'chat',
    })).toBe(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_chat/proxy/openai/chat/completions',
    );
  });

  it('builds a responses proxy url from execution context', () => {
    expect(buildEndpointProxyUrl({
      api_base: 'http://localhost:20000/api/v1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      endpoint_id: 'ep_chat',
      wire_api: 'responses',
    })).toBe(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_chat/proxy/openai/responses',
    );
  });

  it('builds an anthropic messages proxy url from execution context', () => {
    expect(buildEndpointProxyUrl({
      api_base: 'http://localhost:20000/api/v1',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      endpoint_id: 'ep_chat',
      wire_api: 'anthropic_messages',
    })).toBe(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_chat/proxy/anthropic/messages',
    );
  });

  it('builds chat wire_api request bodies without modifying messages', () => {
    expect(buildProxyRequestBody({
      model: 'gpt-4.1',
      executionContext: { wire_api: 'chat' },
      messages: [
        { role: 'system', content: 'You are concise.' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    })).toEqual({
      model: 'gpt-4.1',
      stream: false,
      messages: [
        { role: 'system', content: 'You are concise.' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    });
  });

  it('builds responses wire_api input with text and image parts', () => {
    expect(buildProxyRequestBody({
      model: 'gpt-4.1',
      executionContext: { wire_api: 'responses' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
          ],
        },
      ],
    })).toEqual({
      model: 'gpt-4.1',
      stream: false,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'describe this' },
            { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
          ],
        },
      ],
    });
  });

  it('builds anthropic_messages request bodies with top-level system and content blocks', () => {
    expect(buildProxyRequestBody({
      model: 'claude-sonnet-4-5',
      executionContext: { wire_api: 'anthropic_messages' },
      messages: [
        { role: 'system', content: 'You are concise.' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: 'hi there' },
      ],
    })).toEqual({
      model: 'claude-sonnet-4-5',
      stream: false,
      max_tokens: 1024,
      system: 'You are concise.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
      ],
    });
  });

  it('requests chat completions and parses assistant text', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'hello from chat runner' } }],
      usage: { total_tokens: 33 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestChatProxyCompletion({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hello' }],
      executionContext: {
        api_base: 'http://localhost:20000/api/v1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        endpoint_id: 'ep_chat',
        execution_ticket: 'exec_123',
        wire_api: 'chat',
      },
    })).resolves.toEqual({
      text: 'hello from chat runner',
      usageTokens: 33,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_chat/proxy/openai/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer exec_123',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('requests responses wire_api and parses output_text', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output_text: 'hello from responses',
      usage: { total_tokens: 41 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestChatProxyCompletion({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hello' }],
      executionContext: {
        api_base: 'http://localhost:20000/api/v1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        endpoint_id: 'ep_chat',
        execution_ticket: 'exec_123',
        wire_api: 'responses',
      },
    })).resolves.toEqual({
      text: 'hello from responses',
      usageTokens: 41,
    });
  });

  it('requests anthropic_messages wire_api and parses content blocks with usage totals', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'msg_1',
      type: 'message',
      content: [{ type: 'text', text: 'hello from anthropic' }],
      usage: { input_tokens: 13, output_tokens: 21 },
      stop_reason: 'end_turn',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestChatProxyCompletion({
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'system', content: 'Answer briefly.' },
        { role: 'user', content: 'hello' },
      ],
      executionContext: {
        api_base: 'http://localhost:20000/api/v1',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        endpoint_id: 'ep_chat',
        execution_ticket: 'exec_123',
        wire_api: 'anthropic_messages',
      },
    })).resolves.toEqual({
      text: 'hello from anthropic',
      usageTokens: 34,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:20000/api/v1/workspaces/ws_default/projects/proj_1/endpoints/ep_chat/proxy/anthropic/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer exec_123',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          stream: false,
          max_tokens: 1024,
          system: 'Answer briefly.',
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'hello' }],
            },
          ],
        }),
      }),
    );
  });
});
