import { afterEach, describe, expect, it } from 'vitest';
import { startOpenAICompatibleUpstreamWith } from '../e2e/integration-chat-local-upstream';

type StartedUpstream = Awaited<ReturnType<typeof startOpenAICompatibleUpstreamWith>>;

const startedServers: StartedUpstream[] = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((entry) => new Promise<void>((resolve) => entry.server.close(() => resolve()))));
});

describe('integration chat local upstream', () => {
  it('returns OpenAI-compatible SSE chunks when the chat request asks for stream=true', async () => {
    const upstream = await startOpenAICompatibleUpstreamWith({ replyText: 'Story stream reply' });
    startedServers.push(upstream);

    const response = await fetch(`${upstream.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'integration-chat-model',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const payload = await response.text();
    expect(payload).toContain('"delta":{"content":"Story stream reply"}');
    expect(payload).toContain('[DONE]');
  });

  it('returns a non-stream chat completion payload when stream=false or omitted', async () => {
    const upstream = await startOpenAICompatibleUpstreamWith({ replyText: 'Plain reply' });
    startedServers.push(upstream);

    const response = await fetch(`${upstream.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'integration-chat-model',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({
      choices: [
        {
          message: {
            content: 'Plain reply',
          },
        },
      ],
    });
  });

  it('can listen broadly while advertising a workload-reachable host', async () => {
    const upstream = await startOpenAICompatibleUpstreamWith({
      replyText: 'Reachable reply',
      listenHost: '0.0.0.0',
      advertiseHost: 'localhost',
    });
    startedServers.push(upstream);

    expect(upstream.baseUrl).toMatch(/^http:\/\/localhost:\d+\/v1$/);
    const response = await fetch(`${upstream.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'integration-chat-model',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.ok).toBe(true);
  });
});
