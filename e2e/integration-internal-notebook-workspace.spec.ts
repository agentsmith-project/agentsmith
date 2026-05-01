import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  API_BASE,
  INTERNAL_AGENT_IMAGE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createFileLibraryViaUi,
  createInternalCodexAgent,
  createProjectInWorkspace,
  expectInternalTaskRuntimeStateInPod,
  keycloakLoginToWorkspace,
  mountFileLibraryLocally,
  requestTaskWorkspaceAccess,
  resolveLibraryObjectPath,
  resolveMountedTaskRoot,
  sendTaskMessage,
  waitForNotebookExecutionOutcome,
  waitForWorkloadPodDeleted,
  waitForWorkloadPodIdentity,
  waitForWorkloadPodReady,
} from "./integration-real-helpers";
import { readStoredAuthToken } from "./integration-workspace-access";
import { loadStoryDefinitionSync } from "./story-loader";
import { buildTraceStoryBinding } from "./story-trace-binding";
import { createUxTraceBundleWriter } from "./trace-bundle-support";

const INTERNAL_VISUAL_ARTIFACT_DIR =
  process.env.INTERNAL_REAL_VISUAL_ARTIFACT_DIR?.trim()
    ? path.resolve(process.env.INTERNAL_REAL_VISUAL_ARTIFACT_DIR)
    : path.resolve(`artifacts/backend-real-visual/internal-${Date.now()}`);
const INTERNAL_CLIENT_MOUNT_OVERRIDES = {
  metadataHostOverride:
    process.env.INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE?.trim() ||
    undefined,
  metadataPortOverride:
    process.env.INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE?.trim() ||
    undefined,
  storageEndpointOverride:
    process.env.INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE?.trim() ||
    undefined,
} as const;
const NOTEBOOK_CANCEL_TERMINATE_STORY = loadStoryDefinitionSync(
  "notebook-cancel-terminate-refresh-recovery",
);
const NOTEBOOK_CANCEL_TERMINATE_BINDING = buildTraceStoryBinding(
  NOTEBOOK_CANCEL_TERMINATE_STORY,
);

type CaptureEntry = {
  name: string;
  path: string;
  notes: string;
  route: string;
};

type TaskRealtimeSnapshot = {
  id?: string;
  run_state?: string | null;
  stop_mode?: string | null;
  can_escalate?: boolean;
  escalation_reason?: string | null;
  last_activity_at?: string | null;
};

type TaskStopResponsePayload = {
  status?: string;
  task_id?: string;
  run_id?: string | null;
  request_id?: string | null;
  stop_mode?: string;
  can_escalate?: boolean;
  escalation_reason?: string | null;
  error_code?: string;
  message?: string;
};

type TaskMessageSnapshot = {
  role?: string;
  content?: string;
};

function resolveNotebookCancelTerminateStep(stepId: string) {
  const step = NOTEBOOK_CANCEL_TERMINATE_BINDING.steps.find(
    (entry) => entry.stepId === stepId,
  );
  if (!step) {
    throw new Error(`unknown_notebook_cancel_terminate_step:${stepId}`);
  }
  return step;
}

async function expectTaskArtifactPersisted(args: {
  mountPath: string;
  artifactName: string;
  artifactToken: string;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const artifactContent = await readFile(
          path.join(args.mountPath, ".artifacts", args.artifactName),
          "utf-8",
        ).catch(() => null);
        return {
          artifactReady:
            typeof artifactContent === "string" &&
            artifactContent.includes(args.artifactToken),
        };
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000, 10_000] },
    )
    .toEqual({
      artifactReady: true,
    });
}

function requireInternalSandboxEnv(): string {
  const namespace = process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim();
  if (!process.env.SANDBOX_MANAGER_URL?.trim()) {
    throw new Error("missing_SANDBOX_MANAGER_URL");
  }
  if (!process.env.SANDBOX_SERVICE_KEY?.trim()) {
    throw new Error("missing_SANDBOX_SERVICE_KEY");
  }
  if (!namespace) {
    throw new Error("missing_INTERNAL_AGENT_K8S_NAMESPACE");
  }
  return namespace;
}

function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error("missing_BACKEND_REAL_API_KEY");
  }
  return value;
}

function sanitizeWorkloadId(id: string): string {
  const normalized = id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  return normalized || "workload";
}

async function createNotebookTaskViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  agentId: string;
  fileLibraryId: string;
}): Promise<string> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        title: args.title,
        agent_id: args.agentId,
        workspace_file_library_id: args.fileLibraryId,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    data?: { id?: string };
  } | null;
  const taskId = payload?.id ?? payload?.data?.id;
  expect(taskId).toBeTruthy();
  return taskId!;
}

async function waitForAssistantToken(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
  minAgentMessages?: number;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  await expect
    .poll(
      async () => {
        const response = await args.page.request.get(
          `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!response.ok()) return false;
        const payload = (await response.json()) as Array<{
          role?: string;
          content?: string;
        }>;
        const agentMessages = payload.filter((item) => item.role === "agent");
        if (agentMessages.length < (args.minAgentMessages ?? 1)) return false;
        return agentMessages.some((item) => item.content?.includes(args.token));
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
}

async function waitForAssistantTokenOrArtifact(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
  artifactPath: string;
  minAgentMessages?: number;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  await expect
    .poll(
      async () => {
        const [messageHasToken, artifactContent] = await Promise.all([
          (async () => {
            const response = await args.page.request.get(
              `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
              { headers: { Authorization: `Bearer ${authToken}` } },
            );
            if (!response.ok()) return false;
            const payload = (await response.json()) as Array<{
              role?: string;
              content?: string;
            }>;
            const agentMessages = payload.filter(
              (item) => item.role === "agent",
            );
            if (agentMessages.length < (args.minAgentMessages ?? 1))
              return false;
            return agentMessages.some((item) =>
              item.content?.includes(args.token),
            );
          })(),
          readFile(args.artifactPath, "utf-8").catch(() => null),
        ]);
        return (
          messageHasToken || artifactContent?.includes(args.token) === true
        );
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
}

async function fetchTaskRealtimeSnapshot(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<TaskRealtimeSnapshot> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json().catch(() => null)) as TaskRealtimeSnapshot;
}

async function fetchTaskMessages(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<TaskMessageSnapshot[]> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json().catch(() => [])) as TaskMessageSnapshot[];
}

async function waitForTaskRunState(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  runState: string;
  timeoutMs?: number;
}): Promise<TaskRealtimeSnapshot> {
  let latestSnapshot: TaskRealtimeSnapshot | null = null;
  await expect
    .poll(
      async () => {
        latestSnapshot = await fetchTaskRealtimeSnapshot(args);
        return latestSnapshot?.run_state ?? null;
      },
      { timeout: args.timeoutMs ?? 180_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(args.runState);
  return latestSnapshot ?? {};
}

async function waitForTaskIdleAfterStopAccepted(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  stopLabel: "cancel" | "terminate";
  allowedRunStates: Array<"cancelling" | "terminating" | "finalizing">;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<TaskRealtimeSnapshot> {
  const deadline = Date.now() + (args.timeoutMs ?? 300_000);
  const intervalMs = args.intervalMs ?? 1_000;
  const samples: string[] = [];
  let latestSnapshot: TaskRealtimeSnapshot | null = null;

  while (true) {
    latestSnapshot = await fetchTaskRealtimeSnapshot(args);
    const runState = latestSnapshot.run_state ?? "null";
    samples.push(runState);

    if (runState === "running") {
      throw new Error(
        `task run_state regressed to running after ${args.stopLabel} accepted: ${samples.join(" -> ")}`,
      );
    }

    if (runState === "idle") {
      return latestSnapshot;
    }

    if (
      !args.allowedRunStates.includes(
        runState as "cancelling" | "terminating" | "finalizing",
      )
    ) {
      throw new Error(
        `unexpected task run_state after ${args.stopLabel} accepted: ${samples.join(" -> ")}`,
      );
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `task did not recover to idle after ${args.stopLabel} accepted: ${samples.join(" -> ")}`,
      );
    }

    await args.page.waitForTimeout(intervalMs);
  }
}

async function requestTaskStop(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  mode: "cancel" | "terminate";
}): Promise<{ status: number; payload: TaskStopResponsePayload }> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/cancel`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        mode: args.mode,
      },
    },
  );
  return {
    status: response.status(),
    payload: (await response
      .json()
      .catch(() => null)) as TaskStopResponsePayload,
  };
}

function notebookActiveCancelControl(page: Page) {
  return page
    .getByTestId("notebook__run-active-cancel")
    .or(page.getByRole("button", { name: /^Cancel$/i }));
}

async function expectNotebookConversationReady(page: Page): Promise<void> {
  await expect(
    page
      .getByTestId("notebook__conversation-input")
      .locator("textarea")
      .first(),
  ).toBeEnabled({ timeout: 30_000 });
  await expect(notebookActiveCancelControl(page)).toHaveCount(0);
  await expect(
    page.getByTestId("notebook__conversation-blocked-state"),
  ).toHaveCount(0);
}

async function openFileLibraryRoot(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryName: string;
}): Promise<void> {
  const { page, workspaceId, projectId, libraryName } = args;
  await page.goto(
    `/en-US/workspaces/${workspaceId}/projects/${projectId}/files`,
  );
  const libraryItem = page
    .locator('[data-testid^="files__library-item--"]')
    .filter({ hasText: libraryName })
    .first();
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  await dismissFilesDialogs(page);
  await libraryItem.click();
  await expect(page.getByTestId("files__objects-table")).toBeVisible({
    timeout: 30_000,
  });
  const mountAccessDialog = page.getByTestId(
    "files__dialog__desktop-mount-access",
  );
  if (await mountAccessDialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await expect(mountAccessDialog).toBeHidden({ timeout: 10_000 });
  }
}

async function dismissFilesDialogs(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible().catch(() => false))) {
      return;
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

async function openFolderByName(page: Page, name: string): Promise<void> {
  await dismissFilesDialogs(page);
  const folderRow = page
    .getByTestId("files__object-row")
    .filter({ hasText: name })
    .first();
  await expect(folderRow).toBeVisible({ timeout: 30_000 });
  const button = folderRow.getByRole("button").first();
  if (await button.isVisible().catch(() => false)) {
    await button.dblclick();
    return;
  }
  await folderRow.dblclick();
}

async function ensureArtifactDir(): Promise<void> {
  await mkdir(INTERNAL_VISUAL_ARTIFACT_DIR, { recursive: true });
}

async function capturePage(
  page: Page,
  captures: CaptureEntry[],
  name: string,
  notes: string,
): Promise<void> {
  await ensureArtifactDir();
  const filename = `${name}.png`;
  await page.screenshot({
    path: path.join(INTERNAL_VISUAL_ARTIFACT_DIR, filename),
    fullPage: true,
  });
  captures.push({
    name,
    path: filename,
    notes,
    route: page.url(),
  });
}

async function flushArtifacts(captures: CaptureEntry[]): Promise<void> {
  await ensureArtifactDir();
  const manifest = {
    generated_at: new Date().toISOString(),
    total: captures.length,
    screenshots: captures,
  };
  const reviewLines = [
    "# Internal Notebook Workspace Real Review",
    "",
    `- generated_at: ${manifest.generated_at}`,
    `- total: ${manifest.total}`,
    "",
    "| Screenshot | Route | Notes |",
    "| --- | --- | --- |",
    ...captures.map(
      (item) => `| ${item.path} | ${item.route} | ${item.notes} |`,
    ),
    "",
    "- 这些截图来自 internal-k8s notebook workspace 真实 gate。",
    "- 用于审查 lazy start、任务详情和 Files 中的 deliverables 可见性。",
  ];
  await writeFile(
    path.join(INTERNAL_VISUAL_ARTIFACT_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
  await writeFile(
    path.join(INTERNAL_VISUAL_ARTIFACT_DIR, "review.md"),
    `${reviewLines.join("\n")}\n`,
    "utf-8",
  );
}

test.describe("@lane-real internal notebook workspace via sandbox manager", () => {
  test("lazy-starts an internal agent, writes into /workspace, and resumes after workload reclaim", async ({
    page,
  }) => {
    test.setTimeout(900_000);
    const namespace = requireInternalSandboxEnv();
    const providerApiKey = requireRealLaneApiKey();
    const captures: CaptureEntry[] = [];

    console.log("[internal-real] login");
    await keycloakLoginToWorkspace(
      page,
      "ws_default",
      KEYCLOAK_DEV_ADMIN_USERNAME,
      KEYCLOAK_DEV_ADMIN_PASSWORD,
    );
    console.log("[internal-real] create project");
    const { projectId } = await createProjectInWorkspace(
      page,
      "ws_default",
      "Internal Notebook Workspace",
    );
    const workspaceLibraryName = `Internal Workspace ${Date.now()}`;
    console.log("[internal-real] create file library");
    const fileLibraryId = await createFileLibraryViaUi(
      page,
      "ws_default",
      projectId,
      workspaceLibraryName,
    );
    const credentialName = `Provider Credential ${Date.now()}`;
    console.log("[internal-real] create credential");
    await createCredentialViaUi(
      page,
      "ws_default",
      projectId,
      credentialName,
      providerApiKey,
    );
    console.log("[internal-real] create endpoint");
    const endpointId = await createEndpointViaApi(
      page,
      "ws_default",
      projectId,
      {
        endpointName: `Provider Endpoint ${Date.now()}`,
        endpointModel: BACKEND_REAL_MODEL,
        upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
        credentialName,
      },
    );
    console.log("[internal-real] create internal agent");
    const internalAgent = await createInternalCodexAgent(page, {
      workspaceId: "ws_default",
      projectId,
      endpointId,
      title: "internal-codex-workspace",
      image: INTERNAL_AGENT_IMAGE,
      idleTimeoutSec: 180,
      maxLifetimeSec: 3600,
    });

    const taskTitle = `Internal Workspace Task ${Date.now()}`;
    console.log("[internal-real] create task");
    const taskId = await createNotebookTaskViaApi({
      page,
      workspaceId: "ws_default",
      projectId,
      title: taskTitle,
      agentId: internalAgent.agentId,
      fileLibraryId,
    });

    const firstToken = `INTERNAL_WORKSPACE_FIRST_${Date.now()}`;
    const firstArtifact = `internal-report-${Date.now()}.md`;
    console.log("[internal-real] send first message");
    await sendTaskMessage({
      page,
      workspaceId: "ws_default",
      projectId,
      taskId,
      content: [
        "Run the following shell command exactly, then reply with the token and filename.",
        "```bash",
        `mkdir -p .artifacts && cat <<'EOF' > .artifacts/${firstArtifact}`,
        "# Internal workspace report",
        `- Token: ${firstToken}`,
        "- Insight: internal agent mounted persistent workspace successfully",
        "EOF",
        "```",
        `After the file is written, reply with exactly: ${firstToken} ${firstArtifact}`,
      ].join(" "),
    });
    await page.goto(
      `/en-US/workspaces/ws_default/projects/${projectId}/notebook`,
    );
    await expect(page.getByTestId("notebook__task-list")).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByTestId("notebook__task-list")
      .getByText(taskTitle)
      .first()
      .click();
    await page.waitForTimeout(1_500);
    await capturePage(
      page,
      captures,
      "internal-task-preparing",
      "internal-k8s 首条消息触发 lazy start 后的任务执行中状态",
    );
    console.log("[internal-real] wait for first token");
    await waitForAssistantToken({
      page,
      workspaceId: "ws_default",
      projectId,
      taskId,
      token: firstToken,
    });
    await capturePage(
      page,
      captures,
      "internal-task-detail-complete",
      "internal-k8s notebook 任务完成后的详情页，工作目录固定为 /workspace/<task_id>",
    );

    const authToken = await readStoredAuthToken(page);
    const workspaceAccessResponse = await page.request.post(
      `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/workspace-access`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    expect(workspaceAccessResponse.ok()).toBeTruthy();
    const workspaceAccessBody = (await workspaceAccessResponse.json()) as {
      metadata_url: string;
      storage_bucket_url?: string;
      container_workspace_path?: string | null;
      library_root_path?: string | null;
    };
    expect(workspaceAccessBody.metadata_url).toBeTruthy();
    expect(workspaceAccessBody.container_workspace_path).toBe(
      `/workspace/${taskId}`,
    );
    expect(workspaceAccessBody.library_root_path).toBe(".");

    const workloadId = sanitizeWorkloadId(taskId);
    const firstWorkloadPod = await waitForWorkloadPodIdentity({
      namespace,
      workloadId,
      timeoutMs: 120_000,
    });
    await expectInternalTaskRuntimeStateInPod({
      namespace,
      podName: firstWorkloadPod.name,
      taskId,
    });

    const localMount = await mountFileLibraryLocally(
      workspaceAccessBody.metadata_url,
      workspaceAccessBody.storage_bucket_url,
      INTERNAL_CLIENT_MOUNT_OVERRIDES,
    );
    try {
      console.log("[internal-real] verify first artifact via local mount");
      await expectTaskArtifactPersisted({
        mountPath: resolveMountedTaskRoot(localMount.mountPath, {
          libraryRootPath: workspaceAccessBody.library_root_path,
        }),
        artifactName: firstArtifact,
        artifactToken: firstToken,
      });

      console.log("[internal-real] wait for idle reclaim", workloadId);
      await waitForWorkloadPodDeleted({
        namespace,
        workloadId,
        timeoutMs: 330_000,
      });

      const secondToken = `INTERNAL_WORKSPACE_RESUME_${Date.now()}`;
      const secondArtifact = `internal-resume-${Date.now()}.md`;
      console.log("[internal-real] send second message");
      await sendTaskMessage({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        content: [
          "Run the following shell command exactly, then reply with the token and filename.",
          "```bash",
          `if [ ! -f .artifacts/${firstArtifact} ]; then echo 'missing-first-artifact' >&2; exit 1; fi`,
          `cat <<'EOF' > .artifacts/${secondArtifact}`,
          "# Internal workspace resume report",
          `- Token: ${secondToken}`,
          `- Verified previous artifact: ${firstArtifact}`,
          "EOF",
          "```",
          `After the file is written, reply with exactly: ${secondToken} ${secondArtifact}`,
        ].join(" "),
      });
      console.log("[internal-real] wait for second token");
      await waitForAssistantTokenOrArtifact({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        token: secondToken,
        artifactPath: path.join(
          localMount.mountPath,
          ".artifacts",
          secondArtifact,
        ),
        minAgentMessages: 2,
      });
      const secondWorkloadPod = await waitForWorkloadPodIdentity({
        namespace,
        workloadId,
        timeoutMs: 120_000,
      });
      expect(secondWorkloadPod.name).toBe(firstWorkloadPod.name);
      expect(secondWorkloadPod.uid).not.toBe(firstWorkloadPod.uid);
      await capturePage(
        page,
        captures,
        "internal-task-detail-resumed",
        "internal-k8s workload reclaim 后再次恢复执行的任务详情页",
      );

      console.log("[internal-real] verify second artifact via local mount");
      await expect
        .poll(
          async () =>
            readFile(
              path.join(
                resolveMountedTaskRoot(localMount.mountPath, {
                  libraryRootPath: workspaceAccessBody.library_root_path,
                }),
                ".artifacts",
                secondArtifact,
              ),
              "utf-8",
            ).catch(() => null),
          { timeout: 90_000, intervals: [1_000, 2_000, 5_000] },
        )
        .toContain(secondToken);
    } finally {
      await localMount.stop();
    }

    console.log("[internal-real] verify files ui");
    await openFileLibraryRoot({
      page,
      workspaceId: "ws_default",
      projectId,
      libraryName: workspaceLibraryName,
    });
    await openFolderByName(page, ".artifacts");
    const firstArtifactRow = page
      .getByTestId("files__object-row")
      .filter({ hasText: firstArtifact })
      .first();
    await expect(firstArtifactRow).toBeVisible({ timeout: 30_000 });
    const downloadResponse = await page.request.get(
      `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/file-libraries/${fileLibraryId}/download?path=${encodeURIComponent(
        resolveLibraryObjectPath(`.artifacts/${firstArtifact}`, {
          libraryRootPath: workspaceAccessBody.library_root_path,
        }),
      )}`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    expect(downloadResponse.ok()).toBeTruthy();
    expect(downloadResponse.headers()["content-type"]).toContain("text/");
    await expect(downloadResponse.text()).resolves.toContain(firstToken);
    await capturePage(
      page,
      captures,
      "internal-files-artifacts-visible",
      "Files 页面中已可见 internal-k8s notebook 生成的 .artifacts 交付物",
    );
    await flushArtifacts(captures);
  });

  test("cancel and terminate resync the same notebook task after refresh without leaving blocked state behind", async ({
    page,
  }) => {
    test.setTimeout(900_000);
    const namespace = requireInternalSandboxEnv();
    const providerApiKey = requireRealLaneApiKey();

    console.log("[internal-real] login for terminate recovery");
    await keycloakLoginToWorkspace(
      page,
      "ws_default",
      KEYCLOAK_DEV_ADMIN_USERNAME,
      KEYCLOAK_DEV_ADMIN_PASSWORD,
    );
    console.log("[internal-real] create project for terminate recovery");
    const { projectId } = await createProjectInWorkspace(
      page,
      "ws_default",
      "Internal Notebook Terminate Recovery",
    );
    const workspaceLibraryName = `Internal Terminate Recovery ${Date.now()}`;
    console.log("[internal-real] create file library for terminate recovery");
    const fileLibraryId = await createFileLibraryViaUi(
      page,
      "ws_default",
      projectId,
      workspaceLibraryName,
    );
    const credentialName = `Terminate Recovery Credential ${Date.now()}`;
    console.log("[internal-real] create credential for terminate recovery");
    await createCredentialViaUi(
      page,
      "ws_default",
      projectId,
      credentialName,
      providerApiKey,
    );
    console.log("[internal-real] create endpoint for terminate recovery");
    const endpointId = await createEndpointViaApi(
      page,
      "ws_default",
      projectId,
      {
        endpointName: `Terminate Recovery Endpoint ${Date.now()}`,
        endpointModel: BACKEND_REAL_MODEL,
        upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
        credentialName,
      },
    );
    console.log("[internal-real] create internal agent for terminate recovery");
    const internalAgent = await createInternalCodexAgent(page, {
      workspaceId: "ws_default",
      projectId,
      endpointId,
      title: "internal-codex-terminate-recovery",
      image: INTERNAL_AGENT_IMAGE,
      idleTimeoutSec: 180,
      maxLifetimeSec: 3600,
    });

    const taskTitle = `Internal Terminate Recovery Task ${Date.now()}`;
    console.log("[internal-real] create task for terminate recovery");
    const taskId = await createNotebookTaskViaApi({
      page,
      workspaceId: "ws_default",
      projectId,
      title: taskTitle,
      agentId: internalAgent.agentId,
      fileLibraryId,
    });
    const workloadId = sanitizeWorkloadId(taskId);
    const taskWorkspaceAccess = await requestTaskWorkspaceAccess({
      page,
      workspaceId: "ws_default",
      projectId,
      taskId,
    });
    const localMount = await mountFileLibraryLocally(
      taskWorkspaceAccess.metadata_url,
      taskWorkspaceAccess.storage_bucket_url,
      INTERNAL_CLIENT_MOUNT_OVERRIDES,
    );
    const mountedTaskRoot = resolveMountedTaskRoot(localMount.mountPath, {
      libraryRootPath: taskWorkspaceAccess.library_root_path,
    });
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: "backend-real",
      suite: "integration-internal-notebook-workspace",
      storyId: NOTEBOOK_CANCEL_TERMINATE_STORY.storyId,
      title: NOTEBOOK_CANCEL_TERMINATE_STORY.title,
      actor: NOTEBOOK_CANCEL_TERMINATE_STORY.actor,
      route: `/en-US/workspaces/ws_default/projects/${projectId}/notebook/tasks/${taskId}`,
      specFile: "e2e/integration-internal-notebook-workspace.spec.ts",
      browser: "chromium",
      goal: NOTEBOOK_CANCEL_TERMINATE_STORY.goal,
      preconditions: [...(NOTEBOOK_CANCEL_TERMINATE_STORY.preconditions ?? [])],
      seedData: [...(NOTEBOOK_CANCEL_TERMINATE_STORY.seedData ?? [])],
      storyBinding: NOTEBOOK_CANCEL_TERMINATE_BINDING,
    });
    const captureTrace = async (
      stepId: string,
      extra: Partial<Parameters<typeof trace.capture>[1]> = {},
    ): Promise<void> => {
      const storyStep = resolveNotebookCancelTerminateStep(stepId);
      await trace.capture(page, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
        ...extra,
      });
    };
    let outcome: "pass" | "fail" = "fail";

    try {
      await page.goto(
        `/en-US/workspaces/ws_default/projects/${projectId}/notebook/tasks/${taskId}`,
      );
      await expect(page.getByTestId("notebook__task-header")).toBeVisible({
        timeout: 30_000,
      });
      await expectNotebookConversationReady(page);

      const cancelLongRunningToken = `INTERNAL_CANCEL_SHOULD_NOT_FINISH_${Date.now()}`;
      const cancelHeartbeatArtifact = `cancel-heartbeat-${Date.now()}.txt`;
      console.log(
        "[internal-real] send long-running notebook message for cancel recovery",
      );
      await sendTaskMessage({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        content: [
          "Run the following shell command exactly and do not send any final answer until the command exits.",
          "```bash",
          "mkdir -p .artifacts",
          "trap '' INT TERM",
          `i=0; while [ "$i" -lt 1200 ]; do i=$((i+1)); printf 'tick=%s\\n' "$i" > .artifacts/${cancelHeartbeatArtifact}; sleep 1; done`,
          "```",
          `After the command exits, reply with exactly: ${cancelLongRunningToken}`,
        ].join("\n"),
      });

      console.log(
        "[internal-real] wait for running task truth and active workload pod before cancel",
      );
      const [cancelRunningTask, cancelRunningPod] = await Promise.all([
        waitForTaskRunState({
          page,
          workspaceId: "ws_default",
          projectId,
          taskId,
          runState: "running",
          timeoutMs: 180_000,
        }),
        waitForWorkloadPodIdentity({
          namespace,
          workloadId,
          timeoutMs: 180_000,
        }),
      ]);
      expect(cancelRunningTask.run_state).toBe("running");
      expect(cancelRunningPod.name).toBeTruthy();
      expect(cancelRunningPod.uid).toBeTruthy();
      await captureTrace("reenter-running-notebook-task", {
        assertion:
          "The member is back in the same running task and can stop it from the task surface instead of abandoning it.",
      });

      console.log(
        "[internal-real] request normal cancel stop from notebook detail",
      );
      const cancelResponsePromise = page.waitForResponse(
        (response) => {
          if (response.request().method() !== "POST") return false;
          return (
            new URL(response.url()).pathname ===
            `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/cancel`
          );
        },
        { timeout: 30_000 },
      );
      await expect(notebookActiveCancelControl(page).first()).toBeVisible({
        timeout: 30_000,
      });
      await notebookActiveCancelControl(page).first().click();
      const cancelResponse = await cancelResponsePromise;
      expect(cancelResponse.status()).toBe(202);
      const cancelPayload = (await cancelResponse
        .json()
        .catch(() => null)) as TaskStopResponsePayload | null;
      expect(cancelPayload).toMatchObject({
        status: "cancelling",
        task_id: taskId,
        stop_mode: "cancel",
      });
      await captureTrace("cancel-the-active-run-from-the-task-surface", {
        request: {
          method: "POST",
          url: `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/cancel`,
          summary: "mode=cancel",
        },
        response: {
          status: cancelResponse.status(),
          summary: `state=${cancelPayload?.status ?? "unknown"}`,
        },
        assertion:
          "Cancel is accepted on the same task and moves the UI into authoritative stopping truth instead of leaving the member guessing.",
      });

      console.log(
        "[internal-real] refresh task detail while cancel recovery settles",
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("notebook__task-header")).toBeVisible({
        timeout: 30_000,
      });
      const refreshedCancelTask = await fetchTaskRealtimeSnapshot({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
      });
      expect(refreshedCancelTask.run_state).not.toBe("running");
      if (refreshedCancelTask.run_state === "idle") {
        await expect(
          page
            .getByTestId("notebook__conversation-input")
            .locator("textarea")
            .first(),
        ).toBeEnabled({ timeout: 30_000 });
      } else {
        expect(["cancelling", "finalizing"]).toContain(
          refreshedCancelTask.run_state,
        );
        await expect(
          page
            .getByTestId("notebook__conversation-input")
            .locator("textarea")
            .first(),
        ).toBeDisabled({ timeout: 30_000 });
      }
      await expect(notebookActiveCancelControl(page)).toHaveCount(0);
      await expect(
        page.getByTestId("notebook__conversation-blocked-state"),
      ).toHaveCount(0);

      console.log(
        "[internal-real] wait for clean cancel recovery to authoritative idle truth",
      );
      const cancelRecoveredTask = await waitForTaskIdleAfterStopAccepted({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        stopLabel: "cancel",
        allowedRunStates: ["cancelling", "finalizing"],
        timeoutMs: 300_000,
        intervalMs: 1_000,
      });
      expect(cancelRecoveredTask.run_state).toBe("idle");
      const cancelledMessages = await fetchTaskMessages({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
      });
      expect(
        cancelledMessages.some(
          (item) =>
            item.role === "agent" &&
            item.content?.includes(cancelLongRunningToken),
        ),
      ).toBe(false);
      expect(
        cancelledMessages.some(
          (item) =>
            item.role === "agent" && item.content?.includes("AGENT_CANCELLED"),
        ),
      ).toBe(true);
      const cancelRecoveredPod = await waitForWorkloadPodIdentity({
        namespace,
        workloadId,
        timeoutMs: 60_000,
      });
      expect(cancelRecoveredPod.uid).toBe(cancelRunningPod.uid);

      console.log("[internal-real] re-enter task after clean cancel recovery");
      await page.goto(
        `/en-US/workspaces/ws_default/projects/${projectId}/notebook`,
      );
      await expect(page.getByTestId("notebook__task-list")).toBeVisible({
        timeout: 30_000,
      });
      const cancelRecoveredTaskCard = page.getByTestId(
        `notebook__task-card--${taskId}`,
      );
      await cancelRecoveredTaskCard.getByRole("button").click();
      await expect(page.getByTestId("notebook__task-header")).toBeVisible({
        timeout: 30_000,
      });
      await expectNotebookConversationReady(page);
      const cancelReentryTask = await fetchTaskRealtimeSnapshot({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
      });
      expect(cancelReentryTask.run_state).toBe("idle");

      const cancelRecoveryToken = `INTERNAL_CANCEL_RECOVERY_${Date.now()}`;
      const cancelRecoveryArtifact = `after-cancel-recovery-${Date.now()}.md`;
      console.log(
        "[internal-real] send next message after clean cancel recovery",
      );
      await sendTaskMessage({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        content: [
          "Run the following shell command exactly, then reply with the token and filename.",
          "```bash",
          `mkdir -p .artifacts && cat <<'EOF' > .artifacts/${cancelRecoveryArtifact}`,
          "# Internal cancel recovery report",
          `- Token: ${cancelRecoveryToken}`,
          `- Previous workload pod: ${cancelRunningPod.name}`,
          "EOF",
          "```",
          `After the file is written, reply with exactly: ${cancelRecoveryToken} ${cancelRecoveryArtifact}`,
        ].join("\n"),
      });
      const [cancelRecoveryRunningTask, cancelRecoveryPod] = await Promise.all([
        waitForTaskRunState({
          page,
          workspaceId: "ws_default",
          projectId,
          taskId,
          runState: "running",
          timeoutMs: 180_000,
        }),
        waitForWorkloadPodIdentity({
          namespace,
          workloadId,
          timeoutMs: 60_000,
        }),
      ]);
      expect(cancelRecoveryRunningTask.run_state).toBe("running");
      expect(cancelRecoveryPod.uid).toBe(cancelRunningPod.uid);
      await waitForAssistantToken({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        token: cancelRecoveryToken,
      });
      await waitForTaskRunState({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        runState: "idle",
        timeoutMs: 300_000,
      });
      const cancelRecoveryMessages = await fetchTaskMessages({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
      });
      expect(
        cancelRecoveryMessages.some(
          (item) =>
            item.role === "agent" &&
            item.content?.includes(cancelRecoveryToken),
        ),
      ).toBe(true);

      const terminateLongRunningToken = `INTERNAL_TERMINATE_SHOULD_NOT_FINISH_${Date.now()}`;
      const terminateHeartbeatArtifact = `terminate-heartbeat-${Date.now()}.txt`;
      console.log(
        "[internal-real] send long-running notebook message for terminate recovery",
      );
      await sendTaskMessage({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        content: [
          "Run the following shell command exactly and do not send any final answer until the command exits.",
          "```bash",
          "mkdir -p .artifacts",
          "trap '' INT TERM",
          `i=0; while [ "$i" -lt 1200 ]; do i=$((i+1)); printf 'tick=%s\\n' "$i" > .artifacts/${terminateHeartbeatArtifact}; sleep 1; done`,
          "```",
          `After the command exits, reply with exactly: ${terminateLongRunningToken}`,
        ].join("\n"),
      });

      console.log(
        "[internal-real] wait for running task truth and active workload pod before terminate",
      );
      const [terminateRunningTask, terminateRunningPod] = await Promise.all([
        waitForTaskRunState({
          page,
          workspaceId: "ws_default",
          projectId,
          taskId,
          runState: "running",
          timeoutMs: 180_000,
        }),
        waitForWorkloadPodIdentity({
          namespace,
          workloadId,
          timeoutMs: 180_000,
        }),
      ]);
      expect(terminateRunningTask.run_state).toBe("running");
      expect(terminateRunningPod.uid).toBe(cancelRunningPod.uid);

      console.log("[internal-real] request terminate stop");
      const terminate = await requestTaskStop({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        mode: "terminate",
      });
      expect(terminate.status).toBe(202);
      expect(terminate.payload).toMatchObject({
        status: "terminating",
        task_id: taskId,
        stop_mode: "terminate",
        can_escalate: false,
      });
      if (
        typeof terminate.payload.escalation_reason === "string" &&
        terminate.payload.escalation_reason.trim().length > 0
      ) {
        expect(terminate.payload.escalation_reason).toBe("already_terminating");
      }
      await captureTrace("escalate-a-stuck-cancel-to-terminate", {
        request: {
          method: "POST",
          url: `/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/cancel`,
          summary: "mode=terminate",
        },
        response: {
          status: terminate.status,
          summary: `state=${terminate.payload.status ?? "unknown"}`,
        },
        assertion:
          "The same task surface can escalate to hard terminate when a stronger stop path is needed, without asking the member to create a replacement task.",
      });

      console.log(
        "[internal-real] refresh task detail while terminate recovery settles",
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("notebook__task-header")).toBeVisible({
        timeout: 30_000,
      });
      const refreshedTerminateTask = await fetchTaskRealtimeSnapshot({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
      });
      expect(refreshedTerminateTask.run_state).not.toBe("running");
      if (refreshedTerminateTask.run_state === "idle") {
        await expect(
          page
            .getByTestId("notebook__conversation-input")
            .locator("textarea")
            .first(),
        ).toBeEnabled({ timeout: 30_000 });
      } else {
        expect(["terminating", "finalizing"]).toContain(
          refreshedTerminateTask.run_state,
        );
        await expect(
          page
            .getByTestId("notebook__conversation-input")
            .locator("textarea")
            .first(),
        ).toBeDisabled({ timeout: 30_000 });
      }
      await expect(notebookActiveCancelControl(page)).toHaveCount(0);
      await expect(
        page.getByTestId("notebook__conversation-blocked-state"),
      ).toHaveCount(0);
      await captureTrace(
        "refresh-the-task-while-stop-truth-is-still-settling",
        {
          assertion: `Refresh keeps the same task on authoritative ${refreshedTerminateTask.run_state ?? "unknown"} truth without reviving the old run or showing a stale blocked state.`,
        },
      );

      console.log(
        "[internal-real] wait for hard teardown and terminate recovery to authoritative idle truth",
      );
      const [, terminateRecoveredTask] = await Promise.all([
        waitForWorkloadPodDeleted({
          namespace,
          workloadId,
          timeoutMs: 300_000,
        }),
        waitForTaskIdleAfterStopAccepted({
          page,
          workspaceId: "ws_default",
          projectId,
          taskId,
          stopLabel: "terminate",
          allowedRunStates: ["terminating", "finalizing"],
          timeoutMs: 300_000,
          intervalMs: 1_000,
        }),
      ]);
      expect(terminateRecoveredTask.run_state).toBe("idle");
      const terminatedMessages = await fetchTaskMessages({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
      });
      expect(
        terminatedMessages.some(
          (item) =>
            item.role === "agent" &&
            item.content?.includes(terminateLongRunningToken),
        ),
      ).toBe(false);

      console.log("[internal-real] re-enter task after terminate recovery");
      await page.goto(
        `/en-US/workspaces/ws_default/projects/${projectId}/notebook`,
      );
      await expect(page.getByTestId("notebook__task-list")).toBeVisible({
        timeout: 30_000,
      });
      const terminateRecoveredTaskCard = page.getByTestId(
        `notebook__task-card--${taskId}`,
      );
      await terminateRecoveredTaskCard.getByRole("button").click();
      await expect(page.getByTestId("notebook__task-header")).toBeVisible({
        timeout: 30_000,
      });
      await expectNotebookConversationReady(page);
      const terminateReentryTask = await fetchTaskRealtimeSnapshot({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
      });
      expect(terminateReentryTask.run_state).toBe("idle");
      await captureTrace("recover-the-same-task-after-stop-settles", {
        assertion:
          "After backend truth settles, the same task becomes usable again with no lingering blocked or stop state.",
      });

      const terminateRecoveryToken = `INTERNAL_TERMINATE_RECOVERY_${Date.now()}`;
      const terminateRecoveryArtifact = `after-terminate-recovery-${Date.now()}.md`;
      const terminateRecoveryArtifactPath = path.join(
        mountedTaskRoot,
        ".artifacts",
        terminateRecoveryArtifact,
      );
      console.log("[internal-real] send next message after terminate recovery");
      const { assistantMessageId: terminateRecoveryAssistantMessageId } =
        await sendTaskMessage({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        content: [
          "Run the following shell command exactly, then reply with the token and filename.",
          "```bash",
          `mkdir -p .artifacts && cat <<'EOF' > .artifacts/${terminateRecoveryArtifact}`,
          "# Internal terminate recovery report",
          `- Token: ${terminateRecoveryToken}`,
          `- Previous workload pod: ${terminateRunningPod.name}`,
          "EOF",
          "```",
          `After the file is written, reply with exactly: ${terminateRecoveryToken} ${terminateRecoveryArtifact}`,
        ].join("\n"),
      });
      console.log(
        "[internal-real] wait for next round to restart on a fresh pod after terminate recovery",
      );
      const [restartedTask, restartedPod] = await Promise.all([
        waitForTaskRunState({
          page,
          workspaceId: "ws_default",
          projectId,
          taskId,
          runState: "running",
          timeoutMs: 180_000,
        }),
        waitForWorkloadPodReady({
          namespace,
          workloadId,
          timeoutMs: 180_000,
        }),
      ]);
      expect(restartedTask.run_state).toBe("running");
      expect(restartedPod.uid).not.toBe(terminateRunningPod.uid);

      console.log(
        "[internal-real] wait for next round to complete after terminate recovery",
      );
      await waitForNotebookExecutionOutcome({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        token: terminateRecoveryToken,
        assistantMessageId: terminateRecoveryAssistantMessageId,
        artifactPath: terminateRecoveryArtifactPath,
        namespace,
        workloadId,
        timeoutMs: 300_000,
        startEvidenceTimeoutMs: 60_000,
      });
      await waitForTaskRunState({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
        runState: "idle",
        timeoutMs: 300_000,
      });
      await expectNotebookConversationReady(page);
      await expect
        .poll(
          async () =>
            readFile(terminateRecoveryArtifactPath, "utf-8").catch(() => null),
          { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
        )
        .toContain(terminateRecoveryToken);
      const terminateRecoveryMessages = await fetchTaskMessages({
        page,
        workspaceId: "ws_default",
        projectId,
        taskId,
      });
      expect(
        terminateRecoveryMessages.some(
          (item) =>
            item.role === "agent" &&
            item.content?.includes(terminateRecoveryToken),
        ),
      ).toBe(true);
      await captureTrace("continue-the-next-turn-in-the-same-task", {
        assertion:
          "The next turn succeeds in the recovered task, proving the front end did not stay stuck in the old blocked or stopping state.",
      });

      outcome = "pass";
    } finally {
      try {
        await localMount.stop();
      } finally {
        await trace.finish({ outcome });
      }
    }
  });
});
