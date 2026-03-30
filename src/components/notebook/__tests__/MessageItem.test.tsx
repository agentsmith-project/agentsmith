import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageItem } from "../MessageItem";
import type { TaskMessage, TaskTraceEvent } from "@/lib/types/task";

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
      const translations: Record<string, string> = {
        copied: "Copied!",
        copy_failed: "Failed to copy",
        copy: "Copy",
        process_status_idle: "Ready",
        process_status_running: "Running",
        process_status_success: "Completed",
        process_status_error: "Needs retry",
        process_status_cancelled: "Cancelled",
        process_cancel_reason_user_stopped:
          "Reason: interrupted by user (stopped)",
        process_title: "Execution",
        process_no_steps: "No recent steps yet",
        process_collapse: "Hide full history",
        final_answer_title: "Final answer",
        process_stage_preparing: "Preparing",
        process_stage_exploring: "Exploring",
        process_stage_running_command: "Running command",
        process_stage_using_tool: "Using tool",
        process_stage_updating_files: "Updating files",
        process_stage_preparing_response: "Preparing response",
        process_stage_failed: "Failed",
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
      if (key === "process_expand")
        return `Show full history (+${values?.count ?? "?"})`;
      return translations[key] || key;
    },
}));

describe("MessageItem", () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined);

  const userMessage: TaskMessage = {
    id: "msg-user",
    task_id: "task-1",
    role: "user",
    content: "Hello from user",
    created_at: "2024-01-01T14:30:00Z",
  };

  const agentMessage: TaskMessage = {
    id: "msg-agent",
    task_id: "task-1",
    role: "agent",
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
    details: { command: "pnpm test --filter notebook" },
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

  it("renders user messages unchanged", () => {
    const { container } = render(<MessageItem message={userMessage} />);
    expect(screen.getByTestId("markdown-content")).toHaveTextContent(
      "Hello from user",
    );
    expect(
      screen.queryByTestId("notebook__message-process-panel"),
    ).not.toBeInTheDocument();
    expect(container.firstElementChild?.firstElementChild?.className ?? "").toContain("max-w-[min(680px,62%)]");
    expect(container.firstElementChild?.firstElementChild?.className ?? "").not.toContain("w-full");
  });

  it("renders agent message as a single bubble with process panel and final answer", () => {
    render(
      <MessageItem
        message={agentMessage}
        traceEvents={[
          commandTrace(1, "start", "running"),
          commandTrace(2, "end", "success"),
        ]}
      />,
    );

    const bubble = screen.getByTestId("notebook__agent-message-bubble");
    expect(bubble).toBeInTheDocument();
    expect(bubble.className).toContain("w-full");
    expect(bubble.className).toContain("max-w-[1120px]");
    expect(
      screen.getByTestId("notebook__message-process-panel"),
    ).toBeInTheDocument();
    expect(screen.getByText("Running command")).toBeInTheDocument();
    expect(screen.getByText("pnpm test --filter notebook")).toBeInTheDocument();
    expect(
      screen.getByTestId("notebook__message-final-answer"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("markdown-content")).toHaveTextContent(
      "Final **answer**",
    );
    expect(screen.getByTestId("notebook__message-final-answer").innerHTML).toContain("max-w-[88ch]");
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

    const footer = screen.getByTestId("notebook__message-status-footer");
    expect(within(footer).getByTestId("notebook__message-run-status")).toHaveTextContent(
      "Completed",
    );
    expect(within(footer).getByTestId("notebook__message-run-duration")).toHaveTextContent(
      "Duration: 55s",
    );
    expect(within(footer).getByText("06:31 AM")).toBeInTheDocument();
  });

  it("keeps pending final answer and running state visible after refresh recovery", () => {
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        forceRunning
        traceEvents={[]}
      />,
    );

    expect(screen.getByTestId("notebook__message-final-answer-pending")).toBeInTheDocument();
    expect(screen.getByTestId("notebook__message-run-status")).toHaveTextContent("Running");
  });

  it("shows a subtle running indicator in the footer while the agent is still executing", () => {
    render(
      <MessageItem
        message={{ ...agentMessage, content: "" }}
        streamingContent="Streaming reply"
        traceEvents={[commandTrace(1, "start", "running")]}
      />,
    );

    const footer = screen.getByTestId("notebook__message-status-footer");
    const status = within(footer).getByTestId("notebook__message-run-status");
    expect(status).toHaveTextContent("Running");
    expect(status.querySelector(".animate-ping")).toBeTruthy();
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

    expect(screen.getAllByTestId("notebook__message-step-row")).toHaveLength(2);
    expect(
      screen.getByTestId("notebook__message-process-toggle"),
    ).toHaveTextContent("Show full history (+6)");

    await user.click(screen.getByTestId("notebook__message-process-toggle"));
    expect(screen.getAllByTestId("notebook__message-step-row")).toHaveLength(8);
    expect(
      screen.getByTestId("notebook__message-process-toggle"),
    ).toHaveTextContent("Hide full history");
  });

  it("loads initial traces lazily for agent messages without local trace data", () => {
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
      screen.queryByTestId("notebook__message-trace-load-more"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId("notebook__message-process-toggle"));
    await user.click(screen.getByTestId("notebook__message-trace-load-more"));
    expect(onTraceLoadMore).toHaveBeenCalledWith("msg-agent");
  });

  it("filters reasoning-only preparing steps, hides per-step status text, and truncates long details", () => {
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
        details: {
          command:
            "python scripts/run_very_long_notebook_smoke_command_with_extra_arguments_and_flags.py --flag-one --flag-two --flag-three --flag-four --flag-five --flag-six --flag-seven --flag-eight --flag-nine --flag-ten --flag-eleven --flag-twelve --flag-thirteen --flag-fourteen --flag-fifteen --flag-sixteen --flag-seventeen --flag-eighteen --flag-nineteen --flag-twenty --flag-twenty-one --flag-twenty-two --flag-twenty-three --flag-twenty-four --flag-twenty-five --flag-twenty-six --flag-twenty-seven --flag-twenty-eight --flag-twenty-nine --flag-thirty",
        },
      },
    ];

    render(<MessageItem message={agentMessage} traceEvents={traces} />);

    expect(
      screen.queryByText(/Reasoning about the task/i),
    ).not.toBeInTheDocument();
    const stepRow = screen.getByTestId("notebook__message-step-row");
    expect(within(stepRow).queryByText("Completed")).not.toBeInTheDocument();
    expect(
      screen.getByText(/python scripts\/run_very_long_notebook_smoke_command_with_extra_arguments_and_flags\.py/),
    ).toBeInTheDocument();
    const commandDetail = screen.getByTestId("notebook__message-step-detail");
    expect(commandDetail.textContent?.length ?? 0).toBeLessThan(320);
    expect(commandDetail.textContent ?? "").toContain("…");
    expect(commandDetail).toHaveTextContent(/python scripts\/run_very_long_notebook_smoke_command_with_extra_arguments_and_flags\.py/);
  });

  it("shows answer content directly for preparing response steps and preserves line breaks", () => {
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

    expect(screen.getByText("Preparing response")).toBeInTheDocument();
    const processSteps = screen.getByTestId("notebook__message-process-steps");
    expect(within(processSteps).getByText(/Line one/)).toBeInTheDocument();
    expect(within(processSteps).getByText(/Line two/)).toBeInTheDocument();
    expect(within(processSteps).getByText(/Line three/)).toBeInTheDocument();
    expect(screen.queryByText("Agent message completed")).not.toBeInTheDocument();
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
      screen.getByTestId("notebook__message-run-reason"),
    ).toHaveTextContent("Reason: interrupted by user (stopped)");
    expect(
      screen.getByTestId("notebook__message-final-answer-pending"),
    ).toBeInTheDocument();
  });
});
