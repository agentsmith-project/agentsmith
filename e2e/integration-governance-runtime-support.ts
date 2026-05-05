import { expect, type Page } from '@playwright/test';
import {
  API_BASE,
  LOCALE,
  bindAgentTaskExecutionSocketToTask,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

export { bindAgentTaskExecutionSocketToTask };

export function readUserIdFromJwt(token: string): string {
  const [, payload] = token.split('.');
  if (!payload) {
    throw new Error('invalid_jwt_payload');
  }
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { sub?: string };
  if (!decoded.sub?.trim()) {
    throw new Error('jwt_sub_missing');
  }
  return decoded.sub;
}

export async function createInviteViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  invitedEmail: string;
}): Promise<string> {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/members`);
  await expect(args.page.getByTestId('members__invite-btn')).toBeVisible({ timeout: 30_000 });
  await args.page.getByTestId('members__invite-btn').click();
  const dialog = args.page.getByTestId('members__invite-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.locator('#invite-email').fill(args.invitedEmail);
  await dialog.getByRole('button', { name: /create invite|invite/i }).click();
  const inviteInput = dialog.locator('input[readonly]').first();
  await expect(inviteInput).toBeVisible({ timeout: 30_000 });
  const inviteUrl = (await inviteInput.inputValue()).trim();
  const token = new URL(inviteUrl).searchParams.get('token');
  if (!token) {
    throw new Error('invite_token_missing_from_ui_invite');
  }
  await dialog.getByRole('button', { name: /done/i }).click().catch(() => {});
  return token;
}

export async function openMemberDrawerByEmail(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  memberEmail: string;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/members?member_tab=people`);
  await expect(args.page.getByTestId('members__table')).toBeVisible({ timeout: 30_000 });
  const memberRow = args.page.getByTestId('members__table__row').filter({
    has: args.page.getByText(args.memberEmail, { exact: true }),
  });
  await expect(memberRow).toBeVisible({ timeout: 30_000 });
  await memberRow.click();
  await expect(args.page.getByRole('tabpanel', { name: /effective access/i })).toBeVisible({ timeout: 30_000 });
}

export async function setProjectAdminMembership(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  memberUserId: string;
  shouldBeAdmin: boolean;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/settings`);
  await expect(args.page.getByTestId('settings__project-admins-section')).toBeVisible({ timeout: 30_000 });
  const option = args.page.getByTestId(`settings__project-admin-option--${args.memberUserId}`);
  await expect(option).toBeVisible({ timeout: 30_000 });
  const checkbox = option.getByRole('checkbox');
  const isChecked = await checkbox.isChecked();
  if (isChecked !== args.shouldBeAdmin) {
    await option.click();
  }
  const saveResponse = args.page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'PATCH'
      && candidate.url().includes(`/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/groups/`),
    { timeout: 30_000 },
  );
  await args.page.getByTestId('settings__project-admins-save').click();
  const response = await saveResponse;
  expect(response.ok()).toBeTruthy();
}

export async function removeProjectMemberByApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  memberId: string;
  memberEmail: string;
}) {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.delete(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/memberships/${args.memberId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(response.ok()).toBeTruthy();
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/members?member_tab=people`);
  await expect(args.page.getByTestId('members__table')).toBeVisible({ timeout: 30_000 });
  const memberRow = args.page.getByTestId('members__table__row').filter({
    has: args.page.getByText(args.memberEmail, { exact: true }),
  });
  await expect(memberRow).toHaveCount(0, { timeout: 30_000 });
}

export async function runChatStreamTurn(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  content: string;
}): Promise<string> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/chat/sessions/${args.sessionId}/messages/stream`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        input: {
          role: 'user',
          content: args.content,
        },
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  return response.text();
}

export async function waitForAssistantToken(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  token: string;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  await expect
    .poll(
      async () => {
        const response = await args.page.request.get(
          `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/chat/sessions/${args.sessionId}/messages`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!response.ok()) return false;
        const payload = await response.json() as { items?: Array<{ role?: string; content?: string }> };
        return (payload.items ?? []).some((item) => item.role === 'assistant' && item.content?.includes(args.token));
      },
      { timeout: 240_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
}

export async function waitForAgentTaskRunnerReply(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
}): Promise<string> {
  const authToken = await readStoredAuthToken(args.page);
  let matchedReply: string | null = null;
  await expect
    .poll(
      async () => {
        let response;
        try {
          response = await args.page.request.get(
            `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/activity`,
            { headers: { Authorization: `Bearer ${authToken}` } },
          );
        } catch {
          // Backend-real polling should survive transient transport resets and keep waiting on task truth.
          return null;
        }
        if (!response.ok()) return null;
        const activities = (await response.json()) as Array<{ actor?: string; content?: string }>;
        matchedReply =
          activities.find(
            (item) => item.actor === 'runner' && item.content?.includes(args.token),
          )?.content ?? null;
        return matchedReply;
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBeTruthy();
  return matchedReply ?? '';
}

export async function waitForAgentTaskRunnerToken(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
}): Promise<void> {
  await waitForAgentTaskRunnerReply(args);
}

export async function createAgentTaskWithNewWorkspaceViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  workspaceName: string;
}): Promise<{ taskId: string; fileLibraryId: string; fileLibraryName: string }> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: args.title,
        workspace_mode: 'create_new',
        workspace_name: args.workspaceName,
      },
    },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => '');
    throw new Error(`create_agent_task_with_new_workspace_failed:${response.status()}:${body}`);
  }
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    data?: { id?: string };
    workspace_file_library_id?: string;
    workspace_file_library_name?: string;
  } | null;
  const taskId = payload?.id ?? payload?.data?.id;
  const fileLibraryId = payload?.workspace_file_library_id;
  const fileLibraryName = payload?.workspace_file_library_name;
  if (!taskId || !fileLibraryId || !fileLibraryName) {
    throw new Error('create_agent_task_with_new_workspace_payload_incomplete');
  }
  return { taskId, fileLibraryId, fileLibraryName };
}

export async function waitForTaskArtifacts(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  expectedPath: string;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  await expect.poll(async () => {
    let response;
    try {
      response = await args.page.request.get(
        `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/artifacts`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
    } catch {
      return false;
    }
    if (!response.ok()) return false;
    const payload = (await response.json()) as Array<{ task_relative_path?: string }>;
    return payload.some((item) => item.task_relative_path === args.expectedPath);
  }, { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }).toBe(true);
}

export async function openAgentTaskDetail(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/agent-tasks/${args.taskId}`);
  await expect(args.page.getByTestId('agent-task__task-header')).toBeVisible({ timeout: 30_000 });
  await expect(args.page.getByTestId('agent-tasks__conversation-input')).toBeVisible({ timeout: 30_000 });
}

export async function openFileLibraryRoot(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  libraryName: string;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/files`);
  await expect(args.page.getByTestId('files__workspace-surface')).toBeVisible({ timeout: 30_000 });
  const mountDialog = args.page.getByTestId('files__dialog__desktop-mount-access');
  if (await mountDialog.isVisible().catch(() => false)) {
    await args.page.keyboard.press('Escape');
    await expect(mountDialog).toBeHidden({ timeout: 10_000 });
  }
  const libraryItem = args.page.locator('[data-testid^="files__library-item--"]').filter({ hasText: args.libraryName }).first();
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  await libraryItem.click();
  await expect(args.page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
}

export async function openFolderByName(page: Page, name: string): Promise<void> {
  const folderRow = page.getByTestId('files__object-row').filter({ hasText: name }).first();
  await expect(folderRow).toBeVisible({ timeout: 30_000 });
  const button = folderRow.getByRole('button').first();
  if (await button.isVisible().catch(() => false)) {
    await button.dblclick();
    return;
  }
  await folderRow.dblclick();
}

export async function assertProjectUnavailableOnRoutes(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  routes: string[];
}) {
  for (const route of args.routes) {
    await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/${route}`);
    await expect(args.page.getByText('Project unavailable', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(args.page.getByTestId('project-shell__project-not-found')).toBeVisible({ timeout: 30_000 });
  }
}

export async function runEndpointProxyChatCompletion(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  endpointId: string;
  content: string;
}): Promise<{ status: number; bodyText: string }> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/endpoints/${args.endpointId}/proxy/openai/chat/completions`,
    {
      timeout: 60_000,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        model: 'ignored',
        messages: [{ role: 'user', content: args.content }],
      },
    },
  );
  return {
    status: response.status(),
    bodyText: await response.text().catch(() => ''),
  };
}

export async function updateEndpointPolicyAllowListViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  endpointId: string;
  userIds: string[];
  explainSubjectId?: string;
}) {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/resource-policy`);
  await expect(args.page.getByTestId('resource-policy__table')).toBeVisible({ timeout: 30_000 });
  await args.page.getByTestId(`resource-policy__row--endpoint--${args.endpointId}`).click();
  await expect(args.page.getByTestId('resource-policy__editor')).toBeVisible({ timeout: 30_000 });
  await args.page.getByTestId('resource-policy__access-mode').selectOption('allow_list');

  let subjectRows = args.page.locator('[data-testid^="resource-policy__subject--"]');
  let currentCount = await subjectRows.count();
  for (let index = currentCount; index < args.userIds.length; index += 1) {
    await args.page.getByTestId('resource-policy__add-subject').click();
  }
  subjectRows = args.page.locator('[data-testid^="resource-policy__subject--"]');
  currentCount = await subjectRows.count();
  if (currentCount < args.userIds.length) {
    throw new Error(`resource_policy_subject_rows_missing:${currentCount}:${args.userIds.length}`);
  }

  for (let index = 0; index < args.userIds.length; index += 1) {
    const row = subjectRows.nth(index);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByTestId('resource-policy__subject-type').selectOption('user');
    await row.getByTestId('resource-policy__subject-id-select').selectOption(args.userIds[index] ?? '');
  }

  const saveResponse = args.page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH'
      && response.url().includes(`/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/resources/endpoint/${args.endpointId}/policy`),
    { timeout: 30_000 },
  );
  await args.page.getByTestId('resource-policy__save').click();
  const response = await saveResponse;
  expect(response.ok()).toBeTruthy();

  if (args.explainSubjectId) {
    await args.page.getByTestId('resource-policy__explain-subject-type').selectOption('user');
    await args.page.getByTestId('resource-policy__explain-subject-id').selectOption(args.explainSubjectId);
    await args.page.getByTestId('resource-policy__explain-action').fill('invoke');
    await args.page.getByTestId('resource-policy__explain-run').click();
    await expect(args.page.getByTestId('resource-policy__explain-result')).toBeVisible({ timeout: 30_000 });
  }
}
