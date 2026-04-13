import { expect, test } from '@playwright/test';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const LOCALE = process.env.INTEGRATION_LOCALE ?? 'en-US';
const SYSTEM_ADMIN_USERNAME = process.env.SYSTEM_ADMIN_USERNAME ?? 'mbos-admin';
const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD ?? 'mbos-admin';
const SYSTEM_ADMIN_ENTRY_STORY = loadStoryDefinitionSync('system-admin-entry');
const SYSTEM_ADMIN_ENTRY_STORY_BINDING = buildTraceStoryBinding(SYSTEM_ADMIN_ENTRY_STORY);

test.describe('@lane-real integration system admin entry', () => {
  test('system admin can sign in and reach the workspaces page', async ({ page }) => {
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
      storyBinding: SYSTEM_ADMIN_ENTRY_STORY_BINDING,
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
      await expect(page.getByTestId('system-workspaces__heading')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'system-workspaces' });
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
