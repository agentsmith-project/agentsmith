import { WebSocket } from 'ws';

const wsUrl = process.env.MBOS_AGENT_WS_URL;
const key = process.env.MBOS_AGENT_KEY;

if (!wsUrl || !key) {
  process.stderr.write('Usage: MBOS_AGENT_WS_URL=ws://... MBOS_AGENT_KEY=ask_xxx tsx packages/api-entry-node/examples/external-agent-echo.ts\n');
  process.exit(1);
}

const ws = new WebSocket(wsUrl, {
  headers: { Authorization: `Bearer ${key}` },
});

ws.on('open', () => {
  process.stdout.write('[echo-agent] connected\n');
  ws.send(JSON.stringify({
    type: 'agent.ready',
    timestamp: new Date().toISOString(),
    payload: {
      capabilities: {
        streaming_completion: true,
        multimodal_completion: true,
      },
    },
  }));
});

ws.on('message', (raw) => {
  let msg: { type?: string; request_id?: string; payload?: { messages?: Array<{ role?: string; content?: unknown }> } };
  try {
    msg = JSON.parse(raw.toString('utf-8')) as {
      type?: string;
      request_id?: string;
      payload?: { messages?: Array<{ role?: string; content?: unknown }> };
    };
  } catch {
    return;
  }

  if (msg.type === 'server.ping') {
    ws.send(JSON.stringify({ type: 'agent.pong', timestamp: new Date().toISOString(), payload: {} }));
    return;
  }

  if (msg.type !== 'server.request.start' || !msg.request_id) {
    return;
  }

  const messages = msg.payload?.messages ?? [];
  const lastUser = [...messages].reverse().find((item) => item.role === 'user');
  const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
  const response = `echo: ${text}`;

  const words = response.split(/\s+/).filter(Boolean);
  for (const word of words) {
    ws.send(JSON.stringify({
      type: 'agent.response.delta',
      request_id: msg.request_id,
      timestamp: new Date().toISOString(),
      payload: { delta: `${word} ` },
    }));
  }

  ws.send(JSON.stringify({
    type: 'agent.response.done',
    request_id: msg.request_id,
    timestamp: new Date().toISOString(),
    payload: { finish_reason: 'stop' },
  }));
});

ws.on('close', () => {
  process.stdout.write('[echo-agent] disconnected\n');
});

ws.on('error', (error) => {
  process.stderr.write(`[echo-agent] error: ${error instanceof Error ? error.message : 'unknown'}\n`);
});
