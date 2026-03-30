export type NotebookOutcomeMessage = {
  role?: string | null;
  content?: string | null;
};

export type NotebookOutcomeTrace = {
  category?: string | null;
  phase?: string | null;
  status?: string | null;
  name?: string | null;
  summary?: string | null;
  at?: string | null;
};

export type NotebookOutcomeTask = {
  run_state?: string | null;
};

export type NotebookOutcomePod = {
  name?: string | null;
  phase?: string | null;
  reason?: string | null;
  exitCode?: number | null;
};

export type NotebookExecutionSnapshot = {
  token: string;
  minAgentMessages?: number;
  messages: NotebookOutcomeMessage[];
  traces: NotebookOutcomeTrace[];
  task?: NotebookOutcomeTask | null;
  artifactContent?: string | null;
  pod?: NotebookOutcomePod | null;
  podSeenBefore?: boolean;
};

export type NotebookExecutionEvaluation = {
  success: boolean;
  failure: boolean;
  reason: string | null;
  messageHasToken: boolean;
  artifactHasToken: boolean;
  latestAgentMessage: string | null;
  latestTraceSummary: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function latestTrace(traces: NotebookOutcomeTrace[]): NotebookOutcomeTrace | null {
  return traces.length > 0 ? traces[traces.length - 1] ?? null : null;
}

function hasTerminalFailureTrace(traces: NotebookOutcomeTrace[]): boolean {
  return traces.some((trace) => {
    const status = normalizeText(trace.status);
    const category = normalizeText(trace.category);
    const name = normalizeText(trace.name);
    if (status === 'error' || status === 'cancelled') return true;
    if (category === 'error') return true;
    if (name === 'execution.terminal' && normalizeText(trace.summary).toLowerCase().includes('error')) return true;
    return false;
  });
}

function latestAgentMessage(messages: NotebookOutcomeMessage[]): string | null {
  const agentMessages = messages.filter((message) => message.role === 'agent');
  return agentMessages.length > 0 ? normalizeText(agentMessages[agentMessages.length - 1]?.content) || null : null;
}

export function evaluateNotebookExecutionSnapshot(input: NotebookExecutionSnapshot): NotebookExecutionEvaluation {
  const minAgentMessages = input.minAgentMessages ?? 1;
  const agentMessages = input.messages.filter((message) => message.role === 'agent');
  const messageHasToken =
    agentMessages.length >= minAgentMessages
    && agentMessages.some((message) => normalizeText(message.content).includes(input.token));
  const artifactHasToken = normalizeText(input.artifactContent).includes(input.token);
  const latestAgent = latestAgentMessage(input.messages);
  const latestTraceEvent = latestTrace(input.traces);
  const latestTraceSummary = latestTraceEvent ? normalizeText(latestTraceEvent.summary) || null : null;

  if (messageHasToken || artifactHasToken) {
    return {
      success: true,
      failure: false,
      reason: null,
      messageHasToken,
      artifactHasToken,
      latestAgentMessage: latestAgent,
      latestTraceSummary,
    };
  }

  if (hasTerminalFailureTrace(input.traces)) {
    return {
      success: false,
      failure: true,
      reason: 'terminal_trace_failure',
      messageHasToken,
      artifactHasToken,
      latestAgentMessage: latestAgent,
      latestTraceSummary,
    };
  }

  const podPhase = normalizeText(input.pod?.phase);
  if (input.podSeenBefore && (podPhase === 'Failed' || podPhase === 'Succeeded')) {
    return {
      success: false,
      failure: true,
      reason: 'workload_pod_exited_without_success_signal',
      messageHasToken,
      artifactHasToken,
      latestAgentMessage: latestAgent,
      latestTraceSummary,
    };
  }

  const runState = normalizeText(input.task?.run_state);
    if (input.podSeenBefore && runState === 'idle' && !input.pod?.name && input.traces.length > 0) {
    return {
      success: false,
      failure: true,
      reason: 'task_idle_without_success_signal',
      messageHasToken,
      artifactHasToken,
      latestAgentMessage: latestAgent,
      latestTraceSummary,
    };
  }

  return {
    success: false,
    failure: false,
    reason: null,
    messageHasToken,
    artifactHasToken,
    latestAgentMessage: latestAgent,
    latestTraceSummary,
  };
}

function truncateLine(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export function summarizeNotebookMessages(messages: NotebookOutcomeMessage[], limit = 3): string[] {
  return messages
    .slice(-limit)
    .map((message) => `${message.role ?? 'unknown'}: ${truncateLine(normalizeText(message.content) || '<empty>')}`);
}

export function summarizeNotebookTraces(traces: NotebookOutcomeTrace[], limit = 5): string[] {
  return traces
    .slice(-limit)
    .map((trace) => {
      const category = normalizeText(trace.category) || 'unknown';
      const status = normalizeText(trace.status);
      const name = normalizeText(trace.name) || 'trace';
      const summary = truncateLine(normalizeText(trace.summary) || '<empty>');
      return `${category}${status ? `/${status}` : ''} ${name}: ${summary}`;
    });
}

export function summarizeNotebookPod(pod?: NotebookOutcomePod | null): string {
  if (!pod?.name) return 'pod: <missing>';
  const parts = [
    `pod=${pod.name}`,
    pod.phase ? `phase=${pod.phase}` : null,
    pod.reason ? `reason=${pod.reason}` : null,
    pod.exitCode !== undefined && pod.exitCode !== null ? `exit_code=${pod.exitCode}` : null,
  ].filter(Boolean);
  return parts.join(' ');
}
