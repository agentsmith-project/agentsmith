import { expect, test } from '@playwright/test';
import { API_BASE, KEYCLOAK_DEV_ADMIN_PASSWORD, KEYCLOAK_DEV_ADMIN_USERNAME, keycloakLoginToWorkspace, LOCALE } from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import { buildTraceStoryBinding } from './story-trace-binding';
import { readStoryDefinitionFromMarkdownFileSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const SYSTEM_ADMIN_USERNAME = process.env.SYSTEM_ADMIN_USERNAME ?? 'mbos-admin';
const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD ?? 'mbos-admin';
const SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY = readStoryDefinitionFromMarkdownFileSync('e2e/stories/backend-real/workspace-lifecycle-admin-operations.story.md');
const SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_BINDING = buildTraceStoryBinding(SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY);
const LIVE_WORKSPACE_ID = SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY.seedData?.[0] ?? 'ws_default';

function resolveLifecycleStep(stepId: string) {
  const step = SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_workspace_lifecycle_step:${stepId}`);
  }
  return step;
}

test.describe('@lane-real integration system admin entry', () => {
  test('system admin can maintain a live workspace and confirm it remains reachable', async ({ page }) => {
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-system-admin-entry',
      storyId: SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY.storyId,
      title: SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY.title,
      actor: SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY.actor,
      route: SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY.entryRoute,
      specFile: 'e2e/integration-system-admin-entry.spec.ts',
      browser: 'chromium',
      goal: SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY.goal,
      preconditions: [...(SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY.preconditions ?? [])],
      seedData: [...(SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_STORY.seedData ?? [])],
      storyBinding: SYSTEM_ADMIN_WORKSPACE_LIFECYCLE_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    await page.context().clearCookies();
    try {
      await page.goto(`/${LOCALE}/system/login`);
      await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'system-login' });
      await page.getByTestId('system-login__username').fill(SYSTEM_ADMIN_USERNAME);
      await page.getByTestId('system-login__password').fill(SYSTEM_ADMIN_PASSWORD);

      let loginResponseOk = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const responsePromise = page
          .waitForResponse(
            (response) =>
              response.url().includes('/api/system/session') && response.request().method() === 'POST',
            { timeout: 5_000 },
          )
          .catch(() => null);
        await page.getByTestId('system-login__submit').click();
        const response = await responsePromise;
        if (response) {
          loginResponseOk = response.ok();
          break;
        }
        await page.waitForTimeout(1_000);
      }

      expect(loginResponseOk).toBe(true);
      await expect
        .poll(() => page.url(), { timeout: 30_000 })
        .toMatch(new RegExp(`/${LOCALE}/system/workspaces`));
      await expect(page.getByTestId('system-workspaces__list')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('system-workspaces__new-workspace')).toBeVisible({ timeout: 30_000 });

      const workspaceCard = page.getByTestId(`system-workspaces__card--${LIVE_WORKSPACE_ID}`);
      await expect(workspaceCard).toBeVisible({ timeout: 30_000 });
      await workspaceCard.click();
      await expect(workspaceCard.getByTestId(`system-workspaces__open-workspace-login--${LIVE_WORKSPACE_ID}`)).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'system-workspaces' });

      await page.getByTestId('system-workspaces__enable-edit').click();
      const verifyResponsePromise = page
        .waitForResponse(
          (response) => response.url().includes('/api/system/workspaces/idp/verify') && response.request().method() === 'POST',
          { timeout: 15_000 },
        )
        .catch(() => null);
      await page.getByTestId('system-workspaces__verify-idp').click();
      const verifyResponse = await verifyResponsePromise;
      expect(verifyResponse?.ok()).toBeTruthy();
      await expect(page.getByTestId('system-workspaces__idp-status')).toBeVisible({ timeout: 15_000 });
      await trace.capture(page, { stepId: 'live-workspace-maintenance' });

      await keycloakLoginToWorkspace(page, LIVE_WORKSPACE_ID, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD, {
        ensureProjectCreatorAccess: false,
      });
      await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'workspace-login' });

      const token = await readStoredAuthToken(page);
      const response = await page.request.get(
        `${API_BASE}/api/v1/workspaces/${LIVE_WORKSPACE_ID}/projects?page=1&page_size=20`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(response.ok()).toBeTruthy();
      await trace.capture(page, { stepId: 'workspace-projects' });
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
