import { expect, test } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createChatSessionViaApi,
  createExternalRunnerAgentBundle,
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
  startChatRunnerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding, type TraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const INVITE_TO_FIRST_EFFECTIVE_WORK_STORY = loadStoryDefinitionSync('invite-to-first-effective-work');
const INVITE_TO_FIRST_EFFECTIVE_WORK_BINDING = buildTraceStoryBinding(INVITE_TO_FIRST_EFFECTIVE_WORK_STORY);
const MEMBERS_INVITE_PRIVACY_STORY = loadStoryDefinitionSync('members-invite-and-chat-privacy');
const MEMBERS_INVITE_PRIVACY_BINDING = buildTraceStoryBinding(MEMBERS_INVITE_PRIVACY_STORY);

type MembersInviteRuntime = {
  privateProjectNamePrefix: string;
  sharedRunnerProjectNamePrefix: string;
  credentialNamePrefix: string;
  endpointNamePrefix: string;
  ownerPrivateMessagePrefix: string;
  sharedChatTitlePrefix: string;
  ownerTokenPrefix: string;
  memberTokenPrefix: string;
};

function resolveStoryStep(binding: TraceStoryBinding, stepId: string, storyId: string) {
  const step = binding.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_story_step:${storyId}:${stepId}`);
  }
  return step;
}

function requireMembersInviteRuntime(
  story: { runtimeData?: unknown; storyId: string },
  runtimeKey: 'inviteToFirstEffectiveWork' | 'membersInviteFirstUse',
): MembersInviteRuntime {
  const runtimeRoot = story.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.[runtimeKey] as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error(`missing_members_invite_runtime_data:${story.storyId}:${runtimeKey}`);
  }
  for (const key of [
    'privateProjectNamePrefix',
    'sharedRunnerProjectNamePrefix',
    'credentialNamePrefix',
    'endpointNamePrefix',
    'ownerPrivateMessagePrefix',
    'sharedChatTitlePrefix',
    'ownerTokenPrefix',
    'memberTokenPrefix',
  ] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_members_invite_runtime_data:${story.storyId}:${runtimeKey}:${key}`);
    }
  }
  return runtime as unknown as MembersInviteRuntime;
}

function requireApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
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

async function createInvite(page: import('@playwright/test').Page, workspaceId: string, projectId: string, email: string): Promise<string> {
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
  page: import('@playwright/test').Page,
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

async function waitForAssistantToken(page: import('@playwright/test').Page, workspaceId: string, projectId: string, sessionId: string, token: string): Promise<void> {
  const authToken = await readStoredAuthToken(page);
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!response.ok()) return false;
        const payload = await response.json() as { items?: Array<{ role?: string; content?: string }> };
        return (payload.items ?? []).some((item) => item.role === 'assistant' && item.content?.includes(token));
      },
      { timeout: 240_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
}

async function runChatStreamTurn(
  page: import('@playwright/test').Page,
  workspaceId: string,
  projectId: string,
  sessionId: string,
  content: string,
): Promise<string> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}/messages/stream`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        input: {
          role: 'user',
          content,
        },
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  return response.text();
}

async function postChatMessage(page: import('@playwright/test').Page, workspaceId: string, projectId: string, sessionId: string, content: string): Promise<void> {
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

test.describe('@lane-real invite flow and chat isolation', () => {
  test('accepted invite takes member through correct workspace entry, overview, and first chat work', async ({ browser, page }) => {
    test.setTimeout(600_000);
    const workspaceId = 'ws_default';
    const apiKey = requireApiKey();
    const runtime = requireMembersInviteRuntime(INVITE_TO_FIRST_EFFECTIVE_WORK_STORY, 'inviteToFirstEffectiveWork');
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
      suite: 'integration-membership-chat-isolation',
      storyId: INVITE_TO_FIRST_EFFECTIVE_WORK_STORY.storyId,
      title: INVITE_TO_FIRST_EFFECTIVE_WORK_STORY.title,
      actor: INVITE_TO_FIRST_EFFECTIVE_WORK_STORY.actor,
      route: `/${LOCALE}/join`,
      specFile: 'e2e/integration-membership-chat-isolation.spec.ts',
      browser: 'chromium',
      goal: INVITE_TO_FIRST_EFFECTIVE_WORK_STORY.goal,
      preconditions: [...(INVITE_TO_FIRST_EFFECTIVE_WORK_STORY.preconditions ?? [])],
      seedData: [...(INVITE_TO_FIRST_EFFECTIVE_WORK_STORY.seedData ?? [])],
      storyBinding: INVITE_TO_FIRST_EFFECTIVE_WORK_BINDING,
    });
    const captureInviteFirstWorkTrace = async (pageRef: import('@playwright/test').Page, stepId: string) => {
      const storyStep = resolveStoryStep(INVITE_TO_FIRST_EFFECTIVE_WORK_BINDING, stepId, INVITE_TO_FIRST_EFFECTIVE_WORK_STORY.storyId);
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
      await captureInviteFirstWorkTrace(memberPage, 'inspect-invite-truth');

      await memberPage.getByTestId('join__continue-btn').click();
      await expect(memberPage).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/login(?:\\?.*)?$`), { timeout: 30_000 });
      const loginUrl = new URL(memberPage.url());
      expect(loginUrl.pathname).toBe(`/${LOCALE}/workspaces/${workspaceId}/login`);
      expect(loginUrl.searchParams.get('project_id')).toBe(projectId);
      await expect(memberPage.getByTestId('workspace-login__heading')).toBeVisible({ timeout: 30_000 });
      const workspaceLoginButton = memberPage.getByTestId('workspace-login__keycloak-btn');
      await expect(workspaceLoginButton).toBeVisible({ timeout: 30_000 });
      await expect(workspaceLoginButton).toBeEnabled({ timeout: 30_000 });
      await captureInviteFirstWorkTrace(memberPage, 'continue-to-invited-workspace-login');

      await keycloakLoginToWorkspace(
        memberPage,
        workspaceId,
        KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
        KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
        { ensureProjectCreatorAccess: false, projectId, preserveCurrentWorkspaceLoginPage: true },
      );

      await expect(memberPage).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview$`), {
        timeout: 30_000,
      });
      await expect(memberPage.getByTestId('project-overview__page')).toBeVisible({ timeout: 30_000 });
      await captureInviteFirstWorkTrace(memberPage, 'complete-workspace-login-and-accept');
      await captureInviteFirstWorkTrace(memberPage, 'land-on-invited-project-overview');
      await captureInviteFirstWorkTrace(memberPage, 'start-first-chat-work');

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
      const groupsPayload = await groupsResponse.json() as {
        items?: Array<{ id: string; member_ids: string[] }>;
      };
      const memberIds = groupsPayload.items?.find((group) => group.id === 'grp_project_members')?.member_ids ?? [];
      const adminIds = groupsPayload.items?.find((group) => group.id === 'grp_project_admins')?.member_ids ?? [];
      expect(memberIds).toContain(memberUserId);
      expect(adminIds).not.toContain(memberUserId);
      await captureInviteFirstWorkTrace(memberPage, 'verify-private-chat-boundary');
      outcome = 'pass';
    } finally {
      await memberContext.close();
      await trace.finish({ outcome });
    }
  });

  test('shares one chat runner pod across owner and member sessions without leaking session content', async ({ browser, page }) => {
    test.setTimeout(720_000);
    const workspaceId = 'ws_default';
    const apiKey = requireApiKey();
    const runtime = requireMembersInviteRuntime(MEMBERS_INVITE_PRIVACY_STORY, 'membersInviteFirstUse');
    await ensureIntegrationKeycloakUsers();

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const projectName = `${runtime.sharedRunnerProjectNamePrefix} ${Date.now()}`;
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
    const chatTitle = `${runtime.sharedChatTitlePrefix}-${Date.now()}`;
    const agentBundle = await createExternalRunnerAgentBundle(page, {
      workspaceId,
      projectId,
      endpointId,
      title: chatTitle,
      interactionKind: 'chat',
    });

    const runner = await startChatRunnerProcess({
      wsUrl: agentBundle.wsUrl,
      agentKey: agentBundle.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });

    const invitePath = await createInvite(page, workspaceId, projectId, KEYCLOAK_INTEGRATION_MEMBER_EMAIL);
    const ownerToken = `${runtime.ownerTokenPrefix}_${Date.now()}`;
    const memberToken = `${runtime.memberTokenPrefix}_${Date.now()}`;
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-membership-chat-isolation',
      storyId: MEMBERS_INVITE_PRIVACY_STORY.storyId,
      title: MEMBERS_INVITE_PRIVACY_STORY.title,
      actor: MEMBERS_INVITE_PRIVACY_STORY.actor,
      route: `/${LOCALE}/join`,
      specFile: 'e2e/integration-membership-chat-isolation.spec.ts',
      browser: 'chromium',
      goal: MEMBERS_INVITE_PRIVACY_STORY.goal,
      preconditions: [...(MEMBERS_INVITE_PRIVACY_STORY.preconditions ?? [])],
      seedData: [...(MEMBERS_INVITE_PRIVACY_STORY.seedData ?? [])],
      storyBinding: MEMBERS_INVITE_PRIVACY_BINDING,
    });
    const capturePrivacyTrace = async (pageRef: import('@playwright/test').Page, stepId: string) => {
      const storyStep = resolveStoryStep(MEMBERS_INVITE_PRIVACY_BINDING, stepId, MEMBERS_INVITE_PRIVACY_STORY.storyId);
      await trace.capture(pageRef, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await waitForAgentPresenceOnline(page, workspaceId, projectId, agentBundle.agentId);
      const ownerSessionId = (await createChatSessionViaApi({
        page,
        workspaceId,
        projectId,
        externalAgentId: agentBundle.agentId,
        title: `${chatTitle}-owner`,
      })).id;
      const ownerStream = await runChatStreamTurn(
        page,
        workspaceId,
        projectId,
        ownerSessionId,
        `Reply with exactly ${ownerToken}.`,
      );
      expect(ownerStream).toContain(ownerToken);
      await waitForAssistantToken(page, workspaceId, projectId, ownerSessionId, ownerToken);

      const memberContext = await browser.newContext();
      const memberPage = await memberContext.newPage();
      try {
        await keycloakLoginToWorkspace(
          memberPage,
          workspaceId,
          KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
          KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
          { ensureProjectCreatorAccess: false },
        );
        await memberPage.goto(`/${LOCALE}${invitePath}`);
        await expect(memberPage.getByTestId('join__auto-accepting')).toBeVisible({ timeout: 30_000 });
        await capturePrivacyTrace(memberPage, 'accept-invite');
        await expect(memberPage).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview$`), { timeout: 30_000 });
        await expect(memberPage.getByTestId('project-overview__page')).toBeVisible({ timeout: 30_000 });
        await capturePrivacyTrace(memberPage, 'verify-member-first-access');
        await memberPage.getByTestId('project-overview__primary-cta').click();
        await expect(memberPage.getByTestId('chat__surface')).toBeVisible({ timeout: 30_000 });
        await capturePrivacyTrace(memberPage, 'start-first-chat-use');

        const memberSessionId = (await createChatSessionViaApi({
          page: memberPage,
          workspaceId,
          projectId,
          externalAgentId: agentBundle.agentId,
          title: `${chatTitle}-member`,
        })).id;
        const memberStream = await runChatStreamTurn(
          memberPage,
          workspaceId,
          projectId,
          memberSessionId,
          `Reply with exactly ${memberToken}.`,
        );
        expect(memberStream).toContain(memberToken);
        await waitForAssistantToken(memberPage, workspaceId, projectId, memberSessionId, memberToken);

        const ownerAuthToken = await readStoredAuthToken(page);
        const ownerMessagesRes = await page.request.get(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${ownerSessionId}/messages`,
          { headers: { Authorization: `Bearer ${ownerAuthToken}` } },
        );
        expect(ownerMessagesRes.ok()).toBeTruthy();
        const ownerMessages = await ownerMessagesRes.json() as { items?: Array<{ role?: string; content?: string }> };
        expect((ownerMessages.items ?? []).some((item) => item.role === 'assistant' && item.content?.includes(ownerToken))).toBe(true);
        expect((ownerMessages.items ?? []).some((item) => item.role === 'assistant' && item.content?.includes(memberToken))).toBe(false);

        const memberMessagesRes = await memberPage.request.get(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${memberSessionId}/messages`,
          { headers: { Authorization: `Bearer ${await readStoredAuthToken(memberPage)}` } },
        );
        expect(memberMessagesRes.ok()).toBeTruthy();
        const memberMessages = await memberMessagesRes.json() as { items?: Array<{ role?: string; content?: string }> };
        expect((memberMessages.items ?? []).some((item) => item.role === 'assistant' && item.content?.includes(memberToken))).toBe(true);
        expect((memberMessages.items ?? []).some((item) => item.role === 'assistant' && item.content?.includes(ownerToken))).toBe(false);
        await capturePrivacyTrace(memberPage, 'verify-chat-privacy');
        await capturePrivacyTrace(memberPage, 'verify-shared-runner-isolation');
        outcome = 'pass';
      } finally {
        await memberContext.close();
      }
    } finally {
      await runner.stop();
      await trace.finish({ outcome });
    }
  });
});
