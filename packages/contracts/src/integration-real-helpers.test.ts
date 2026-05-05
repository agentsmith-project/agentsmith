import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../e2e/integration-workspace-access", () => ({
  ensureWorkspaceProjectCreatorAccess: vi.fn(),
  readStoredAuthToken: vi.fn(async () => "fixture-token"),
}));

import {
  API_BASE,
  createManagedAgentRunnerViaApi,
} from "../../../e2e/integration-real-helpers";

function createJsonResponse(payload: unknown) {
  return {
    ok: () => true,
    json: async () => payload,
  };
}

function createManagedAgentRunnerPageStub(): {
  page: Page;
  post: ReturnType<typeof vi.fn>;
} {
  const get = vi
    .fn()
    .mockRejectedValue(new Error("managed_agent_runner_helper_should_not_read_endpoint"));
  const post = vi.fn().mockResolvedValue(
    createJsonResponse({
      id: "runner_agent_task_123",
      name: "agent-task-runner",
      status: "ready",
      is_default: true,
      default_endpoint_id: "endpoint_123",
      capabilities: { task_execution: true },
      diagnostics: { target: "agent_task_runner" },
    }),
  );

  return {
    page: {
      request: {
        get,
        post,
      },
    } as unknown as Page,
    post,
  };
}

describe("createManagedAgentRunnerViaApi", () => {
  it("creates a managed Agent Runner through the canonical agent-runners API", async () => {
    const { page, post } = createManagedAgentRunnerPageStub();

    const runner = await createManagedAgentRunnerViaApi(page, {
      workspaceId: "ws_default",
      projectId: "proj_default",
      endpointId: "endpoint_123",
      title: "agent-task-runner",
    });

    expect(post).toHaveBeenCalledWith(
      `${API_BASE}/api/v1/workspaces/ws_default/projects/proj_default/agent-runners`,
      expect.objectContaining({
        headers: {
          Authorization: "Bearer fixture-token",
          "Content-Type": "application/json",
        },
        data: expect.objectContaining({
          name: "agent-task-runner",
          is_default: true,
          status: "ready",
          default_endpoint_id: "endpoint_123",
        }),
      }),
    );
    const [, requestOptions] = post.mock.calls[0] ?? [];
    expect(requestOptions?.data).not.toHaveProperty("mode");
    expect(requestOptions?.data).not.toHaveProperty("interaction_kind");
    expect(requestOptions?.data).not.toHaveProperty("external_agent_id");
    expect(runner.runnerId).toBe("runner_agent_task_123");
    expect(runner.runnerName).toBe("agent-task-runner");
  });
});
