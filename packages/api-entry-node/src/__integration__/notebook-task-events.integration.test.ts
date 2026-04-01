import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { apiFetch, startServer } from './test-support.js';

const sockets: WebSocket[] = [];

type ParsedDefaultSseBlock = {
  id: string | null;
  payload: Record<string, unknown> | null;
};

function parseDefaultSseBlocks(text: string): ParsedDefaultSseBlock[] {
  const blocks = text.split('\n\n').map((item) => item.trim()).filter(Boolean);
  const parsed: ParsedDefaultSseBlock[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const dataLine = lines.find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const idLine = lines.find((line) => line.startsWith('id:'));
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
    } catch {
      payload = null;
    }
    parsed.push({
      id: idLine ? idLine.slice('id:'.length).trim() : null,
      payload,
    });
  }
  return parsed;
}

async function readSseBlocks(
  response: Response,
  minBlocks: number,
  timeoutMs = 1_000,
): Promise<string> {
  const reader = response.body?.getReader();
  expect(reader).toBeTruthy();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;

  const countBlocks = (): number =>
    text
      .split('\n\n')
      .map((item) => item.trim())
      .filter(Boolean).length;

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader!.read(),
      new Promise<{ done: true; value?: undefined }>((resolve) => {
        setTimeout(() => resolve({ done: true }), remaining);
      }),
    ]);
    if (result.value) {
      text += decoder.decode(result.value, { stream: !result.done });
      if (countBlocks() >= minBlocks) {
        await reader?.cancel().catch(() => undefined);
        return text;
      }
    }
    if (result.done) {
      break;
    }
  }

  await reader?.cancel().catch(() => undefined);
  return text;
}

afterEach(() => {
  for (const socket of sockets) {
    try {
      socket.close();
    } catch {
      // ignore cleanup failures in tests
    }
  }
  sockets.length = 0;
});

describe('api-entry-node notebook task event routes', () => {
  it('replays buffered task events after last_event_id for notebook task SSE', async () => {
    const { baseUrl } = startServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-key',
          type: 'api_key',
          value: 'sk-placeholder-test',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-coding',
          type: 'catalog',
          provider_family: 'glm',
          upstream_protocol: 'openai_chat_completions',
          status: 'active',
          wire_api: 'responses',
          base_url: 'https://example.com',
          model: 'placeholder-model',
          model_profile: {
            max_context_tokens: 204800,
            max_output_tokens: 128000,
            supports_file: false,
            supports_tool_call: true,
            supports_reasoning: false,
            price_input_per_1m: 0,
            price_output_per_1m: 0,
            cache_read_discount_ratio: 0,
            cache_write_discount_ratio: 0,
          },
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createAgent = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'External notebook agent',
          mode: 'external',
          interaction_mode: 'notebook',
          execution_preferences: {
            notebook: {
              endpoint_id: endpoint.id,
              wire_api: 'responses',
              model: 'placeholder-model',
            },
          },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgent.status).toBe(201);
    const agent = (await createAgent.json()) as { id: string };

    const createAgentKeyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(createAgentKeyRes.status).toBe(201);
    const agentKey = (await createAgentKeyRes.json()) as { key: string };

    const connectionInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connectionInfoRes.status).toBe(200);
    const connectionInfo = (await connectionInfoRes.json()) as { ws_url: string };

    const executionSocket = new WebSocket(
      connectionInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );
    sockets.push(executionSocket);

    const executionChannelReady = new Promise<void>((resolve) => {
      executionSocket.on('open', () => {
        executionSocket.send(
          JSON.stringify({
            type: 'agent.ready',
            payload: {
              capabilities: { mode: 'external', wire_api: 'responses' },
            },
          }),
        );
        resolve();
      });
    });

    executionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      executionSocket.send(JSON.stringify({
        type: 'agent.response.event',
        request_id: msg.request_id,
        payload: {
          sequence: 1,
          at: new Date().toISOString(),
          category: 'progress',
          phase: 'start',
          status: 'running',
          name: 'codex.exec',
          summary: 'Starting',
        },
      }));
      executionSocket.send(JSON.stringify({
        type: 'agent.response.event',
        request_id: msg.request_id,
        payload: {
          sequence: 2,
          at: new Date().toISOString(),
          category: 'progress',
          phase: 'update',
          status: 'running',
          name: 'codex.exec',
          summary: 'Halfway',
        },
      }));
      executionSocket.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 1 },
      }));
    });

    await executionChannelReady;

    const createLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Task SSE replay workspace' }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const workspaceLibrary = (await createLibraryRes.json()) as { id: string };

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Task SSE replay',
          agent_id: agent.id,
          workspace_file_library_id: workspaceLibrary.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'run' }) },
    );
    expect(postMessageRes.status).toBe(200);

    const replayRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/events?last_event_id=1`,
    );
    expect(replayRes.status).toBe(200);
    expect(replayRes.headers.get('content-type')).toContain('text/event-stream');
    const replayText = await readSseBlocks(replayRes, 2, 4_000);
    const replayBlocks = parseDefaultSseBlocks(replayText).filter(
      (item) => item.payload && item.payload.type !== 'ping',
    );
    expect(replayBlocks.some((item) => item.payload?.type === 'trace_event')).toBe(true);
    expect(replayText).toContain('Halfway');
    expect(replayBlocks.some((item) => item.payload?.type === 'task_update')).toBe(true);
  });
});
