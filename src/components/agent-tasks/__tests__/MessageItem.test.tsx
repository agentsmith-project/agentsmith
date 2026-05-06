import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageItem } from "../MessageItem";
import type { TaskActivityItem, TaskTraceEvent } from "@/lib/types/task";

vi.mock("@/components/ui/toast", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/chat/Markdown", () => ({
  Markdown: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string | number>) => {
      const formatCount = (
        value: string | number | undefined,
        singular: string,
        plural: string,
      ) => `${value ?? "?"} ${Number(value) === 1 ? singular : plural}`;
      const translations: Record<string, string> = {
        copied: "Copied!",
        copy_failed: "Failed to copy",
        copy: "Copy",
        process_status_idle: "Ready",
        process_status_running: "Running",
        process_status_success: "Completed",
        process_status_error: "Needs retry",
        process_status_cancelled: "Cancelled",
        active_run_status_running: "Running",
        active_run_status_cancelling: "Cancelling",
        active_run_status_reconnecting: "Reconnecting",
        active_run_status_realtime_error: "Realtime updates need attention",
        active_run_status_finalizing: "Saving",
        active_run_status_terminating: "Stopping",
        active_run_latest_action: "Latest action: {summary}",
        runner_test_badge: "runner_test",
        runner_test_source_value: "Developer runner test",
        run_cancel: "Cancel current run",
        run_cancel_submitting: "Cancelling...",
        process_cancel_reason_user_stopped:
          "Reason: interrupted by user (stopped)",
        process_title: "Execution",
        process_details_title: "Execution details",
        process_no_steps: "No recent steps yet",
        process_history_summary: "{count} execution steps",
        process_recovered_summary: "{count} recovered issues",
        process_recovered_history_summary:
          "{recovered} recovered issues · {steps} execution steps",
        process_details_unavailable: "Execution details unavailable",
        process_details_unavailable_description:
          "Execution details could not be loaded. Refresh if the run timeline still looks incomplete.",
        process_details_expand: "Show details",
        process_details_collapse: "Hide details",
        process_history_region_label: "Execution history",
        process_collapse: "Hide full history",
        final_answer_title: "Final answer",
        process_stage_preparing: "Preparing",
        process_stage_exploring: "Exploring",
        process_stage_running_command: "Running command",
        process_stage_using_tool: "Using tool",
        process_stage_updating_files: "Updating files",
        process_stage_workspace_diagnostics: "Workspace changes",
        process_stage_runner_output: "Generated output",
        process_stage_preparing_response: "Preparing response",
        process_stage_failed: "Failed",
        process_recovered_issues_title: "Recovered issues",
        process_writing_final_answer: "Writing final answer",
        process_loading: "Loading execution details...",
        process_more_available: "Older steps are available",
        process_load_more: "Load older steps",
        process_load_more_loading: "Loading...",
      };
      if (key === "process_duration")
        return `Duration: ${values?.value ?? "?"}`;
      if (key === "process_recent_steps")
        return `Showing latest ${values?.count ?? "?"} steps`;
      if (key === "process_history_summary")
        return formatCount(values?.count, "execution step", "execution steps");
      if (key === "process_recovered_summary")
        return formatCount(values?.count, "recovered issue", "recovered issues");
      if (key === "process_recovered_history_summary")
        return `${formatCount(
          values?.recovered,
          "recovered issue",
          "recovered issues",
        )} · ${formatCount(
          values?.steps,
          "execution step",
          "execution steps",
        )}`;
      if (key === "process_expand")
        return `Show full history (+${values?.count ?? "?"})`;
      if (key === "active_run_elapsed")
        return `Elapsed: ${values?.duration ?? "?"}`;
      if (key === "active_run_latest_action")
        return `Latest action: ${values?.summary ?? "?"}`;
      return translations[key] || key;
    },
}));

describe("MessageItem", () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined);

  const userMessage: TaskActivityItem = {
    id: "msg-user",
    task_id: "task-1",
    kind: "user_intent",
    actor: "user",
    content: "Hello from user",
    created_at: "2024-01-01T14:30:00Z",
  };

  const agentMessage: TaskActivityItem = {
    id: "msg-agent",
    task_id: "task-1",
    kind: "runner_output",
    actor: "runner",
    content: "Final **answer**",
    created_at: "2024-01-01T14:31:00Z",
  };

  const commandTrace = (
    seq: number,
    phase: "start" | "end",
    status: "running" | "success",
  ): TaskTraceEvent => ({
    id: `trace-command-${seq}`,
    task_id: "task-1",
    message_id: "msg-agent",
    run_id: "run-1",
    seq,
    at: `2024-01-01T14:31:0${seq}Z`,
    category: "tool",
    phase,
    status,
    name: "codex.command",
    summary: phase === "start" ? "Command started" : "Command completed",
    details: { command: "pnpm test --filter agent-task" },
  });

  beforeAll(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock, readText: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const activeRunView = (overrides = {}) => ({
    messageId: "msg-agent",
    runState: "running" as const,
    latestAction: { kind: "command" as const, summary: "pnpm test --filter agent-task" },
    recentActions: [],
    startedAt: "2024-01-01T14:31:00Z",
    elapsedSeconds: 65,
    cancelPending: false,
    onCancel: vi.fn(),
    realtimeHealth: { status: "connected" as const },
    ...overrides,
  });

  it("renders user messages unchanged", () => {
    const { container } = render(<MessageItem message={userMessage} />);
    expect(screen.getByTestId("markdown-content")).toHaveTextContent(
      "Hello from user",
    );
    expect(
      screen.queryByTestId("agent-tasks__message-process-panel"),
    ).not.toBeInTheDocument();
    expect(container.firstElementChild?.firstElementChild?.className ?? "").toContain("max-w-[min(680px,62%)]");
    expect(container.firstElementChild?.firstElementChild?.className ?? "").not.toContain("w-full");
  });

  it("renders agent message as a single trace-first bubble with collapsible process details before the final answer", async () => {
    const user = userEvent.setup();
    render(
      <MessageItem
        message={agentMessage}
        traceEvents={[
          commandTrace(1, "start", "running"),
          commandTrace(2, "end", "success"),
        ]}
      />,
    );

    const bubble = screen.getByTestId("agent-tasks__agent-message-bubble");
    expect(bubble).toBeInTheDocument();
    expect(bubble.className).toContain("w-full");
    expect(bubble.className).toContain("max-w-[1120px]");
    expect(
      screen.getByTestId("agent-tasks__message-process-panel"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("agent-tasks__message-final-answer"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("markdown-content")).toHaveTextContent(
      "Final **answer**",
    );
    expect(screen.getByTestId("agent-tasks__message-final-answer").innerHTML).toContain("max-w-[88ch]");
    expect(screen.queryByText("Running command")).not.toBeInTheDocument();
    expect(
      screen.queryByText("pnpm test --filter agent-task"),
    ).not.toBeInTheDocument();

    const processPanel = screen.getByTestId("agent-tasks__message-process-panel");
    const finalAnswer = screen.getByTestId("agent-tasks__message-final-answer");
    expect(
      processPanel.compareDocumentPosition(finalAnswer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );
    expect(screen.getByText("Running command")).toBeInTheDocument();
    expect(screen.getByText("Command completed #2")).toBeInTheDocument();
    expect(
      screen.queryByText("pnpm test --filter agent-task"),
    ).not.toBeInTheDocument();
  });

  it("renders agent status metadata in the footer", () => {
    render(
      <MessageItem
        message={agentMessage}
        traceEvents={[
          commandTrace(1, "start", "running"),
          commandTrace(2, "end", "success"),
          {
            id: "trace-summary",
            task_id: "task-1",
            message_id: "msg-agent",
            run_id: "run-1",
            seq: 3,
            at: "2024-01-01T14:31:03Z",
            category: "progress",
            phase: "end",
            status: "success",
            name: "run.summary",
            summary: "Run completed",
            details: { final_status: "success", duration_ms: 55000 },
          },
        ]}
      />,
    );

    const footer = screen.getByTestId("agent-tasks__message-status-footer");
    expect(within(footer).getByTestId("agent-tasks__message-run-status")).toHaveTextContent(
      "Completed",
    );
    expect(within(footer).getByTestId("agent-tasks__message-run-duration")).toHaveTextContent(
      "Duration: 55s",
    );
    expect(within(footer).getByText("06:31 AM")).toBeInTheDocument();
  });

  it("surfaces runner_test source on execution summary messages", () => {
    render(
      <MessageItem
        message={{
          ...agentMessage,
          id: "msg-runner-test",
          run_id: "run_runner_test_1",
          source: "runner_test",
          runner_test: true,
        } as TaskActivityItem}
      />,
    );

    const footer = screen.getByTestId("agent-tasks__message-status-footer");
    const badge = within(footer).getByTestId("agent-tasks__runner-test-badge");
    expect(badge).toHaveTextContent("runner_test");
    expect(badge).toHaveAttribute("title", "Developer runner test");
  });

  it("does not render raw trace error messages inside expanded process details", async () => {
    const user = userEvent.setup();

    render(
      <MessageItem
        message={agentMessage}
        traceError={{
          kind: "trace_network",
          message: "fetch failed: token=raw-secret upstream=trace-store",
        }}
      />,
    );

    expect(screen.getByTestId("agent-tasks__message-process-summary")).toHaveTextContent(
      "Execution details unavailable",
    );

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );

    expect(screen.getByTestId("agent-tasks__message-process-error")).toHaveTextContent(
      "Execution details could not be loaded. Refresh if the run timeline still looks incomplete.",
    );
    expect(screen.queryByText(/token=raw-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/upstream=trace-store/)).not.toBeInTheDocument();
  });

  it("keeps ordinary execution-detail copy free of diagnostics and raw runner terms", async () => {
    const user = userEvent.setup();
    const ordinaryTaskDenylist = [
      /runner/i,
      /diagnostics/i,
      /diagnostic id/i,
      /diagnostic entrypoint/i,
      /raw event/i,
      /raw diagnostics/i,
      /reason_code/i,
      /required_permissions/i,
    ];

    render(
      <MessageItem
        message={agentMessage}
        traceError={{
          kind: "trace_network",
          message:
            "runner diagnostics diagnostic id diag_123 diagnostic entrypoint /raw reason_code=agent_runner_unavailable required_permissions=project:agent_runner:read raw event",
        }}
      />,
    );

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );

    const renderedCopy =
      screen.getByTestId("agent-tasks__agent-message-bubble").textContent ?? "";
    for (const denied of ordinaryTaskDenylist) {
      expect(renderedCopy).not.toMatch(denied);
    }
  });

  it("does not render raw trace summary or command details inside expanded execution details", async () => {
    const user = userEvent.setup();
    const traces: TaskTraceEvent[] = [
      {
        id: "trace-malicious-command",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 1,
        at: "2024-01-01T14:31:01Z",
        category: "tool",
        phase: "end",
        status: "success",
        name: "codex.command",
        summary:
          "raw event TOKEN=abc secret required_permissions reason_code raw diagnostics /internal/diagnostic_entrypoint",
        details: {
          command: "TOKEN=abc secret /internal/diagnostic_entrypoint",
          tool_name: "diagnostic_entrypoint",
          required_permissions: ["project:agent_runner:read"],
          reason_code: "agent_runner_unavailable",
          diagnostics: "raw diagnostics",
        },
      },
    ];

    render(<MessageItem message={agentMessage} traceEvents={traces} />);

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );

    const renderedCopy =
      screen.getByTestId("agent-tasks__agent-message-bubble").textContent ?? "";
    expect(renderedCopy).toContain("Running command");
    for (const denied of [
      "TOKEN=abc",
      "secret",
      "required_permissions",
      "reason_code",
      "raw event",
      "raw diagnostics",
      "/internal/",
      "diagnostic_entrypoint",
    ]) {
      expect(renderedCopy).not.toContain(denied);
    }
  });

  it("keeps recovered issues separate from execution history and shows recovered details only when expanded", async () => {
    const user = userEvent.setup();
    const traces: TaskTraceEvent[] = [
      {
        id: "trace-command-failed",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 1,
        at: "2024-01-01T14:31:01Z",
        category: "error",
        phase: "end",
        status: "error",
        name: "codex.command",
        summary: "Command failed",
        details: { command: "npm run agent-task:probe" },
      },
      {
        id: "trace-files-changed",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 2,
        at: "2024-01-01T14:31:02Z",
        category: "artifact",
        phase: "end",
        status: "success",
        name: "workspace.files_changed",
        summary: "Workspace files changed",
        details: {
          added: ["reports/result.md"],
          modified: ["src/agent-tasks.ts"],
          deleted: [],
        },
      },
      {
        id: "trace-summary",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 3,
        at: "2024-01-01T14:31:03Z",
        category: "progress",
        phase: "end",
        status: "success",
        name: "run.summary",
        summary: "Run completed",
        details: { final_status: "success", duration_ms: 1800 },
      },
    ];

    render(
      <MessageItem
        message={{ ...agentMessage, content: "Recovered final answer" }}
        traceEvents={traces}
      />,
    );

    expect(screen.getByTestId("agent-tasks__message-run-status")).toHaveTextContent(
      "Completed",
    );
    expect(screen.getByTestId("agent-tasks__message-run-status")).not.toHaveTextContent(
      "Completed with recovered issues",
    );
    expect(screen.queryByText("Needs retry")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-tasks__message-final-answer")).toHaveTextContent(
      "Recovered final answer",
    );

    const bubble = screen.getByTestId("agent-tasks__agent-message-bubble");
    const processPanel = screen.getByTestId("agent-tasks__message-process-panel");
    const finalAnswer = screen.getByTestId("agent-tasks__message-final-answer");
    expect(
      processPanel.compareDocumentPosition(finalAnswer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.queryByText("Command failed")).not.toBeInTheDocument();
    expect(screen.queryByText("npm run agent-task:probe")).not.toBeInTheDocument();
    expect(within(bubble).queryByText(/Artifact/i)).not.toBeInTheDocument();
    expect(within(bubble).queryByText(/产物/)).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-tasks__message-process-summary")).toHaveTextContent(
      "1 execution step",
    );
    expect(screen.getByTestId("agent-tasks__message-process-summary")).not.toHaveTextContent(
      "recovered issue",
    );

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );

    const recoveredIssues = screen.getByTestId(
      "agent-tasks__message-recovered-issues",
    );
    expect(within(recoveredIssues).getByText("Recovered issues")).toBeInTheDocument();
    expect(within(recoveredIssues).getByText("Running command")).toBeInTheDocument();
    expect(
      within(recoveredIssues).getByText("Command failed #1"),
    ).toBeInTheDocument();
    expect(
      within(recoveredIssues).queryByText("npm run agent-task:probe"),
    ).not.toBeInTheDocument();

    const history = screen.getByTestId("agent-tasks__message-process-steps");
    expect(within(history).getByText("Workspace changes")).toBeInTheDocument();
    expect(within(history).getByText("1 added · 1 modified · 0 deleted")).toBeInTheDocument();
    expect(within(history).queryByText("npm run agent-task:probe")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("agent-tasks__message-step-row")).toHaveLength(2);
  });

  it("filters recovered reasoning and thinking issues without changing the successful run state", async () => {
    const user = userEvent.setup();
    const traces: TaskTraceEvent[] = [
      {
        id: "trace-recovered-reasoning",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 1,
        at: "2024-01-01T14:31:01Z",
        category: "error",
        phase: "end",
        status: "error",
        name: "codex.reasoning",
        summary: "private reasoning detail should never render",
      },
      {
        id: "trace-recovered-thinking",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 2,
        at: "2024-01-01T14:31:02Z",
        category: "progress",
        phase: "end",
        status: "cancelled",
        name: "codex.thinking",
        summary: "private thinking detail should never render",
      },
      {
        id: "trace-visible-command",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 3,
        at: "2024-01-01T14:31:03Z",
        category: "tool",
        phase: "end",
        status: "success",
        name: "codex.command",
        summary: "Command completed",
        details: { command: "npm run agent-task:probe" },
      },
      {
        id: "trace-summary",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 4,
        at: "2024-01-01T14:31:04Z",
        category: "progress",
        phase: "end",
        status: "success",
        name: "run.summary",
        summary: "Run completed",
        details: { final_status: "success", duration_ms: 2400 },
      },
    ];

    render(
      <MessageItem
        message={{ ...agentMessage, content: "Successful final answer" }}
        traceEvents={traces}
      />,
    );

    expect(screen.getByTestId("agent-tasks__message-run-status")).toHaveTextContent(
      "Completed",
    );
    expect(screen.getByTestId("agent-tasks__message-final-answer")).toHaveTextContent(
      "Successful final answer",
    );

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );

    expect(
      screen.queryByTestId("agent-tasks__message-recovered-issues"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/private reasoning detail/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/private thinking detail/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Running command")).toBeInTheDocument();
    expect(screen.getByText("Command completed #3")).toBeInTheDocument();
    expect(screen.queryByText("npm run agent-task:probe")).not.toBeInTheDocument();
  });

  it("keeps trace errors collapsed with an unavailable-details summary while the trace slot stays before the final answer", async () => {
    const user = userEvent.setup();

    render(
      <MessageItem
        message={{ ...agentMessage, content: "Final answer from backend truth" }}
        traceError={{
          kind: "trace_failed",
          message: "Trace detail fetch failed",
        }}
      />,
    );

    expect(screen.getByTestId("agent-tasks__message-final-answer")).toHaveTextContent(
      "Final answer from backend truth",
    );
    expect(screen.getByTestId("agent-tasks__message-process-summary")).toHaveTextContent(
      "Execution details unavailable",
    );
    expect(screen.queryByText("Trace detail fetch failed")).not.toBeInTheDocument();

    const processPanel = screen.getByTestId("agent-tasks__message-process-panel");
    const finalAnswer = screen.getByTestId("agent-tasks__message-final-answer");
    expect(
      processPanel.compareDocumentPosition(finalAnswer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );
    expect(screen.queryByText("Trace detail fetch failed")).not.toBeInTheDocument();
    expect(screen.getByText(
      "Execution details could not be loaded. Refresh if the run timeline still looks incomplete.",
    )).toBeInTheDocument();
  });

  it("wires execution details and history toggles to expanded regions", async () => {
    const user = userEvent.setup();
    const traces = Array.from({ length: 4 }, (_, index) => ({
      id: `trace-${index + 1}`,
      task_id: "task-1",
      message_id: "msg-agent",
      run_id: "run-1",
      seq: index + 1,
      at: `2024-01-01T14:31:${String(index).padStart(2, "0")}Z`,
      category: "tool" as const,
      phase: "end" as const,
      status: "success" as const,
      name: "codex.tool",
      summary: `Tool call completed: tool-${index + 1}`,
      details: { tool_name: `tool-${index + 1}` },
    }));

    render(<MessageItem message={agentMessage} traceEvents={traces} />);

    const detailsToggle = screen.getByTestId(
      "agent-tasks__message-process-details-toggle",
    );
    const detailsRegionId = detailsToggle.getAttribute("aria-controls");
    expect(detailsToggle).toHaveAttribute("aria-expanded", "false");
    expect(detailsRegionId).toBeTruthy();
    expect(
      detailsRegionId
        ? document.getElementById(detailsRegionId)
        : null,
    ).not.toBeInTheDocument();

    await user.click(detailsToggle);

    expect(detailsToggle).toHaveAttribute("aria-expanded", "true");
    const detailsRegion = detailsRegionId
      ? document.getElementById(detailsRegionId)
      : null;
    expect(detailsRegion).toHaveAttribute("role", "region");
    expect(detailsRegion).toHaveAttribute("aria-label", "Execution details");

    const historyToggle = screen.getByTestId("agent-tasks__message-process-toggle");
    const historyRegionId = historyToggle.getAttribute("aria-controls");
    expect(historyToggle).toHaveAttribute("aria-expanded", "false");
    expect(historyRegionId).toBeTruthy();
    const historyRegion = historyRegionId
      ? document.getElementById(historyRegionId)
      : null;
    expect(historyRegion).toHaveAttribute("role", "region");
    expect(historyRegion).toHaveAttribute("aria-label", "Execution history");
    expect(within(historyRegion as HTMLElement).getAllByTestId("agent-tasks__message-step-row")).toHaveLength(2);

    await user.click(historyToggle);
    expect(historyToggle).toHaveAttribute("aria-expanded", "true");
    expect(within(historyRegion as HTMLElement).getAllByTestId("agent-tasks__message-step-row")).toHaveLength(4);
  });

  it("labels runner artifact trace events as generated output instead of artifact truth", async () => {
    const user = userEvent.setup();
    const traces: TaskTraceEvent[] = [
      {
        id: "trace-runner-artifact",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 1,
        at: "2024-01-01T14:31:01Z",
        category: "artifact",
        phase: "end",
        status: "success",
        name: "runner.artifact",
        summary: "Generated output",
        details: { filename: "reports/result.md" },
      },
    ];

    render(<MessageItem message={agentMessage} traceEvents={traces} />);

    expect(screen.getByTestId("agent-tasks__message-process-summary")).toHaveTextContent(
      "1 execution step",
    );

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );

    const bubble = screen.getByTestId("agent-tasks__agent-message-bubble");
    expect(screen.getAllByText("Generated output").length).toBeGreaterThan(0);
    expect(screen.queryByText("reports/result.md")).not.toBeInTheDocument();
    expect(within(bubble).queryByText(/Artifact/i)).not.toBeInTheDocument();
    expect(within(bubble).queryByText(/产物/)).not.toBeInTheDocument();
  });

  it("keeps pending final answer and active footer visible after refresh recovery", () => {
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        activeRunView={activeRunView()}
        traceEvents={[]}
      />,
    );

    expect(screen.getByTestId("agent-tasks__message-final-answer-pending")).toBeInTheDocument();
    expect(screen.getByTestId("agent-tasks__message-active-run-footer")).toHaveTextContent("Running");
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("keeps the active run process slot before a final answer even before traces arrive", () => {
    render(
      <MessageItem
        message={{
          ...agentMessage,
          content: "Final answer arrived before the first trace event",
        }}
        activeRunView={activeRunView()}
        traceEvents={[]}
      />,
    );

    const processPanel = screen.getByTestId("agent-tasks__message-process-panel");
    const finalAnswer = screen.getByTestId("agent-tasks__message-final-answer");
    expect(processPanel).toBeInTheDocument();
    expect(processPanel).toHaveTextContent("No recent steps yet");
    expect(finalAnswer).toHaveTextContent(
      "Final answer arrived before the first trace event",
    );
    expect(
      processPanel.compareDocumentPosition(finalAnswer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows active run elapsed time, latest action, subtle motion, and cancel control in the AI bubble footer", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        streamingContent="Streaming reply"
        traceEvents={[commandTrace(1, "start", "running")]}
        activeRunView={activeRunView({ elapsedSeconds: 65, onCancel })}
      />,
    );

    const footer = screen.getByTestId("agent-tasks__message-active-run-footer");
    const status = within(footer).getByTestId("agent-tasks__message-active-run-status");
    expect(status).toHaveTextContent("Running");
    expect(status.querySelector(".animate-ping")).toBeTruthy();
    expect(within(footer).getByTestId("agent-tasks__message-active-run-elapsed")).toHaveTextContent("Elapsed: 1m 5s");
    expect(within(footer).getByTestId("agent-tasks__message-active-run-latest-action")).toHaveTextContent("Latest action: pnpm test --filter agent-task");

    await user.click(within(footer).getByTestId("agent-tasks__message-active-run-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps a long latest action in the active footer left column without letting it wrap or squeeze cancel", () => {
    const longLatestAction =
      "python scripts/run_agent_task_recovery_probe.py --workspace very-long-workspace-name --project very-long-project-name --task very-long-task-name --with-many-flags --and-extra-operator-context --final-marker";

    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        activeRunView={activeRunView({
          latestAction: { kind: "command", summary: longLatestAction },
          recentActions: [],
        })}
      />,
    );

    const footer = screen.getByTestId("agent-tasks__message-active-run-footer");
    const meta = within(footer).getByTestId("agent-tasks__message-active-run-meta");
    const latestAction = within(footer).getByTestId(
      "agent-tasks__message-active-run-latest-action",
    );
    const cancel = within(footer).getByTestId(
      "agent-tasks__message-active-run-cancel",
    );

    expect(footer).toHaveClass("grid");
    expect(footer).toHaveClass("grid-cols-[minmax(0,1fr)_auto]");
    expect(footer).not.toHaveClass("flex-wrap");
    expect(meta).toHaveClass("min-w-0");
    expect(meta).toHaveClass("overflow-hidden");
    expect(latestAction).toHaveClass("min-w-0");
    expect(latestAction).toHaveClass("truncate");
    expect(latestAction).toHaveClass("whitespace-nowrap");
    expect(latestAction).toHaveAttribute("title", longLatestAction);
    expect(cancel).toHaveClass("shrink-0");
    expect(cancel).toHaveClass("whitespace-nowrap");
    expect(cancel).toHaveAccessibleName("Cancel current run");
  });

  it("keeps the active footer two-column layout stable when there is no latest action", () => {
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        activeRunView={activeRunView({
          latestAction: { kind: "system", summary: "" },
          recentActions: [],
        })}
      />,
    );

    const footer = screen.getByTestId("agent-tasks__message-active-run-footer");
    const meta = within(footer).getByTestId("agent-tasks__message-active-run-meta");
    const cancel = within(footer).getByTestId(
      "agent-tasks__message-active-run-cancel",
    );

    expect(footer).toHaveClass("grid");
    expect(footer).toHaveClass("grid-cols-[minmax(0,1fr)_auto]");
    expect(meta).toHaveClass("min-w-0");
    expect(meta).toHaveClass("overflow-hidden");
    expect(
      within(footer).queryByTestId("agent-tasks__message-active-run-latest-action"),
    ).not.toBeInTheDocument();
    expect(cancel).toHaveClass("shrink-0");
    expect(cancel).toHaveClass("whitespace-nowrap");
    expect(cancel).toHaveAccessibleName("Cancel current run");
  });

  it("keeps traceName latest action click and cancel click independent in the active footer", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onRunActionClick = vi.fn();
    const actionSummary = "npm run focused:agent-task-footer";

    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        activeRunView={activeRunView({
          latestAction: { kind: "command", summary: "fallback command" },
          recentActions: [
            {
              id: "trace-command-action",
              kind: "command",
              summary: actionSummary,
              ageSeconds: 2,
              traceName: "codex.command",
            },
          ],
          onCancel,
        })}
        onRunActionClick={onRunActionClick}
      />,
    );

    const footer = screen.getByTestId("agent-tasks__message-active-run-footer");
    await user.click(
      within(footer).getByTestId("agent-tasks__message-active-run-latest-action"),
    );
    await user.click(
      within(footer).getByTestId("agent-tasks__message-active-run-cancel"),
    );

    expect(onRunActionClick).toHaveBeenCalledWith({
      traceName: "codex.command",
      summary: actionSummary,
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the active footer cancel button while the current run cancel request is pending", () => {
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        activeRunView={activeRunView({
          runState: "cancelling",
          cancelPending: true,
        })}
      />,
    );

    const cancel = screen.getByTestId("agent-tasks__message-active-run-cancel");
    expect(cancel).toBeDisabled();
    expect(cancel).toHaveTextContent("Cancelling...");
  });

  it("shows reconnecting health in the active footer without adding transport noise to the trace body", () => {
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        activeRunView={activeRunView({
          realtimeHealth: { status: "reconnecting" },
        })}
        traceEvents={[
          {
            id: "trace-transport",
            task_id: "task-1",
            message_id: "msg-agent",
            run_id: "run-1",
            seq: 1,
            at: "2024-01-01T14:31:01Z",
            category: "debug",
            phase: "end",
            status: "success",
            name: "transport.reconnect",
            summary: "Reconnect succeeded",
            details: {
              transport_kind: "reconcile",
              transport_phase: "done",
            },
          },
        ]}
      />,
    );

    expect(screen.getByTestId("agent-tasks__message-active-run-status")).toHaveTextContent("Reconnecting");
    expect(screen.queryByText("Reconnect succeeded")).not.toBeInTheDocument();
  });

  it("shows disconnected health in the active footer instead of creating message body noise", () => {
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        activeRunView={activeRunView({
          realtimeHealth: { status: "disconnected" },
        })}
        traceEvents={[
          {
            id: "trace-watchdog",
            task_id: "task-1",
            message_id: "msg-agent",
            run_id: "run-1",
            seq: 1,
            at: "2024-01-01T14:31:01Z",
            category: "debug",
            phase: "end",
            status: "success",
            name: "transport.watchdog",
            summary: "Watchdog marked stream stale",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("agent-tasks__message-active-run-status")).toHaveTextContent("Reconnecting");
    expect(screen.queryByText("Watchdog marked stream stale")).not.toBeInTheDocument();
  });

  it.each([
    ["cancelling", "Cancelling"],
    ["terminating", "Stopping"],
    ["finalizing", "Saving"],
  ] as const)(
    "keeps %s lifecycle state ahead of reconnecting realtime health",
    (runState, expectedStatus) => {
      render(
        <MessageItem
          message={{ ...agentMessage, content: "" }}
          activeRunView={activeRunView({
            runState,
            realtimeHealth: { status: "reconnecting" },
          })}
        />,
      );

      const status = screen.getByTestId("agent-tasks__message-active-run-status");
      expect(status).toHaveTextContent(expectedStatus);
      expect(status).not.toHaveTextContent("Reconnecting");
    },
  );

  it("shows a distinct realtime error signal in the active footer", () => {
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        activeRunView={activeRunView({
          realtimeHealth: {
            status: "error",
            code: "TASK_EVENTS_RECOVERY_EXHAUSTED",
            message: "Realtime recovery exhausted",
          },
        })}
      />,
    );

    const status = screen.getByTestId("agent-tasks__message-active-run-status");
    expect(status).toHaveTextContent("Realtime updates need attention");
    expect(status).not.toHaveTextContent("Reconnecting");
  });

  it("shows only recent steps by default and lets the user expand earlier steps", async () => {
    const user = userEvent.setup();
    const traces = Array.from({ length: 8 }, (_, index) => ({
      id: `trace-${index + 1}`,
      task_id: "task-1",
      message_id: "msg-agent",
      run_id: "run-1",
      seq: index + 1,
      at: `2024-01-01T14:31:${String(index).padStart(2, "0")}Z`,
      category: "tool" as const,
      phase: "end" as const,
      status: "success" as const,
      name: "codex.tool",
      summary: `Tool call completed: tool-${index + 1}`,
      details: { tool_name: `tool-${index + 1}` },
    }));

    render(<MessageItem message={agentMessage} traceEvents={traces} />);

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );
    expect(screen.getAllByTestId("agent-tasks__message-step-row")).toHaveLength(2);
    expect(
      screen.getByTestId("agent-tasks__message-process-toggle"),
    ).toHaveTextContent("Show full history (+6)");

    await user.click(screen.getByTestId("agent-tasks__message-process-toggle"));
    expect(screen.getAllByTestId("agent-tasks__message-step-row")).toHaveLength(8);
    expect(
      screen.getByTestId("agent-tasks__message-process-toggle"),
    ).toHaveTextContent("Hide full history");
  });

  it("loads initial traces lazily for runner messages without local trace data", () => {
    const onTraceExpand = vi.fn();
    render(
      <MessageItem message={agentMessage} onTraceExpand={onTraceExpand} />,
    );
    expect(onTraceExpand).toHaveBeenCalledWith("msg-agent");
  });

  it("shows load more only when expanded and older traces are available", async () => {
    const user = userEvent.setup();
    const onTraceLoadMore = vi.fn();
    const traces = Array.from({ length: 7 }, (_, index) => ({
      id: `trace-${index + 1}`,
      task_id: "task-1",
      message_id: "msg-agent",
      run_id: "run-1",
      seq: index + 1,
      at: `2024-01-01T14:31:${String(index).padStart(2, "0")}Z`,
      category: "tool" as const,
      phase: "end" as const,
      status: "success" as const,
      name: "codex.tool",
      summary: `Tool call completed: tool-${index + 1}`,
      details: { tool_name: `tool-${index + 1}` },
    }));

    render(
      <MessageItem
        message={agentMessage}
        traceEvents={traces}
        traceHasMore
        onTraceLoadMore={onTraceLoadMore}
      />,
    );

    expect(
      screen.queryByTestId("agent-tasks__message-trace-load-more"),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );
    expect(
      screen.queryByTestId("agent-tasks__message-trace-load-more"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId("agent-tasks__message-process-toggle"));
    await user.click(screen.getByTestId("agent-tasks__message-trace-load-more"));
    expect(onTraceLoadMore).toHaveBeenCalledWith("msg-agent");
  });

  it("filters reasoning-only preparing steps, hides per-step status text, and preserves long user-visible details", async () => {
    const user = userEvent.setup();
    const longCommand =
      "python scripts/run_very_long_agent_task_smoke_command_with_extra_arguments_and_flags.py --flag-one --flag-two --flag-three --flag-four --flag-five --flag-six --flag-seven --flag-eight --flag-nine --flag-ten --flag-eleven --flag-twelve --flag-thirteen --flag-fourteen --flag-fifteen --flag-sixteen --flag-seventeen --flag-eighteen --flag-nineteen --flag-twenty --flag-twenty-one --flag-twenty-two --flag-twenty-three --flag-twenty-four --flag-twenty-five --flag-twenty-six --flag-twenty-seven --flag-twenty-eight --flag-twenty-nine --flag-thirty";
    const longToolName = `tool-${"name-segment-".repeat(40)}final`;
    const longRunnerOutput = `reports/${"nested-output-folder/".repeat(22)}final-result.md`;
    const longProgressText = `Visible progress ${"with important operator context ".repeat(32)}final marker`;
    const traces: TaskTraceEvent[] = [
      {
        id: "trace-reasoning",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 1,
        at: "2024-01-01T14:31:00Z",
        category: "progress",
        phase: "end",
        status: "running",
        name: "codex.reasoning",
        summary: "Reasoning about the task in detail before taking any action",
      },
      {
        id: "trace-command-long",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 2,
        at: "2024-01-01T14:31:01Z",
        category: "tool",
        phase: "end",
        status: "success",
        name: "codex.command",
        summary: "Command completed",
        details: { command: longCommand },
      },
      {
        id: "trace-tool-long",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 3,
        at: "2024-01-01T14:31:02Z",
        category: "tool",
        phase: "end",
        status: "success",
        name: "codex.tool",
        summary: "Tool call completed",
        details: { tool_name: longToolName },
      },
      {
        id: "trace-runner-output-long",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 4,
        at: "2024-01-01T14:31:03Z",
        category: "artifact",
        phase: "end",
        status: "success",
        name: "runner.artifact",
        summary: "Generated output",
        details: { filename: longRunnerOutput },
      },
      {
        id: "trace-progress-long",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 5,
        at: "2024-01-01T14:31:04Z",
        category: "progress",
        phase: "end",
        status: "success",
        name: "codex.progress",
        summary: longProgressText,
      },
    ];

    render(<MessageItem message={agentMessage} traceEvents={traces} />);
    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );
    await user.click(screen.getByTestId("agent-tasks__message-process-toggle"));

    expect(
      screen.queryByText(/Reasoning about the task/i),
    ).not.toBeInTheDocument();
    const stepRow = screen.getAllByTestId("agent-tasks__message-step-row")[0];
    expect(within(stepRow).queryByText("Completed")).not.toBeInTheDocument();
    const detailText = screen
      .getAllByTestId("agent-tasks__message-step-detail")
      .map((element) => element.textContent ?? "")
      .join("\n");
    expect(detailText).toContain("Command completed #2");
    expect(detailText).toContain("Tool completed #3");
    expect(detailText).toContain("Generated output");
    expect(detailText).not.toContain(longCommand);
    expect(detailText).not.toContain(longToolName);
    expect(detailText).not.toContain(longRunnerOutput);
    expect(detailText).toContain(longProgressText);
    expect(detailText).not.toContain("…");
  });

  it("shows a short preparing response summary while preserving final answer line breaks", async () => {
    const user = userEvent.setup();
    const traces: TaskTraceEvent[] = [
      {
        id: "trace-output",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 1,
        at: "2024-01-01T14:31:01Z",
        category: "progress",
        phase: "end",
        status: "success",
        name: "codex.output",
        summary: "Agent message completed",
      },
    ];

    render(
      <MessageItem
        message={{ ...agentMessage, content: "Line one\nLine two\nLine three" }}
        traceEvents={traces}
      />,
    );

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );
    expect(screen.getByText("Preparing response")).toBeInTheDocument();
    const processSteps = screen.getByTestId("agent-tasks__message-process-steps");
    expect(within(processSteps).getByText("Agent message completed")).toBeInTheDocument();
    expect(within(processSteps).queryByText(/Line one/)).not.toBeInTheDocument();
    expect(within(processSteps).queryByText(/Line two/)).not.toBeInTheDocument();
    expect(within(processSteps).queryByText(/Line three/)).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-tasks__message-final-answer"),
    ).toHaveTextContent("Line one Line two Line three");
  });

  it("keeps long final answers out of codex.output execution details while preserving the final answer body", async () => {
    const user = userEvent.setup();
    const longFinalAnswer = [
      "Final answer unique opening marker.",
      "This is the complete final answer body ".repeat(80),
      "Final answer unique closing marker.",
    ].join("\n");
    const traces: TaskTraceEvent[] = [
      {
        id: "trace-output-long-final-answer",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 1,
        at: "2024-01-01T14:31:01Z",
        category: "progress",
        phase: "end",
        status: "success",
        name: "codex.output",
        summary: "Agent message completed",
      },
    ];

    render(
      <MessageItem
        message={{ ...agentMessage, content: longFinalAnswer }}
        traceEvents={traces}
      />,
    );

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );

    const processSteps = screen.getByTestId("agent-tasks__message-process-steps");
    expect(within(processSteps).getByText("Agent message completed")).toBeInTheDocument();
    expect(processSteps).not.toHaveTextContent(
      "Final answer unique opening marker.",
    );
    expect(processSteps).not.toHaveTextContent(
      "Final answer unique closing marker.",
    );
    expect(processSteps).not.toHaveTextContent(longFinalAnswer);

    const finalAnswerText =
      screen.getByTestId("agent-tasks__message-final-answer").textContent ?? "";
    expect(finalAnswerText).toContain("Final answer unique opening marker.");
    expect(finalAnswerText).toContain("Final answer unique closing marker.");
    expect(
      finalAnswerText.match(/This is the complete final answer body/g),
    ).toHaveLength(80);
  });

  it("does not silently truncate user-visible AI progress text and still hides internal reasoning", async () => {
    const user = userEvent.setup();
    const longVisibleProgress = [
      "Line one from the visible progress trace.",
      "Line two keeps important context for the operator.",
      "Line three includes the final confirmation marker.",
      "Line four should remain visible instead of being silently clipped.",
    ].join("\n");
    const traces: TaskTraceEvent[] = [
      {
        id: "trace-thinking",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 1,
        at: "2024-01-01T14:31:00Z",
        category: "progress",
        phase: "end",
        status: "running",
        name: "codex.thinking",
        summary: "thinking through private chain of thought",
      },
      {
        id: "trace-output-long",
        task_id: "task-1",
        message_id: "msg-agent",
        run_id: "run-1",
        seq: 2,
        at: "2024-01-01T14:31:01Z",
        category: "progress",
        phase: "end",
        status: "success",
        name: "codex.progress",
        summary: longVisibleProgress,
      },
    ];

    render(
      <MessageItem
        message={{ ...agentMessage, content: "Final answer after visible progress" }}
        traceEvents={traces}
      />,
    );

    await user.click(
      screen.getByTestId("agent-tasks__message-process-details-toggle"),
    );
    const processSteps = screen.getByTestId("agent-tasks__message-process-steps");
    expect(within(processSteps).queryByText(/private chain of thought/i)).not.toBeInTheDocument();
    expect(within(processSteps).getByText(/Line four should remain visible/)).toBeInTheDocument();
    expect(within(processSteps).getByTestId("agent-tasks__message-step-detail")).not.toHaveTextContent("…");
  });

  it("renders cancelled reason and pending final answer state while streaming", () => {
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        streamingContent=""
        traceEvents={[
          {
            id: "trace-cancel",
            task_id: "task-1",
            message_id: "msg-agent",
            run_id: "run-1",
            seq: 1,
            at: "2024-01-01T14:31:01Z",
            category: "warning",
            phase: "end",
            status: "cancelled",
            name: "run.user_cancel",
            summary: "Run cancelled by request",
          },
          {
            id: "trace-summary",
            task_id: "task-1",
            message_id: "msg-agent",
            run_id: "run-1",
            seq: 2,
            at: "2024-01-01T14:31:02Z",
            category: "progress",
            phase: "end",
            status: "cancelled",
            name: "run.summary",
            summary: "Run cancelled",
            details: { final_status: "cancelled", duration_ms: 1200 },
          },
        ]}
      />,
    );

    expect(
      screen.getByTestId("agent-tasks__message-run-reason"),
    ).toHaveTextContent("Reason: interrupted by user (stopped)");
    expect(
      screen.getByTestId("agent-tasks__message-final-answer-pending"),
    ).toBeInTheDocument();
  });
});
