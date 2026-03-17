import {
  appendNotebookTaskPrometheusMetrics,
  getNotebookTaskMetricsState,
  getNotebookTraceQueryLatencyByScopeSnapshot,
} from '../notebook-task-metrics.js';
import { countInMemoryTraceRecords, getNotebookTraceStoreLimits } from '../notebook-trace-store.js';
import { getNotebookTaskSseBrokerStats } from '../notebook-task-sse-broker.js';
import {
  ACTIVE_RUNS_BY_TASK,
  ARTIFACTS_BY_TASK,
  MESSAGES_BY_TASK,
  TASKS_BY_PROJECT,
} from './task-runtime-state.js';

const NOTEBOOK_TRACE_STORE_LIMITS = getNotebookTraceStoreLimits();

export function getNotebookTaskMetricsSnapshot(): Record<string, unknown> {
  const metrics = getNotebookTaskMetricsState();
  const taskCount = [...TASKS_BY_PROJECT.values()].reduce((acc, items) => acc + items.length, 0);
  const messageCount = [...MESSAGES_BY_TASK.values()].reduce((acc, items) => acc + items.length, 0);
  const artifactCount = [...ARTIFACTS_BY_TASK.values()].reduce((acc, items) => acc + items.length, 0);
  const traceCount = countInMemoryTraceRecords();
  const sseBrokerStats = getNotebookTaskSseBrokerStats();
  return {
    ...metrics,
    active_runs: ACTIVE_RUNS_BY_TASK.size,
    task_sse_clients: sseBrokerStats.client_count,
    in_memory: {
      tasks: taskCount,
      messages: messageCount,
      artifacts: artifactCount,
      traces: traceCount,
      task_event_history_tasks: sseBrokerStats.history_task_count,
    },
    limits: {
      max_trace_events_per_task: NOTEBOOK_TRACE_STORE_LIMITS.maxTraceEventsPerTask,
      max_trace_details_bytes: NOTEBOOK_TRACE_STORE_LIMITS.maxTraceDetailsBytes,
      max_task_sse_events_per_task: sseBrokerStats.max_events_per_task,
    },
    trace_query_latency_by_scope: getNotebookTraceQueryLatencyByScopeSnapshot(),
  };
}

export function getNotebookTaskMetricsPrometheusText(): string {
  const snapshot = getNotebookTaskMetricsSnapshot() as {
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
  };

  const lines: string[] = [];
  appendNotebookTaskPrometheusMetrics(lines, snapshot);
  return `${lines.join('\n')}\n`;
}
