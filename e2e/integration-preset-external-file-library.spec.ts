import { expect, test, type Page } from '@playwright/test';
import { API_BASE, keycloakLoginToWorkspace, LOCALE, waitForAgentPresenceOnline } from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

const WORKSPACE_ID = 'ws_default';
const DEMO_PROJECT_NAME = 'Demo Project';
const DEMO_EXTERNAL_AGENT_NAME = 'demo-external-agent';
const EXPECTED_TOKEN = `PRESET_EXTERNAL_FILE_LIBRARY_OK_${Date.now()}`;
const CREATE_NEW_TASK_REQUEST_TIMEOUT_MS = 60_000;

function expectRelativeLibraryRootPath(value: string | null | undefined): void {
  expect(value).toBeTruthy();
  expect(value?.startsWith('/')).toBe(false);
  expect(value?.includes('..')).toBe(false);
}

async function resolveDemoProjectAndAgent(page: Page): Promise<{ projectId: string; agentId: string }> {
  const token = await readStoredAuthToken(page);
  const projectsResponse = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects?page=1&page_size=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(projectsResponse.ok()).toBeTruthy();
  const projectsPayload = (await projectsResponse.json()) as {
    items?: Array<{ id: string; name: string }>;
  };
  const projectId = projectsPayload.items?.find((item) => item.name === DEMO_PROJECT_NAME)?.id;
  expect(projectId).toBeTruthy();

  const agentsResponse = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${projectId}/agents?page=1&page_size=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(agentsResponse.ok()).toBeTruthy();
  const agentsPayload = (await agentsResponse.json()) as {
    items?: Array<{ id: string; name: string }>;
  };
  const agentId = agentsPayload.items?.find((item) => item.name === DEMO_EXTERNAL_AGENT_NAME)?.id;
  expect(agentId).toBeTruthy();

  return {
    projectId: projectId ?? '',
    agentId: agentId ?? '',
  };
}

async function createTask(page: Page, projectId: string, agentId: string): Promise<string> {
  const token = await readStoredAuthToken(page);
  const title = `Preset External File Library ${Date.now()}`;
  const workspaceName = `preset-ext-flib-${Date.now()}`;
  let lastStatus = 0;
  let lastBody = '';

  await expect
    .poll(async () => {
      const response = await page.request.post(
        `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${projectId}/tasks`,
        {
          timeout: CREATE_NEW_TASK_REQUEST_TIMEOUT_MS,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: {
            title,
            agent_id: agentId,
            workspace_mode: 'create_new',
            workspace_name: workspaceName,
          },
        },
      );
      lastStatus = response.status();
      lastBody = await response.text();
      if (!response.ok()) {
        return null;
      }
      const payload = JSON.parse(lastBody) as { id?: string };
      return payload.id ?? null;
    }, {
      timeout: 60_000,
      intervals: [1_000, 2_000, 5_000],
      message: () => `task creation never became ready, last status=${lastStatus}, body=${lastBody}`,
    })
    .not.toBeNull();

  const payload = JSON.parse(lastBody) as { id?: string };
  expect(payload.id).toBeTruthy();
  return payload.id ?? '';
}

async function expectRunnerSafeWorkspaceAccess(page: Page, projectId: string, taskId: string): Promise<void> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${projectId}/tasks/${taskId}/workspace-access`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as {
    metadata_url?: string;
    storage_bucket_url?: string;
    container_workspace_path?: string | null;
    library_root_path?: string | null;
  };
  expect(payload.metadata_url).toContain('@postgres:5432/');
  expect(payload.storage_bucket_url).toContain('http://minio:9000/');
  expectRelativeLibraryRootPath(payload.library_root_path);
  expect(payload.container_workspace_path ?? null).toBeNull();
}

async function sendNotebookMessage(page: Page, content: string): Promise<void> {
  const input = page.getByTestId('notebook__conversation-input').locator('textarea').first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(content);
  await page.getByTestId('notebook__send-btn').click();
}

async function waitForAgentReply(page: Page, projectId: string, taskId: string, expectedToken: string): Promise<void> {
  const token = await readStoredAuthToken(page);
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${projectId}/tasks/${taskId}/messages`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok()) return false;
      const messages = (await response.json()) as Array<{ role?: string; content?: string }>;
      return messages.some((item) => item.role === 'agent' && item.content?.includes(expectedToken));
    }, { timeout: 300_000, intervals: [1_000, 2_000, 5_000] })
    .toBe(true);
}

test.describe('@lane-real integration preset external file-library execution', () => {
  test('preset compose-managed external runner handles create_new workspace tasks', async ({ page }) => {
    await keycloakLoginToWorkspace(page, WORKSPACE_ID);
    const { projectId, agentId } = await resolveDemoProjectAndAgent(page);
    await waitForAgentPresenceOnline(page, WORKSPACE_ID, projectId, agentId);

    const taskId = await createTask(page, projectId, agentId);
    await expectRunnerSafeWorkspaceAccess(page, projectId, taskId);

    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/notebook/tasks/${taskId}`);
    await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });

    await sendNotebookMessage(
      page,
      `Create notes/preset_external.txt with exactly one line: preset external ok. Then reply with exactly ${EXPECTED_TOKEN}.`,
    );
    await waitForAgentReply(page, projectId, taskId, EXPECTED_TOKEN);
  });
});
