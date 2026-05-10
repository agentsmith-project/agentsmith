import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  keycloakLoginToWorkspace,
  LOCALE,
  startAgentTaskRunViaApi,
  waitForRunnerOutputToken,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

const WORKSPACE_ID = 'ws_default';
const DEMO_PROJECT_NAME = 'Codex Agent Regression';
const EXPECTED_TOKEN = `PRESET_AGENT_TASK_FILE_LIBRARY_OK_${Date.now()}`;
const CREATE_NEW_TASK_REQUEST_TIMEOUT_MS = 60_000;

function expectRelativeLibraryRootPath(value: string | null | undefined): void {
  expect(value).toBeTruthy();
  expect(value?.startsWith('/')).toBe(false);
  expect(value?.includes('..')).toBe(false);
}

async function resolveDemoProjectAndRunner(page: Page): Promise<{ projectId: string; runnerId: string }> {
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

  const runnersResponse = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${projectId}/agent-runners?page=1&page_size=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(runnersResponse.ok()).toBeTruthy();
  const runnersPayload = (await runnersResponse.json()) as {
    items?: Array<{ id: string; is_default?: boolean; status?: string }>;
  };
  const runner = runnersPayload.items?.find((item) => item.is_default === true) ?? runnersPayload.items?.[0];
  expect(runner?.id).toBeTruthy();
  expect(runner?.status ?? 'ready').toMatch(/ready|connected/);

  return {
    projectId: projectId ?? '',
    runnerId: runner?.id ?? '',
  };
}

async function createTask(page: Page, projectId: string): Promise<string> {
  const token = await readStoredAuthToken(page);
  const title = `Preset Agent Task File Library ${Date.now()}`;
  const workspaceName = `preset-agent-task-flib-${Date.now()}`;
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
      message: `task creation never became ready, last status=${lastStatus}, body=${lastBody}`,
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
    task_home_binding?: {
      provider?: string;
      mode?: string;
      paths?: {
        task_home_path?: string;
        workspace_path?: string;
        artifacts_path?: string;
        library_root_path?: string | null;
      };
    };
  };
  expect(JSON.stringify(payload)).not.toMatch(/metadata_url|storage_bucket_url|recommended_mount|filesystem_name|juicefs/i);
  expect(payload.task_home_binding?.provider).toBe('afscp');
  expect(payload.task_home_binding?.mode).toBe('pre_mounted');
  const paths = payload.task_home_binding?.paths ?? {};
  expect(paths.task_home_path).toMatch(/^\/home\/[a-z0-9][a-z0-9._-]*$/);
  expect(paths.workspace_path).toBe(`${paths.task_home_path}/workspace`);
  expect(paths.artifacts_path).toBe(`${paths.workspace_path}/.artifacts`);
  expectRelativeLibraryRootPath(paths.library_root_path);
  expect(payload).not.toHaveProperty('container_workspace_path');
}

test.describe('@lane-real integration preset Agent Task file-library execution', () => {
  test('preset compose-managed Agent Task runner handles create_new workspace tasks', async ({ page }) => {
    await keycloakLoginToWorkspace(page, WORKSPACE_ID);
    const { projectId, runnerId } = await resolveDemoProjectAndRunner(page);

    const taskId = await createTask(page, projectId);
    await expectRunnerSafeWorkspaceAccess(page, projectId, taskId);

    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/agent-tasks/${taskId}`);
    await expect(page.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 30_000 });

    const run = await startAgentTaskRunViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId,
      intent: `Create notes/preset_agent_task.txt with exactly one line: preset agent task ok. Then reply with exactly ${EXPECTED_TOKEN}.`,
    });
    expect(runnerId).toBeTruthy();
    await waitForRunnerOutputToken({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId,
      token: EXPECTED_TOKEN,
      runnerOutputActivityId: run.runnerOutputActivityId,
      runId: run.runId,
    });
  });
});
