import type { TaskTraceEvent } from "@/lib/types/task";
import type {
  TraceStep,
  TraceSummary,
  TransportTraceKind,
  TransportTracePhase,
} from "./types";

export type RenderableExecutionStep = {
  key: string;
  title: string;
  detail: string;
  status: TraceSummary["status"];
  at?: string;
  traceNames: string[];
};

export type RenderableExecution = {
  summary: TraceSummary & { durationText?: string };
  steps: RenderableExecutionStep[];
};

const MAX_STEP_DETAIL_CHARS = 300;

function truncateStepDetail(detail: string): string {
  const normalized = detail.replace(/\r\n?/g, "\n").trim();
  if (normalized.length <= MAX_STEP_DETAIL_CHARS) return normalized;
  return `${normalized.slice(0, Math.max(0, MAX_STEP_DETAIL_CHARS - 1)).trimEnd()}…`;
}

function isReasoningTraceName(name: string): boolean {
  return /reason(?:ing)?|thinking/i.test(name);
}

function isReasoningStep(step: RenderableExecutionStep): boolean {
  if (step.title !== "process_stage_preparing") return false;
  if (/reason(?:ing)?|thinking/i.test(step.detail)) return true;
  return step.traceNames.some(isReasoningTraceName);
}

export function getTransportTraceMeta(
  evt: TaskTraceEvent,
): { kind: TransportTraceKind; phase: TransportTracePhase } | null {
  if (evt.category !== "debug" || !evt.details) return null;
  const transportKind = evt.details.transport_kind;
  const transportPhase = evt.details.transport_phase;
  if (
    (transportKind === "gap_fill" || transportKind === "reconcile") &&
    (transportPhase === "start" ||
      transportPhase === "done" ||
      transportPhase === "error")
  ) {
    return { kind: transportKind, phase: transportPhase };
  }
  return null;
}

export function isExecutionTraceEvent(evt: TaskTraceEvent): boolean {
  return getTransportTraceMeta(evt) == null;
}

export function splitConcatenatedJsonObjects(input: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (!ch) continue;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        items.push(input.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return items;
}

export function decodeCodexEventText(raw: string): string {
  if (!raw || raw.indexOf('"type":"') < 0) return raw;
  const objects = splitConcatenatedJsonObjects(raw);
  if (objects.length === 0) return raw;
  const agentTexts: string[] = [];
  const agentDeltas: string[] = [];
  const errors: string[] = [];
  for (const text of objects) {
    try {
      const evt = JSON.parse(text) as {
        type?: string;
        item?: { type?: string; text?: string };
        delta?: string | { text?: string };
        text?: string;
        message?: string;
        error?: { message?: string };
      };
      if (
        evt.type === "response.output_text.delta" &&
        typeof evt.delta === "string"
      ) {
        agentDeltas.push(evt.delta);
        continue;
      }
      if (
        evt.type === "response.output_text.done" &&
        typeof evt.text === "string"
      ) {
        agentTexts.push(evt.text);
        continue;
      }
      if (
        evt.type === "item.delta" &&
        typeof evt.delta === "object" &&
        evt.delta &&
        typeof evt.delta.text === "string"
      ) {
        agentDeltas.push(evt.delta.text);
        continue;
      }
      if (
        evt.type === "item.completed" &&
        evt.item?.type === "agent_message" &&
        typeof evt.item.text === "string"
      ) {
        agentTexts.push(evt.item.text);
        continue;
      }
      if (evt.type === "error" && typeof evt.message === "string") {
        errors.push(evt.message);
        continue;
      }
      if (
        evt.type === "turn.failed" &&
        typeof evt.error?.message === "string"
      ) {
        errors.push(evt.error.message);
      }
    } catch {
      continue;
    }
  }
  if (agentTexts.length > 0) return agentTexts.join("\n\n");
  if (agentDeltas.length > 0) return agentDeltas.join("");
  if (errors.length > 0) return "";
  return "";
}

export function summarizeTraceEvents(
  traceEvents: TaskTraceEvent[],
): TraceSummary {
  const executionTraceEvents = traceEvents.filter(isExecutionTraceEvent);
  if (executionTraceEvents.length === 0)
    return { status: "idle", stepCount: 0 };
  const sorted = [...executionTraceEvents].sort((a, b) =>
    a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at),
  );
  const stepEvents = sorted.filter(
    (evt) =>
      evt.category !== "debug" &&
      evt.category !== "lifecycle" &&
      evt.name !== "run.summary",
  );
  const runSummaryEvent =
    [...sorted].reverse().find((evt) => evt.name === "run.summary") ?? null;
  const runLifecycleEvent =
    [...sorted].reverse().find((evt) => evt.name === "run.lifecycle") ?? null;
  const mapFinalStatus = (input: unknown): TraceSummary["status"] | null => {
    if (input === "success") return "success";
    if (input === "error") return "error";
    if (input === "cancelled") return "cancelled";
    return null;
  };
  const runSummaryStatus = mapFinalStatus(
    runSummaryEvent?.details?.final_status,
  );
  const hasFinalizedMarker =
    !!runSummaryEvent ||
    sorted.some(
      (evt) =>
        evt.name === "run.user_cancel" || evt.name === "execution.terminal",
    );
  const hasCancelledLifecycle = sorted.some(
    (evt) =>
      evt.name === "run.lifecycle" &&
      (evt.details?.run_phase === "cancelled" || evt.status === "cancelled"),
  );
  const hasCancelledTrace = sorted.some((evt) => evt.status === "cancelled");
  const cancellationOverride =
    (hasCancelledLifecycle || hasCancelledTrace) && hasFinalizedMarker;
  const lastCancelledIndex = [...sorted]
    .map((evt) => evt.status)
    .lastIndexOf("cancelled");
  const hasSuccessAfterCancelled =
    lastCancelledIndex >= 0 &&
    sorted
      .slice(lastCancelledIndex + 1)
      .some((evt) => evt.status === "success");
  const lifecyclePhase = runLifecycleEvent?.details?.run_phase;
  const lifecycleStatus =
    lifecyclePhase === "completed"
      ? "success"
      : lifecyclePhase === "failed"
        ? "error"
        : lifecyclePhase === "cancelled"
          ? "cancelled"
          : lifecyclePhase === "running" ||
              lifecyclePhase === "dispatching" ||
              lifecyclePhase === "queued" ||
              lifecyclePhase === "streaming"
            ? "running"
            : null;
  const terminalCandidateByEvent = (
    evt: TaskTraceEvent,
  ): Exclude<TraceSummary["status"], "running" | "idle"> | null => {
    if (
      evt.status === "success" ||
      evt.status === "error" ||
      evt.status === "cancelled"
    )
      return evt.status;
    if (evt.phase !== "end") return null;
    if (evt.category === "error") return "error";
    return "success";
  };
  const terminalIndex = [...sorted].findLastIndex(
    (evt) => terminalCandidateByEvent(evt) != null,
  );
  const runningIndex = [...sorted].findLastIndex(
    (evt) => evt.status === "running" || evt.phase === "start",
  );
  const terminalStatus =
    terminalIndex >= 0
      ? terminalCandidateByEvent(sorted[terminalIndex]!)
      : null;
  const inferredStatus =
    runningIndex > terminalIndex
      ? "running"
      : (terminalStatus ?? (runningIndex >= 0 ? "running" : "idle"));
  const preliminaryStatus = cancellationOverride
    ? "cancelled"
    : (runSummaryStatus ?? lifecycleStatus ?? inferredStatus);
  const resolvedStatus: TraceSummary["status"] =
    preliminaryStatus === "cancelled" && !hasFinalizedMarker
      ? "running"
      : preliminaryStatus;
  const startedAt = sorted[0]?.at ? Date.parse(sorted[0].at) : NaN;
  const endedAtEvent =
    terminalIndex >= 0 ? sorted[terminalIndex] : sorted[sorted.length - 1];
  const endedAtCandidate = endedAtEvent?.at ? Date.parse(endedAtEvent.at) : NaN;
  const summaryDuration = runSummaryEvent?.details?.duration_ms;
  const durationMs =
    typeof summaryDuration === "number" && Number.isFinite(summaryDuration)
      ? Math.max(0, Math.trunc(summaryDuration))
      : Number.isFinite(startedAt) && Number.isFinite(endedAtCandidate)
        ? Math.max(0, endedAtCandidate - startedAt)
        : undefined;
  return {
    status: resolvedStatus,
    ...(resolvedStatus === "cancelled"
      ? { cancelledOutcome: hasSuccessAfterCancelled ? "ended" : "stopped" }
      : {}),
    stepCount: Math.max(1, stepEvents.length || sorted.length),
    currentStep:
      runLifecycleEvent?.summary ?? sorted[sorted.length - 1]?.summary,
    ...(typeof durationMs === "number" ? { durationMs } : {}),
  };
}

export function formatTraceStatusKey(
  summary: Pick<TraceSummary, "status" | "cancelledOutcome">,
): string {
  switch (summary.status) {
    case "running":
      return "process_status_running";
    case "success":
      return "process_status_success";
    case "error":
      return "process_status_error";
    case "cancelled":
      return "process_status_cancelled";
    default:
      return "process_status_idle";
  }
}

export function formatCancelledReasonKey(
  summary: Pick<TraceSummary, "status" | "cancelledOutcome">,
): string | null {
  if (summary.status !== "cancelled") return null;
  return summary.cancelledOutcome === "ended"
    ? "process_cancel_reason_user_ended"
    : "process_cancel_reason_user_stopped";
}

export function computeDurationMs(
  startedAt?: string,
  endedAt?: string,
): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.max(0, end - start);
}

export function aggregateTraceSteps(
  traceEvents: TaskTraceEvent[],
): TraceStep[] {
  const executionTraceEvents = traceEvents.filter(isExecutionTraceEvent);
  if (executionTraceEvents.length === 0) return [];
  const sorted = [...executionTraceEvents].sort((a, b) =>
    a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at),
  );
  const steps: TraceStep[] = [];
  const activeByName = new Map<string, number>();
  for (const evt of sorted) {
    if (
      evt.category === "debug" ||
      evt.name === "run.lifecycle" ||
      evt.name === "run.summary"
    )
      continue;
    const existingIndex = activeByName.get(evt.name);
    const shouldStartNewStep =
      existingIndex == null ||
      evt.phase === "start" ||
      (steps[existingIndex] && steps[existingIndex].status !== "running");
    if (shouldStartNewStep) {
      const step: TraceStep = {
        key: `${evt.id}:${evt.name}`,
        name: evt.name,
        title: evt.summary || evt.name,
        status: evt.status ?? (evt.phase === "start" ? "running" : "idle"),
        startedAt: evt.at,
        endedAt: evt.status && evt.status !== "running" ? evt.at : undefined,
        events: [evt],
      };
      step.durationMs = computeDurationMs(step.startedAt, step.endedAt);
      steps.push(step);
      activeByName.set(evt.name, steps.length - 1);
      continue;
    }
    const step = steps[existingIndex]!;
    step.events.push(evt);
    step.title = evt.summary || step.title || evt.name;
    if (!step.startedAt) step.startedAt = evt.at;
    if (evt.status) {
      step.status = evt.status;
      if (evt.status !== "running") step.endedAt = evt.at;
    } else if (evt.phase === "end" && step.status === "running") {
      step.status = "success";
      step.endedAt = evt.at;
    }
    step.durationMs = computeDurationMs(step.startedAt, step.endedAt);
  }
  return steps;
}

export function formatDuration(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}

export function formatTraceEventTitle(evt: TaskTraceEvent): string {
  if (
    evt.name === "codex.command" &&
    typeof evt.details?.command === "string" &&
    evt.details.command
  )
    return evt.details.command;
  if (
    evt.name === "codex.tool" &&
    typeof evt.details?.tool_name === "string" &&
    evt.details.tool_name
  )
    return `tool: ${evt.details.tool_name}`;
  return evt.summary || evt.name;
}

function getLifecyclePhaseTitle(phase: unknown): string {
  if (
    phase === "queued" ||
    phase === "dispatching" ||
    phase === "running" ||
    phase === "streaming"
  )
    return "process_stage_preparing";
  if (phase === "completed") return "process_stage_completed";
  if (phase === "failed") return "process_stage_failed";
  if (phase === "cancelled") return "process_stage_cancelled";
  return "process_stage_preparing";
}

function summarizeFileChanges(
  details?: Record<string, unknown>,
): string | null {
  const added = Array.isArray(details?.added) ? details.added.length : 0;
  const modified = Array.isArray(details?.modified)
    ? details.modified.length
    : 0;
  const deleted = Array.isArray(details?.deleted) ? details.deleted.length : 0;
  if (added || modified || deleted) {
    return `${added} added · ${modified} modified · ${deleted} deleted`;
  }
  return null;
}

function mapTraceStep(
  step: TraceStep,
  answerPreview?: string,
): RenderableExecutionStep | null {
  const latestEvent = step.events[step.events.length - 1];
  if (!latestEvent) return null;
  if (latestEvent.category === "debug" || getTransportTraceMeta(latestEvent))
    return null;

  if (step.name === "codex.command") {
    const command =
      typeof latestEvent.details?.command === "string" &&
      latestEvent.details.command.trim().length > 0
        ? latestEvent.details.command.trim()
        : formatTraceEventTitle(latestEvent);
    return {
      key: step.key,
      title: "process_stage_running_command",
      detail: truncateStepDetail(command),
      status: step.status,
      at: latestEvent.at,
      traceNames: step.events.map((event) => event.name),
    };
  }

  if (step.name === "codex.tool") {
    const toolName =
      typeof latestEvent.details?.tool_name === "string" &&
      latestEvent.details.tool_name.trim().length > 0
        ? latestEvent.details.tool_name.trim()
        : latestEvent.summary;
    return {
      key: step.key,
      title: "process_stage_using_tool",
      detail: truncateStepDetail(toolName),
      status: step.status,
      at: latestEvent.at,
      traceNames: step.events.map((event) => event.name),
    };
  }

  if (step.name === "workspace.files_changed") {
    return {
      key: step.key,
      title: "process_stage_updating_files",
      detail: truncateStepDetail(
        summarizeFileChanges(latestEvent.details) ?? latestEvent.summary,
      ),
      status: step.status,
      at: latestEvent.at,
      traceNames: step.events.map((event) => event.name),
    };
  }

  if (step.name === "runner.artifact") {
    const filename =
      typeof latestEvent.details?.filename === "string" &&
      latestEvent.details.filename.trim().length > 0
        ? latestEvent.details.filename.trim()
        : latestEvent.summary;
    return {
      key: step.key,
      title: "process_stage_updating_files",
      detail: truncateStepDetail(filename),
      status: step.status,
      at: latestEvent.at,
      traceNames: step.events.map((event) => event.name),
    };
  }

  if (step.name === "codex.output") {
    return {
      key: step.key,
      title: "process_stage_preparing_response",
      detail: truncateStepDetail(answerPreview || latestEvent.summary),
      status: step.status,
      at: latestEvent.at,
      traceNames: step.events.map((event) => event.name),
    };
  }

  if (latestEvent.category === "error" || step.status === "error") {
    return {
      key: step.key,
      title: "process_stage_failed",
      detail: truncateStepDetail(latestEvent.summary),
      status: "error",
      at: latestEvent.at,
      traceNames: step.events.map((event) => event.name),
    };
  }

  if (latestEvent.category === "artifact") {
    return {
      key: step.key,
      title: "process_stage_updating_files",
      detail: truncateStepDetail(latestEvent.summary),
      status: step.status,
      at: latestEvent.at,
      traceNames: step.events.map((event) => event.name),
    };
  }

  if (latestEvent.category === "tool") {
    return {
      key: step.key,
      title: "process_stage_exploring",
      detail: truncateStepDetail(latestEvent.summary),
      status: step.status,
      at: latestEvent.at,
      traceNames: step.events.map((event) => event.name),
    };
  }

  return {
    key: step.key,
    title: "process_stage_preparing",
    detail: latestEvent.summary,
    status: step.status,
    at: latestEvent.at,
    traceNames: step.events.map((event) => event.name),
  };
}

function dedupeRenderableSteps(
  steps: RenderableExecutionStep[],
): RenderableExecutionStep[] {
  const deduped: RenderableExecutionStep[] = [];
  for (const step of steps) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.title === step.title &&
      prev.detail === step.detail &&
      prev.status === step.status
    ) {
      prev.traceNames = Array.from(
        new Set([...prev.traceNames, ...step.traceNames]),
      );
      prev.at = step.at ?? prev.at;
      continue;
    }
    deduped.push(step);
  }
  return deduped;
}

export function buildRenderableExecution(args: {
  traceEvents: TaskTraceEvent[];
  streamingContent?: string | null;
  fallbackAnswer?: string;
}): RenderableExecution {
  const { traceEvents, streamingContent, fallbackAnswer } = args;
  const answerPreview = truncateStepDetail(
    (fallbackAnswer && fallbackAnswer.trim()) ||
      (streamingContent ? decodeCodexEventText(streamingContent).trim() : "") ||
      "",
  );
  const summary = summarizeTraceEvents(traceEvents);
  const steps = dedupeRenderableSteps(
    aggregateTraceSteps(traceEvents)
      .map((step) => mapTraceStep(step, answerPreview))
      .filter((step): step is RenderableExecutionStep => step != null)
      .filter((step) => !isReasoningStep(step)),
  );

  if (steps.length === 0 && summary.status === "running") {
    const lifecycleEvent = [...traceEvents]
      .filter((event) => event.name === "run.lifecycle")
      .sort((a, b) =>
        a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at),
      )
      .at(-1);
    if (lifecycleEvent) {
      steps.push({
        key: `${lifecycleEvent.id}:lifecycle`,
        title: getLifecyclePhaseTitle(lifecycleEvent.details?.run_phase),
        detail: truncateStepDetail(lifecycleEvent.summary),
        status: "running",
        at: lifecycleEvent.at,
        traceNames: [lifecycleEvent.name],
      });
    } else if (streamingContent != null) {
      steps.push({
        key: "streaming-response",
        title: "process_stage_preparing_response",
        detail: answerPreview || "process_writing_final_answer",
        status: "running",
        traceNames: ["streaming.response"],
      });
    }
  }

  return {
    summary: {
      ...summary,
      ...(summary.durationMs != null
        ? { durationText: formatDuration(summary.durationMs) }
        : {}),
    },
    steps,
  };
}
