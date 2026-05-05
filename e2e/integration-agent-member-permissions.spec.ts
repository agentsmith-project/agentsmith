import { expect, test } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createFileLibraryViaUi,
  createAgentTaskViaApi,
  createManagedAgentRunnerViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  LOCALE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const RUNTIME_SETUP_STORY = loadStoryDefinitionSync('project-governance-runtime-setup');
const RUNTIME_SETUP_BINDING = buildTraceStoryBinding(RUNTIME_SETUP_STORY);
const WORKSPACE_ID = RUNTIME_SETUP_STORY.seedData?.[0];

type AgentSetupRuntime = {
  credentialNamePrefix: string;
  endpointNamePrefix: string;
  agentTaskRunnerTitlePrefix: string;
  memberTaskTitlePrefix: string;
};

function requireWorkspaceId(): string {
  if (typeof WORKSPACE_ID !== 'string' || WORKSPACE_ID.trim().length === 0) {
    throw new Error('missing_project_governance_runtime_workspace_seed');
  }
  return WORKSPACE_ID;
}

function requireAgentSetupRuntime(): AgentSetupRuntime {
  const runtimeRoot = RUNTIME_SETUP_STORY.runtimeData as Record<string, unknown> | undefined;
  const agentSetup = runtimeRoot?.agentSetup as Record<string, unknown> | undefined;
  if (!agentSetup) {
    throw new Error('missing_project_governance_runtime:agentSetup');
  }
  for (const field of ['credentialNamePrefix', 'endpointNamePrefix', 'agentTaskRunnerTitlePrefix', 'memberTaskTitlePrefix'] as const) {
    if (typeof agentSetup[field] !== 'string' || agentSetup[field].trim().length === 0) {
      throw new Error(`missing_project_governance_runtime:agentSetup.${field}`);
    }
  }
  return agentSetup as unknown as AgentSetupRuntime;
}

const RUNTIME_SETUP = requireAgentSetupRuntime();

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

test.describe('@lane-real ordinary members can use agents but cannot manage them', () => {
  test('member can create tasks with agents and gets 403 on manage APIs', async ({ browser, page }) => {
    test.setTimeout(900_000);
    const workspaceId = requireWorkspaceId();
    const apiKey = requireApiKey();
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-agent-member-permissions',
      storyId: RUNTIME_SETUP_STORY.storyId,
      title: RUNTIME_SETUP_STORY.title,
      actor: RUNTIME_SETUP_STORY.actor,
      route: RUNTIME_SETUP_STORY.entryRoute,
      specFile: 'e2e/integration-agent-member-permissions.spec.ts',
      browser: 'chromium',
      goal: RUNTIME_SETUP_STORY.goal,
      preconditions: [...(RUNTIME_SETUP_STORY.preconditions ?? [])],
      seedData: [...(RUNTIME_SETUP_STORY.seedData ?? [])],
      storyBinding: RUNTIME_SETUP_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';
    await ensureIntegrationKeycloakUsers();

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    try {
      await keycloakLoginToWorkspace(memberPage, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const { projectId } = await createProjectInWorkspace(memberPage, workspaceId, 'Agent Member Permissions', {
        visibility: 'private',
        joinPolicy: 'approval_required',
      });

      const credentialName = `${RUNTIME_SETUP.credentialNamePrefix} ${Date.now()}`;
      await createCredentialViaUi(memberPage, workspaceId, projectId, credentialName, apiKey);
      await trace.capture(memberPage, { stepId: 'credentials-list' });
      const endpointId = await createEndpointViaApi(memberPage, workspaceId, projectId, {
        endpointName: `${RUNTIME_SETUP.endpointNamePrefix} ${Date.now()}`,
        endpointModel: BACKEND_REAL_MODEL,
        upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
        credentialName,
      });
      const agentRunner = await createManagedAgentRunnerViaApi(memberPage, {
        workspaceId,
        projectId,
        endpointId,
        title: `${RUNTIME_SETUP.agentTaskRunnerTitlePrefix} ${Date.now()}`,
      });
      await trace.capture(memberPage, { stepId: 'agents-created' });
      const invitePath = await createInvite(page, workspaceId, projectId, 'integration-member@example.com');

      const joinContext = await browser.newContext();
      const joinPage = await joinContext.newPage();
      try {
        await keycloakLoginToWorkspace(
          joinPage,
          workspaceId,
          KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
          KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
        );
        await joinPage.goto(`/${LOCALE}${invitePath}`);
        await expect(joinPage.getByTestId('join__accept-btn')).toBeVisible({ timeout: 30_000 });
        await joinPage.getByTestId('join__accept-btn').click();
        await joinPage.waitForURL(/\/login\/workspace/, { timeout: 30_000 });

        const memberLibraryName = `Agent Member Library ${Date.now()}`;
        const memberLibraryId = await createFileLibraryViaUi(joinPage, workspaceId, projectId, memberLibraryName);
        const taskId = await createAgentTaskViaApi({
          page: joinPage,
          workspaceId,
          projectId,
          title: `${RUNTIME_SETUP.memberTaskTitlePrefix} ${Date.now()}`,
          fileLibraryId: memberLibraryId,
        });
        expect(taskId).toBeTruthy();
        await trace.capture(joinPage, { stepId: 'member-task-created' });

        const memberToken = await readStoredAuthToken(joinPage);
        const patchResponse = await joinPage.request.patch(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agent-runners/${agentRunner.runnerId}`,
          {
            headers: {
              Authorization: `Bearer ${memberToken}`,
              'Content-Type': 'application/json',
            },
            data: { name: `forbidden-${Date.now()}` },
          },
        );
        expect(patchResponse.status()).toBe(403);

        const keyResponse = await joinPage.request.post(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agent-runners/${agentRunner.runnerId}/keys`,
          {
            headers: {
              Authorization: `Bearer ${memberToken}`,
              'Content-Type': 'application/json',
            },
            data: { note: 'member should not issue keys' },
          },
        );
        expect(keyResponse.status()).toBe(403);

        const deleteResponse = await joinPage.request.delete(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agent-runners/${agentRunner.runnerId}`,
          {
            headers: { Authorization: `Bearer ${memberToken}` },
          },
        );
        expect(deleteResponse.status()).toBe(403);
        await trace.capture(joinPage, { stepId: 'member-manage-forbidden' });
        outcome = 'pass';
      } finally {
        await joinContext.close();
      }
    } finally {
      await memberContext.close();
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
