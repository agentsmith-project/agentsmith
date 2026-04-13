import { expect, test } from '@playwright/test';
import { LOCALE, SYSTEM_ADMIN_PASSWORD, SYSTEM_ADMIN_USERNAME } from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const SYSTEM_ADMIN_ENTRY_STORY = loadStoryDefinitionSync('system-admin-entry');
const SYSTEM_ADMIN_ENTRY_BINDING = buildTraceStoryBinding(SYSTEM_ADMIN_ENTRY_STORY);
const SEEDED_WORKSPACE_ID = SYSTEM_ADMIN_ENTRY_STORY.seedData?.[0] ?? null;

function resolveEntryStep(stepId: string) {
  const step = SYSTEM_ADMIN_ENTRY_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_system_admin_entry_step:${stepId}`);
  }
  return step;
}

test.describe('@lane-real integration system admin entry', () => {
  test('system admin can reach the workspace administration directory without access churn', async ({ page }) => {
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-system-admin-entry',
      storyId: SYSTEM_ADMIN_ENTRY_STORY.storyId,
      title: SYSTEM_ADMIN_ENTRY_STORY.title,
      actor: SYSTEM_ADMIN_ENTRY_STORY.actor,
      route: SYSTEM_ADMIN_ENTRY_STORY.entryRoute,
      specFile: 'e2e/integration-system-admin-entry.spec.ts',
      browser: 'chromium',
      goal: SYSTEM_ADMIN_ENTRY_STORY.goal,
      preconditions: [...(SYSTEM_ADMIN_ENTRY_STORY.preconditions ?? [])],
      seedData: [...(SYSTEM_ADMIN_ENTRY_STORY.seedData ?? [])],
      storyBinding: SYSTEM_ADMIN_ENTRY_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await page.context().clearCookies();
      await page.goto(`/${LOCALE}/system/login`);
      await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
      const loginStep = resolveEntryStep('system-login');
      await trace.capture(page, {
        stepId: 'system-login',
        action: loginStep.action,
        target: loginStep.target,
        note: loginStep.note ?? loginStep.expectedFeedback,
      });

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
      await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(new RegExp(`/${LOCALE}/system/workspaces`));
      await expect(page.getByTestId('system-workspaces__list')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('system-workspaces__new-workspace')).toBeVisible({ timeout: 30_000 });
      if (SEEDED_WORKSPACE_ID) {
        await expect(page.getByTestId(`system-workspaces__card--${SEEDED_WORKSPACE_ID}`)).toBeVisible({ timeout: 30_000 });
      }
      const workspacesStep = resolveEntryStep('system-workspaces');
      await trace.capture(page, {
        stepId: 'system-workspaces',
        action: workspacesStep.action,
        target: workspacesStep.target,
        note: workspacesStep.note ?? workspacesStep.expectedFeedback,
      });
      outcome = 'pass';
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString() });
    }
  });
});
