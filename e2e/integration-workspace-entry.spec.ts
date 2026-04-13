import { expect, test } from '@playwright/test';
import { keycloakLoginToWorkspace, LOCALE } from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_ENTRY_STORY = loadStoryDefinitionSync('workspace-entry-and-project-discovery');
const WORKSPACE_ENTRY_STORY_BINDING = buildTraceStoryBinding(WORKSPACE_ENTRY_STORY);
const WORKSPACE_ID = WORKSPACE_ENTRY_STORY.seedData?.[0] ?? 'ws_default';

test.describe('@lane-real integration workspace entry', () => {
  test('dev-admin reaches ws_default projects entry without denied flicker', async ({ page }) => {
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-entry',
      storyId: WORKSPACE_ENTRY_STORY.storyId,
      title: WORKSPACE_ENTRY_STORY.title,
      actor: WORKSPACE_ENTRY_STORY.actor,
      route: WORKSPACE_ENTRY_STORY.entryRoute,
      specFile: 'e2e/integration-workspace-entry.spec.ts',
      browser: 'chromium',
      goal: WORKSPACE_ENTRY_STORY.goal,
      preconditions: [...(WORKSPACE_ENTRY_STORY.preconditions ?? [])],
      seedData: [...(WORKSPACE_ENTRY_STORY.seedData ?? [])],
      storyBinding: WORKSPACE_ENTRY_STORY_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/login`);
      await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'workspace-login' });

      await keycloakLoginToWorkspace(page, WORKSPACE_ID);

      await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects(?:$|/)`), {
        timeout: 30_000,
      });
      await expect(page.getByTestId('projects__page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'workspace-projects' });
      await expect(page.getByText('permission_denied_title')).not.toBeVisible();
      await trace.note({
        stepId: 'project-discovery',
        note: '项目列表与创建入口稳定可见',
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
