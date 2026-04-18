import { expect, test } from '@playwright/test';
import {
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  keycloakLoginToWorkspace,
  LOCALE,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const WORKSPACE_SETTINGS_STORY = loadStoryDefinitionSync('workspace-settings-save-and-effect');
const WORKSPACE_SETTINGS_BINDING = buildTraceStoryBinding(WORKSPACE_SETTINGS_STORY);
const WORKSPACE_ID = WORKSPACE_SETTINGS_STORY.seedData?.[0];

type WorkspaceSettingsRuntime = {
  creatorEmail: string;
  projectNamePrefix: string;
};

function requireWorkspaceId(): string {
  if (typeof WORKSPACE_ID !== 'string' || WORKSPACE_ID.trim().length === 0) {
    throw new Error('missing_workspace_settings_workspace_seed');
  }
  return WORKSPACE_ID;
}

function requireWorkspaceSettingsRuntime(): WorkspaceSettingsRuntime {
  const runtimeRoot = WORKSPACE_SETTINGS_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.workspaceSettingsSaveEffect as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_workspace_settings_save_effect_runtime');
  }
  for (const field of ['creatorEmail', 'projectNamePrefix'] as const) {
    if (typeof runtime[field] !== 'string' || runtime[field].trim().length === 0) {
      throw new Error(`missing_workspace_settings_save_effect_runtime:${field}`);
    }
  }
  return runtime as unknown as WorkspaceSettingsRuntime;
}

test.describe('@lane-real integration workspace settings directory search', () => {
  test('workspace settings saves project creators and the effect is immediately usable', async ({ page }) => {
    test.setTimeout(240_000);
    const runtime = requireWorkspaceSettingsRuntime();
    const workspaceId = requireWorkspaceId();
    const projectName = `${runtime.projectNamePrefix} ${Date.now()}`;
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-workspace-settings-directory',
      storyId: WORKSPACE_SETTINGS_STORY.storyId,
      title: WORKSPACE_SETTINGS_STORY.title,
      actor: WORKSPACE_SETTINGS_STORY.actor,
      route: WORKSPACE_SETTINGS_STORY.entryRoute,
      specFile: 'e2e/integration-workspace-settings-directory.spec.ts',
      browser: 'chromium',
      goal: WORKSPACE_SETTINGS_STORY.goal,
      preconditions: [...(WORKSPACE_SETTINGS_STORY.preconditions ?? [])],
      seedData: [...(WORKSPACE_SETTINGS_STORY.seedData ?? [])],
      storyBinding: WORKSPACE_SETTINGS_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await ensureIntegrationKeycloakUsers();
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);

      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/settings`);
      await expect(page.getByTestId('ws-settings__project-creators')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'open-workspace-settings' });

      const searchInput = page.getByTestId('ws-settings__project-creators-input');
      await searchInput.fill(runtime.creatorEmail);

      const creatorOption = page.getByTestId('ws-settings__project-creators-results').getByRole('button', {
        name: new RegExp(runtime.creatorEmail.replace('.', '\\.')),
      });
      await expect(creatorOption).toBeVisible({ timeout: 15_000 });
      await creatorOption.click();
      await page.getByTestId('ws-settings__project-creators-save').click();
      await expect(page.getByTestId('ws-settings__project-creators-selected')).toContainText(runtime.creatorEmail, {
        timeout: 20_000,
      });
      await trace.capture(page, { stepId: 'save-project-creator' });

      await keycloakLoginToWorkspace(
        page,
        workspaceId,
        KEYCLOAK_INTEGRATION_USER_USERNAME,
        KEYCLOAK_INTEGRATION_USER_PASSWORD,
        { ensureProjectCreatorAccess: false },
      );
      await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
      const createButton = page.getByTestId('projects__create-btn');
      await expect(createButton).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'verify-project-creator-effect' });

      await createButton.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.locator('#project-name').fill(projectName);
      await Promise.all([
        page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/.+/overview(?:$|\\?)`), {
          timeout: 30_000,
        }),
        dialog.getByRole('button', { name: /Create|创建/i }).click(),
      ]);
      await expect(page.getByTestId('project-overview__page')).toBeVisible({ timeout: 30_000 });
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
