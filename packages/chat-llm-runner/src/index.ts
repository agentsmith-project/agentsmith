import { WebSocket } from 'ws';
import {
  CHAT_RUNNER_SPEC,
  type AgentEnvelope,
  type AgentServerStartPayload,
} from '@mbos/agent-runner';
import { selectLatestUserText } from './message-selection.js';
import { requestChatProxyCompletion } from './proxy-client.js';
import { ChatSessionWorkspaceManager, isChatConversationContinuation } from './session-workdir.js';

const wsUrl = process.env.MBOS_AGENT_WS_URL;
const key = process.env.MBOS_AGENT_KEY;

if (!wsUrl || !key) {
  process.stderr.write(
    'Usage: MBOS_AGENT_WS_URL=ws://... MBOS_AGENT_KEY=ask_xxx npm run dev -w @mbos/chat-llm-runner\n',
  );
  process.exit(1);
}

const ws = new WebSocket(wsUrl, {
  headers: { Authorization: `Bearer ${key}` },
});
const sessionWorkspaceManager = new ChatSessionWorkspaceManager();

function sendDone(requestId: string, usage: number) {
  ws.send(JSON.stringify({
    type: 'agent.response.done',
    request_id: requestId,
    timestamp: new Date().toISOString(),
    payload: { finish_reason: 'stop', usage_tokens: usage },
  }));
}

function sendError(requestId: string, error: unknown) {
  const message = error instanceof Error ? error.message : 'chat_runner_upstream_error';
  ws.send(JSON.stringify({
    type: 'agent.response.error',
    request_id: requestId,
    timestamp: new Date().toISOString(),
    payload: {
      error_code: 'CHAT_RUNNER_UPSTREAM_ERROR',
      error_message: message,
    },
  }));
}

function sendWarningEvent(requestId: string, args: { name: string; summary: string; details?: Record<string, unknown> }) {
  ws.send(JSON.stringify({
    type: 'agent.response.event',
    request_id: requestId,
    timestamp: new Date().toISOString(),
    payload: {
      sequence: 1,
      at: new Date().toISOString(),
      category: 'warning',
      phase: 'update',
      status: 'running',
      name: args.name,
      summary: args.summary,
      ...(args.details ? { details: args.details } : {}),
    },
  }));
}

ws.on('open', () => {
  process.stdout.write('[chat-llm-runner] connected\n');
  ws.send(JSON.stringify({
    type: 'agent.ready',
    timestamp: new Date().toISOString(),
    payload: {
      runner_spec: CHAT_RUNNER_SPEC,
      capabilities: {
        streaming_completion: true,
        multimodal_completion: true,
      },
      request_details: {
        executor: 'llm_passthrough',
        wire_api: 'chat',
      },
    },
  }));
});

ws.on('message', async (raw) => {
  let message: AgentEnvelope;
  try {
    message = JSON.parse(raw.toString('utf-8')) as AgentEnvelope;
  } catch {
    return;
  }

  if (message.type === 'server.ping') {
    ws.send(JSON.stringify({ type: 'agent.pong', timestamp: new Date().toISOString(), payload: {} }));
    return;
  }

  if (message.type !== 'server.request.start' || !message.request_id) return;

  const payload = (message.payload ?? {}) as AgentServerStartPayload;
  try {
    const sessionId = typeof payload.execution_context?.session_id === 'string'
      ? payload.execution_context.session_id
      : '';
    if (sessionId) {
      const workspaceState = await sessionWorkspaceManager.ensureSessionWorkspace(
        sessionId,
        isChatConversationContinuation(payload.messages),
      );
      if (workspaceState.recreated) {
        sendWarningEvent(message.request_id, {
          name: 'session.workspace_recreated',
          summary: 'chat_session_workspace_recreated',
          details: {
            session_id: sessionId,
            reclaim_reason: 'workspace_missing',
          },
        });
      }
    }
    const completion = await requestChatProxyCompletion({
      model: payload.model,
      messages: payload.messages,
      executionContext: (payload.execution_context ?? {}) as NonNullable<AgentServerStartPayload['execution_context']>,
    });
    const response = completion.text || selectLatestUserText(payload.messages) || 'chat runner ready';
    ws.send(JSON.stringify({
      type: 'agent.response.delta',
      request_id: message.request_id,
      timestamp: new Date().toISOString(),
      payload: { delta: response },
    }));
    sendDone(message.request_id, completion.usageTokens ?? response.length);
  } catch (error) {
    sendError(message.request_id, error);
  }
});

ws.on('close', () => {
  sessionWorkspaceManager.close();
  process.stdout.write('[chat-llm-runner] disconnected\n');
});

ws.on('error', (error) => {
  process.stderr.write(`[chat-llm-runner] error: ${error instanceof Error ? error.message : 'unknown'}\n`);
});
