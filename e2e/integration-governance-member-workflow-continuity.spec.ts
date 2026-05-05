import { expect, test } from '@playwright/test';
import {
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  createChatSessionViaApi,
  createCredentialViaUi,
  createEndpointViaApi,
  createManagedAgentRunnerViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  expectAgentTaskConversationSurface,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  keycloakLoginToWorkspace,
  LOCALE,
  startAgentTaskRunViaApi,
  waitForRunnerOutputToken,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import {
  assertProjectUnavailableOnRoutes,
  createInviteViaUi,
  createAgentTaskWithNewWorkspaceViaApi,
  openAgentTaskDetail,
  readUserIdFromJwt,
  removeProjectMemberByApi,
  runChatStreamTurn,
  setProjectAdminMembership,
  waitForAssistantToken,
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
  agentTaskRunnerTitlePrefix: string;
  taskWorkspacePrefix: string;
  agentTaskTitlePrefix: string;
  chatTokenPrefix: string;
  agentTaskTokenPrefix: string;
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
    'agentTaskRunnerTitlePrefix',
    'taskWorkspacePrefix',
    'agentTaskTitlePrefix',
    'chatTokenPrefix',
    'agentTaskTokenPrefix',
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
  agentTaskTitle: string;
  agentTaskToken: string;
  artifactName: string;
  endpointId?: string;
  chatToken?: string;
}): Promise<string> {
  const createdTask = await createAgentTaskWithNewWorkspaceViaApi({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    title: args.agentTaskTitle,
    workspaceName: args.taskWorkspaceName,
  });

  const run = await startAgentTaskRunViaApi({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: createdTask.taskId,
    intent: [
      `Run the following shell commands exactly, then reply with exactly ${args.agentTaskToken}.`,
      '```bash',
      'mkdir -p .artifacts',
      `cat <<'EOF' > .artifacts/${args.artifactName}`,
      '# Governance Runtime Artifact',
      `- Token: ${args.agentTaskToken}`,
      '- Scope: member runtime continuity',
      'EOF',
      '```',
    ].join('\n'),
  });
  await waitForRunnerOutputToken({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: createdTask.taskId,
    token: args.agentTaskToken,
    runnerOutputActivityId: run.runnerOutputActivityId,
    runId: run.runId,
  });
  await waitForTaskArtifacts({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: createdTask.taskId,
    expectedPath: `.artifacts/${args.artifactName}`,
  });

  await openAgentTaskDetail({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: createdTask.taskId,
  });
  await expectAgentTaskConversationSurface({
    page: args.page,
    openTerminalAction: 'enabled',
    terminalModeEnabled: false,
    blocked: false,
  });
  await expect(args.page.getByTestId('agent-tasks__artifact-card')).toBeVisible({ timeout: 30_000 });
  await expect(args.page.getByTestId('agent-task__task-header-workspace-library')).toBeVisible({ timeout: 30_000 });

  if (args.endpointId && args.chatToken) {
    const sessionId = (await createChatSessionViaApi({
      page: args.page,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      endpointId: args.endpointId,
      title: `${args.agentTaskTitle}-chat`,
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

  return `agent-task-run:${createdTask.taskId}`;
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

      await createManagedAgentRunnerViaApi(page, {
        workspaceId: WORKSPACE_ID,
        projectId,
        endpointId,
        title: `${runtime.agentTaskRunnerTitlePrefix} ${Date.now()}`,
      });

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
        await expect(memberPage.getByTestId('project-overview__page')).toBeVisible({ timeout: 30_000 });

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

        const adminRunnerLog = await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} admin ${Date.now()}`,
          agentTaskTitle: `${runtime.agentTaskTitlePrefix} admin ${Date.now()}`,
          agentTaskToken: `${runtime.agentTaskTokenPrefix}_ADMIN_${Date.now()}`,
          artifactName: `${runtime.artifactNamePrefix}-admin-${Date.now()}.md`,
        });
        runnerLogs.push(adminRunnerLog);
        test.info().annotations.push({ type: 'agent_task_runner_log', description: adminRunnerLog });

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

        const memberRunnerLog = await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} member ${Date.now()}`,
          agentTaskTitle: `${runtime.agentTaskTitlePrefix} member ${Date.now()}`,
          agentTaskToken: `${runtime.agentTaskTokenPrefix}_MEMBER_${Date.now()}`,
          artifactName: `${runtime.artifactNamePrefix}-member-${Date.now()}.md`,
        });
        runnerLogs.push(memberRunnerLog);
        test.info().annotations.push({ type: 'agent_task_runner_log', description: memberRunnerLog });
        await trace.capture(memberPage, { stepId: 'continue-member-work' });

        outcome = 'pass';
      } finally {
        await memberContext.close();
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

    const agentTaskRunnerLogs: string[] = [];

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

      await createManagedAgentRunnerViaApi(page, {
        workspaceId: WORKSPACE_ID,
        projectId,
        endpointId,
        title: `${runtime.agentTaskRunnerTitlePrefix} ${Date.now()}`,
      });

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
        await expect(memberPage.getByTestId('project-overview__page')).toBeVisible({ timeout: 30_000 });

        const memberToken = await readStoredAuthToken(memberPage);
        const memberUserId = readUserIdFromJwt(memberToken);

        const baselineRunnerLog = await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} baseline ${Date.now()}`,
          agentTaskTitle: `${runtime.agentTaskTitlePrefix} baseline ${Date.now()}`,
          endpointId,
          agentTaskToken: `${runtime.agentTaskTokenPrefix}_BASE_${Date.now()}`,
          chatToken: `${runtime.chatTokenPrefix}_BASE_${Date.now()}`,
          artifactName: `${runtime.artifactNamePrefix}-baseline-${Date.now()}.md`,
        });
        agentTaskRunnerLogs.push(baselineRunnerLog);
        test.info().annotations.push({ type: 'agent_task_runner_log', description: baselineRunnerLog });
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
        const promotedRunnerLog = await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} promoted ${Date.now()}`,
          agentTaskTitle: `${runtime.agentTaskTitlePrefix} promoted ${Date.now()}`,
          endpointId,
          agentTaskToken: `${runtime.agentTaskTokenPrefix}_PROMOTED_${Date.now()}`,
          chatToken: `${runtime.chatTokenPrefix}_PROMOTED_${Date.now()}`,
          artifactName: `${runtime.artifactNamePrefix}-promoted-${Date.now()}.md`,
        });
        agentTaskRunnerLogs.push(promotedRunnerLog);
        test.info().annotations.push({ type: 'agent_task_runner_log', description: promotedRunnerLog });
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
        const demotedRunnerLog = await runMemberWorkCycle({
          page: memberPage,
          workspaceId: WORKSPACE_ID,
          projectId,
          taskWorkspaceName: `${runtime.taskWorkspacePrefix} demoted ${Date.now()}`,
          agentTaskTitle: `${runtime.agentTaskTitlePrefix} demoted ${Date.now()}`,
          endpointId,
          agentTaskToken: `${runtime.agentTaskTokenPrefix}_DEMOTED_${Date.now()}`,
          chatToken: `${runtime.chatTokenPrefix}_DEMOTED_${Date.now()}`,
          artifactName: `${runtime.artifactNamePrefix}-demoted-${Date.now()}.md`,
        });
        agentTaskRunnerLogs.push(demotedRunnerLog);
        test.info().annotations.push({ type: 'agent_task_runner_log', description: demotedRunnerLog });
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
            routes: ['overview', 'chat', 'agent-tasks', 'files'],
          });
          await trace.capture(verificationPage, { stepId: 'remove-member-and-lose-project-access' });
        } finally {
          await verificationContext.close();
        }

        outcome = 'pass';
      } finally {
        await memberContext.close();
      }
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString(), notes: [...agentTaskRunnerLogs] });
    }
  });
});
