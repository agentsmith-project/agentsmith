import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  LOCALE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createExternalConnectionViaApi,
  createTerminalSessionViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalRunnerAgentBundle,
  createNotebookTaskViaApi,
  createFileLibraryViaUi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  expectNotebookTaskConversationSurface,
  getContextEntryViaApi,
  keycloakLoginToWorkspace,
  mountFileLibraryLocally,
  putContextEntryViaApi,
  resolveMountedTaskRoot,
  runTerminalCommandInSession,
  sendTaskMessage,
  startMockFeishuMcpServer,
  startMockJiraServer,
  startCodexRunnerProcess,
  startCodexRunnerDockerProcess,
  waitForAssistantToken,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import { readStoredAuthToken } from './integration-workspace-access';

const NOTEBOOK_ARTIFACT_STORY = loadStoryDefinitionSync('notebook-artifact-to-files-download');
const NOTEBOOK_ARTIFACT_BINDING = buildTraceStoryBinding(NOTEBOOK_ARTIFACT_STORY);

type NotebookArtifactDownloadRuntime = {
  projectName: string;
  workspaceLibraryName: string;
  agentTitle: string;
  taskTitle: string;
  artifactName: string;
  artifactToken: string;
  createPrompt: string;
  expectedArtifactPath: string;
  downloadPath: string;
};

function resolveNotebookArtifactStep(stepId: string) {
  const step = NOTEBOOK_ARTIFACT_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_notebook_artifact_step:${stepId}`);
  }
  return step;
}

function requireNotebookArtifactRuntime(): NotebookArtifactDownloadRuntime {
  const runtimeRoot = NOTEBOOK_ARTIFACT_STORY.runtimeData as Record<string, unknown> | undefined;
  const artifactDownload = runtimeRoot?.notebookArtifactDownload as Record<string, unknown> | undefined;
  if (!artifactDownload) {
    throw new Error('missing_notebook_artifact_runtime_data');
  }
  for (const key of [
    'projectName',
    'workspaceLibraryName',
    'agentTitle',
    'taskTitle',
    'artifactName',
    'artifactToken',
    'createPrompt',
    'expectedArtifactPath',
    'downloadPath',
  ] as const) {
    if (typeof artifactDownload[key] !== 'string' || artifactDownload[key].trim().length === 0) {
      throw new Error(`missing_notebook_artifact_runtime_data:${key}`);
    }
  }
  return artifactDownload as unknown as NotebookArtifactDownloadRuntime;
}

function expectRelativeLibraryRootPath(value: string | null | undefined): void {
  expect(value).toBeTruthy();
  expect(value?.startsWith('/')).toBe(false);
  expect(value?.includes('..')).toBe(false);
}

async function expectTaskRuntimeStatePersisted(args: {
  mountPath: string;
  artifactName: string;
  artifactToken: string;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const [artifactContent, codexConfig, modelCatalog, skillsManifest, feishuSkill] = await Promise.all([
          readFile(path.join(args.mountPath, '.artifacts', args.artifactName), 'utf-8').catch(() => null),
          readFile(path.join(args.mountPath, '.codex', 'config.toml'), 'utf-8').catch(() => null),
          readFile(path.join(args.mountPath, '.codex', 'catalog.json'), 'utf-8').catch(() => null),
          readFile(path.join(args.mountPath, '.mbos', 'builtin-skills-manifest.json'), 'utf-8').catch(() => null),
          readFile(path.join(args.mountPath, '.agents', 'skills', 'feishu-docs', 'SKILL.md'), 'utf-8').catch(() => null),
        ]);
        const parsedCatalog = typeof modelCatalog === 'string'
          ? JSON.parse(modelCatalog) as { models?: Array<{ slug?: string; display_name?: string }> }
          : null;
        return {
          artifactReady: typeof artifactContent === 'string' && artifactContent.includes(args.artifactToken),
          codexConfigReady: typeof codexConfig === 'string' && codexConfig.includes('model = '),
          modelCatalogReady:
            Array.isArray(parsedCatalog?.models)
            && parsedCatalog.models.some((entry) => typeof entry?.slug === 'string' && entry.slug.trim().length > 0),
          skillsManifestReady: typeof skillsManifest === 'string' && skillsManifest.includes('"feishu-docs"'),
          feishuSkillReady: typeof feishuSkill === 'string' && feishuSkill.includes('feishu'),
        };
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000, 10_000] },
    )
    .toEqual({
      artifactReady: true,
      codexConfigReady: true,
      modelCatalogReady: true,
      skillsManifestReady: true,
      feishuSkillReady: true,
    });
}

function isRetryableUpstreamCapacityError(content: string | null | undefined): boolean {
  if (typeof content !== 'string') return false;
  const normalized = content.toLowerCase();
  return normalized.includes('selected model is at capacity')
    || normalized.includes('model is at capacity')
    || normalized.includes('needs retry');
}

function buildNotebookArtifactPrompt(args: {
  artifactName: string;
  token: string;
  title: string;
  bodyLines: string[];
}): string {
  return [
    'Run the following shell command exactly.',
    '```bash',
    `mkdir -p .artifacts && cat <<'EOF' > .artifacts/${args.artifactName}`,
    args.title,
    ...args.bodyLines,
    'EOF',
    '```',
    `After the file is written, reply with exactly: ${args.token} ${args.artifactName}`,
  ].join('\n');
}

async function sendNotebookWriteMessage(args: {
  page: Page;
  projectId: string;
  taskId: string;
  token: string;
  prompt: string;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  const sendMessageResponse = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/tasks/${args.taskId}/messages`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        role: 'user',
        content: args.prompt,
      },
    },
  );
  if (!sendMessageResponse.ok()) {
    throw new Error(`notebook_send_failed:${sendMessageResponse.status()}:${await sendMessageResponse.text()}`);
  }
}

async function waitForAgentReply(args: {
  page: Page;
  projectId: string;
  taskId: string;
  token: string;
}): Promise<{ id?: string; content?: string } | null> {
  const authToken = await readStoredAuthToken(args.page);
  let agentMessageRecord: { id?: string; content?: string } | null = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await args.page.request.get(
      `${API_BASE}/api/v1/workspaces/ws_default/projects/${args.projectId}/tasks/${args.taskId}/messages`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    if (response.ok()) {
      const payload = (await response.json()) as Array<{ id?: string; role?: string; content?: string }>;
      const agentMessages = payload.filter((item) => item.role === 'agent');
      const withToken = agentMessages.find((item) => typeof item.content === 'string' && item.content.includes(args.token));
      if (withToken) {
        return withToken;
      }
      agentMessageRecord = agentMessages.at(-1) ?? null;
    }
    await args.page.waitForTimeout(2_000);
  }
  return agentMessageRecord;
}

function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return value;
}

async function createNotebookTaskViaDialog(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  agentName: string;
  workspaceLibraryName?: string;
  title: string;
}): Promise<string> {
  const { page, workspaceId, projectId, agentName, workspaceLibraryName, title } = args;
  await expect(page.getByTestId('notebook__create-task-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('notebook__create-task-btn').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#task-title').fill(title);
  await dialog.locator('#task-agent').click();
  await page.getByRole('option', { name: new RegExp(agentName) }).click();
  if (workspaceLibraryName) {
    await dialog.getByRole('radio', { name: /continue an existing workspace/i }).click();
    await dialog.getByTestId('task-create__file-library').click();
    await page.getByRole('option', { name: new RegExp(workspaceLibraryName) }).click();
  }
  const createTaskResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new RegExp(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks$`).test(response.url()),
  );
  await dialog.getByRole('button', { name: /create/i }).click();
  const response = await createTaskResponse;
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const taskId = payload?.id ?? payload?.data?.id;
  expect(taskId).toBeTruthy();
  await page.goto(`/en-US/workspaces/${workspaceId}/projects/${projectId}/notebook/tasks/${taskId}`);
  await expectNotebookTaskConversationSurface({
    page,
    openTerminalAction: 'enabled',
    terminalModeEnabled: false,
    blocked: false,
  });
  return taskId!;
}

async function openFileLibraryRoot(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryName: string;
}): Promise<void> {
  const { page, workspaceId, projectId, libraryName } = args;
  await page.goto(`/en-US/workspaces/${workspaceId}/projects/${projectId}/files`);
  const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: libraryName }).first();
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  await dismissFilesDialogs(page);
  await libraryItem.click();
  await expect(page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
}

async function dismissFilesDialogs(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialog = page.getByRole('dialog').last();
    if (!(await dialog.isVisible().catch(() => false))) {
      return;
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

async function openFolderByName(page: Page, name: string): Promise<void> {
  await dismissFilesDialogs(page);
  const folderRow = page.getByTestId('files__object-row').filter({ hasText: name }).first();
  await expect(folderRow).toBeVisible({ timeout: 30_000 });
  const rowButton = folderRow.getByRole('button').first();
  if (await rowButton.isVisible().catch(() => false)) {
    await rowButton.dblclick();
    return;
  }
  await folderRow.dblclick();
}

test.describe('@lane-real notebook external agent via real codex runner', () => {
  test('runs a notebook task and keeps the mounted workspace consistent across runner, Files UI, and local mount', async ({ page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();
    const runtime = requireNotebookArtifactRuntime();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', runtime.projectName);
    const workspaceLibraryName = `${runtime.workspaceLibraryName} ${Date.now()}`;
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: `${runtime.agentTitle}-${Date.now()}`,
    });
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-notebook-codex-runner',
      storyId: NOTEBOOK_ARTIFACT_STORY.storyId,
      title: NOTEBOOK_ARTIFACT_STORY.title,
      actor: NOTEBOOK_ARTIFACT_STORY.actor,
      route: `/${LOCALE}/workspaces/ws_default/projects/${projectId}/notebook`,
      specFile: 'e2e/integration-notebook-codex-runner.spec.ts',
      browser: 'chromium',
      goal: NOTEBOOK_ARTIFACT_STORY.goal,
      preconditions: [...(NOTEBOOK_ARTIFACT_STORY.preconditions ?? [])],
      seedData: [...(NOTEBOOK_ARTIFACT_STORY.seedData ?? [])],
      storyBinding: NOTEBOOK_ARTIFACT_BINDING,
    });
    const captureTrace = async (stepId: string): Promise<void> => {
      const storyStep = resolveNotebookArtifactStep(stepId);
      await trace.capture(page, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    let runnerStopped = false;
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);

      await page.goto(`/en-US/workspaces/ws_default/projects/${projectId}/notebook`);
      const taskId = await createNotebookTaskViaDialog({
        page,
        workspaceId: 'ws_default',
        projectId,
        agentName: agentBundle.agentName,
        workspaceLibraryName,
        title: `${runtime.taskTitle} ${Date.now()}`,
      });
      await captureTrace('open-notebook-task');

      const replyToken = runtime.artifactToken;
      const artifactName = runtime.artifactName;
      let agentMessageRecord: { id?: string; content?: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await sendNotebookWriteMessage({
          page,
          projectId,
          taskId,
          token: replyToken,
          prompt: runtime.createPrompt,
        });
        agentMessageRecord = await waitForAgentReply({
          page,
          projectId,
          taskId,
          token: replyToken,
        });
        if (!isRetryableUpstreamCapacityError(agentMessageRecord?.content)) {
          break;
        }
      }

      expect(agentMessageRecord).toBeTruthy();
      expect(agentMessageRecord?.content).toContain(replyToken);

      const token = await readStoredAuthToken(page);
      const workspaceAccessResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/workspace-access`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(workspaceAccessResponse.ok()).toBeTruthy();
      const workspaceAccessBody = (await workspaceAccessResponse.json()) as {
        workspace_dir_name: string;
        metadata_url: string;
        storage_bucket_url?: string;
        library_root_path?: string | null;
      };
      expect(workspaceAccessBody.workspace_dir_name).toBeTruthy();
      expect(workspaceAccessBody.metadata_url).toBeTruthy();
      expectRelativeLibraryRootPath(workspaceAccessBody.library_root_path);

      await openFileLibraryRoot({
        page,
        workspaceId: 'ws_default',
        projectId,
        libraryName: workspaceLibraryName,
      });
      await openFolderByName(page, '.artifacts');
      const artifactRow = page.getByTestId('files__object-row').filter({ hasText: artifactName }).first();
      await expect(artifactRow).toBeVisible({ timeout: 30_000 });
      await captureTrace('open-files-artifacts');

      await artifactRow.getByRole('button').click();
      const downloadResponsePromise = page.waitForResponse((response) => {
        return response.url().includes(`/api/v1/workspaces/ws_default/projects/${projectId}/file-libraries/${fileLibraryId}/download`)
          && response.status() === 200;
      });
      await page.getByTestId('files__download').click();
      const uiDownloadResponse = await downloadResponsePromise;
      expect(uiDownloadResponse.ok()).toBeTruthy();
      expect(uiDownloadResponse.headers()['content-type']).toContain('text/');
      const verifiedDownload = await page.request.get(uiDownloadResponse.url(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(verifiedDownload.ok()).toBeTruthy();
      await expect(verifiedDownload.text()).resolves.toContain(replyToken);
      await captureTrace('download-artifact');

      await runner.stop();
      runnerStopped = true;

      const localMount = await mountFileLibraryLocally(
        workspaceAccessBody.metadata_url,
        workspaceAccessBody.storage_bucket_url,
      );
      try {
        await expectTaskRuntimeStatePersisted({
          mountPath: resolveMountedTaskRoot(localMount.mountPath, {
            libraryRootPath: workspaceAccessBody.library_root_path,
          }),
          artifactName,
          artifactToken: replyToken,
        });
      } finally {
        await localMount.stop();
      }

      outcome = 'pass';

    } finally {
      if (!runnerStopped) {
        await runner.stop();
      }
      await trace.finish({ outcome });
    }
  });

  test('reads task context through mbos-context in a real notebook codex runner task', async ({ page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Notebook Context');
    const workspaceLibraryName = `Notebook Context Workspace ${Date.now()}`;
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'codex-notebook-context',
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      const taskId = await createNotebookTaskViaApi({
        page,
        workspaceId: 'ws_default',
        projectId,
        title: `Notebook Context ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId,
      });

      const taskNote = `TASK_CTX_${Date.now()}`;
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: 'ws_default',
        projectId,
        taskId,
        key: 'notes.current_task',
        content: taskNote,
      });

      await sendTaskMessage({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        content: [
          'Run this exact shell command and use its stdout value in your final reply:',
          '`python3 ~/.agents/skills/mbos-context/scripts/context_cli.py get --scope task --key notes.current_task`',
          'Reply with exactly one line in this format and no extra text:',
          '`CTX_TASK::<note>`',
        ].join(' '),
      });

      await waitForAssistantToken({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        token: taskNote,
      });
    } finally {
      await runner.stop();
    }
  });

  test('writes task context through mbos-context and persists it for the task owner', async ({ page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Notebook Context Write');
    const workspaceLibraryName = `Notebook Context Write Workspace ${Date.now()}`;
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'codex-notebook-context-write',
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      const taskId = await createNotebookTaskViaApi({
        page,
        workspaceId: 'ws_default',
        projectId,
        title: `Notebook Context Write ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId,
      });

      const contextKey = `notes.task_roundtrip_${Date.now()}`;
      const contextValue = `CTX_TASK_VALUE_${Date.now()}`;
      await sendTaskMessage({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        content: [
          'Run these exact shell commands and use their stdout values in your final reply:',
          `python3 ~/.agents/skills/mbos-context/scripts/context_cli.py put --scope task --key ${contextKey} --content ${contextValue}`,
          `python3 ~/.agents/skills/mbos-context/scripts/context_cli.py get --scope task --key ${contextKey}`,
          'Reply with exactly one line in this format and no extra text:',
          '`CTX_TASK_WRITE::<value>`',
        ].join(' '),
      });

      await waitForAssistantToken({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        token: contextValue,
      });

      const persisted = await getContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: 'ws_default',
        projectId,
        taskId,
        key: contextKey,
      });
      expect(persisted.body).toEqual(expect.objectContaining({
        scope: 'task',
        key: contextKey,
        content: contextValue,
        task_id: taskId,
      }));
    } finally {
      await runner.stop();
    }
  });

  test('reads task context through mbos-context inside a real notebook terminal session', async ({ page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Notebook Terminal Context');
    const workspaceLibraryName = `Notebook Terminal Context Workspace ${Date.now()}`;
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'codex-notebook-terminal-context',
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      const taskId = await createNotebookTaskViaApi({
        page,
        workspaceId: 'ws_default',
        projectId,
        title: `Notebook Terminal Context ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId,
      });

      const taskNote = `TERM_TASK_CTX_${Date.now()}`;
      const doneMarker = `TERM_CTX_DONE_${Date.now()}`;
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: 'ws_default',
        projectId,
        taskId,
        key: 'notes.current_task',
        content: taskNote,
      });

      const terminalSession = await createTerminalSessionViaApi({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        shell: '/usr/bin/bash',
      });

      const output = await runTerminalCommandInSession({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        sessionId: terminalSession.sessionId,
        command: `python3 ~/.agents/skills/mbos-context/scripts/context_cli.py get --scope task --key notes.current_task; printf '${doneMarker}\\n'`,
        waitFor: [taskNote, doneMarker],
      });

      expect(output).toContain(taskNote);
      expect(output).toContain(doneMarker);
    } finally {
      await runner.stop();
    }
  });

  test('rejects shared workspace context writes inside a real notebook terminal session', async ({ page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Notebook Terminal Shared Read Only');
    const workspaceLibraryName = `Notebook Terminal Shared Workspace ${Date.now()}`;
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'codex-notebook-terminal-shared-ro',
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      const taskId = await createNotebookTaskViaApi({
        page,
        workspaceId: 'ws_default',
        projectId,
        title: `Notebook Terminal Shared Read Only ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId,
      });

      const doneMarker = `TERM_SHARED_DONE_${Date.now()}`;
      const terminalSession = await createTerminalSessionViaApi({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        shell: '/usr/bin/bash',
      });

      const output = await runTerminalCommandInSession({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        sessionId: terminalSession.sessionId,
        command: `python3 ~/.agents/skills/mbos-context/scripts/context_cli.py put --scope workspace --key shared.terminal_attempt --content denied 2>&1 || true; printf '${doneMarker}\\n'`,
        waitFor: ['context_scope_read_only_for_agent', doneMarker],
      });

      expect(output.toLowerCase()).toContain('context_scope_read_only_for_agent');
      expect(output).toContain(doneMarker);
    } finally {
      await runner.stop();
    }
  });

  test('uses jira-ops task context before member context in a real notebook codex runner task', async ({ page }) => {
    test.setTimeout(720_000);
    let stage = 'init';
    const providerApiKey = requireRealLaneApiKey();
    const memberToken = `jira_member_${Date.now()}`;
    const taskToken = `jira_task_${Date.now()}`;
    const memberServer = await startMockJiraServer({
      displayName: `jira-member-${Date.now()}`,
      expectedToken: memberToken,
    });
    const taskServer = await startMockJiraServer({
      displayName: `jira-task-${Date.now()}`,
      expectedToken: taskToken,
    });

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Notebook Jira Skill');
    const workspaceLibraryName = `Notebook Jira Workspace ${Date.now()}`;
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: `notebook-jira-${Date.now()}`,
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    try {
      stage = 'put_member_jira_base_url';
      await putContextEntryViaApi({
        page,
        scope: 'member',
        workspaceId: 'ws_default',
        key: 'credentials.jira_base_url',
        content: memberServer.baseUrl,
      });
      stage = 'put_member_jira_token';
      await putContextEntryViaApi({
        page,
        scope: 'member',
        workspaceId: 'ws_default',
        key: 'credentials.jira_token',
        content: memberToken,
      });

      stage = 'wait_agent_online';
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      stage = 'create_task';
      const taskId = await createNotebookTaskViaApi({
        page,
        workspaceId: 'ws_default',
        projectId,
        title: `Notebook Jira Task ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId,
      });

      stage = 'put_task_jira_base_url';
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: 'ws_default',
        projectId,
        taskId,
        key: 'credentials.jira_base_url',
        content: taskServer.baseUrl,
      });
      stage = 'put_task_jira_token';
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: 'ws_default',
        projectId,
        taskId,
        key: 'credentials.jira_token',
        content: taskToken,
      });

      stage = 'send_task_message';
      await sendTaskMessage({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        content: [
          'Run this exact shell command and use its stdout value in your final reply:',
          '`python3 ~/.agents/skills/jira-ops/scripts/jira_ops.py myself | python3 -c "import json,sys; print(\\\'JIRA_TASK_SCOPE::\\\' + json.load(sys.stdin)[\\\'displayName\\\'])"`',
          'Reply with exactly one line and no extra text.',
        ].join(' '),
      });
      stage = 'wait_for_jira_task_scope';
      await waitForAssistantToken({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        token: `JIRA_TASK_SCOPE::jira-task-`,
      });
      stage = 'verify_not_member_token';
      const authToken = await readStoredAuthToken(page);
      const messagesResponse = await page.request.get(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/messages`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      expect(messagesResponse.ok()).toBeTruthy();
      const messages = (await messagesResponse.json()) as Array<{ content?: string; role?: string }>;
      const agentContent = messages
        .filter((item) => item.role === 'agent')
        .map((item) => item.content ?? '')
        .join('\n');
      expect(agentContent).toContain('JIRA_TASK_SCOPE::jira-task-');
      expect(agentContent).not.toContain('JIRA_TASK_SCOPE::jira-member-');
      stage = 'done';
    } catch (error) {
      throw new Error(`jira_task_real_smoke_failed:${stage}:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await runner.stop();
      await memberServer.stop();
      await taskServer.stop();
    }
  });

  test('uses feishu-docs managed credential projection in a real notebook codex runner task', async ({ page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();
    const feishuToken = `feishu_mock_token_${Date.now()}`;
    const toolName = `mock_feishu_tool_${Date.now()}`;
    const feishuServer = await startMockFeishuMcpServer({
      expectedToken: feishuToken,
      toolName,
    });

    await ensureIntegrationKeycloakUsers();
    await keycloakLoginToWorkspace(
      page,
      'ws_default',
      KEYCLOAK_INTEGRATION_USER_USERNAME,
      KEYCLOAK_INTEGRATION_USER_PASSWORD,
      { ensureProjectCreatorAccess: true },
    );
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Notebook Feishu Skill');
    const workspaceLibraryName = `Notebook Feishu Workspace ${Date.now()}`;
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: `notebook-feishu-${Date.now()}`,
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    try {
      const authToken = await readStoredAuthToken(page);
      expect(authToken).toBeTruthy();
      await createExternalConnectionViaApi({
        request: page.request,
        token: authToken!,
        provider: 'feishu',
        kind: 'oauth_account',
        displayName: `member-feishu-${Date.now()}`,
        fields: [
          { key: 'access_token', value: feishuToken, secret: true },
          { key: 'feishu_mcp_endpoint', value: feishuServer.endpoint, secret: false },
        ],
      });

      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);
      const taskId = await createNotebookTaskViaApi({
        page,
        workspaceId: 'ws_default',
        projectId,
        title: `Notebook Feishu Task ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId,
      });

      await sendTaskMessage({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        content: [
          'Run this exact shell command and use its stdout value in your final reply:',
          '`python3 ~/.agents/skills/feishu-docs/scripts/feishu_mcp.py tools-list | python3 -c "import json,sys; payload=json.load(sys.stdin); print(\\\'FEISHU_TOOLS::\\\' + payload[\\\'result\\\'][\\\'tools\\\'][0][\\\'name\\\'])"`',
          'Reply with exactly one line and no extra text.',
        ].join(' '),
      });
      await waitForAssistantToken({
        page,
        workspaceId: 'ws_default',
        projectId,
        taskId,
        token: `FEISHU_TOOLS::${toolName}`,
      });
    } finally {
      await runner.stop();
      await feishuServer.stop();
    }
  });

  test('runs a notebook task through docker runner with the same mounted workspace semantics', async ({ page }) => {
    test.setTimeout(900_000);
    const providerApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Docker Notebook');
    const workspaceLibraryName = `Docker Notebook Workspace ${Date.now()}`;
    await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `Provider Docker Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Docker Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'codex-docker-notebook',
    });

    const runner = await startCodexRunnerDockerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    let runnerStopped = false;

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);

      await page.goto(`/en-US/workspaces/ws_default/projects/${projectId}/notebook`);
      const taskId = await createNotebookTaskViaDialog({
        page,
        workspaceId: 'ws_default',
        projectId,
        agentName: agentBundle.agentName,
        workspaceLibraryName,
        title: `Codex Docker Notebook ${Date.now()}`,
      });

      const replyToken = `REAL_CODEX_DOCKER_NOTEBOOK_OK_${Date.now()}`;
      const artifactName = `docker-artifact-${Date.now()}.md`;
      const prompt = buildNotebookArtifactPrompt({
        artifactName,
        token: replyToken,
        title: '# Docker Notebook Artifact',
        bodyLines: [
          `- Token: ${replyToken}`,
          '- Audience: notebook runtime verification',
          '- Delivery: docker runner artifact',
        ],
      });
      let agentMessageRecord: { id?: string; content?: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await sendNotebookWriteMessage({
          page,
          projectId,
          taskId,
          token: replyToken,
          prompt,
        });
        agentMessageRecord = await waitForAgentReply({
          page,
          projectId,
          taskId,
          token: replyToken,
        });
        if (!isRetryableUpstreamCapacityError(agentMessageRecord?.content)) {
          break;
        }
      }
      expect(agentMessageRecord?.content).toContain(replyToken);

      const token = await readStoredAuthToken(page);
      const workspaceAccessResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/workspace-access`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(workspaceAccessResponse.ok()).toBeTruthy();
      const workspaceAccessBody = (await workspaceAccessResponse.json()) as {
        metadata_url: string;
        storage_bucket_url?: string;
        library_root_path?: string | null;
      };
      expect(workspaceAccessBody.metadata_url).toBeTruthy();
      expectRelativeLibraryRootPath(workspaceAccessBody.library_root_path);

      await runner.stop();
      runnerStopped = true;

      const localMount = await mountFileLibraryLocally(
        workspaceAccessBody.metadata_url,
        workspaceAccessBody.storage_bucket_url,
      );
      try {
        await expectTaskRuntimeStatePersisted({
          mountPath: resolveMountedTaskRoot(localMount.mountPath, {
            libraryRootPath: workspaceAccessBody.library_root_path,
          }),
          artifactName,
          artifactToken: replyToken,
        });
      } finally {
        await localMount.stop();
      }
    } finally {
      if (!runnerStopped) {
        await runner.stop();
      }
    }
  });
});
