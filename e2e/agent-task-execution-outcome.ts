export type AgentTaskOutcomeActivity = {
  id?: string | null;
  kind?: string | null;
  actor?: string | null;
  content?: string | null;
  run_id?: string | null;
};

export type AgentTaskOutcomeTrace = {
  message_id?: string | null;
  run_id?: string | null;
  category?: string | null;
  phase?: string | null;
  status?: string | null;
  name?: string | null;
  summary?: string | null;
  details?: unknown;
  at?: string | null;
};

export type AgentTaskOutcomeTask = {
  run_state?: string | null;
  active_run?: {
    status?: string | null;
  } | null;
  run_status?: string | null;
};

export type AgentTaskOutcomePod = {
  name?: string | null;
  phase?: string | null;
  reason?: string | null;
  exitCode?: number | null;
};

export type AgentTaskExecutionSnapshot = {
  token: string;
  runnerOutputActivityId?: string;
  runId?: string;
  minRunnerOutputs?: number;
  activity: AgentTaskOutcomeActivity[];
  traces: AgentTaskOutcomeTrace[];
  task?: AgentTaskOutcomeTask | null;
  artifactContent?: string | null;
  pod?: AgentTaskOutcomePod | null;
  podSeenBefore?: boolean;
};

export type AgentTaskExecutionEvaluation = {
  success: boolean;
  failure: boolean;
  reason: string | null;
  activityHasToken: boolean;
  artifactHasToken: boolean;
  latestRunnerOutput: string | null;
  latestTraceSummary: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function latestTrace(traces: AgentTaskOutcomeTrace[]): AgentTaskOutcomeTrace | null {
  return traces.length > 0 ? traces[traces.length - 1] ?? null : null;
}

function scopeActivityToRunnerOutput(
  activity: AgentTaskOutcomeActivity[],
  runnerOutputActivityId?: string,
  runId?: string,
): AgentTaskOutcomeActivity[] {
  const scopedRunnerOutputActivityId = normalizeText(runnerOutputActivityId);
  const scopedRunId = normalizeText(runId);
  if (!scopedRunnerOutputActivityId && !scopedRunId) {
    return activity;
  }
  return activity.filter((item) => {
    if (!isRunnerOutputActivity(item)) return false;
    const itemRunId = normalizeText(item.run_id);
    if (scopedRunId) {
      if (itemRunId) return itemRunId === scopedRunId;
      return Boolean(
        scopedRunnerOutputActivityId
        && normalizeText(item.id) === scopedRunnerOutputActivityId,
      );
    }
    return Boolean(
      scopedRunnerOutputActivityId
      && normalizeText(item.id) === scopedRunnerOutputActivityId,
    );
  });
}

function scopeTracesToActivity(
  traces: AgentTaskOutcomeTrace[],
  runnerOutputActivityId?: string,
  runId?: string,
): AgentTaskOutcomeTrace[] {
  const scopedRunnerOutputActivityId = normalizeText(runnerOutputActivityId);
  const scopedRunId = normalizeText(runId);
  if (!scopedRunnerOutputActivityId && !scopedRunId) {
    return traces;
  }
  return traces.filter((trace) => {
    const traceRunId = normalizeText(trace.run_id);
    if (scopedRunId) {
      if (traceRunId) return traceRunId === scopedRunId;
      return Boolean(
        scopedRunnerOutputActivityId
        && normalizeText(trace.message_id) === scopedRunnerOutputActivityId,
      );
    }
    return Boolean(
      scopedRunnerOutputActivityId
      && normalizeText(trace.message_id) === scopedRunnerOutputActivityId,
    );
  });
}

function isFailureStatus(status: string): boolean {
  return status === 'error' || status === 'failed' || status === 'cancelled' || status === 'canceled';
}

function isFinalTracePhase(phase: string): boolean {
  return phase === 'end' || phase === 'complete' || phase === 'completed';
}

function isTerminalFailureTrace(trace: AgentTaskOutcomeTrace): boolean {
  const status = normalizeText(trace.status);
  if (!isFailureStatus(status)) return false;
  const phase = normalizeText(trace.phase);
  const name = normalizeText(trace.name);
  const summary = normalizeText(trace.summary).toLowerCase();

  if (name === 'codex.command') {
    return false;
  }
  if (name === 'execution.terminal') {
    return isFinalTracePhase(phase) || summary.includes('synthesized');
  }
  if (name === 'codex.exec') {
    return isFinalTracePhase(phase);
  }
  if (name === 'run.lifecycle' || name === 'run.summary' || name === 'runner.result_policy') {
    return isFinalTracePhase(phase);
  }
  return false;
}

function hasTerminalFailureTrace(traces: AgentTaskOutcomeTrace[]): boolean {
  return traces.some((trace) => {
    return isTerminalFailureTrace(trace);
  });
}

function hasCompletedFailedTask(task?: AgentTaskOutcomeTask | null): boolean {
  const activeRunStatus = normalizeText(task?.active_run?.status);
  const runStatus = normalizeText(task?.run_status);
  return isFailureStatus(activeRunStatus) || isFailureStatus(runStatus);
}

function isRunnerOutputActivity(item: AgentTaskOutcomeActivity): boolean {
  return normalizeText(item.kind) === 'runner_output' && normalizeText(item.actor) === 'runner';
}

function latestRunnerOutput(activity: AgentTaskOutcomeActivity[]): string | null {
  const runnerOutputs = activity.filter(isRunnerOutputActivity);
  return runnerOutputs.length > 0 ? normalizeText(runnerOutputs[runnerOutputs.length - 1]?.content) || null : null;
}

export function evaluateAgentTaskExecutionSnapshot(input: AgentTaskExecutionSnapshot): AgentTaskExecutionEvaluation {
  const minRunnerOutputs = input.minRunnerOutputs ?? 1;
  const scopedActivity = scopeActivityToRunnerOutput(input.activity, input.runnerOutputActivityId, input.runId);
  const scopedTraces = scopeTracesToActivity(input.traces, input.runnerOutputActivityId, input.runId);
  const allRunnerOutputs = input.activity.filter(isRunnerOutputActivity);
  const runnerOutputs = scopedActivity.filter(isRunnerOutputActivity);
  // minRunnerOutputs is a conversation-level guard; token matching stays scoped to the current run output.
  const runnerOutputMinimumSatisfied = allRunnerOutputs.length >= minRunnerOutputs;
  const activityHasToken =
    runnerOutputMinimumSatisfied
    && runnerOutputs.some((item) => normalizeText(item.content).includes(input.token));
  const artifactHasToken = normalizeText(input.artifactContent).includes(input.token);
  const latestRunner = latestRunnerOutput(scopedActivity);
  const latestTraceEvent = latestTrace(scopedTraces);
  const latestTraceSummary = latestTraceEvent ? normalizeText(latestTraceEvent.summary) || null : null;

  if (activityHasToken || artifactHasToken) {
    return {
      success: true,
      failure: false,
      reason: null,
      activityHasToken,
      artifactHasToken,
      latestRunnerOutput: latestRunner,
      latestTraceSummary,
    };
  }

  if (hasTerminalFailureTrace(scopedTraces)) {
    return {
      success: false,
      failure: true,
      reason: 'terminal_trace_failure',
      activityHasToken,
      artifactHasToken,
      latestRunnerOutput: latestRunner,
      latestTraceSummary,
    };
  }

  if (hasCompletedFailedTask(input.task)) {
    return {
      success: false,
      failure: true,
      reason: 'task_run_failed',
      activityHasToken,
      artifactHasToken,
      latestRunnerOutput: latestRunner,
      latestTraceSummary,
    };
  }

  const podPhase = normalizeText(input.pod?.phase);
  if (input.podSeenBefore && (podPhase === 'Failed' || podPhase === 'Succeeded')) {
    return {
      success: false,
      failure: true,
      reason: 'workload_pod_exited_without_success_signal',
      activityHasToken,
      artifactHasToken,
      latestRunnerOutput: latestRunner,
      latestTraceSummary,
    };
  }

  const runState = normalizeText(input.task?.run_state);
  if (input.podSeenBefore && runState === 'idle' && !input.pod?.name && scopedTraces.length > 0) {
    return {
      success: false,
      failure: true,
      reason: 'task_idle_without_success_signal',
      activityHasToken,
      artifactHasToken,
      latestRunnerOutput: latestRunner,
      latestTraceSummary,
    };
  }

  return {
    success: false,
    failure: false,
    reason: null,
    activityHasToken,
    artifactHasToken,
    latestRunnerOutput: latestRunner,
    latestTraceSummary,
  };
}

function truncateLine(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function readTextField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readTextOrNumberField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function summarizeSandboxRuntimeStep(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const workloadId = readTextField(value, 'workloadId') || readTextField(value, 'workload_id');
  const requestId = readTextOrNumberField(value, 'requestId', 'request_id');
  const status = readTextOrNumberField(value, 'status', 'statusCode', 'status_code');
  const httpStatus = readTextOrNumberField(value, 'httpStatus', 'http_status');
  const code = readTextOrNumberField(value, 'code', 'error_code');
  const asbcpCode = readTextOrNumberField(value, 'asbcpCode', 'asbcp_code');
  const readinessReason = readTextOrNumberField(value, 'readinessReason', 'readiness_reason');
  const readinessMessage = readTextOrNumberField(value, 'readinessMessage', 'readiness_message');
  const retryAfter = readTextOrNumberField(value, 'retryAfter', 'retry_after');
  const parts = [
    readTextField(value, 'operation') || 'step',
    readTextField(value, 'outcome'),
    requestId ? `request_id=${requestId}` : null,
    workloadId ? `workload_id=${workloadId}` : null,
    readTextField(value, 'phase') ? `phase=${readTextField(value, 'phase')}` : null,
    status ? `status=${status}` : null,
    httpStatus ? `http_status=${httpStatus}` : null,
    code ? `code=${code}` : null,
    asbcpCode ? `asbcp_code=${asbcpCode}` : null,
    readinessReason ? `readiness_reason=${readinessReason}` : null,
    readinessMessage ? `readiness_message=${readinessMessage}` : null,
    retryAfter ? `retry_after=${retryAfter}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(':') : null;
}

function summarizeTraceRuntimeDiagnostics(trace: AgentTaskOutcomeTrace): string {
  if (!isRecord(trace.details)) return '';
  const errorDiagnostic = readRecordField(trace.details, 'error_diagnostic');
  if (!errorDiagnostic) return '';
  const sandboxDiagnostics = readRecordField(errorDiagnostic, 'sandbox_diagnostics');
  if (!sandboxDiagnostics) return '';
  const steps = Array.isArray(sandboxDiagnostics.steps)
    ? sandboxDiagnostics.steps
    : [];
  const stepSummary = steps
    .slice(-3)
    .map(summarizeSandboxRuntimeStep)
    .filter(Boolean)
    .join(' | ');
  const theme = readTextField(sandboxDiagnostics, 'theme');
  const workloadId = readTextField(sandboxDiagnostics, 'workloadId');
  const head = [
    theme ? `theme=${theme}` : null,
    workloadId ? `workload_id=${workloadId}` : null,
  ].filter(Boolean).join(' ');
  const body = stepSummary ? `steps=${stepSummary}` : '';
  return [head, body].filter(Boolean).join(' ');
}

export function summarizeAgentTaskActivity(activity: AgentTaskOutcomeActivity[], limit = 3): string[] {
  return activity
    .slice(-limit)
    .map((item) => {
      const actor = normalizeText(item.actor) || 'unknown';
      const kind = normalizeText(item.kind) || 'activity';
      return `${actor}/${kind}: ${truncateLine(normalizeText(item.content) || '<empty>')}`;
    });
}

export function summarizeAgentTaskTraces(traces: AgentTaskOutcomeTrace[], limit = 5): string[] {
  return traces
    .slice(-limit)
    .map((trace) => {
      const category = normalizeText(trace.category) || 'unknown';
      const status = normalizeText(trace.status);
      const name = normalizeText(trace.name) || 'trace';
      const runtimeDiagnostics = summarizeTraceRuntimeDiagnostics(trace);
      const summary = truncateLine(
        [
          normalizeText(trace.summary) || '<empty>',
          runtimeDiagnostics ? `runtime_diagnostics: ${runtimeDiagnostics}` : '',
        ].filter(Boolean).join(' '),
        640,
      );
      return `${category}${status ? `/${status}` : ''} ${name}: ${summary}`;
    });
}

export function summarizeAgentTaskPod(pod?: AgentTaskOutcomePod | null): string {
  if (!pod?.name) return 'pod: <missing>';
  const parts = [
    `pod=${pod.name}`,
    pod.phase ? `phase=${pod.phase}` : null,
    pod.reason ? `reason=${pod.reason}` : null,
    pod.exitCode !== undefined && pod.exitCode !== null ? `exit_code=${pod.exitCode}` : null,
  ].filter(Boolean);
  return parts.join(' ');
}
