import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_EMAIL,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  LOCALE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding, type TraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const STORY = loadStoryDefinitionSync('invite-to-first-effective-work');
const STORY_BINDING = buildTraceStoryBinding(STORY);

type Runtime = {
  privateProjectNamePrefix: string;
  credentialNamePrefix: string;
  endpointNamePrefix: string;
  ownerPrivateMessagePrefix: string;
};

function requireRuntime(): Runtime {
  const runtimeRoot = STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.inviteToFirstEffectiveWork as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_invite_to_first_effective_work_runtime');
  }
  for (const key of ['privateProjectNamePrefix', 'credentialNamePrefix', 'endpointNamePrefix', 'ownerPrivateMessagePrefix'] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_invite_to_first_effective_work_runtime:${key}`);
    }
  }
  return runtime as unknown as Runtime;
}

function resolveStoryStep(binding: TraceStoryBinding, stepId: string) {
  const step = binding.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_story_step:${STORY.storyId}:${stepId}`);
  }
  return step;
}

function readUserIdFromJwt(token: string): string {
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

async function createInvite(page: Page, workspaceId: string, projectId: string, email: string): Promise<string> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/invites`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        email,
        expires_in_hours: 24,
      },
    },
  );
  if (!response.ok()) {
    throw new Error(`create_invite_failed:${response.status()}:${await response.text()}`);
  }
  const payload = await response.json() as { invite_url?: string };
  expect(payload.invite_url).toBeTruthy();
  return payload.invite_url ?? '';
}

async function createChatSession(
  page: Page,
  workspaceId: string,
  projectId: string,
  endpointId: string,
  title = `owner-session-${Date.now()}`,
): Promise<string> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        title,
        model: BACKEND_REAL_MODEL,
        endpoint_id: endpointId,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { id?: string };
  expect(payload.id).toBeTruthy();
  return payload.id ?? '';
}

async function postChatMessage(page: Page, workspaceId: string, projectId: string, sessionId: string, content: string): Promise<void> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        role: 'user',
        content,
      },
    },
  );
  expect(response.status()).toBe(201);
}

test.describe('@lane-real invite to first effective work', () => {
  test('accepted invite takes the member through the correct workspace, overview, and first effective chat work', async ({ browser, page }) => {
    test.setTimeout(600_000);
    const workspaceId = 'ws_default';
    const apiKey = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
    }
    const runtime = requireRuntime();
    await ensureIntegrationKeycloakUsers();

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const projectName = `${runtime.privateProjectNamePrefix} ${Date.now()}`;
    const { projectId } = await createProjectInWorkspace(page, workspaceId, projectName, {
      visibility: 'private',
      joinPolicy: 'approval_required',
    });

    const credentialName = `${runtime.credentialNamePrefix} ${Date.now()}`;
    await createCredentialViaUi(page, workspaceId, projectId, credentialName, apiKey);
    const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
      endpointName: `${runtime.endpointNamePrefix} ${Date.now()}`,
      endpointModel: BACKEND_REAL_MODEL,
      upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
      credentialName,
    });

    const invitePath = await createInvite(page, workspaceId, projectId, KEYCLOAK_INTEGRATION_MEMBER_EMAIL);
    const ownerSessionId = await createChatSession(page, workspaceId, projectId, endpointId);
    await postChatMessage(page, workspaceId, projectId, ownerSessionId, `${runtime.ownerPrivateMessagePrefix}_${Date.now()}`);

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-invite-first-effective-work',
      storyId: STORY.storyId,
      title: STORY.title,
      actor: STORY.actor,
      route: `/${LOCALE}/join`,
      specFile: 'e2e/integration-invite-first-effective-work.spec.ts',
      browser: 'chromium',
      goal: STORY.goal,
      preconditions: [...(STORY.preconditions ?? [])],
      seedData: [...(STORY.seedData ?? [])],
      storyBinding: STORY_BINDING,
    });

    const captureInviteTrace = async (pageRef: Page, stepId: string) => {
      const storyStep = resolveStoryStep(STORY_BINDING, stepId);
      await trace.capture(pageRef, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };

    let outcome: 'pass' | 'fail' = 'fail';
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    try {
      await memberPage.goto(`/${LOCALE}${invitePath}`);
      await expect(memberPage.getByTestId('join__invite-card')).toBeVisible({ timeout: 30_000 });
      await expect(memberPage.getByTestId('join__invite-workspace')).toBeVisible({ timeout: 30_000 });
      await expect(memberPage.getByTestId('join__invite-project')).toBeVisible({ timeout: 30_000 });
      await captureInviteTrace(memberPage, 'inspect-invite-truth');

      await memberPage.getByTestId('join__continue-btn').click();
      await expect(memberPage).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/login(?:\\?.*)?$`), { timeout: 30_000 });
      const loginUrl = new URL(memberPage.url());
      expect(loginUrl.pathname).toBe(`/${LOCALE}/workspaces/${workspaceId}/login`);
      expect(loginUrl.searchParams.get('project_id')).toBe(projectId);
      await expect(memberPage.getByTestId('workspace-login__heading')).toBeVisible({ timeout: 30_000 });
      const workspaceLoginButton = memberPage.getByTestId('workspace-login__keycloak-btn');
      await expect(workspaceLoginButton).toBeVisible({ timeout: 30_000 });
      await expect(workspaceLoginButton).toBeEnabled({ timeout: 30_000 });
      await captureInviteTrace(memberPage, 'continue-to-invited-workspace-login');

      await keycloakLoginToWorkspace(
        memberPage,
        workspaceId,
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
        { ensureProjectCreatorAccess: false, projectId, preserveCurrentWorkspaceLoginPage: true },
      );

      await expect(memberPage).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview$`), { timeout: 30_000 });
      await expect(memberPage.getByTestId('project-overview__page')).toBeVisible({ timeout: 30_000 });
      await captureInviteTrace(memberPage, 'complete-workspace-login-and-accept');
      await captureInviteTrace(memberPage, 'land-on-invited-project-overview');
      await captureInviteTrace(memberPage, 'start-first-chat-work');

      await memberPage.getByTestId('project-overview__primary-cta').click();
      await expect(memberPage).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/chat$`), {
        timeout: 30_000,
      });
      await expect(memberPage.getByTestId('chat__surface')).toBeVisible({ timeout: 30_000 });

      const memberToken = await readStoredAuthToken(memberPage);
      const memberUserId = readUserIdFromJwt(memberToken);
      const projectAccessResponse = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(projectAccessResponse.ok()).toBeTruthy();

      const memberSessionsResponse = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberSessionsResponse.ok()).toBeTruthy();
      const memberSessions = await memberSessionsResponse.json() as { items?: Array<{ id: string }> };
      expect(memberSessions.items?.map((item) => item.id) ?? []).not.toContain(ownerSessionId);

      const memberGetOwnerSession = await memberPage.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${ownerSessionId}`,
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(memberGetOwnerSession.status()).toBe(404);

      const ownerToken = await readStoredAuthToken(page);
      const groupsResponse = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/groups`,
        { headers: { Authorization: `Bearer ${ownerToken}` } },
      );
      expect(groupsResponse.ok()).toBeTruthy();
      const groupsPayload = await groupsResponse.json() as { items?: Array<{ id: string; name: string; permission_ids?: string[] }> };
      const memberGroup = (groupsPayload.items ?? []).find((group) => group.id === 'grp_project_members');
      expect(memberGroup).toBeTruthy();
      expect(memberGroup?.permission_ids ?? []).not.toContain('project:governance:read');
      await captureInviteTrace(memberPage, 'verify-private-chat-boundary');
      outcome = 'pass';
    } finally {
      await memberContext.close();
      await trace.finish({ outcome, finishedAt: new Date().toISOString() });
    }
  });
});
