import { WebSocket } from 'ws';

type AgentMessage = {
  type?: string;
  request_id?: string;
  payload?: {
    messages?: Array<{ role?: string; content?: unknown }>;
  };
};

const wsUrl = process.env.MBOS_AGENT_WS_URL;
const key = process.env.MBOS_AGENT_KEY;
const mode = process.env.MBOS_AGENT_MODE ?? 'echo';

if (!wsUrl || !key) {
  process.stderr.write(
    'Usage: MBOS_AGENT_WS_URL=ws://... MBOS_AGENT_KEY=ask_xxx [MBOS_AGENT_MODE=echo|multimodal] tsx packages/api-entry-node/examples/external-agent-test-runner.ts\n',
  );
  process.exit(1);
}

const ws = new WebSocket(wsUrl, {
  headers: { Authorization: `Bearer ${key}` },
});

function sendDone(requestId: string) {
  ws.send(
    JSON.stringify({
      type: 'agent.response.done',
      request_id: requestId,
      timestamp: new Date().toISOString(),
      payload: { finish_reason: 'stop' },
    }),
  );
}

ws.on('open', () => {
  process.stdout.write('[test-agent] connected\n');
  ws.send(
    JSON.stringify({
      type: 'agent.ready',
      timestamp: new Date().toISOString(),
      payload: {
        capabilities: {
          streaming_completion: true,
          multimodal_completion: mode === 'multimodal',
        },
      },
    }),
  );
});

ws.on('message', (raw) => {
  let msg: AgentMessage;
  try {
    msg = JSON.parse(raw.toString('utf-8')) as AgentMessage;
  } catch {
    return;
  }

  if (msg.type === 'server.ping') {
    ws.send(JSON.stringify({ type: 'agent.pong', timestamp: new Date().toISOString(), payload: {} }));
    return;
  }

  if (msg.type === 'server.request.cancel') {
    return;
  }

  if (msg.type !== 'server.request.start' || !msg.request_id) {
    return;
  }

  const messages = msg.payload?.messages ?? [];
  const lastUser = [...messages].reverse().find((item) => item.role === 'user');
  const content = lastUser?.content;

  if (mode === 'multimodal' && Array.isArray(content)) {
    const hasImage = content.some(
      (part) =>
        typeof part === 'object'
        && part !== null
        && (part as { type?: string }).type === 'image_url',
    );
    const text = hasImage ? 'saw image attachment' : 'no image attachment';
    ws.send(
      JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        timestamp: new Date().toISOString(),
        payload: { delta: text },
      }),
    );
    sendDone(msg.request_id);
    return;
  }

  const userText = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  const response = `echo: ${userText}`;
  const chunks = ['echo: ', response.replace(/^echo:\s*/, '')];
  for (const chunk of chunks) {
    ws.send(
      JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        timestamp: new Date().toISOString(),
        payload: { delta: chunk },
      }),
    );
  }
  sendDone(msg.request_id);
});

ws.on('close', () => {
  process.stdout.write('[test-agent] disconnected\n');
});

ws.on('error', (error) => {
  process.stderr.write(`[test-agent] error: ${error instanceof Error ? error.message : 'unknown'}\n`);
});
