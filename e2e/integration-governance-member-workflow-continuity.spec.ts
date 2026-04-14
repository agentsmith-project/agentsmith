import { expect, test } from '@playwright/test';
import {
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createChatSessionViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createExternalRunnerAgentBundle,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  expectNotebookTaskConversationSurface,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  LOCALE,
  sendTaskMessage,
  startChatRunnerProcess,
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import {
  assertProjectUnavailableOnRoutes,
  createInviteViaUi,
  createNotebookTaskWithNewWorkspaceViaApi,
  readUserIdFromJwt,
  removeProjectMemberByApi,
  runChatStreamTurn,
  setProjectAdminMembership,
  waitForAssistantToken,
  openNotebookTaskDetail,
  waitForNotebookAgentToken,
  waitForTaskArtifacts,
} from './integration-governance-runtime-support';
import { readStoredAuthToken } from './integration-workspace-access';

const STORY = loadStoryDefinitionSync('e2e/stories/backend-real/governance-change-then-member-keeps-working.story.md');
const BINDING = buildTraceStoryBinding(STORY);
const WORKSPACE_ID = STORY.seedData?.[0] ?? 'ws_default';
const ADMIN_SWITCH_STORY = loadStoryDefinitionSync('e2e/stories/backend-real/admin-switches-to-member-and-keeps-working.story.md');
const ADMIN_SWITCH_BINDING = buildTraceStoryBinding(ADMIN_SWITCH_STORY);

type RuntimeData = {
  projectNamePrefix: string;
  memberEmail: string;
  memberDisplayName: string;
  credentialNamePrefix: string;
  endpointNamePrefix: string;
  chatAgentTitlePrefix: string;
  notebookAgentTitlePrefix: string;
  taskWorkspacePrefix: string;
  notebookTaskTitlePrefix: string;
  chatTokenPrefix: string;
  notebookTokenPrefix: string;
  artifactNamePrefix: string;
};

function requireRuntime(): RuntimeData {
  const runtimeRoot = STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.governanceRuntimeWork as Record<string, unknown> | undefined;
  if (!runtime) throw new Error('missing_governance_runtime_story_data');
  for (const key of [
    'projectNamePrefix',
    'memberEmail',
    'memberDisplayName',
    'credentialNamePrefix',
    'endpointNamePrefix',
    'chatAgentTitlePrefix',
    'notebookAgentTitlePrefix',
    'taskWorkspacePrefix',
    'notebookTaskTitlePrefix',
    'chatTokenPrefix',
    'notebookTokenPrefix',
    'artifactNamePrefix',
  ] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_governance_runtime_story_data:${key}`);
    }
  }
  return runtime as unknown as RuntimeData;
}

function requireApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim() || process.env.PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY_or_PRESET_ENDPOINT_API_KEY');
  }
  return value;
}

async function runMemberWorkCycle(args: {
  page: import('@playwright/test').Page;
  workspaceId: string;
  projectId: string;
  taskWorkspaceName: string;
  notebookTaskTitle: string;
  notebookAgentId: string;
  notebookToken: string;
  artifactName: string;
  chatAgentId?: string;
  chatToken?: string;
}) {
  const createdTask = await createNotebookTaskWithNewWorkspaceViaApi({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    title: args.notebookTaskTitle,
    agentId: args.notebookAgentId,
    workspaceName: args.taskWorkspaceName,
  });
  await sendTaskMessage({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: createdTask.taskId,
    content: [
      `Run the following shell commands exactly, then reply with exactly ${args.notebookToken}.`,
      '```bash',
      'mkdir -p .artifacts',
      `cat <<'EOF' > .artifacts/${args.artifactName}`,
      '# Governance Runtime Artifact',
      `- Token: ${args.notebookToken}`,
      '- Scope: member runtime continuity',
      'EOF',
      '```',
    ].join('\n'),
  });
  await waitForNotebookAgentToken({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: createdTask.taskId,
    token: args.notebookToken,
  });
  await waitForTaskArtifacts({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: createdTask.taskId,
    expectedPath: `.artifacts/${args.artifactName}`,
  });

  await openNotebookTaskDetail({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: createdTask.taskId,
  });
  await expectNotebookTaskConversationSurface({
    page: args.page,
    openTerminalAction: 'enabled',
    terminalModeEnabled: false,
    blocked: false,
  });
  await expect(args.page.getByTestId('notebook__artifact-card')).toBeVisible({ timeout: 30_000 });
  await expect(args.page.getByTestId('notebook__task-header-workspace-library')).toBeVisible({ timeout: 30_000 });

  if (args.chatAgentId && args.chatToken) {
    const sessionId = (await createChatSessionViaApi({
      page: args.page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      externalAgentId: args.chatAgentId,
      title: `${args.notebookTaskTitle}-chat`,
    })).id;
    const stream = await runChatStreamTurn({
      page: args.page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      sessionId,
      content: `Reply with exactly ${args.chatToken}.`,
    });
    expect(stream).toContain(args.chatToken);
    await waitForAssistantToken({
      page: args.page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      sessionId,
      token: args.chatToken,
    });
  }
}

test.describe('@lane-real governance change then member keeps working', () => {
  test('admin switches to member and keeps working through governance handoff', async ({ browser, page }) => {
    test.setTimeout(1_200_000);
    const runtime = requireRuntime();
    const apiKey = requireApiKey();
    await ensureIntegrationKeycloakUsers();

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-governance-member-workflow-continuity',
      storyId: ADMIN_SWITCH_STORY.storyId,
      title: ADMIN_SWITCH_STORY.title,
      actor: ADMIN_SWITCH_STORY.actor,
      route: ADMIN_SWITCH_STORY.entryRoute,
      specFile: 'e2e/integration-governance-member-workflow-continuity.spec.ts',
      browser: 'chromium',
      goal: ADMIN_SWITCH_STORY.goal,
      preconditions: [...(ADMIN_SWITCH_STORY.preconditions ?? [])],
      seedData: [...(ADMIN_SWITCH_STORY.seedData ?? [])],
      storyBinding: ADMIN_SWITCH_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    const runnerLogs: string[] = [];

    try {
      await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD, {
        ensureProjectCreatorAccess: false,
      });
      const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, `${runtime.projectNamePrefix} ${Date.now()}`, {
        visibility: 'private',
        joinPolicy: 'approval_required',
      });

      const credentialName = `${runtime.credentialNamePrefix} ${Date.now()}`;
      await createCredentialViaUi(page, WORKSPACE_ID, projectId, credentialName, apiKey);
      const endpointId = await createEndpointViaApi(page, WORKSPACE_ID, projectId, {
        endpointName: `${runtime.endpointNamePrefix} ${Date.now()}`,
        endpointModel: BACKEND_REAL_MODEL,
        upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
        credentialName,
      });

      const notebookBundle = await createExternalRunnerAgentBundle(page, {
        workspaceId: WORKSPACE_ID,
        projectId,
        endpointId,
        title: `${runtime.notebookAgentTitlePrefix} ${Date.now()}`,
        interactionKind: 'notebook',
      });

      const notebookRunner = await startCodexRunnerProcess({ wsUrl: notebookBundle.wsUrl, agentKey: notebookBundle.agentKey });
      runnerLogs.push(notebookRunner.logPath);
      test.info().annotations.push({ type: 'notebook_runner_log', description: notebookRunner.logPath });

      await waitForAgentPresenceOnline(page, WORKSPACE_ID, projectId, notebookBundle.agentId);

      const inviteToken = await createInviteViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        invitedEmail: runtime.memberEmail,
      });

      const memberContext = await browser.newContext();
      const memberPage = await memberContext.newPage();
      try {
        await keycloakLoginToWorkspace(memberPage, WORKSPACE_ID, KEYCLOAK_INTEGRATION_MEMBER_USERNAME, KEYCLOAK_INTEGRATION_MEMBER_PASSWORD, {
          ensureProjectCreatorAccess: false,
        });
        await memberPage.goto(`/${LOCALE}/join?token=${inviteToken}`);
        await expect(memberPage.getByTestId('join__auto-accepting')).toBeVisible({ timeout: 30_000 });
        await memberPage.waitForURL((url) => {
          const parsed = new URL(url.toString());
          return parsed.pathname === `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/overview`;
        }, { timeout: 30_000 });
        await expect(memberPage.getByTestId('project-hub__page')).toBeVisible({ timeout: 30_000 });

        const memberToken = await readStoredAuthToken(memberPage);
        const memberUserId = readUserIdFromJwt(memberToken);

        await setProjectAdminMembership({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          memberUserId,
          shouldBeAdmin: true,
        });

        await memberPage.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/settings`);
        await expect(memberPage.getByTestId('settings__project-admins-section')).toBeVisible({ timeout: 30_000 });
        await trace.capture(memberPage, { stepId: 'confirm-admin-surface' });

        await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} admin ${Date.now()}`,
          notebookTaskTitle: `${runtime.notebookTaskTitlePrefix} admin ${Date.now()}`,
          notebookAgentId: notebookBundle.agentId,
          notebookToken: `${runtime.notebookTokenPrefix}_ADMIN_${Date.now()}`,
          artifactName: `${runtime.artifactNamePrefix}-admin-${Date.now()}.md`,
        });

        await setProjectAdminMembership({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          memberUserId,
          shouldBeAdmin: false,
        });
        await trace.capture(page, { stepId: 'demote-admin-to-member' });

        await memberPage.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/settings`);
        await expect(memberPage.getByTestId('page-state__error')).toBeVisible({ timeout: 30_000 });
        await trace.capture(memberPage, { stepId: 'lose-governance-surface' });

        await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} member ${Date.now()}`,
          notebookTaskTitle: `${runtime.notebookTaskTitlePrefix} member ${Date.now()}`,
          notebookAgentId: notebookBundle.agentId,
          notebookToken: `${runtime.notebookTokenPrefix}_MEMBER_${Date.now()}`,
          artifactName: `${runtime.artifactNamePrefix}-member-${Date.now()}.md`,
        });
        await trace.capture(memberPage, { stepId: 'continue-member-work' });

        outcome = 'pass';
      } finally {
        await memberContext.close();
        await notebookRunner.stop();
      }
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString(), notes: [...runnerLogs] });
    }
  });

  test('member work continues across promotion and demotion, then disappears after removal', async ({ browser, page }) => {
    test.setTimeout(1_200_000);
    const runtime = requireRuntime();
    const apiKey = requireApiKey();
    await ensureIntegrationKeycloakUsers();

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-governance-member-workflow-continuity',
      storyId: STORY.storyId,
      title: STORY.title,
      actor: STORY.actor,
      route: STORY.entryRoute,
      specFile: 'e2e/integration-governance-member-workflow-continuity.spec.ts',
      browser: 'chromium',
      goal: STORY.goal,
      preconditions: [...(STORY.preconditions ?? [])],
      seedData: [...(STORY.seedData ?? [])],
      storyBinding: BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    const chatRunnerLogs: string[] = [];
    const notebookRunnerLogs: string[] = [];

    try {
      await keycloakLoginToWorkspace(page, WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD, {
        ensureProjectCreatorAccess: false,
      });
      const { projectId } = await createProjectInWorkspace(page, WORKSPACE_ID, `${runtime.projectNamePrefix} ${Date.now()}`, {
        visibility: 'private',
        joinPolicy: 'approval_required',
      });

      const credentialName = `${runtime.credentialNamePrefix} ${Date.now()}`;
      await createCredentialViaUi(page, WORKSPACE_ID, projectId, credentialName, apiKey);
      const endpointId = await createEndpointViaApi(page, WORKSPACE_ID, projectId, {
        endpointName: `${runtime.endpointNamePrefix} ${Date.now()}`,
        endpointModel: BACKEND_REAL_MODEL,
        upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
        credentialName,
      });

      const notebookBundle = await createExternalRunnerAgentBundle(page, {
        workspaceId: WORKSPACE_ID,
        projectId,
        endpointId,
        title: `${runtime.notebookAgentTitlePrefix} ${Date.now()}`,
        interactionKind: 'notebook',
      });

      const chatRunner = await startChatRunnerProcess({ wsUrl: chatBundle.wsUrl, agentKey: chatBundle.agentKey });
      const notebookRunner = await startCodexRunnerProcess({ wsUrl: notebookBundle.wsUrl, agentKey: notebookBundle.agentKey });
      chatRunnerLogs.push(chatRunner.logPath);
      notebookRunnerLogs.push(notebookRunner.logPath);
      test.info().annotations.push({ type: 'chat_runner_log', description: chatRunner.logPath });
      test.info().annotations.push({ type: 'notebook_runner_log', description: notebookRunner.logPath });

      await waitForAgentPresenceOnline(page, WORKSPACE_ID, projectId, chatBundle.agentId);
      await waitForAgentPresenceOnline(page, WORKSPACE_ID, projectId, notebookBundle.agentId);

      const inviteToken = await createInviteViaUi({
        page,
        workspaceId: WORKSPACE_ID,
        projectId,
        invitedEmail: runtime.memberEmail,
      });

      const memberContext = await browser.newContext();
      const memberPage = await memberContext.newPage();
      try {
        await keycloakLoginToWorkspace(memberPage, WORKSPACE_ID, KEYCLOAK_INTEGRATION_MEMBER_USERNAME, KEYCLOAK_INTEGRATION_MEMBER_PASSWORD, {
          ensureProjectCreatorAccess: false,
        });
        await memberPage.goto(`/${LOCALE}/join?token=${inviteToken}`);
        await expect(memberPage.getByTestId('join__auto-accepting')).toBeVisible({ timeout: 30_000 });
        await memberPage.waitForURL((url) => {
          const parsed = new URL(url.toString());
          return parsed.pathname === `/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/overview`;
        }, { timeout: 30_000 });
        await expect(memberPage.getByTestId('project-hub__page')).toBeVisible({ timeout: 30_000 });

        const memberToken = await readStoredAuthToken(memberPage);
        const memberUserId = readUserIdFromJwt(memberToken);

        await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} baseline ${Date.now()}`,
          notebookTaskTitle: `${runtime.notebookTaskTitlePrefix} baseline ${Date.now()}`,
          notebookAgentId: notebookBundle.agentId,
          chatAgentId: chatBundle.agentId,
          notebookToken: `${runtime.notebookTokenPrefix}_BASE_${Date.now()}`,
          chatToken: `${runtime.chatTokenPrefix}_BASE_${Date.now()}`,
      artifactName: `${runtime.artifactNamePrefix}-baseline-${Date.now()}.md`,
        });
        await trace.capture(memberPage, { stepId: 'member-first-success' });

        await setProjectAdminMembership({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          memberUserId,
          shouldBeAdmin: true,
        });
        await memberPage.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/settings`);
        await expect(memberPage.getByTestId('settings__project-admins-save')).toBeVisible({ timeout: 30_000 });
        await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} promoted ${Date.now()}`,
          notebookTaskTitle: `${runtime.notebookTaskTitlePrefix} promoted ${Date.now()}`,
          notebookAgentId: notebookBundle.agentId,
          chatAgentId: chatBundle.agentId,
          notebookToken: `${runtime.notebookTokenPrefix}_PROMOTED_${Date.now()}`,
          chatToken: `${runtime.chatTokenPrefix}_PROMOTED_${Date.now()}`,
      artifactName: `${runtime.artifactNamePrefix}-promoted-${Date.now()}.md`,
        });
        await trace.capture(memberPage, { stepId: 'promote-member-and-continue-work' });

        await setProjectAdminMembership({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          memberUserId,
          shouldBeAdmin: false,
        });
        await memberPage.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${projectId}/settings`);
        await expect(memberPage.getByTestId('page-state__error')).toBeVisible({ timeout: 30_000 });
        await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} demoted ${Date.now()}`,
          notebookTaskTitle: `${runtime.notebookTaskTitlePrefix} demoted ${Date.now()}`,
          notebookAgentId: notebookBundle.agentId,
          chatAgentId: chatBundle.agentId,
          notebookToken: `${runtime.notebookTokenPrefix}_DEMOTED_${Date.now()}`,
          chatToken: `${runtime.chatTokenPrefix}_DEMOTED_${Date.now()}`,
      artifactName: `${runtime.artifactNamePrefix}-demoted-${Date.now()}.md`,
        });
        await trace.capture(memberPage, { stepId: 'demote-member-and-continue-work' });

        await removeProjectMemberByApi({
          page,
          workspaceId: WORKSPACE_ID,
          projectId,
          memberId: memberUserId,
          memberEmail: runtime.memberEmail,
        });

        const verificationContext = await browser.newContext();
        const verificationPage = await verificationContext.newPage();
        try {
          await keycloakLoginToWorkspace(verificationPage, WORKSPACE_ID, KEYCLOAK_INTEGRATION_MEMBER_USERNAME, KEYCLOAK_INTEGRATION_MEMBER_PASSWORD, {
            ensureProjectCreatorAccess: false,
          });
          await verificationPage.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects`);
          await expect(verificationPage.getByText(runtime.projectNamePrefix)).toHaveCount(0);
          await assertProjectUnavailableOnRoutes({
            page: verificationPage,
            workspaceId: WORKSPACE_ID,
            projectId,
            routes: ['overview', 'chat', 'notebook', 'files'],
          });
          await trace.capture(verificationPage, { stepId: 'remove-member-and-lose-project-access' });
        } finally {
          await verificationContext.close();
        }

        outcome = 'pass';
      } finally {
        await memberContext.close();
        await notebookRunner.stop();
      }
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString(), notes: [...chatRunnerLogs, ...notebookRunnerLogs] });
    }
  });
});
