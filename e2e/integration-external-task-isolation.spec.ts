import { expect, test } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalRunnerAgentBundle,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  createNotebookTaskViaApi,
  requestTaskWorkspaceAccess,
  sendTaskMessage,
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
  waitForAssistantToken,
  LOCALE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

function requireApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

async function createInvite(page: import('@playwright/test').Page, workspaceId: string, projectId: string, email: string): Promise<string> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/invites`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { email, expires_in_hours: 24 },
    },
  );
  if (!response.ok()) {
    throw new Error(`create_invite_failed:${response.status()}:${await response.text()}`);
  }
  const payload = await response.json() as { invite_url?: string };
  expect(payload.invite_url).toBeTruthy();
  return payload.invite_url ?? '';
}

async function createFileLibrary(page: import('@playwright/test').Page, workspaceId: string, projectId: string, name: string): Promise<string> {
  const token = await readStoredAuthToken(page);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await page.request.post(
      `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/file-libraries`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: {
          name,
          description: `auto-created ${name}`,
        },
      },
    );
    if (response.ok()) {
      const payload = await response.json() as { id?: string };
      expect(payload.id).toBeTruthy();
      return payload.id ?? '';
    }
    const errorText = await response.text();
    const retryableProvisioningFailure = response.status() === 502
      && errorText.includes('FILE_LIBRARY_PROVISIONING_FAILED')
      && (errorText.includes('connection reset') || errorText.includes('ECONNRESET'));
    if (!retryableProvisioningFailure || attempt === 4) {
      throw new Error(`create_file_library_failed:${response.status()}:${errorText}`);
    }
    await page.waitForTimeout(1_000 * (attempt + 1));
  }
  throw new Error('create_file_library_retry_exhausted');
}

async function expectFilesLibraryVisibility(args: {
  page: import('@playwright/test').Page;
  workspaceId: string;
  projectId: string;
  visibleLibraryName: string;
  hiddenLibraryName: string;
}): Promise<void> {
  await args.page.goto(`/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/files`);
  const visibleLibrary = args.page.locator('[data-testid^="files__library-item--"]').filter({ hasText: args.visibleLibraryName }).first();
  const hiddenLibrary = args.page.locator('[data-testid^="files__library-item--"]').filter({ hasText: args.hiddenLibraryName }).first();
  await expect(visibleLibrary).toBeVisible({ timeout: 30_000 });
  await expect(hiddenLibrary).toHaveCount(0);
}

async function createNotebookTaskWithCreateNewWorkspace(args: {
  page: import('@playwright/test').Page;
  workspaceId: string;
  projectId: string;
  title: string;
  agentId: string;
  workspaceName: string;
}): Promise<string> {
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
        agent_id: args.agentId,
        workspace_mode: 'create_new',
        workspace_name: args.workspaceName,
      },
    },
  );
  if (!response.ok()) {
    throw new Error(`create_notebook_task_create_new_failed:${response.status()}:${await response.text()}`);
  }
  const payload = (await response.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const taskId = payload?.id ?? payload?.data?.id;
  expect(taskId).toBeTruthy();
  return taskId ?? '';
}

async function listTaskArtifacts(args: {
  page: import('@playwright/test').Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<Array<{ id?: string; title?: string; task_relative_path?: string }>> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/artifacts`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok()) {
    throw new Error(`list_task_artifacts_failed:${response.status()}:${await response.text()}`);
  }
  return (await response.json()) as Array<{ id?: string; title?: string; task_relative_path?: string }>;
}

async function downloadTaskArtifact(args: {
  page: import('@playwright/test').Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  artifactId: string;
}): Promise<{ status: number; body: string }> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/artifacts/${args.artifactId}/download`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return {
    status: response.status(),
    body: await response.text(),
  };
}

test.describe('@lane-real external notebook task isolation by user', () => {
  test('different users get different external notebook tasks hidden from each other', async ({ browser, page }) => {
    test.setTimeout(1_200_000);
    const workspaceId = 'ws_default';
    const apiKey = requireApiKey();
    await ensureIntegrationKeycloakUsers();

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, 'External Isolation', {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    const credentialName = `External Isolation Credential ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, credentialName, apiKey);
    const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `External Isolation Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });

    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId,
      projectId,
      endpointId,
      title: 'external-user-isolation',
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });

    const ownerLibraryName = `Owner External Isolation ${Date.now()}`;
    const memberLibraryName = `Member External Isolation ${Date.now()}`;
    const ownerFileLibraryId = await createFileLibrary(page, workspaceId, projectId, ownerLibraryName);
    const invitePath = await createInvite(page, workspaceId, projectId, 'integration-member@example.com');

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await waitForAgentPresenceOnline(page, workspaceId, projectId, agentBundle.agentId);
      await keycloakLoginToWorkspace(
        memberPage,
        workspaceId,
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      );
      await memberPage.goto(`/${LOCALE}${invitePath}`);
      await expect(memberPage.getByTestId('join__accept-btn')).toBeVisible({ timeout: 30_000 });
      await memberPage.getByTestId('join__accept-btn').click();
      await memberPage.waitForURL(/\/login\/workspace/, { timeout: 30_000 });
      const memberFileLibraryId = await createFileLibrary(memberPage, workspaceId, projectId, memberLibraryName);

      const ownerTaskId = await createNotebookTaskViaApi({
        page,
        workspaceId,
        projectId,
        title: `Owner External Task ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId: ownerFileLibraryId,
      });
      const memberTaskId = await createNotebookTaskViaApi({
        page: memberPage,
        workspaceId,
        projectId,
        title: `Member External Task ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId: memberFileLibraryId,
      });

      await expectFilesLibraryVisibility({
        page,
        workspaceId,
        projectId,
        visibleLibraryName: ownerLibraryName,
        hiddenLibraryName: memberLibraryName,
      });
      await expectFilesLibraryVisibility({
        page: memberPage,
        workspaceId,
        projectId,
        visibleLibraryName: memberLibraryName,
        hiddenLibraryName: ownerLibraryName,
      });

      const ownerToken = await readStoredAuthToken(page);
      const memberToken = await readStoredAuthToken(memberPage);

      const ownerCannotReadMemberLibrary = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${memberFileLibraryId}`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      expect(ownerCannotReadMemberLibrary.status()).toBe(404);

      const memberCannotReadOwnerLibrary = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${ownerFileLibraryId}`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberCannotReadOwnerLibrary.status()).toBe(404);

      const ownerCannotReadMember = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${memberTaskId}`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      expect(ownerCannotReadMember.status()).toBe(404);

      const memberCannotReadOwner = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${ownerTaskId}`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberCannotReadOwner.status()).toBe(404);

      await sendTaskMessage({
        page,
        workspaceId,
        projectId,
        taskId: ownerTaskId,
        content: `Reply with OWNER_EXTERNAL_TASK_ISOLATION_${Date.now()}`,
      });
      await sendTaskMessage({
        page: memberPage,
        workspaceId,
        projectId,
        taskId: memberTaskId,
        content: `Reply with MEMBER_EXTERNAL_TASK_ISOLATION_${Date.now()}`,
      });

      const memberCannotReadOwnerMessages = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${ownerTaskId}/messages`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberCannotReadOwnerMessages.status()).toBe(404);

      const ownerCannotReadMemberMessages = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${memberTaskId}/messages`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      expect(ownerCannotReadMemberMessages.status()).toBe(404);
    } finally {
      await memberContext.close();
      await runner.stop();
    }
  });

  test('different users keep create_new notebook workspaces and same-path artifacts isolated even when task names match', async ({ browser, page }) => {
    test.setTimeout(1_200_000);
    const workspaceId = 'ws_default';
    const apiKey = requireApiKey();
    await ensureIntegrationKeycloakUsers();

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, 'External Collision Isolation', {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    const credentialName = `External Collision Credential ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, credentialName, apiKey);
    const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `External Collision Endpoint ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });

    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId,
      projectId,
      endpointId,
      title: 'external-user-collision-isolation',
    });

    const runner = await startCodexRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });

    const invitePath = await createInvite(page, workspaceId, projectId, 'integration-member@example.com');
    const sharedTaskTitle = `Shared Notebook Task ${Date.now()}`;
    const sharedWorkspaceName = `Shared Notebook Workspace ${Date.now()}`;

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await waitForAgentPresenceOnline(page, workspaceId, projectId, agentBundle.agentId);
      await keycloakLoginToWorkspace(
        memberPage,
        workspaceId,
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      );
      await memberPage.goto(`/${LOCALE}${invitePath}`);
      await expect(memberPage.getByTestId('join__accept-btn')).toBeVisible({ timeout: 30_000 });
      await memberPage.getByTestId('join__accept-btn').click();
      await memberPage.waitForURL(/\/login\/workspace/, { timeout: 30_000 });

      const ownerTaskId = await createNotebookTaskWithCreateNewWorkspace({
        page,
        workspaceId,
        projectId,
        title: sharedTaskTitle,
        agentId: agentBundle.agentId,
        workspaceName: sharedWorkspaceName,
      });
      const memberTaskId = await createNotebookTaskWithCreateNewWorkspace({
        page: memberPage,
        workspaceId,
        projectId,
        title: sharedTaskTitle,
        agentId: agentBundle.agentId,
        workspaceName: sharedWorkspaceName,
      });

      const ownerWorkspaceAccess = await requestTaskWorkspaceAccess({
        page,
        workspaceId,
        projectId,
        taskId: ownerTaskId,
      });
      const memberWorkspaceAccess = await requestTaskWorkspaceAccess({
        page: memberPage,
        workspaceId,
        projectId,
        taskId: memberTaskId,
      });

      expect(ownerWorkspaceAccess.file_library_id).not.toBe(memberWorkspaceAccess.file_library_id);
      expect(ownerWorkspaceAccess.workspace_dir_name).not.toBe(memberWorkspaceAccess.workspace_dir_name);
      expect(ownerWorkspaceAccess.metadata_url).not.toBe(memberWorkspaceAccess.metadata_url);
      expect(ownerWorkspaceAccess.storage_bucket_url).not.toBe(memberWorkspaceAccess.storage_bucket_url);

      const ownerReplyToken = `OWNER_COLLISION_OK_${Date.now()}`;
      const memberReplyToken = `MEMBER_COLLISION_OK_${Date.now()}`;
      await sendTaskMessage({
        page,
        workspaceId,
        projectId,
        taskId: ownerTaskId,
        content: [
          `Create .artifacts/result.txt with exactly one line: owner collision artifact ${ownerReplyToken}.`,
          `Then reply with exactly ${ownerReplyToken}.`,
        ].join(' '),
      });
      await sendTaskMessage({
        page: memberPage,
        workspaceId,
        projectId,
        taskId: memberTaskId,
        content: [
          `Create .artifacts/result.txt with exactly one line: member collision artifact ${memberReplyToken}.`,
          `Then reply with exactly ${memberReplyToken}.`,
        ].join(' '),
      });

      await waitForAssistantToken({
        page,
        workspaceId,
        projectId,
        taskId: ownerTaskId,
        token: ownerReplyToken,
      });
      await waitForAssistantToken({
        page: memberPage,
        workspaceId,
        projectId,
        taskId: memberTaskId,
        token: memberReplyToken,
      });

      let ownerArtifacts: Array<{ id?: string; title?: string; task_relative_path?: string }> = [];
      await expect
        .poll(async () => {
          ownerArtifacts = await listTaskArtifacts({ page, workspaceId, projectId, taskId: ownerTaskId });
          return ownerArtifacts.some((item) => item.task_relative_path === '.artifacts/result.txt');
        }, {
          timeout: 300_000,
          intervals: [1_000, 2_000, 5_000],
        })
        .toBe(true);
      let memberArtifacts: Array<{ id?: string; title?: string; task_relative_path?: string }> = [];
      await expect
        .poll(async () => {
          memberArtifacts = await listTaskArtifacts({ page: memberPage, workspaceId, projectId, taskId: memberTaskId });
          return memberArtifacts.some((item) => item.task_relative_path === '.artifacts/result.txt');
        }, {
          timeout: 300_000,
          intervals: [1_000, 2_000, 5_000],
        })
        .toBe(true);

      const ownerArtifactId = ownerArtifacts.find((item) => item.task_relative_path === '.artifacts/result.txt')?.id;
      const memberArtifactId = memberArtifacts.find((item) => item.task_relative_path === '.artifacts/result.txt')?.id;
      expect(ownerArtifactId).toBeTruthy();
      expect(memberArtifactId).toBeTruthy();

      const ownerDownload = await downloadTaskArtifact({
        page,
        workspaceId,
        projectId,
        taskId: ownerTaskId,
        artifactId: ownerArtifactId!,
      });
      expect(ownerDownload.status).toBe(200);
      expect(ownerDownload.body).toContain(ownerReplyToken);
      expect(ownerDownload.body).not.toContain(memberReplyToken);

      const memberDownload = await downloadTaskArtifact({
        page: memberPage,
        workspaceId,
        projectId,
        taskId: memberTaskId,
        artifactId: memberArtifactId!,
      });
      expect(memberDownload.status).toBe(200);
      expect(memberDownload.body).toContain(memberReplyToken);
      expect(memberDownload.body).not.toContain(ownerReplyToken);

      const ownerAuthToken = await readStoredAuthToken(page);
      const crossOwnerArtifactRead = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${memberTaskId}/artifacts`,
        {
          headers: { Authorization: `Bearer ${ownerAuthToken}` },
        },
      );
      expect(crossOwnerArtifactRead.status()).toBe(404);

      const memberAuthToken = await readStoredAuthToken(memberPage);
      const crossMemberArtifactRead = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${ownerTaskId}/artifacts`,
        {
          headers: { Authorization: `Bearer ${memberAuthToken}` },
        },
      );
      expect(crossMemberArtifactRead.status()).toBe(404);
    } finally {
      await memberContext.close();
      await runner.stop();
    }
  });
});
