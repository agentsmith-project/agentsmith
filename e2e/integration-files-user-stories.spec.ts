import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
  startAgentTaskRunViaApi,
  waitForRunnerOutputToken,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

const WORKSPACE_ID = 'ws_default';
const DEMO_PROJECT_NAME = 'Codex Agent Regression';
const MANY_LIBRARY_COUNT = 16;
const CREATE_NEW_TASK_REQUEST_TIMEOUT_MS = 60_000;

type FileLibraryListItem = {
  id: string;
  name: string;
  status?: string | null;
};

type CreatedAgentTaskWithLibrary = {
  taskId: string;
  workspaceFileLibraryId: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveCreatedAgentTaskFields(payload: unknown): { taskId: string | null; workspaceFileLibraryId: string | null } {
  const candidates: Record<string, unknown>[] = [];
  const root = asRecord(payload);
  if (root) {
    candidates.push(root);
    const data = asRecord(root.data);
    if (data) {
      candidates.push(data);
      const dataTask = asRecord(data.task);
      if (dataTask) candidates.push(dataTask);
    }
    const task = asRecord(root.task);
    if (task) candidates.push(task);
  }

  return {
    taskId: candidates.map((candidate) => readStringField(candidate, 'id')).find(Boolean) ?? null,
    workspaceFileLibraryId: candidates
      .map((candidate) => readStringField(candidate, 'workspace_file_library_id'))
      .find(Boolean) ?? null,
  };
}

function parseCreatedAgentTaskWithLibrary(body: string): CreatedAgentTaskWithLibrary {
  const fields = resolveCreatedAgentTaskFields(JSON.parse(body) as unknown);
  if (!fields.taskId) {
    throw new Error('agent_task_id_not_found_after_storage_ready_create');
  }
  if (!fields.workspaceFileLibraryId) {
    throw new Error(`agent_task_workspace_file_library_id_not_found:${fields.taskId}`);
  }
  return {
    taskId: fields.taskId,
    workspaceFileLibraryId: fields.workspaceFileLibraryId,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function authHeaders(page: Page): Promise<{ Authorization: string }> {
  const token = await readStoredAuthToken(page);
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

async function createFileLibraryViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  name: string;
}): Promise<FileLibraryListItem> {
  const headers = await authHeaders(args.page);
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 0; attempt < 18; attempt += 1) {
    try {
      const response = await args.page.request.post(
        `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries`,
        {
          timeout: 60_000,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          data: {
            name: args.name,
            description: 'Created by Files user-story e2e coverage.',
          },
        },
      );
      lastStatus = response.status();
      lastBody = await response.text();
      if (response.ok()) {
        const payload = JSON.parse(lastBody) as Partial<FileLibraryListItem>;
        const id = payload.id?.trim();
        if (!id) {
          throw new Error('file_library_id_missing_after_api_create');
        }
        return {
          id,
          name: payload.name?.trim() || args.name,
          status: payload.status,
        };
      }
    } catch (error) {
      lastStatus = 0;
      lastBody = error instanceof Error ? error.message : String(error);
      const maybeCreated = (await listFileLibraries(args).catch(() => []))
        .find((library) => library.name === args.name);
      if (maybeCreated) {
        return maybeCreated;
      }
    }
    const projectStorageStillBootstrapping =
      lastStatus === 409
      && /PROJECT_STORAGE_PENDING|project_storage_pending/.test(lastBody);
    const requestTimedOut = /Timeout \d+ms exceeded/i.test(lastBody);
    if (!projectStorageStillBootstrapping && !requestTimedOut) {
      break;
    }
    await args.page.waitForTimeout(Math.min(10_000, 1_000 * (attempt + 1)));
  }
  throw new Error(`create_file_library_failed:${lastStatus}:${lastBody}`);
}

async function listFileLibraries(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
}): Promise<FileLibraryListItem[]> {
  const headers = await authHeaders(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries?page=1&page_size=100`,
    { headers },
  );
  if (!response.ok()) {
    throw new Error(`list_file_libraries_failed:${response.status()}:${await response.text()}`);
  }
  const payload = (await response.json()) as { items?: FileLibraryListItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

async function waitForLibraryStatus(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  expected: RegExp;
  timeoutMs?: number;
}): Promise<string> {
  let latestStatus = '';
  await expect.poll(async () => {
    const libraries = await listFileLibraries(args);
    latestStatus = libraries.find((library) => library.id === args.libraryId)?.status ?? '';
    return latestStatus;
  }, {
    timeout: args.timeoutMs ?? 120_000,
    intervals: [1_000, 2_000, 5_000],
    message: `file library ${args.libraryId} did not reach ${args.expected}; latest=${latestStatus}`,
  }).toMatch(args.expected);
  return latestStatus;
}

async function deleteFileLibraryViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  libraryName: string;
}): Promise<void> {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/files`);
  const libraryItem = args.page.getByTestId(`files__library-item--${args.libraryId}`);
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  await libraryItem.click();
  await args.page.getByTestId(`files__library-delete-inline--${args.libraryId}`).click();

  const deleteDialog = args.page.getByTestId('files__dialog__library-delete');
  await expect(deleteDialog).toBeVisible({ timeout: 10_000 });
  await deleteDialog.getByTestId('files__library-delete__confirm').fill(args.libraryName);

  const deleteResponsePromise = args.page.waitForResponse((response) => (
    response.request().method() === 'DELETE'
    && response
      .url()
      .includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}`)
  ));
  await deleteDialog.getByTestId('files__library-delete__submit').click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.ok()).toBeTruthy();
}

async function resolveDemoProjectAndRunner(page: Page): Promise<{ projectId: string; runnerId: string }> {
  const headers = await authHeaders(page);
  const projectsResponse = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects?page=1&page_size=100`,
    { headers },
  );
  expect(projectsResponse.ok()).toBeTruthy();
  const projectsPayload = (await projectsResponse.json()) as {
    items?: Array<{ id: string; name: string }>;
  };
  const projectId = projectsPayload.items?.find((item) => item.name === DEMO_PROJECT_NAME)?.id?.trim();
  expect(projectId).toBeTruthy();

  const runnersResponse = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${projectId}/agent-runners?page=1&page_size=100`,
    { headers },
  );
  expect(runnersResponse.ok()).toBeTruthy();
  const runnersPayload = (await runnersResponse.json()) as {
    items?: Array<{ id: string; is_default?: boolean; status?: string | null }>;
  };
  const runner = runnersPayload.items?.find((item) => item.is_default === true) ?? runnersPayload.items?.[0];
  expect(runner?.id).toBeTruthy();
  expect(runner?.status ?? 'ready').toMatch(/ready|connected/);

  return {
    projectId: projectId ?? '',
    runnerId: runner?.id ?? '',
  };
}

async function createAgentTaskAfterProjectStorageReady(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  workspaceName: string;
}): Promise<CreatedAgentTaskWithLibrary> {
  const headers = await authHeaders(args.page);
  let lastStatus = 0;
  let lastBody = '';
  await expect.poll(async () => {
    let response: Awaited<ReturnType<Page['request']['post']>>;
    try {
      response = await args.page.request.post(
        `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
        {
          timeout: CREATE_NEW_TASK_REQUEST_TIMEOUT_MS,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          data: {
            title: args.title,
            workspace_mode: 'create_new',
            workspace_name: args.workspaceName,
          },
        },
      );
    } catch (error) {
      lastStatus = 0;
      lastBody = error instanceof Error ? error.message : String(error);
      if (/Timeout \d+ms exceeded/i.test(lastBody)) {
        return null;
      }
      throw error;
    }
    lastStatus = response.status();
    lastBody = await response.text();
    if (!response.ok()) {
      const projectStoragePending =
        response.status() === 409
        && /PROJECT_STORAGE_PENDING|project_storage_pending/.test(lastBody);
      if (projectStoragePending) {
        return null;
      }
      throw new Error(`create_agent_task_failed:${response.status()}:${lastBody}`);
    }

    return resolveCreatedAgentTaskFields(JSON.parse(lastBody) as unknown).taskId;
  }, {
    timeout: 180_000,
    intervals: [1_000, 2_000, 5_000],
    message: `agent task creation never became ready; last status=${lastStatus}, body=${lastBody}`,
  }).not.toBeNull();

  return parseCreatedAgentTaskWithLibrary(lastBody);
}

async function openWorkspaceFilesRoot(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryId: string;
}): Promise<string> {
  const rootEntriesResponsePromise = args.page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response
      .url()
      .includes(`/workspaces/${args.workspaceId}/projects/${args.projectId}/file-libraries/${args.libraryId}/entries`)
    && response.ok()
  ), { timeout: 30_000 });
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/files?library_id=${encodeURIComponent(args.libraryId)}`);
  await expect(args.page).toHaveURL(new RegExp(`[?&]library_id=${escapeRegex(args.libraryId)}(?:&|$)`), {
    timeout: 30_000,
  });
  const libraryItem = args.page.getByTestId(`files__library-item--${args.libraryId}`);
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  await expect(libraryItem).toHaveClass(/bg-accent\/10/, { timeout: 30_000 });
  await rootEntriesResponsePromise;
  await expect(args.page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
  return args.libraryId;
}

async function openFolderByName(page: Page, name: string): Promise<void> {
  const visibleDialog = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last();
  if (await visibleDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  const folderRow = page.getByTestId('files__object-row').filter({ hasText: name }).first();
  await expect(folderRow).toBeVisible({ timeout: 30_000 });
  const button = folderRow.getByRole('button').first();
  if (await button.isVisible().catch(() => false)) {
    await button.dblclick();
    return;
  }
  await folderRow.dblclick();
}

async function waitForTaskArtifact(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  expectedPath: string;
}): Promise<void> {
  const headers = await authHeaders(args.page);
  await expect.poll(async () => {
    const response = await args.page.request.get(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/artifacts`,
      { headers },
    );
    if (!response.ok()) return false;
    const payload = (await response.json()) as Array<{ task_relative_path?: string }>;
    return payload.some((item) => item.task_relative_path === args.expectedPath);
  }, {
    timeout: 120_000,
    intervals: [1_000, 2_000, 5_000],
  }).toBe(true);
}

test.describe.serial('@lane-real files user stories', () => {
  test('many file libraries keep the left list scrollable and scannable', async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 640 });

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, 'Files Many Libraries');
    const namePrefix = `Scan Library ${Date.now()}`;
    const libraries: FileLibraryListItem[] = [];
    for (let index = 0; index < MANY_LIBRARY_COUNT; index += 1) {
      libraries.push(await createFileLibraryViaApi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        name: `${namePrefix} ${String(index + 1).padStart(2, '0')}`,
      }));
    }

    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/files`);
    const listScroll = page.getByTestId('files__library-list-scroll');
    await expect(listScroll).toBeVisible({ timeout: 30_000 });

    const firstLibrary = libraries[0];
    const middleLibrary = libraries[Math.floor(libraries.length / 2)];
    const lastLibrary = libraries[libraries.length - 1];

    await expect(page.getByTestId(`files__library-item--${firstLibrary.id}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`files__library-status--${firstLibrary.id}`)).toBeVisible({ timeout: 30_000 });

    await expect.poll(async () => listScroll.evaluate((element) => element.scrollHeight > element.clientHeight + 8), {
      timeout: 30_000,
      intervals: [500, 1_000],
      message: 'files library list never became vertically scrollable',
    }).toBe(true);

    await listScroll.evaluate((element) => {
      element.scrollTop = Math.floor(element.scrollHeight / 2);
    });
    await expect(page.getByTestId(`files__library-item--${middleLibrary.id}`)).toContainText(middleLibrary.name);
    await expect(page.getByTestId(`files__library-status--${middleLibrary.id}`)).toBeVisible();

    await listScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.getByTestId(`files__library-item--${lastLibrary.id}`)).toContainText(lastLibrary.name);
    await expect(page.getByTestId(`files__library-status--${lastLibrary.id}`)).toBeVisible();
  });

  test('deleting an empty file library reaches a terminal visible state', async ({ page }) => {
    test.setTimeout(240_000);

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, 'Files Delete Terminal');
    const libraryName = `Delete Terminal Library ${Date.now()}`;
    const createdLibrary = await createFileLibraryViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      name: libraryName,
    });
    const libraryId = createdLibrary.id;
    await waitForLibraryStatus({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      expected: /^ready$/i,
    });

    await deleteFileLibraryViaUi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId,
      libraryName,
    });

    await expect.poll(async () => {
      const library = (await listFileLibraries({ page, workspaceId: WORKSPACE_ID, projectId }))
        .find((item) => item.id === libraryId);
      if (!library) return 'removed';
      return library.status ?? '';
    }, {
      timeout: 180_000,
      intervals: [1_000, 2_000, 5_000],
      message: 'deleted file library remained in a non-terminal deleting state',
    }).toMatch(/^(removed|deleted|failed)$/i);

    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/files`);
    const deletedItem = page.getByTestId(`files__library-item--${libraryId}`);
    if (await deletedItem.count()) {
      await expect(page.getByTestId(`files__library-status--${libraryId}`)).not.toContainText(/deleting/i);
    } else {
      await expect(page.getByText(libraryName)).toHaveCount(0);
    }
  });

  test('Agent Task artifacts written under HOME workspace are visible from Files', async ({ page }) => {
    test.setTimeout(600_000);

    await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId, runnerId } = await resolveDemoProjectAndRunner(page);
    expect(runnerId).toBeTruthy();

    const token = `FILES_UI_TASK_ARTIFACT_OK_${Date.now()}`;
    const workspaceName = `Files Task Workspace ${Date.now()}`;
    const homeRootFileName = `files-ui-home-root-${Date.now()}.txt`;
    const workspaceFileName = `files-ui-workspace-${Date.now()}.txt`;
    const artifactFileName = `files-ui-artifact-${Date.now()}.txt`;
    const contentLine = `same-content:${token}`;
    const createdTask = await createAgentTaskAfterProjectStorageReady({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      title: `Files UI artifact visibility ${Date.now()}`,
      workspaceName,
    });
    const taskId = createdTask.taskId;

    const run = await startAgentTaskRunViaApi({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId,
      intent: [
        'Run this exact shell script and do not finish until every command succeeds.',
        '```bash',
        'set -euo pipefail',
        'mkdir -p "$HOME/workspace/.artifacts"',
        `printf '%s\\n' '${contentLine}' > "$HOME/${homeRootFileName}"`,
        `printf '%s\\n' '${contentLine}' > "$HOME/workspace/${workspaceFileName}"`,
        `cp "$HOME/workspace/${workspaceFileName}" "$HOME/workspace/.artifacts/${artifactFileName}"`,
        `test "$(cat "$HOME/${homeRootFileName}")" = '${contentLine}'`,
        `test "$(cat "$HOME/workspace/${workspaceFileName}")" = '${contentLine}'`,
        `test "$(cat "$HOME/workspace/.artifacts/${artifactFileName}")" = '${contentLine}'`,
        '```',
        `After the script succeeds, reply with exactly ${token}.`,
      ].join('\n'),
    });
    await waitForRunnerOutputToken({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId,
      token,
      runnerOutputActivityId: run.runnerOutputActivityId,
      runId: run.runId,
    });
    await waitForTaskArtifact({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      taskId,
      expectedPath: `.artifacts/${artifactFileName}`,
    });

    const libraryId = await openWorkspaceFilesRoot({
      page,
      workspaceId: WORKSPACE_ID,
      projectId,
      libraryId: createdTask.workspaceFileLibraryId,
    });
    await expect(page.getByTestId('files__object-row').filter({ hasText: homeRootFileName }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('files__object-row').filter({ hasText: 'workspace' }).first()).toBeVisible({
      timeout: 30_000,
    });

    await openFolderByName(page, 'workspace');
    await expect(page.getByTestId('files__object-row').filter({ hasText: workspaceFileName }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('files__object-row').filter({ hasText: '.artifacts' }).first()).toBeVisible({
      timeout: 30_000,
    });
    await openFolderByName(page, '.artifacts');
    const artifactRow = page.getByTestId('files__object-row').filter({ hasText: artifactFileName }).first();
    await expect(artifactRow).toBeVisible({ timeout: 30_000 });
    await artifactRow.getByRole('button').click();

    const downloadResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response
        .url()
        .includes(`/workspaces/${WORKSPACE_ID}/projects/${projectId}/file-libraries/${libraryId}/download`)
      && response.url().includes('/download')
      && response.status() === 200
    ));
    await page.getByTestId('files__download').click();
    const downloadResponse = await downloadResponsePromise;
    expect(downloadResponse.url()).toContain(`path=${encodeURIComponent(`workspace/.artifacts/${artifactFileName}`)}`);

    const verifiedDownload = await page.request.get(downloadResponse.url(), {
      headers: await authHeaders(page),
    });
    expect(verifiedDownload.ok()).toBeTruthy();
    expect((await verifiedDownload.text()).trim()).toBe(contentLine);
  });
});
