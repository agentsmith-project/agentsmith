import type http from 'node:http';
import type { NodeApiDeps } from '../node-api-deps.js';
import { resolveInternalWorkloadCoordinator } from '../internal-workload-coordinator.js';
import { isManagedAgentRunner } from '../agent-runner-profile.js';
import type { AgentRecord } from '../resource-models.js';
import {
  getNotebookTaskRunHardTeardownDebt,
  getNotebookTaskRunState,
  type NotebookTaskRunHardTeardownDebtRecord,
  type NotebookTaskRunState,
  type NotebookTaskRunStopMode,
} from './task-run-coordination.js';
import { sanitizeTaskRecordForActiveModel, type TaskListItem, type TaskRecord } from './task-models.js';
import { loadTaskArtifacts, loadTaskMessages } from './task-store.js';
import { getTaskArtifacts, getTaskMessages } from './task-runtime-state.js';

export type NotebookRunStopStatus = 'cancelling' | 'terminating';
export type NotebookRunStopEscalationReason =
  | 'already_terminating'
  | 'unmanaged_runner'
  | 'unsupported_runner';

type NotebookRunAgentProfile = Pick<AgentRecord, 'runner_provider'> | null | undefined;

function mapNotebookRunPhaseToTaskRunState(
  activeRun: Awaited<ReturnType<typeof getNotebookTaskRunState>>,
  hardTeardownDebt?: NotebookTaskRunHardTeardownDebtRecord | null,
): TaskListItem['run_state'] {
  if (hardTeardownDebt) return 'terminating';
  if (!activeRun) return 'idle';
  if (activeRun.phase === 'cancelling') return 'cancelling';
  if (activeRun.phase === 'terminating') return 'terminating';
  if (activeRun.phase === 'finalizing') return 'finalizing';
  return 'running';
}

function mapNotebookRunPhaseToActiveRunStatus(
  activeRun: NotebookTaskRunState,
): NonNullable<TaskListItem['active_run']>['status'] {
  if (activeRun.phase === 'cancelling' || activeRun.phase === 'terminating') return 'stopping';
  return 'running';
}

function mapNotebookRunStopStatus(state: NotebookTaskRunState): NotebookRunStopStatus {
  return state.stop?.mode === 'terminate' || state.phase === 'terminating'
    ? 'terminating'
    : 'cancelling';
}

export function canRequestNotebookRunHardTerminate(
  deps: NodeApiDeps,
  agent: NotebookRunAgentProfile,
): boolean {
  return Boolean(agent && isManagedAgentRunner(agent) && resolveInternalWorkloadCoordinator(deps) !== undefined);
}

export function resolveNotebookRunEscalation(
  deps: NodeApiDeps,
  agent: NotebookRunAgentProfile,
  state: NotebookTaskRunState,
): { can_escalate: boolean; escalation_reason?: NotebookRunStopEscalationReason } {
  if (state.stop?.mode === 'terminate' || state.phase === 'terminating') {
    return { can_escalate: false, escalation_reason: 'already_terminating' };
  }
  if (!agent || !isManagedAgentRunner(agent)) {
    return { can_escalate: false, escalation_reason: 'unsupported_runner' };
  }
  if (!canRequestNotebookRunHardTerminate(deps, agent)) {
    return { can_escalate: false, escalation_reason: 'unmanaged_runner' };
  }
  return { can_escalate: true };
}

function resolveNotebookRunStopMode(state: NotebookTaskRunState): NotebookTaskRunStopMode {
  return state.stop?.mode ?? (
    state.phase === 'terminating' ? 'terminate' : 'cancel'
  );
}

export function buildNotebookRunStopTruthResponse(input: {
  deps: NodeApiDeps;
  agent: NotebookRunAgentProfile;
  taskId: string;
  state: NotebookTaskRunState;
  requestId?: string | null;
}): {
  status: NotebookRunStopStatus;
  task_id: string;
  run_id: string;
  request_id: string | null;
  stop_mode: NotebookTaskRunStopMode;
  can_escalate: boolean;
  escalation_reason?: NotebookRunStopEscalationReason;
} {
  const escalation = resolveNotebookRunEscalation(input.deps, input.agent, input.state);
  return {
    status: mapNotebookRunStopStatus(input.state),
    task_id: input.taskId,
    run_id: input.state.run_id,
    request_id: input.state.request_id ?? input.requestId ?? null,
    stop_mode: resolveNotebookRunStopMode(input.state),
    ...escalation,
  };
}

export function buildNotebookRunStopEscalationUnavailableResponse(input: {
  taskId: string;
  state: NotebookTaskRunState | null;
  requestId?: string | null;
  reason: Exclude<NotebookRunStopEscalationReason, 'already_terminating'>;
}): {
  error_code: 'STOP_ESCALATION_UNAVAILABLE';
  message: 'stop_escalation_unavailable';
  task_id: string;
  run_id: string | null;
  request_id: string | null;
  status?: NotebookRunStopStatus;
  stop_mode?: NotebookTaskRunStopMode;
  can_escalate: false;
  escalation_reason: Exclude<NotebookRunStopEscalationReason, 'already_terminating'>;
} {
  return {
    error_code: 'STOP_ESCALATION_UNAVAILABLE',
    message: 'stop_escalation_unavailable',
    task_id: input.taskId,
    run_id: input.state?.run_id ?? null,
    request_id: input.state?.request_id ?? input.requestId ?? null,
    ...(input.state ? { status: mapNotebookRunStopStatus(input.state) } : {}),
    ...(input.state?.stop?.mode ? { stop_mode: input.state.stop.mode } : {}),
    can_escalate: false,
    escalation_reason: input.reason,
  };
}

function buildNotebookRunRealtimeTruth(
  deps: NodeApiDeps,
  agent: NotebookRunAgentProfile,
  activeRun: Awaited<ReturnType<typeof getNotebookTaskRunState>>,
  hardTeardownDebt?: NotebookTaskRunHardTeardownDebtRecord | null,
): Pick<TaskListItem, 'stop_mode' | 'can_escalate' | 'escalation_reason'> {
  if (!activeRun) {
    if (!hardTeardownDebt) return {};
    return {
      stop_mode: 'terminate',
      can_escalate: false,
      escalation_reason: canRequestNotebookRunHardTerminate(deps, agent)
        ? 'already_terminating'
        : agent && isManagedAgentRunner(agent) ? 'unmanaged_runner' : 'unsupported_runner',
    };
  }
  const escalation = resolveNotebookRunEscalation(deps, agent, activeRun);
  return {
    stop_mode: resolveNotebookRunStopMode(activeRun),
    ...escalation,
  };
}

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
  const [activeRun, hardTeardownDebt] = await Promise.all([
    getNotebookTaskRunState(deps.cache, task.id),
    getNotebookTaskRunHardTeardownDebt(deps.cache, task.id),
  ]);
  const activeRunnerId = activeRun?.resolved_runner_id?.trim() ?? '';
  const agent = activeRunnerId
    ? await deps.agentResourceService.getAgent(workspaceId, projectId, activeRunnerId)
    : null;
  const agentPresence: TaskListItem['agent_presence'] | undefined = activeRunnerId
    ? (
      !agent ? 'unknown'
      : isManagedAgentRunner(agent) ? 'managed'
      : (agent.presence === 'online' ? 'online' : 'offline')
    )
    : undefined;
  const publicTask = sanitizeTaskRecordForActiveModel(task);
  const result: TaskListItem = {
    ...publicTask,
    lifecycle_status: task.status,
    ...(agentPresence ? { agent_presence: agentPresence } : {}),
    run_state: mapNotebookRunPhaseToTaskRunState(activeRun, hardTeardownDebt),
    ...(activeRun && activeRunnerId
      ? {
        active_run: {
          id: activeRun.run_id,
          status: mapNotebookRunPhaseToActiveRunStatus(activeRun),
          runner_id: activeRunnerId,
          ...(activeRun.runner_test === true ? { source: 'runner_test' as const, runner_test: true as const } : {}),
          ...(activeRun.started_at ? { started_at: activeRun.started_at } : {}),
        },
      }
      : {}),
    ...(activeRun?.started_at ? { active_run_started_at: activeRun.started_at } : {}),
    ...buildNotebookRunRealtimeTruth(deps, agent, activeRun, hardTeardownDebt),
    stats: {
      user_turn_count: userTurnCount,
      message_count: messages.length,
      artifact_count: artifacts.length,
      attached_input_count: task.attached_inputs.length,
    },
  };
  return result;
}

export function mapTaskMessagesForExecution(taskId: string, assistantMessageId: string): Array<Record<string, unknown>> {
  const latestUserTurn = [...getTaskMessages(taskId)]
    .reverse()
    .find((item) => item.id !== assistantMessageId && item.role === 'user' && item.content.trim().length > 0);
  if (!latestUserTurn) {
    return [];
  }
  return [{
    role: 'user',
    content: latestUserTurn.content,
  }];
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
