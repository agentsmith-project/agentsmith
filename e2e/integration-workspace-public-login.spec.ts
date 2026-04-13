import { expect, test, type Page } from '@playwright/test';
import { keycloakLoginToWorkspace, LOCALE, KEYCLOAK_DEV_ADMIN_EMAIL, KEYCLOAK_DEV_ADMIN_PASSWORD, KEYCLOAK_DEV_ADMIN_USERNAME, SYSTEM_ADMIN_PASSWORD, SYSTEM_ADMIN_USERNAME } from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_PUBLIC_ENTRY_STORY = loadStoryDefinitionSync('workspace-public-entry-and-login-truth');
const WORKSPACE_PUBLIC_ENTRY_STORY_BINDING = buildTraceStoryBinding(WORKSPACE_PUBLIC_ENTRY_STORY);
const WORKSPACE_ID = WORKSPACE_PUBLIC_ENTRY_STORY.seedData?.[0] ?? 'ws_default';

const WORKSPACE_IDENTITY_SWITCH_STORY = loadStoryDefinitionSync('workspace-identity-switch-truth');
const WORKSPACE_IDENTITY_SWITCH_STORY_BINDING = buildTraceStoryBinding(WORKSPACE_IDENTITY_SWITCH_STORY);
const SOURCE_WORKSPACE_ID = WORKSPACE_IDENTITY_SWITCH_STORY.runtimeData?.workspaceIdentitySwitchTruth?.sourceWorkspaceId ?? 'ws_default';
const TARGET_WORKSPACE_NAME_PREFIX = WORKSPACE_IDENTITY_SWITCH_STORY.runtimeData?.workspaceIdentitySwitchTruth?.targetWorkspaceNamePrefix ?? 'Story Identity Switch Target';
const TARGET_WORKSPACE_ADMIN_EMAIL = WORKSPACE_IDENTITY_SWITCH_STORY.runtimeData?.workspaceIdentitySwitchTruth?.targetWorkspaceAdminEmail ?? KEYCLOAK_DEV_ADMIN_EMAIL;
const STALE_PROJECT_ID = WORKSPACE_IDENTITY_SWITCH_STORY.runtimeData?.workspaceIdentitySwitchTruth?.staleProjectId ?? 'proj_001';
const LONG_HORIZON_TIMEOUT_MS = 120_000;

async function loginAsSystemAdminViaRequest(page: Page): Promise<void> {
  const response = await page.request.post('/api/system/session', {
    headers: {
      'Content-Type': 'application/json',
    },
    data: JSON.stringify({
      username: SYSTEM_ADMIN_USERNAME,
      password: SYSTEM_ADMIN_PASSWORD,
    }),
  });
  expect(response.ok()).toBeTruthy();
}

test.describe('@lane-real integration workspace public login truth', () => {
  test('public workspace entry keeps workspace identity and login next step consistent for ordinary users', async ({ page }) => {
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-public-login',
      storyId: WORKSPACE_PUBLIC_ENTRY_STORY.storyId,
      title: WORKSPACE_PUBLIC_ENTRY_STORY.title,
      actor: WORKSPACE_PUBLIC_ENTRY_STORY.actor,
      route: WORKSPACE_PUBLIC_ENTRY_STORY.entryRoute,
      specFile: 'e2e/integration-workspace-public-login.spec.ts',
      browser: 'chromium',
      goal: WORKSPACE_PUBLIC_ENTRY_STORY.goal,
      preconditions: [...(WORKSPACE_PUBLIC_ENTRY_STORY.preconditions ?? [])],
      seedData: [...(WORKSPACE_PUBLIC_ENTRY_STORY.seedData ?? [])],
      storyBinding: WORKSPACE_PUBLIC_ENTRY_STORY_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await page.goto(`/${LOCALE}/login/workspace`);
      await expect(page.getByTestId('workspace-select__list')).toBeVisible({ timeout: LONG_HORIZON_TIMEOUT_MS });
      const workspaceEntry = page.getByTestId(`workspace-select__item--${WORKSPACE_ID}`);
      await expect(workspaceEntry).toBeVisible({ timeout: 30_000 });
      const workspaceName = (await workspaceEntry.locator('h2').textContent())?.trim();
      expect(workspaceName).toBeTruthy();
      await trace.capture(page, {
        stepId: 'workspace-selection',
        target: `workspace-select__item--${WORKSPACE_ID}`,
        assertion: 'workspace selection shows the intended public workspace entry',
      });

      await workspaceEntry.click();
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${WORKSPACE_ID}/login$`), { timeout: 30_000 });
      await expect(page.getByTestId('workspace-login__heading')).toHaveText(workspaceName ?? '', { timeout: 30_000 });
      await expect(page.getByTestId('workspace-login__back-to-selection')).toHaveAttribute(
        'href',
        `/${LOCALE}/login/workspace`,
      );
      await trace.capture(page, {
        stepId: 'workspace-login-identity',
        assertion: 'workspace login heading matches the selected public workspace',
      });

      await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeEnabled({ timeout: 30_000 });
      await expect(page.getByTestId('workspace-login__error')).toHaveCount(0);
      await trace.capture(page, {
        stepId: 'workspace-login-next-step',
        assertion: 'workspace login presents a clear sign-in action and a real path back to workspace selection',
      });
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });

  test('same human can sign out from one workspace and enter another without stale project continuation leaking across identities', async ({ page }) => {
    test.setTimeout(180_000);
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-public-login',
      storyId: WORKSPACE_IDENTITY_SWITCH_STORY.storyId,
      title: WORKSPACE_IDENTITY_SWITCH_STORY.title,
      actor: WORKSPACE_IDENTITY_SWITCH_STORY.actor,
      route: WORKSPACE_IDENTITY_SWITCH_STORY.entryRoute,
      specFile: 'e2e/integration-workspace-public-login.spec.ts',
      browser: 'chromium',
      goal: WORKSPACE_IDENTITY_SWITCH_STORY.goal,
      preconditions: [...(WORKSPACE_IDENTITY_SWITCH_STORY.preconditions ?? [])],
      seedData: [...(WORKSPACE_IDENTITY_SWITCH_STORY.seedData ?? [])],
      storyBinding: WORKSPACE_IDENTITY_SWITCH_STORY_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await loginAsSystemAdminViaRequest(page);
      const existingWorkspaceResponse = await page.request.get('/api/public/workspaces');
      expect(existingWorkspaceResponse.ok()).toBeTruthy();
      const existingWorkspacePayload = await existingWorkspaceResponse.json() as { items?: Array<{ id: string; name: string }> };
      const existingWorkspaces = existingWorkspacePayload.items ?? [];

      let sourceWorkspaceId = existingWorkspaces.find((item) => item.id === SOURCE_WORKSPACE_ID)?.id ?? '';
      if (!sourceWorkspaceId) {
        const sourceWorkspaceName = 'Default Workspace';
        const createSourceResponse = await page.request.post('/api/system/workspaces', {
          data: {
            name: sourceWorkspaceName,
            workspace_admin_mode: 'email_pending',
            workspace_admin_email: KEYCLOAK_DEV_ADMIN_EMAIL,
            login_idp_url: process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080',
            login_idp_realm: process.env.KEYCLOAK_REALM ?? 'mbos',
            login_client_id: process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith',
          },
        });
        expect(createSourceResponse.ok()).toBeTruthy();
        const createdSourceWorkspace = await createSourceResponse.json() as { id?: string };
        sourceWorkspaceId = createdSourceWorkspace.id ?? '';
        expect(sourceWorkspaceId).toBeTruthy();
        const publishSourceResponse = await page.request.post(`/api/system/workspaces/${sourceWorkspaceId}/publish`);
        expect(publishSourceResponse.ok()).toBeTruthy();
      }

      const targetWorkspaceName = `${TARGET_WORKSPACE_NAME_PREFIX} ${Date.now()}`;
      const createResponse = await page.request.post('/api/system/workspaces', {
        data: {
          name: targetWorkspaceName,
          workspace_admin_mode: 'email_pending',
          workspace_admin_email: TARGET_WORKSPACE_ADMIN_EMAIL,
          login_idp_url: process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080',
          login_idp_realm: process.env.KEYCLOAK_REALM ?? 'mbos',
          login_client_id: process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith',
        },
      });
      expect(createResponse.ok()).toBeTruthy();
      const createdWorkspace = await createResponse.json() as { id?: string };
      const targetWorkspaceId = createdWorkspace.id ?? '';
      expect(targetWorkspaceId).toBeTruthy();
      const publishResponse = await page.request.post(`/api/system/workspaces/${targetWorkspaceId}/publish`);
      expect(publishResponse.ok()).toBeTruthy();
      await expect.poll(async () => {
        const response = await page.request.get('/api/public/workspaces');
        expect(response.ok()).toBeTruthy();
        const payload = await response.json() as { items?: Array<{ id: string; name: string }> };
        return payload.items?.some((item) => item.id === targetWorkspaceId && item.name === targetWorkspaceName) ?? false;
      }, {
        timeout: LONG_HORIZON_TIMEOUT_MS,
      }).toBe(true);
      await page.context().clearCookies();

      await page.goto(`/${LOCALE}/login/workspace`);
      await expect(page.getByTestId('workspace-select__list')).toBeVisible({ timeout: LONG_HORIZON_TIMEOUT_MS });
      await expect(page.getByTestId(`workspace-select__item--${sourceWorkspaceId}`)).toBeVisible({ timeout: LONG_HORIZON_TIMEOUT_MS });
      await expect(page.getByTestId(`workspace-select__item--${targetWorkspaceId}`)).toBeVisible({ timeout: LONG_HORIZON_TIMEOUT_MS });
      await trace.capture(page, {
        stepId: 'open-workspace-selection',
        target: 'workspace-select__list',
        assertion: 'workspace selection shows both the source workspace and the newly published target workspace',
      });

      await page.getByTestId(`workspace-select__item--${sourceWorkspaceId}`).click();
      await expect(page).toHaveURL(new RegExp(String.raw`/${LOCALE}/workspaces/${sourceWorkspaceId}/login(?:\?.*)?$`), { timeout: LONG_HORIZON_TIMEOUT_MS });
      await expect(page.getByTestId('workspace-login__heading')).toBeVisible({ timeout: LONG_HORIZON_TIMEOUT_MS });
      await trace.capture(page, {
        stepId: 'enter-source-workspace',
        target: 'workspace-login__keycloak-btn',
        assertion: 'source workspace login opens with the matching workspace identity',
      });

      await keycloakLoginToWorkspace(page, sourceWorkspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD, { preserveCurrentWorkspaceLoginPage: true });
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${sourceWorkspaceId}/projects(?:$|/)`), { timeout: 30_000 });
      await expect(page.getByTestId('projects__page')).toBeVisible({ timeout: LONG_HORIZON_TIMEOUT_MS });

      await page.evaluate(({ workspaceId, projectId }) => {
        window.sessionStorage.setItem(
          'agentsmith:invite-handoff',
          JSON.stringify({ workspaceId, projectId, storedAt: Date.now() }),
        );
        window.sessionStorage.setItem(
          'agentsmith:pending-invite',
          JSON.stringify({ inviteToken: 'stale_invite', storedAt: Date.now() }),
        );
      }, { workspaceId: SOURCE_WORKSPACE_ID, projectId: STALE_PROJECT_ID });

      await page.getByTestId('topbar__user-menu').click();
      await expect(page.getByTestId('user-menu__logout')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('user-menu__logout').click();
      await page.waitForURL(`**/${LOCALE}/login/workspace`, { timeout: 30_000 });
      await expect(page.getByTestId('workspace-select__list')).toBeVisible({ timeout: LONG_HORIZON_TIMEOUT_MS });
      expect(await page.evaluate(() => window.sessionStorage.getItem('agentsmith:invite-handoff'))).toBeNull();
      expect(await page.evaluate(() => window.sessionStorage.getItem('agentsmith:pending-invite'))).toBeNull();
      await trace.capture(page, {
        stepId: 'sign-out-from-source-workspace',
        target: 'user-menu__logout',
        assertion: 'sign out clears stale login continuation state before returning to workspace selection',
      });

      await page.getByTestId(`workspace-select__item--${targetWorkspaceId}`).click();
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${targetWorkspaceId}/login$`), { timeout: LONG_HORIZON_TIMEOUT_MS });
      await expect(page.getByTestId('workspace-login__heading')).toHaveText(targetWorkspaceName, { timeout: LONG_HORIZON_TIMEOUT_MS });
      await expect(page.getByTestId('workspace-login__back-to-selection')).toHaveAttribute('href', `/${LOCALE}/login/workspace`);
      await expect(page.url()).not.toContain('project_id=');
      await trace.capture(page, {
        stepId: 'choose-target-workspace',
        target: `workspace-select__item--${targetWorkspaceId}`,
        assertion: 'target workspace login opens without carrying over the source workspace continuation',
      });

      await keycloakLoginToWorkspace(page, targetWorkspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD, { preserveCurrentWorkspaceLoginPage: true });
      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${targetWorkspaceId}/projects(?:$|/)`), { timeout: LONG_HORIZON_TIMEOUT_MS });
      await expect(page.getByTestId('projects__page')).toBeVisible({ timeout: LONG_HORIZON_TIMEOUT_MS });
      await trace.capture(page, {
        stepId: 'land-on-target-projects',
        target: 'projects__create-btn',
        assertion: 'target workspace landing remains clean and truthful after identity switch',
      });
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
