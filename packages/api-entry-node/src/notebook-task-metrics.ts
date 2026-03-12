type TraceQueryScope = 'task' | 'message' | 'run' | 'message_run';

type TraceQueryLatencyStats = {
  count: number;
  sum_ms: number;
  max_ms: number;
  buckets: Record<string, number>;
};

const NOTEBOOK_RUNTIME_METRICS = {
  task_runs_started: 0,
  task_runs_completed: 0,
  task_runs_failed: 0,
  task_runs_terminal_without_done: 0,
  trace_events_recorded: 0,
  trace_events_truncated_records: 0,
  trace_details_truncated: 0,
  task_traces_queries_total: 0,
  task_traces_queries_message_scoped_total: 0,
  task_traces_queries_run_scoped_total: 0,
  task_traces_query_latency_ms_total: 0,
  task_traces_query_latency_ms_max: 0,
};

const TRACE_QUERY_LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;
const TRACE_QUERY_LATENCY_BY_SCOPE = new Map<TraceQueryScope, TraceQueryLatencyStats>();

function getTraceQueryLatencyStats(scope: TraceQueryScope): TraceQueryLatencyStats {
  let stats = TRACE_QUERY_LATENCY_BY_SCOPE.get(scope);
  if (stats) return stats;
  const buckets: Record<string, number> = { '+Inf': 0 };
  for (const upper of TRACE_QUERY_LATENCY_BUCKETS_MS) {
    buckets[String(upper)] = 0;
  }
  stats = { count: 0, sum_ms: 0, max_ms: 0, buckets };
  TRACE_QUERY_LATENCY_BY_SCOPE.set(scope, stats);
  return stats;
}

export function observeNotebookTraceQueryLatency(scope: TraceQueryScope, latencyMs: number): void {
  const safeLatency = Math.max(0, Number.isFinite(latencyMs) ? latencyMs : 0);
  NOTEBOOK_RUNTIME_METRICS.task_traces_queries_total += 1;
  if (scope === 'message' || scope === 'message_run') {
    NOTEBOOK_RUNTIME_METRICS.task_traces_queries_message_scoped_total += 1;
  }
  if (scope === 'run' || scope === 'message_run') {
    NOTEBOOK_RUNTIME_METRICS.task_traces_queries_run_scoped_total += 1;
  }
  NOTEBOOK_RUNTIME_METRICS.task_traces_query_latency_ms_total += safeLatency;
  NOTEBOOK_RUNTIME_METRICS.task_traces_query_latency_ms_max = Math.max(
    NOTEBOOK_RUNTIME_METRICS.task_traces_query_latency_ms_max,
    safeLatency,
  );

  const stats = getTraceQueryLatencyStats(scope);
  stats.count += 1;
  stats.sum_ms += safeLatency;
  stats.max_ms = Math.max(stats.max_ms, safeLatency);
  for (const upper of TRACE_QUERY_LATENCY_BUCKETS_MS) {
    if (safeLatency <= upper) {
      stats.buckets[String(upper)] += 1;
    }
  }
  stats.buckets['+Inf'] += 1;
}

export function recordNotebookTaskRunStarted(): void {
  NOTEBOOK_RUNTIME_METRICS.task_runs_started += 1;
}

export function recordNotebookTaskRunCompleted(): void {
  NOTEBOOK_RUNTIME_METRICS.task_runs_completed += 1;
}

export function recordNotebookTaskRunFailed(): void {
  NOTEBOOK_RUNTIME_METRICS.task_runs_failed += 1;
}

export function recordNotebookTaskRunTerminalWithoutDone(): void {
  NOTEBOOK_RUNTIME_METRICS.task_runs_terminal_without_done += 1;
}

export function recordNotebookTraceEventStored(): void {
  NOTEBOOK_RUNTIME_METRICS.trace_events_recorded += 1;
}

export function recordNotebookTraceEventsTruncated(count: number): void {
  NOTEBOOK_RUNTIME_METRICS.trace_events_truncated_records += Math.max(0, count);
}

export function recordNotebookTraceDetailsTruncated(): void {
  NOTEBOOK_RUNTIME_METRICS.trace_details_truncated += 1;
}

export function getNotebookTaskMetricsState(): Readonly<typeof NOTEBOOK_RUNTIME_METRICS> {
  return NOTEBOOK_RUNTIME_METRICS;
}

export function getNotebookTraceQueryLatencyByScopeSnapshot(): Record<string, unknown> {
  return Object.fromEntries(
    [...TRACE_QUERY_LATENCY_BY_SCOPE.entries()].map(([scope, stats]) => [
      scope,
      {
        count: stats.count,
        sum_ms: Math.round(stats.sum_ms * 1000) / 1000,
        max_ms: stats.max_ms,
        buckets: stats.buckets,
      },
    ]),
  );
}

export function appendNotebookTaskPrometheusMetrics(
  lines: string[],
  snapshot: {
    task_runs_started: number;
    task_runs_completed: number;
    task_runs_failed: number;
    task_runs_terminal_without_done: number;
    trace_events_recorded: number;
    trace_events_truncated_records: number;
    trace_details_truncated: number;
    task_traces_queries_total: number;
    task_traces_queries_message_scoped_total: number;
    task_traces_queries_run_scoped_total: number;
    active_runs: number;
    task_sse_clients: number;
    in_memory: {
      tasks: number;
      messages: number;
      artifacts: number;
      traces: number;
      task_event_history_tasks: number;
    };
    limits: {
      max_trace_events_per_task: number;
      max_trace_details_bytes: number;
      max_task_sse_events_per_task: number;
    };
  },
): void {
  const appendGauge = (name: string, value: number, help: string): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
  };
  const appendCounter = (name: string, value: number, help: string): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
  };

  appendCounter('notebook_task_runs_started_total', snapshot.task_runs_started, 'Notebook task runs started');
  appendCounter('notebook_task_runs_completed_total', snapshot.task_runs_completed, 'Notebook task runs completed');
  appendCounter('notebook_task_runs_failed_total', snapshot.task_runs_failed, 'Notebook task runs failed');
  appendCounter(
    'notebook_task_runs_terminal_without_done_total',
    snapshot.task_runs_terminal_without_done,
    'Notebook task run streams finalized without terminal done/error event',
  );
  appendCounter('notebook_trace_events_recorded_total', snapshot.trace_events_recorded, 'Notebook trace events recorded');
  appendCounter(
    'notebook_trace_events_truncated_records_total',
    snapshot.trace_events_truncated_records,
    'Notebook trace records truncated due to retention limits',
  );
  appendCounter(
    'notebook_trace_details_truncated_total',
    snapshot.trace_details_truncated,
    'Notebook trace details payloads truncated due to size limits',
  );
  appendCounter(
    'notebook_task_traces_queries_total',
    snapshot.task_traces_queries_total,
    'Notebook task traces API queries served',
  );
  appendCounter(
    'notebook_task_traces_queries_message_scoped_total',
    snapshot.task_traces_queries_message_scoped_total,
    'Notebook task traces API queries scoped by message_id',
  );
  appendCounter(
    'notebook_task_traces_queries_run_scoped_total',
    snapshot.task_traces_queries_run_scoped_total,
    'Notebook task traces API queries scoped by run_id',
  );

  appendGauge('notebook_active_runs', snapshot.active_runs, 'Current active notebook task runs');
  appendGauge('notebook_task_sse_clients', snapshot.task_sse_clients, 'Current notebook task SSE clients');
  appendGauge('notebook_in_memory_tasks', snapshot.in_memory.tasks, 'In-memory notebook task records');
  appendGauge('notebook_in_memory_messages', snapshot.in_memory.messages, 'In-memory notebook task message records');
  appendGauge('notebook_in_memory_artifacts', snapshot.in_memory.artifacts, 'In-memory notebook task artifact records');
  appendGauge('notebook_in_memory_traces', snapshot.in_memory.traces, 'In-memory notebook task trace records');
  appendGauge(
    'notebook_in_memory_task_event_history_tasks',
    snapshot.in_memory.task_event_history_tasks,
    'Task ids with buffered notebook SSE event history',
  );

  appendGauge(
    'notebook_limit_trace_events_per_task',
    snapshot.limits.max_trace_events_per_task,
    'Configured max trace events retained per task',
  );
  appendGauge(
    'notebook_limit_trace_details_max_bytes',
    snapshot.limits.max_trace_details_bytes,
    'Configured max bytes for trace details payload before truncation',
  );
  appendGauge(
    'notebook_limit_task_sse_events_per_task',
    snapshot.limits.max_task_sse_events_per_task,
    'Configured max buffered notebook SSE events per task',
  );

  lines.push('# HELP notebook_task_traces_query_duration_ms Traces API query latency in milliseconds by scope');
  lines.push('# TYPE notebook_task_traces_query_duration_ms histogram');
  for (const scope of ['task', 'message', 'run', 'message_run'] as const) {
    const stats = TRACE_QUERY_LATENCY_BY_SCOPE.get(scope) ?? getTraceQueryLatencyStats(scope);
    let cumulative = 0;
    for (const upper of TRACE_QUERY_LATENCY_BUCKETS_MS) {
      cumulative = stats.buckets[String(upper)] ?? cumulative;
      lines.push(`notebook_task_traces_query_duration_ms_bucket{scope="${scope}",le="${upper}"} ${cumulative}`);
    }
    lines.push(
      `notebook_task_traces_query_duration_ms_bucket{scope="${scope}",le="+Inf"} ${stats.buckets['+Inf'] ?? stats.count}`,
    );
    lines.push(`notebook_task_traces_query_duration_ms_sum{scope="${scope}"} ${stats.sum_ms}`);
    lines.push(`notebook_task_traces_query_duration_ms_count{scope="${scope}"} ${stats.count}`);
  }
}

export type { TraceQueryScope };

