import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  REAL_LANE_ANTHROPIC_BASE_URL,
  REAL_LANE_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalCodexAgentBundle,
  createFileLibraryViaUi,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
  mountFileLibraryLocally,
  startCodexRunnerProcess,
  startCodexRunnerDockerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

function requireRealLaneApiKey(): string {
  const value = process.env.REAL_LANE_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_REAL_LANE_API_KEY');
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
    const glmApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Notebook');
    const workspaceLibraryName = `Notebook Workspace ${Date.now()}`;
    await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `GLM Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, glmApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `GLM Endpoint ${Date.now()}`,
      endpointModel: REAL_LANE_MODEL,
      upstreamBaseUrl: REAL_LANE_ANTHROPIC_BASE_URL,
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
      const token = await readStoredAuthToken(page);
      const sendMessageResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/messages`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            role: 'user',
            content: [
              'Run the following shell command exactly, then reply with the token and filename.',
              '```bash',
              `mkdir -p .artifacts && printf '%s\\n' '# Market sizing summary' '- Token: ${replyToken}' '- Segment: North America consumer electronics' '- Insight: online channel share is expanding faster than retail' '- Recommendation: prioritize search plus retail media in the next planning cycle' > .artifacts/${artifactName}`,
              '```',
              `After the file is written, reply with exactly: ${replyToken} ${artifactName}`,
            ].join(' '),
          },
        },
      );
      if (!sendMessageResponse.ok()) {
        throw new Error(`notebook_send_failed:${sendMessageResponse.status()}:${await sendMessageResponse.text()}`);
      }

      let agentMessageRecord: { id?: string; content?: string } | null = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const response = await page.request.get(
          `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (response.ok()) {
          const payload = (await response.json()) as Array<{ id?: string; role?: string; content?: string }>;
          const agentMessages = payload.filter((item) => item.role === 'agent');
          const withToken = agentMessages.find((item) => typeof item.content === 'string' && item.content.includes(replyToken));
          if (withToken) {
            agentMessageRecord = withToken;
            break;
          }
          agentMessageRecord = agentMessages.at(-1) ?? null;
        }
        await page.waitForTimeout(2_000);
      }

      expect(agentMessageRecord).toBeTruthy();
      expect(agentMessageRecord?.content).toContain(replyToken);
      expect(agentMessageRecord?.content).toContain(artifactName);

      const workspaceAccessResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/workspace-access`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(workspaceAccessResponse.ok()).toBeTruthy();
      const workspaceAccessBody = (await workspaceAccessResponse.json()) as {
        workspace_dir_name: string;
        metadata_url: string;
        storage_bucket_url?: string;
      };
      expect(workspaceAccessBody.workspace_dir_name).toBeTruthy();
      expect(workspaceAccessBody.metadata_url).toBeTruthy();

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

      const localMount = await mountFileLibraryLocally(
        workspaceAccessBody.metadata_url,
        workspaceAccessBody.storage_bucket_url,
      );
      try {
        await expect
          .poll(
            async () => readFile(path.join(localMount.mountPath, '.artifacts', artifactName), 'utf-8').catch(() => null),
            { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
          )
          .toContain(replyToken);
      } finally {
        await localMount.stop();
      }

    } finally {
      await runner.stop();
    }
  });

  test('runs a notebook task through docker runner with the same mounted workspace semantics', async ({ page }) => {
    test.setTimeout(900_000);
    const glmApiKey = requireRealLaneApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Docker Notebook');
    const workspaceLibraryName = `Docker Notebook Workspace ${Date.now()}`;
    await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `GLM Docker Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, glmApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `GLM Docker Endpoint ${Date.now()}`,
      endpointModel: REAL_LANE_MODEL,
      upstreamBaseUrl: REAL_LANE_ANTHROPIC_BASE_URL,
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
      const token = await readStoredAuthToken(page);
      const sendMessageResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/messages`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          data: {
            role: 'user',
            content: [
              'Run the following shell command exactly, then reply with the token and filename.',
              '```bash',
              `mkdir -p .artifacts && printf '%s\\n' '# Market sizing summary' '- Token: ${replyToken}' '- Segment: North America consumer electronics' '- Insight: online channel share is expanding faster than retail' '- Recommendation: prioritize search plus retail media in the next planning cycle' > .artifacts/${artifactName}`,
              '```',
              `After the file is written, reply with exactly: ${replyToken} ${artifactName}`,
            ].join(' '),
          },
        },
      );
      if (!sendMessageResponse.ok()) {
        throw new Error(`notebook_send_failed:${sendMessageResponse.status()}:${await sendMessageResponse.text()}`);
      }

      await expect
        .poll(
          async () => {
            const response = await page.request.get(
              `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/messages`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!response.ok()) return null;
            const payload = (await response.json()) as Array<{ role?: string; content?: string }>;
            return payload.find((item) => item.role === 'agent' && item.content?.includes(replyToken))?.content ?? null;
          },
          { timeout: 180_000, intervals: [2_000, 5_000, 10_000] },
        )
        .toContain(replyToken);

      const workspaceAccessResponse = await page.request.post(
        `${API_BASE}/api/v1/workspaces/ws_default/projects/${projectId}/tasks/${taskId}/workspace-access`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(workspaceAccessResponse.ok()).toBeTruthy();
      const workspaceAccessBody = (await workspaceAccessResponse.json()) as {
        metadata_url: string;
        storage_bucket_url?: string;
      };
      expect(workspaceAccessBody.metadata_url).toBeTruthy();

      const localMount = await mountFileLibraryLocally(
        workspaceAccessBody.metadata_url,
        workspaceAccessBody.storage_bucket_url,
      );
      try {
        await expect
          .poll(
            async () => readFile(path.join(localMount.mountPath, '.artifacts', artifactName), 'utf-8').catch(() => null),
            { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
          )
          .toContain(replyToken);
      } finally {
        await localMount.stop();
      }
    } finally {
      await runner.stop();
    }
  });
});
