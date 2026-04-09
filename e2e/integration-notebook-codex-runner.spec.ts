import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createTerminalSessionViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalCodexAgentBundle,
  createNotebookTaskViaApi,
  createFileLibraryViaUi,
  createProjectInWorkspace,
  getContextEntryViaApi,
  keycloakLoginToWorkspace,
  mountFileLibraryLocally,
  putContextEntryViaApi,
  resolveMountedTaskRoot,
  runTerminalCommandViaWs,
  sendTaskMessage,
  startCodexRunnerProcess,
  startCodexRunnerDockerProcess,
  waitForAssistantToken,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

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

async function sendNotebookWriteMessage(args: {
  page: Page;
  projectId: string;
  taskId: string;
  token: string;
  artifactName: string;
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
        content: [
          'Run the following shell command exactly, then reply with the token and filename.',
          '```bash',
          `mkdir -p .artifacts && printf '%s\\n' '# Market sizing summary' '- Token: ${args.token}' '- Segment: North America consumer electronics' '- Insight: online channel share is expanding faster than retail' '- Recommendation: prioritize search plus retail media in the next planning cycle' > .artifacts/${args.artifactName}`,
          '```',
          `After the file is written, reply with exactly: ${args.token} ${args.artifactName}`,
        ].join(' '),
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
  await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
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

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Notebook');
    const workspaceLibraryName = `Notebook Workspace ${Date.now()}`;
    await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `Provider Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, providerApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `Provider Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });
    const agentBundle = await createExternalCodexAgentBundle(page, {
      workspaceId: 'ws_default',
      projectId,
      endpointId,
      title: 'codex-notebook',
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    let runnerStopped = false;
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    try {
      await waitForAgentPresenceOnline(page, 'ws_default', projectId, agentBundle.agentId);

      await page.goto(`/en-US/workspaces/ws_default/projects/${projectId}/notebook`);
      const taskId = await createNotebookTaskViaDialog({
        page,
        workspaceId: 'ws_default',
        projectId,
        agentName: agentBundle.agentName,
        workspaceLibraryName,
        title: `Codex Notebook ${Date.now()}`,
      });

      const replyToken = `REAL_CODEX_NOTEBOOK_OK_${Date.now()}`;
      const artifactName = `market-summary-${Date.now()}.md`;
      let agentMessageRecord: { id?: string; content?: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await sendNotebookWriteMessage({
          page,
          projectId,
          taskId,
          token: replyToken,
          artifactName,
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
      expect(agentMessageRecord?.content).toContain(artifactName);

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
      await expect(
        page.getByTestId('files__object-row').filter({ hasText: artifactName }).first(),
      ).toBeVisible({ timeout: 30_000 });

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
    const agentBundle = await createExternalCodexAgentBundle(page, {
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
    const agentBundle = await createExternalCodexAgentBundle(page, {
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
    const agentBundle = await createExternalCodexAgentBundle(page, {
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

      const output = await runTerminalCommandViaWs({
        wsUrl: terminalSession.wsUrl,
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
    const agentBundle = await createExternalCodexAgentBundle(page, {
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

      const output = await runTerminalCommandViaWs({
        wsUrl: terminalSession.wsUrl,
        command: `python3 ~/.agents/skills/mbos-context/scripts/context_cli.py put --scope workspace --key shared.terminal_attempt --content denied 2>&1 || true; printf '${doneMarker}\\n'`,
        waitFor: ['context_scope_read_only_for_agent', doneMarker],
      });

      expect(output.toLowerCase()).toContain('context_scope_read_only_for_agent');
      expect(output).toContain(doneMarker);
    } finally {
      await runner.stop();
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
    const agentBundle = await createExternalCodexAgentBundle(page, {
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
      const artifactName = `docker-market-summary-${Date.now()}.md`;
      let agentMessageRecord: { id?: string; content?: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await sendNotebookWriteMessage({
          page,
          projectId,
          taskId,
          token: replyToken,
          artifactName,
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
