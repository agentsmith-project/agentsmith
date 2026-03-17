import type http from 'node:http';
import type { NodeApiDeps } from '../node-api-deps.js';
import type { TaskListItem, TaskRecord } from './task-models.js';
import { loadTaskArtifacts, loadTaskMessages } from './task-store.js';
import { ACTIVE_RUNS_BY_TASK, getTaskArtifacts, getTaskMessages } from './task-runtime-state.js';

export async function buildTaskRealtimeView(
  deps: NodeApiDeps,
  workspaceId: string,
  projectId: string,
  task: TaskRecord,
): Promise<TaskListItem> {
  await Promise.all([
    loadTaskMessages(deps, task.id),
    loadTaskArtifacts(deps, task.id),
  ]);
  const messages = getTaskMessages(task.id);
  const artifacts = getTaskArtifacts(task.id);
  const userTurnCount = messages.filter((item) => item.role === 'user').length;
  const agent = await deps.agentResourceService.getAgent(workspaceId, projectId, task.agent_id);
  const agentPresence: TaskListItem['agent_presence'] = (
    !agent ? 'unknown'
    : agent.mode === 'internal' ? 'managed'
    : (agent.presence === 'online' ? 'online' : 'offline')
  );
  return {
    ...task,
    agent_presence: agentPresence,
    run_state: ACTIVE_RUNS_BY_TASK.has(task.id) ? 'running' : 'idle',
    stats: {
      user_turn_count: userTurnCount,
      message_count: messages.length,
      artifact_count: artifacts.length,
      attached_input_count: task.attached_inputs.length,
    },
  };
}

export function mapTaskMessagesForExecution(taskId: string, assistantMessageId: string): Array<Record<string, unknown>> {
  return getTaskMessages(taskId)
    .filter((item) => item.id !== assistantMessageId)
    .filter((item) => item.role === 'user' || (item.role === 'agent' && item.content.trim().length > 0))
    .map((item) => ({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: item.content,
    }));
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function resolvePublicBaseUrl(req: http.IncomingMessage): string {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const host = firstHeaderValue(req.headers.host);
  const proto = (forwardedProto?.split(',')[0]?.trim() || 'http').toLowerCase();
  const resolvedHost = forwardedHost?.split(',')[0]?.trim() || host?.trim();
  if (resolvedHost) {
    return `${proto}://${resolvedHost}`;
  }
  return process.env.MBOS_PUBLIC_BASE_URL ?? 'http://localhost:20000';
}
