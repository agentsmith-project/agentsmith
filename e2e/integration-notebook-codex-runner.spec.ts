import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  GLM_BASE_URL,
  GLM_MODEL,
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
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

function requireGlmApiKey(): string {
  const value = process.env.GLM_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_GLM_API_KEY');
  }
  return value;
}

async function createNotebookTaskViaDialog(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  agentName: string;
  workspaceLibraryName: string;
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
  await dialog.getByTestId('task-create__file-library').click();
  await page.getByRole('option', { name: new RegExp(workspaceLibraryName) }).click();
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

test.describe('@lane-real notebook external agent via real codex runner', () => {
  test('runs a notebook task, exposes traces, and leaves usage/audit evidence', async ({ page }) => {
    test.setTimeout(720_000);
    const glmApiKey = requireGlmApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Notebook');
    const workspaceLibraryName = `Notebook Workspace ${Date.now()}`;
    await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `GLM Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, glmApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `GLM Endpoint ${Date.now()}`,
      endpointModel: GLM_MODEL,
      upstreamBaseUrl: GLM_BASE_URL,
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
              `Create a concise markdown deliverable at .artifacts/${artifactName}.`,
              `The file must include the exact token ${replyToken}.`,
              'The deliverable should summarize a simple market-sizing analysis in 3 bullets.',
              `Then reply with the exact token ${replyToken} and mention ${artifactName}.`,
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
      const workspaceAccessBody = (await workspaceAccessResponse.json()) as { workspace_dir_name: string };
      expect(workspaceAccessBody.workspace_dir_name).toBeTruthy();

      const artifactPath = path.join(
        runner.workspaceRoot,
        workspaceAccessBody.workspace_dir_name,
        '.artifacts',
        artifactName,
      );
      await expect
        .poll(
          async () => readFile(artifactPath, 'utf-8').catch(() => null),
          { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
        )
        .toContain(replyToken);
      await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
    } finally {
      await runner.stop();
    }
  });

  test('runs a notebook task through docker runner with the same mounted workspace semantics', async ({ page }) => {
    test.setTimeout(900_000);
    const glmApiKey = requireGlmApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Docker Notebook');
    const workspaceLibraryName = `Docker Notebook Workspace ${Date.now()}`;
    await createFileLibraryViaUi(page, 'ws_default', projectId, workspaceLibraryName);
    const credentialName = `GLM Docker Credential ${Date.now()}`;
    await createCredentialViaUi(page, 'ws_default', projectId, credentialName, glmApiKey);
    const endpointId = await createEndpointViaApi(page, 'ws_default', projectId, {
      endpointName: `GLM Docker Endpoint ${Date.now()}`,
      endpointModel: GLM_MODEL,
      upstreamBaseUrl: GLM_BASE_URL,
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
              `Create a markdown deliverable at .artifacts/${artifactName}.`,
              `The file must include the exact token ${replyToken}.`,
              'Summarize a compact market-sizing analysis in 3 bullets and one recommendation.',
              `Then reply with the exact token ${replyToken} and mention ${artifactName}.`,
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
      const workspaceAccessBody = (await workspaceAccessResponse.json()) as { metadata_url: string };
      expect(workspaceAccessBody.metadata_url).toBeTruthy();

      const localMount = await mountFileLibraryLocally(workspaceAccessBody.metadata_url);
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
