import { expect, test } from '@playwright/test';
import {
  API_BASE,
  BACKEND_REAL_ANTHROPIC_BASE_URL,
  BACKEND_REAL_MODEL,
  LOCALE,
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
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  keycloakLoginToWorkspace,
  putContextEntryViaApi,
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { readStoryDefinitionFromMarkdownFileSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import { readStoredAuthToken } from './integration-workspace-access';
import { openWorkspaceSharedContextPage } from './integration-context-ui-support';

const PERSONAL_CONTEXT_STORY = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/workspace-project-personal-context.story.md');
const PERSONAL_CONTEXT_BINDING = buildTraceStoryBinding(PERSONAL_CONTEXT_STORY);
const WORKSPACE_SHARED_CONTEXT_STORY = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/workspace-shared-context-continuity.story.md');
const WORKSPACE_SHARED_CONTEXT_BINDING = buildTraceStoryBinding(WORKSPACE_SHARED_CONTEXT_STORY);

type PersonalContextRuntime = {
  projectName: string;
  contextKey: string;
  workspaceValue: string;
  projectValue: string;
};

type WorkspaceSharedContextRuntime = {
  sharedKey: string;
  sharedValue: string;
  privateKey: string;
  privateValue: string;
  projectNamePrefix: string;
  endpointNamePrefix: string;
  credentialNamePrefix: string;
  model: string;
};

function resolvePersonalContextStep(stepId: string) {
  const step = PERSONAL_CONTEXT_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_personal_context_step:${stepId}`);
  }
  return step;
}

function resolveWorkspaceSharedContextStep(stepId: string) {
  const step = WORKSPACE_SHARED_CONTEXT_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_workspace_shared_context_step:${stepId}`);
  }
  return step;
}

function requirePersonalContextRuntime(): PersonalContextRuntime {
  const runtimeRoot = PERSONAL_CONTEXT_STORY.runtimeData as Record<string, unknown> | undefined;
  const personalContext = runtimeRoot?.personalContext as Record<string, unknown> | undefined;
  if (!personalContext) {
    throw new Error('missing_personal_context_runtime_data');
  }
  for (const key of ['projectName', 'contextKey', 'workspaceValue', 'projectValue'] as const) {
    if (typeof personalContext[key] !== 'string' || personalContext[key].trim().length === 0) {
      throw new Error(`missing_personal_context_runtime_data:${key}`);
    }
  }
  return personalContext as unknown as PersonalContextRuntime;
}

function requireWorkspaceSharedContextRuntime(): WorkspaceSharedContextRuntime {
  const runtimeRoot = WORKSPACE_SHARED_CONTEXT_STORY.runtimeData as Record<string, unknown> | undefined;
  const workspaceSharedContext = runtimeRoot?.workspaceSharedContext as Record<string, unknown> | undefined;
  if (!workspaceSharedContext) {
    throw new Error('missing_workspace_shared_context_runtime_data');
  }
  for (const key of ['sharedKey', 'sharedValue', 'privateKey', 'privateValue'] as const) {
    if (typeof workspaceSharedContext[key] !== 'string' || workspaceSharedContext[key].trim().length === 0) {
      throw new Error(`missing_workspace_shared_context_runtime_data:${key}`);
    }
  }
  const projectUseGuide = runtimeRoot?.projectUseGuide as Record<string, unknown> | undefined;
  if (!projectUseGuide) {
    throw new Error('missing_workspace_shared_context_project_use_guide_data');
  }
  for (const key of ['projectNamePrefix', 'endpointNamePrefix', 'credentialNamePrefix', 'model'] as const) {
    if (typeof projectUseGuide[key] !== 'string' || projectUseGuide[key].trim().length === 0) {
      throw new Error(`missing_workspace_shared_context_project_use_guide_data:${key}`);
    }
  }
  return {
    ...workspaceSharedContext,
    ...projectUseGuide,
  } as unknown as WorkspaceSharedContextRuntime;
}

async function joinProjectNow(page: import('@playwright/test').Page, workspaceId: string, projectId: string): Promise<void> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
  const joinButton = page.getByTestId(`projects__join-project-btn--${projectId}`);
  await expect(joinButton).toBeVisible({ timeout: 30_000 });
  await joinButton.click();
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}(/|$)`), {
    timeout: 30_000,
  });
}

async function openPersonalContextFromUserMenu(args: {
  page: import('@playwright/test').Page;
  entryPagePath: string;
  menuItemTestId: 'user-menu__workspace-personal-context' | 'user-menu__project-personal-context';
  expectedPath: RegExp;
}): Promise<void> {
  await args.page.goto(args.entryPagePath);
  await expect(args.page.getByTestId('topbar__user-menu')).toBeVisible({ timeout: 30_000 });
  await args.page.getByTestId('topbar__user-menu').click();
  await expect(args.page.getByTestId(args.menuItemTestId)).toBeVisible({ timeout: 10_000 });
  await args.page.getByTestId(args.menuItemTestId).click();
  await args.page.waitForURL(args.expectedPath, { timeout: 30_000 });
  await expect(args.page.getByTestId('context-store__list-card')).toBeVisible({ timeout: 30_000 });
}

async function saveContextEntryViaUi(args: {
  page: import('@playwright/test').Page;
  key: string;
  value: string;
}): Promise<void> {
  await args.page.getByTestId('context-store__new').click();
  await args.page.getByTestId('context-store__key').fill(args.key);
  await args.page.getByTestId('context-store__content').fill(args.value);
  await args.page.getByTestId('context-store__save').click();
  await expect(args.page.getByTestId(`context-store__item--${args.key}`)).toBeVisible({ timeout: 30_000 });
  await expect(args.page.getByTestId('context-store__content')).toHaveValue(args.value);
}


function requireRealLaneApiKey(): string {
  const value = process.env.BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return value;
}

test.describe('@lane-real context store isolation', () => {
  test('keeps workspace and project personal context scoped for a joined project member', async ({ page }) => {
    test.setTimeout(600_000);
    const runtime = requirePersonalContextRuntime();
    const workspaceId = 'ws_default';

    await ensureIntegrationKeycloakUsers();
    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, runtime.projectName, {
      visibility: 'public',
      joinPolicy: 'open',
    });

    await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_INTEGRATION_MEMBER_USERNAME, KEYCLOAK_INTEGRATION_MEMBER_PASSWORD);
    await joinProjectNow(page, workspaceId, projectId);

    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-context-store-isolation',
      storyId: PERSONAL_CONTEXT_STORY.storyId,
      title: PERSONAL_CONTEXT_STORY.title,
      actor: PERSONAL_CONTEXT_STORY.actor,
      route: `/${LOCALE}/workspaces/${workspaceId}/context`,
      specFile: 'e2e/integration-context-store-isolation.spec.ts',
      browser: 'chromium',
      goal: PERSONAL_CONTEXT_STORY.goal,
      preconditions: [...(PERSONAL_CONTEXT_STORY.preconditions ?? [])],
      seedData: [...(PERSONAL_CONTEXT_STORY.seedData ?? [])],
      storyBinding: PERSONAL_CONTEXT_BINDING,
    });
    const captureTrace = async (stepId: string): Promise<void> => {
      const storyStep = resolvePersonalContextStep(stepId);
      await trace.capture(page, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await openPersonalContextFromUserMenu({
        page,
        entryPagePath: `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview`,
        menuItemTestId: 'user-menu__workspace-personal-context',
        expectedPath: new RegExp(`/workspaces/${workspaceId}/context$`),
      });
      await captureTrace('open-workspace-personal-context');
      await saveContextEntryViaUi({
        page,
        key: runtime.contextKey,
        value: runtime.workspaceValue,
      });
      await captureTrace('save-workspace-personal-context');

      await openPersonalContextFromUserMenu({
        page,
        entryPagePath: `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview`,
        menuItemTestId: 'user-menu__project-personal-context',
        expectedPath: new RegExp(`/workspaces/${workspaceId}/projects/${projectId}/my-context$`),
      });
      await captureTrace('open-project-personal-context');
      await saveContextEntryViaUi({
        page,
        key: runtime.contextKey,
        value: runtime.projectValue,
      });
      await captureTrace('save-project-personal-context');

      const workspaceContext = await getContextEntryViaApi({
        page,
        scope: 'member',
        workspaceId,
        key: runtime.contextKey,
      });
      expect(workspaceContext.body).toEqual(expect.objectContaining({
        scope: 'member',
        key: runtime.contextKey,
        content: runtime.workspaceValue,
      }));

      const authToken = await readStoredAuthToken(page);
      const params = new URLSearchParams({
        scope: 'project_member',
        workspace_id: workspaceId,
        project_id: projectId,
        key: runtime.contextKey,
      });
      const projectContextResponse = await page.request.get(`${API_BASE}/api/v1/context?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(projectContextResponse.ok()).toBeTruthy();
      const projectContext = await projectContextResponse.json() as {
        scope?: string;
        key?: string;
        content?: string;
      };
      expect(projectContext).toEqual(expect.objectContaining({
        scope: 'project_member',
        key: runtime.contextKey,
        content: runtime.projectValue,
      }));
      await captureTrace('verify-scoped-context');
      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
    }
  });

  test('member context stays private between workspace members', async ({ browser, page }) => {
    test.setTimeout(240_000);
    await ensureIntegrationKeycloakUsers();
    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);

    const contextKey = `context.member.private.${Date.now()}`;
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
    const runtime = requireWorkspaceSharedContextRuntime();
    const runId = Date.now();
    const sharedKey = `${runtime.sharedKey}.${runId}`;
    const sharedValue = `${runtime.sharedValue} [${runId}]`;
    const privateKey = `${runtime.privateKey}.${runId}`;
    const privateValue = `${runtime.privateValue} [${runId}]`;
    const projectName = `${runtime.projectNamePrefix} ${runId}`;
    const endpointName = `${runtime.endpointNamePrefix} ${runId}`;
    const credentialName = `${runtime.credentialNamePrefix} ${runId}`;

    await ensureIntegrationKeycloakUsers();
    await keycloakLoginToWorkspace(page, 'ws_default', KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);

    const projectOwnerContext = await browser.newContext();
    const projectOwnerPage = await projectOwnerContext.newPage();
    try {
      await keycloakLoginToWorkspace(
        projectOwnerPage,
        'ws_default',
        KEYCLOAK_INTEGRATION_USER_USERNAME,
        KEYCLOAK_INTEGRATION_USER_PASSWORD,
        { ensureProjectCreatorAccess: false },
      );
      const { projectId } = await createProjectInWorkspace(projectOwnerPage, 'ws_default', projectName, {
        visibility: 'public',
        joinPolicy: 'open',
      });
      await createCredentialViaUi(projectOwnerPage, 'ws_default', projectId, credentialName, requireRealLaneApiKey());
      await createEndpointViaApi(projectOwnerPage, 'ws_default', projectId, {
        endpointName,
        endpointModel: runtime.model,
        upstreamBaseUrl: BACKEND_REAL_ANTHROPIC_BASE_URL,
        credentialName,
        upstreamProtocol: 'anthropic_messages',
      });

      const trace = await createUxTraceBundleWriter({
        outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
        lane: 'backend-real',
        suite: 'integration-context-store-isolation',
        storyId: WORKSPACE_SHARED_CONTEXT_STORY.storyId,
        title: WORKSPACE_SHARED_CONTEXT_STORY.title,
        actor: WORKSPACE_SHARED_CONTEXT_STORY.actor,
        route: `/${LOCALE}/workspaces/ws_default/settings/context`,
        specFile: 'e2e/integration-context-store-isolation.spec.ts',
        browser: 'chromium',
        goal: WORKSPACE_SHARED_CONTEXT_STORY.goal,
        preconditions: [...(WORKSPACE_SHARED_CONTEXT_STORY.preconditions ?? [])],
        seedData: [...(WORKSPACE_SHARED_CONTEXT_STORY.seedData ?? [])],
        storyBinding: WORKSPACE_SHARED_CONTEXT_BINDING,
      });
      let sharedContextTracePage = page;
      const captureSharedContextTrace = async (stepId: string): Promise<void> => {
        const storyStep = resolveWorkspaceSharedContextStep(stepId);
        await trace.capture(sharedContextTracePage, {
          stepId,
          action: storyStep.action,
          target: storyStep.target,
          note: storyStep.note ?? storyStep.expectedFeedback,
        });
      };
      let outcome: 'pass' | 'fail' = 'fail';

      try {
        await openWorkspaceSharedContextPage({ page, workspaceId: 'ws_default' });
        await captureSharedContextTrace('open-workspace-shared-context');
        await saveContextEntryViaUi({
          page,
          key: sharedKey,
          value: sharedValue,
        });
        await captureSharedContextTrace('save-workspace-shared-context');

        const sharedLookupAsAdmin = await getContextEntryViaApi({
          page,
          scope: 'workspace',
          workspaceId: 'ws_default',
          key: sharedKey,
        });
        expect(sharedLookupAsAdmin.body).toEqual(expect.objectContaining({
          scope: 'workspace',
          key: sharedKey,
          content: sharedValue,
        }));

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

          await joinProjectNow(memberPage, 'ws_default', projectId);
          await captureSharedContextTrace('join-project-before-use-guide');

          await openPersonalContextFromUserMenu({
            page: memberPage,
            entryPagePath: `/${LOCALE}/workspaces/ws_default/projects`,
            menuItemTestId: 'user-menu__workspace-personal-context',
            expectedPath: new RegExp(`/workspaces/ws_default/context$`),
          });
          await expect(memberPage.getByTestId('context-store__scope-note')).toBeVisible({ timeout: 30_000 });
          sharedContextTracePage = memberPage;
          await captureSharedContextTrace('verify-member-shared-context-boundary');

          await saveContextEntryViaUi({
            page: memberPage,
            key: privateKey,
            value: privateValue,
          });
          await captureSharedContextTrace('verify-member-private-context-boundary');

          const privateLookup = await getContextEntryViaApi({
            page: memberPage,
            scope: 'member',
            workspaceId: 'ws_default',
            key: privateKey,
          });
          expect(privateLookup.body).toEqual(expect.objectContaining({
            scope: 'member',
            key: privateKey,
            content: privateValue,
          }));

          await memberPage.goto(`/${LOCALE}/workspaces/ws_default/projects/${projectId}/use-guide`);
          await expect(memberPage.getByTestId('use-guide__page')).toBeVisible({ timeout: 30_000 });
          await expect(memberPage.getByTestId('use-guide__status-context')).toContainText('workspace personal context entries', { timeout: 30_000 });
          sharedContextTracePage = memberPage;
          await captureSharedContextTrace('verify-project-use-guide-readiness');
          outcome = 'pass';
        } finally {
          await memberContext.close();
        }
      } finally {
        await trace.finish({ outcome });
      }
    } finally {
      await projectOwnerContext.close();
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
