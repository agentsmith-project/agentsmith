import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
} from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const FILES_LIBRARY_STORY = loadStoryDefinitionSync('files-library-access-and-recovery');
const FILES_LIBRARY_BINDING = buildTraceStoryBinding(FILES_LIBRARY_STORY);

type ReadyLibraryFixture = {
  workspaceId: string;
  projectId: string;
  libraryId: string;
  name: string;
  createdByUserId: string;
};

type DegradedLibraryFixture = {
  id: string;
  name: string;
  workspaceId: string;
  projectId: string;
};

type FilesLibraryRuntime = {
  degradedLibraryNamePrefix: string;
  degradedLibraryDescription: string;
};

function resolveFilesLibraryStep(stepId: string) {
  const step = FILES_LIBRARY_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_files_library_step:${stepId}`);
  }
  return step;
}

function requireFilesLibraryRuntime(): FilesLibraryRuntime {
  const runtimeRoot = FILES_LIBRARY_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.filesLibraryAccessRecovery as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_files_library_runtime_data');
  }
  for (const key of ['degradedLibraryNamePrefix', 'degradedLibraryDescription'] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_files_library_runtime_data:${key}`);
    }
  }
  return runtime as unknown as FilesLibraryRuntime;
}

function runMongoEval(script: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      'mbos-mongo',
      'mongosh',
      '-u',
      'mbos',
      '-p',
      'mbos_dev_password',
      '--authenticationDatabase',
      'admin',
      '--quiet',
      '--eval',
      script,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
    },
  ).trim();
}

function findReadyLibraryFixture(): ReadyLibraryFixture {
  const raw = runMongoEval(
    [
      "const rows = db.getSiblingDB('mbos').project_file_libraries.find(",
      "  { workspace_id: 'ws_default', status: 'ready' },",
      "  { workspace_id: 1, project_id: 1, id: 1, name: 1, created_by_user_id: 1, created_at: 1 }",
      ").sort({ created_at: -1 }).limit(1).toArray();",
      'print(JSON.stringify(rows));',
    ].join(' '),
  );
  const parsed = JSON.parse(raw) as Array<{
    workspace_id?: string;
    project_id?: string;
    id?: string;
    name?: string;
    created_by_user_id?: string;
  }>;
  const fixture = parsed[0];
  if (!fixture?.workspace_id || !fixture.project_id || !fixture.id || !fixture.name || !fixture.created_by_user_id) {
    throw new Error('files_management_ux_ready_library_missing');
  }
  return {
    workspaceId: fixture.workspace_id,
    projectId: fixture.project_id,
    libraryId: fixture.id,
    name: fixture.name,
    createdByUserId: fixture.created_by_user_id,
  };
}

function insertTemporaryDegradedLibrary(base: ReadyLibraryFixture, runtime: FilesLibraryRuntime): DegradedLibraryFixture {
  const id = `flib_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const name = `${runtime.degradedLibraryNamePrefix} ${Date.now()}`;
  const now = new Date().toISOString();
  runMongoEval(
    [
      "db.getSiblingDB('mbos').project_file_libraries.insertOne(",
      JSON.stringify({
        id,
        workspace_id: base.workspaceId,
        project_id: base.projectId,
        name,
        description: runtime.degradedLibraryDescription,
        status: 'degraded',
        filesystem_name: `release_ux_${id}`,
        created_by_user_id: base.createdByUserId,
        created_at: now,
        updated_at: now,
      }),
      ');',
    ].join(' '),
  );
  return {
    id,
    name,
    workspaceId: base.workspaceId,
    projectId: base.projectId,
  };
}

function deleteTemporaryLibrary(libraryId: string): void {
  runMongoEval(
    [
      "db.getSiblingDB('mbos').project_file_libraries.deleteOne(",
      JSON.stringify({ id: libraryId }),
      ');',
    ].join(' '),
  );
}

async function loginThroughWorkspaceSelection(page: Page, workspaceId: string) {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/login/workspace`);
  await expect(page.getByTestId(`workspace-select__item--${workspaceId}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`workspace-select__item--${workspaceId}`).click();

  await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('workspace-login__keycloak-btn').click();
  await page.waitForURL(/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i, {
    timeout: 30_000,
  });
  await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(KEYCLOAK_DEV_ADMIN_USERNAME);
  await page.locator('input#password, input[name="password"]').first().fill(KEYCLOAK_DEV_ADMIN_PASSWORD);
  await page.locator('#kc-login, button[type="submit"]').first().click();
  await expect
    .poll(() => page.url(), { timeout: 60_000 })
    .toMatch(new RegExp(`/${LOCALE}/workspaces/${workspaceId}(?:$|/projects)`));
}

test.describe('@lane-real files management UX walkthrough', () => {
  let readyLibrary: ReadyLibraryFixture;
  let degradedLibrary: DegradedLibraryFixture;
  const runtime = requireFilesLibraryRuntime();

  test.beforeAll(() => {
    readyLibrary = findReadyLibraryFixture();
    degradedLibrary = insertTemporaryDegradedLibrary(readyLibrary, runtime);
  });

  test.afterAll(() => {
    deleteTemporaryLibrary(degradedLibrary.id);
  });

  test('shows ready and degraded file libraries with operator-friendly recovery UX', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-files-management-ux',
      storyId: FILES_LIBRARY_STORY.storyId,
      title: FILES_LIBRARY_STORY.title,
      actor: FILES_LIBRARY_STORY.actor,
      route: `/${LOCALE}/workspaces/${readyLibrary.workspaceId}/projects/${readyLibrary.projectId}/files`,
      specFile: 'e2e/integration-files-management-ux.spec.ts',
      browser: 'chromium',
      goal: FILES_LIBRARY_STORY.goal,
      preconditions: [...(FILES_LIBRARY_STORY.preconditions ?? [])],
      seedData: [...(FILES_LIBRARY_STORY.seedData ?? [])],
      storyBinding: FILES_LIBRARY_BINDING,
    });
    const captureTrace = async (stepId: string): Promise<void> => {
      const storyStep = resolveFilesLibraryStep(stepId);
      await trace.capture(page, {
        stepId,
        action: storyStep.action,
        target: storyStep.target,
        note: storyStep.note ?? storyStep.expectedFeedback,
      });
    };
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await loginThroughWorkspaceSelection(page, readyLibrary.workspaceId);
      await page.goto(`/${LOCALE}/workspaces/${readyLibrary.workspaceId}/projects/${readyLibrary.projectId}/files`);

      const readyCard = page.getByTestId(`files__library-item--${readyLibrary.libraryId}`);
      await expect(readyCard).toBeVisible({ timeout: 30_000 });
      await readyCard.click();

      await expect(page.getByTestId(`files__library-status--${readyLibrary.libraryId}`)).toContainText('Ready');
      await expect(page.getByTestId(`files__library-desktop-access--${readyLibrary.libraryId}`)).toBeEnabled();
      await expect(page.getByTestId(`files__library-manual-mount-access--${readyLibrary.libraryId}`)).toHaveCount(0);
      await expect(page.getByTestId('files__library-unavailable-empty-state')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('files.file_manager.loading');
      await page.screenshot({ path: testInfo.outputPath('files-ready-overview.png'), fullPage: true });
      await captureTrace('open-files-library');

      await page.getByTestId(`files__library-desktop-access--${readyLibrary.libraryId}`).click();
      const desktopDialog = page.getByTestId('files__dialog__desktop-mount-access');
      await expect(desktopDialog).toBeVisible();
      await expect(desktopDialog).toContainText('AgentSmith Desktop');
      await expect(page.getByTestId('files__desktop-setup__download')).toBeVisible();
      await expect(page.getByTestId('files__desktop-mount__deployment-url')).toHaveValue(/https?:\/\/.+/);
      await expect(page.getByTestId('files__desktop-setup__debug-panel')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('files-ready-desktop-dialog.png'), fullPage: true });

      await page.getByTestId('files__desktop-setup__platform-windows').click();
      await expect(page.getByTestId('files__desktop-setup__platform-windows')).toHaveAttribute('data-state', 'active');
      await page.screenshot({ path: testInfo.outputPath('files-ready-desktop-dialog-windows.png'), fullPage: true });

      await page.getByTestId('files__desktop-setup__debug-toggle').click();
      await expect(page.getByTestId('files__desktop-setup__debug-panel')).toBeVisible();
      await expect(page.getByTestId('files__library-mount__filesystem-name')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('files-ready-desktop-dialog-debug.png'), fullPage: true });
      await captureTrace('review-desktop-access');
      await page.keyboard.press('Escape');
      await expect(desktopDialog).toHaveCount(0);

      const degradedCard = page.getByTestId(`files__library-item--${degradedLibrary.id}`);
      await expect(degradedCard).toBeVisible({ timeout: 30_000 });
      await degradedCard.click();

      await expect(page.getByTestId(`files__library-status--${degradedLibrary.id}`)).toContainText('Degraded');
      await expect(page.getByTestId(`files__library-status-reason--${degradedLibrary.id}`)).toContainText(
        'This library needs attention before you rely on it for local mounts.',
      );
      await expect(page.getByTestId(`files__library-desktop-access--${degradedLibrary.id}`)).toBeDisabled();
      await expect(page.getByTestId(`files__library-manual-mount-access--${degradedLibrary.id}`)).toHaveCount(0);
      await expect(page.getByTestId('files__library-unavailable-empty-state')).toBeVisible();
      await expect(page.getByTestId('files__library-unavailable-empty-state')).toContainText(
        'This library is not ready for browsing or local mounts.',
      );
      await expect(page.getByTestId('files__library-unavailable-empty-state')).toContainText(
        'delete the broken record and create a new one',
      );
      await expect(page.locator('body')).not.toContainText('files.file_manager.loading');
      await page.screenshot({ path: testInfo.outputPath('files-degraded-overview.png'), fullPage: true });

      await page.getByTestId(`files__library-delete-inline--${degradedLibrary.id}`).click();
      const deleteDialog = page.getByTestId('files__dialog__library-delete');
      await expect(deleteDialog).toBeVisible();
      await expect(deleteDialog).toContainText(
        `Delete "${degradedLibrary.name}" if you want to clean up the broken record, then create a new library if you still need it.`,
      );
      await expect(page.getByTestId('files__library-delete__warning')).toContainText(
        'Recovery action: this removes the broken library record.',
      );
      await page.screenshot({ path: testInfo.outputPath('files-degraded-delete-dialog.png'), fullPage: true });
      await captureTrace('review-degraded-recovery');
      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
    }
  });
});
