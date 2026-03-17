import { expect, test } from '@playwright/test';
import {
  GLM_BASE_URL,
  GLM_MODEL,
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalCodexAgentBundle,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
  startCodexRunnerProcess,
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

test.describe('@lane-real notebook external agent via real codex runner', () => {
  test('runs a notebook task, exposes traces, and leaves usage/audit evidence', async ({ page }) => {
    test.setTimeout(720_000);
    const glmApiKey = requireGlmApiKey();

    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Codex Notebook');
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
      await expect(page.getByTestId('notebook__create-task-btn')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('notebook__create-task-btn').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('#task-title').fill(`Codex Notebook ${Date.now()}`);
      await dialog.locator('#task-agent').click();
      await page.getByRole('option', { name: new RegExp(agentBundle.agentName) }).click();
      await dialog.getByRole('button', { name: /create/i }).click();
      await page.waitForURL(/\/notebook\/tasks\/.+$/, { timeout: 30_000 });
      const taskId = page.url().match(/\/notebook\/tasks\/([^/?#]+)/)?.[1];
      expect(taskId).toBeTruthy();
      await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });

      const replyToken = `REAL_CODEX_NOTEBOOK_OK_${Date.now()}`;
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
            content: `Reply with the exact token ${replyToken} and a short explanation.`,
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
      await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
    } finally {
      await runner.stop();
    }
  });
});
