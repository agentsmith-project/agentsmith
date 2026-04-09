import { expect, test } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalRunnerAgentBundle,
  createFileLibraryViaUi,
  createNotebookTaskViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  getContextEntryViaApi,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  putContextEntryViaApi,
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return value;
}

test.describe('@lane-real context store isolation', () => {
  test('member context stays private between workspace members', async ({ browser, page }) => {
    test.setTimeout(240_000);
    await ensureIntegrationKeycloakUsers();
    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);

    const contextKey = `prefs.member_private_${Date.now()}`;
    const contextValue = `private_${Date.now()}`;
    await putContextEntryViaApi({
      page,
      scope: 'member',
      workspaceId: 'ws_default',
      key: contextKey,
      content: contextValue,
    });

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await keycloakLoginToWorkspace(
        memberPage,
        'ws_default',
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      );

      const lookup = await getContextEntryViaApi({
        page: memberPage,
        scope: 'member',
        workspaceId: 'ws_default',
        key: contextKey,
        expectedStatus: 404,
      });
      expect(lookup.body).toEqual(expect.objectContaining({
        error_code: 'NOT_FOUND',
        message: 'context_not_found',
      }));
    } finally {
      await memberContext.close();
    }
  });

  test('workspace shared context stays governance-controlled while member context stays private', async ({ browser, page }) => {
    test.setTimeout(240_000);
    await ensureIntegrationKeycloakUsers();
    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);

    const sharedKey = `shared.workspace_visible_${Date.now()}`;
    const sharedValue = `shared_${Date.now()}`;
    const privateKey = `prefs.member_hidden_${Date.now()}`;
    const privateValue = `hidden_${Date.now()}`;

    await putContextEntryViaApi({
      page,
      scope: 'workspace',
      workspaceId: 'ws_default',
      key: sharedKey,
      content: sharedValue,
    });
    await putContextEntryViaApi({
      page,
      scope: 'member',
      workspaceId: 'ws_default',
      key: privateKey,
      content: privateValue,
    });

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await keycloakLoginToWorkspace(
        memberPage,
        'ws_default',
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
      );

      const sharedLookup = await getContextEntryViaApi({
        page: memberPage,
        scope: 'workspace',
        workspaceId: 'ws_default',
        key: sharedKey,
        expectedStatus: 403,
      });
      expect(sharedLookup.body).toEqual(expect.objectContaining({
        error_code: 'FORBIDDEN',
        message: 'context_workspace_forbidden',
      }));

      const privateLookup = await getContextEntryViaApi({
        page: memberPage,
        scope: 'member',
        workspaceId: 'ws_default',
        key: privateKey,
        expectedStatus: 404,
      });
      expect(privateLookup.body).toEqual(expect.objectContaining({
        error_code: 'NOT_FOUND',
        message: 'context_not_found',
      }));
    } finally {
      await memberContext.close();
    }
  });

  test('task context stays private to the task owner within the same workspace', async ({ browser, page }) => {
    test.setTimeout(720_000);
    const providerApiKey = requireRealLaneApiKey();

    await ensureIntegrationKeycloakUsers();
    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, 'ws_default', 'Context Store Task Isolation');
    const fileLibraryId = await createFileLibraryViaUi(page, 'ws_default', projectId, `Task Isolation Workspace ${Date.now()}`);
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
      title: `task-isolation-${Date.now()}`,
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
        title: `Task Isolation ${Date.now()}`,
        agentId: agentBundle.agentId,
        fileLibraryId,
      });

      const contextKey = `notes.task_private_${Date.now()}`;
      const contextValue = `task_private_${Date.now()}`;
      await putContextEntryViaApi({
        page,
        scope: 'task',
        workspaceId: 'ws_default',
        projectId,
        taskId,
        key: contextKey,
        content: contextValue,
      });

      const memberContext = await browser.newContext();
      const memberPage = await memberContext.newPage();
      try {
        await keycloakLoginToWorkspace(
          memberPage,
          'ws_default',
          KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
          KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
        );

        const memberToken = await readStoredAuthToken(memberPage);
        const params = new URLSearchParams({
          scope: 'task',
          key: contextKey,
          workspace_id: 'ws_default',
          project_id: projectId,
          task_id: taskId,
        });
        const response = await memberPage.request.get(
          `${API_BASE}/api/v1/context?${params.toString()}`,
          { headers: { Authorization: `Bearer ${memberToken}` } },
        );
        expect([403, 404]).toContain(response.status());
        const body = (await response.json().catch(() => null)) as { error_code?: string; message?: string } | null;
        expect(body?.message).toBe('context_task_not_found');
        expect(['FORBIDDEN', 'NOT_FOUND']).toContain(body?.error_code ?? '');
      } finally {
        await memberContext.close();
      }
    } finally {
      await runner.stop();
    }
  });
});
