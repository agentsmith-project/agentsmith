import { expect, test } from '@playwright/test';
import { LOCALE } from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_PUBLIC_ENTRY_STORY = loadStoryDefinitionSync('workspace-public-entry-and-login-truth');
const WORKSPACE_PUBLIC_ENTRY_STORY_BINDING = buildTraceStoryBinding(WORKSPACE_PUBLIC_ENTRY_STORY);
const WORKSPACE_ID = WORKSPACE_PUBLIC_ENTRY_STORY.seedData?.[0] ?? 'ws_default';

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
      await expect(page.getByTestId('workspace-select__list')).toBeVisible({ timeout: 30_000 });
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
});
