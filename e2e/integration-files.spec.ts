import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  createFileLibraryViaUi,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const FILES_CRUD_SYNC_STORY = loadStoryDefinitionSync('files-crud-and-sync');
const FILES_CRUD_SYNC_BINDING = buildTraceStoryBinding(FILES_CRUD_SYNC_STORY);
const WORKSPACE_ID = FILES_CRUD_SYNC_STORY.seedData?.[0];

type FilesCrudRuntime = {
  projectNamePrefix: string;
  libraryNamePrefix: string;
  folderNamePrefix: string;
  uploadFileName: string;
  uploadContent: string;
  renamedFileName: string;
};

function requireWorkspaceId(): string {
  if (typeof WORKSPACE_ID !== 'string' || WORKSPACE_ID.trim().length === 0) {
    throw new Error('missing_files_crud_sync_workspace_seed');
  }
  return WORKSPACE_ID;
}

function requireFilesCrudRuntime(): FilesCrudRuntime {
  const runtimeRoot = FILES_CRUD_SYNC_STORY.runtimeData as Record<string, unknown> | undefined;
  const filesCrudSync = runtimeRoot?.filesCrudSync as Record<string, unknown> | undefined;
  const webCrud = filesCrudSync?.webCrud as Record<string, unknown> | undefined;
  if (!webCrud) {
    throw new Error('missing_files_crud_sync_runtime:webCrud');
  }

  const fields = [
    'projectNamePrefix',
    'libraryNamePrefix',
    'folderNamePrefix',
    'uploadFileName',
    'uploadContent',
    'renamedFileName',
  ] as const;
  for (const field of fields) {
    if (typeof webCrud[field] !== 'string' || webCrud[field].trim().length === 0) {
      throw new Error(`missing_files_crud_sync_runtime:webCrud.${field}`);
    }
  }

  return webCrud as unknown as FilesCrudRuntime;
}

async function dismissOpenFilesDialogs(page: Page) {
  const libraryDeleteConfirm = page.getByTestId('files__library-delete__confirm');
  if (await libraryDeleteConfirm.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(libraryDeleteConfirm).toHaveCount(0);
  }

  const objectDeleteDialog = page.getByTestId('files__dialog__delete');
  if (await objectDeleteDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(objectDeleteDialog).toHaveCount(0);
  }
}

test.describe('@lane-real files integration flow', () => {
  test('keycloak login, create project, and complete files object-browser CRUD', async ({ page }) => {
    test.setTimeout(240_000);
    const multiSelectModifier: 'Control' | 'Meta' = process.platform === 'darwin' ? 'Meta' : 'Control';
    const runtime = requireFilesCrudRuntime();
    const workspaceId = requireWorkspaceId();
    const folderName = `${runtime.folderNamePrefix}-${Date.now()}`;
    const libraryName = `${runtime.libraryNamePrefix} ${Date.now()}`;
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-files',
      storyId: FILES_CRUD_SYNC_STORY.storyId,
      title: FILES_CRUD_SYNC_STORY.title,
      actor: FILES_CRUD_SYNC_STORY.actor,
      route: FILES_CRUD_SYNC_STORY.entryRoute,
      specFile: 'e2e/integration-files.spec.ts',
      browser: 'chromium',
      goal: FILES_CRUD_SYNC_STORY.goal,
      preconditions: [...(FILES_CRUD_SYNC_STORY.preconditions ?? [])],
      seedData: [...(FILES_CRUD_SYNC_STORY.seedData ?? [])],
      storyBinding: FILES_CRUD_SYNC_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await keycloakLoginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      const { projectId } = await createProjectInWorkspace(page, workspaceId, runtime.projectNamePrefix);
      await createFileLibraryViaUi(page, workspaceId, projectId, libraryName);

      const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: libraryName }).first();
      await expect(libraryItem).toBeVisible({ timeout: 30_000 });
      await libraryItem.click();
      await dismissOpenFilesDialogs(page);
      await trace.capture(page, { stepId: 'open-files-library' });

      await page.getByTestId('files__new-folder').click();
      await page.getByTestId('files__dialog__new-folder').locator('input').fill(folderName);
      await page.getByTestId('files__dialog__new-folder').getByRole('button', { name: /Create|创建/i }).click();
      await expect(page.getByRole('button', { name: folderName }).first()).toHaveCount(1, { timeout: 30_000 });
      await page.getByRole('button', { name: /^root$/i }).click();
      await expect(page.getByRole('button', { name: /^root$/i })).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator('[data-testid="files__object-row"]').filter({ hasText: folderName }).first(),
      ).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('files__upload').click();
      await page.locator('input[type="file"]').setInputFiles({
        name: runtime.uploadFileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(runtime.uploadContent, 'utf-8'),
      });
      await expect(page.locator('text=' + runtime.uploadFileName)).toBeVisible({ timeout: 30_000 });

      const uploadedRow = page
        .locator('[data-testid="files__object-row"]')
        .filter({ hasText: runtime.uploadFileName })
        .first();
      await uploadedRow.getByRole('button').click({ modifiers: [multiSelectModifier] });
      await uploadedRow.locator('input[type="checkbox"]').check();

      await page.getByTestId('files__rename').click();
      await page.getByTestId('files__move__dest-prefix').fill(`${folderName}/`);
      await page.getByTestId('files__move__name').fill(runtime.renamedFileName);
      await page.getByTestId('files__move__submit').click();
      await expect(
        page.locator('[data-testid="files__object-row"]').filter({ hasText: runtime.uploadFileName }),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-testid="files__object-row"]').filter({ hasText: runtime.renamedFileName }),
      ).toHaveCount(0);

      await page.keyboard.press('Escape');
      await page
        .locator('[data-testid="files__object-row"]')
        .filter({ hasText: folderName })
        .first()
        .locator('button')
        .first()
        .dblclick();
      const movedRow = page
        .locator('[data-testid="files__object-row"]')
        .filter({ hasText: runtime.renamedFileName })
        .first();
      await expect(movedRow).toBeVisible({ timeout: 30_000 });
      await movedRow.getByRole('button').click({ modifiers: [multiSelectModifier] });
      const movedCheckbox = movedRow.locator('input[type="checkbox"]');
      await movedCheckbox.check();
      await expect(movedCheckbox).toBeChecked();

      await expect(page.getByTestId('files__details-panel')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('files__details-share').click();
      await expect(page.getByTestId('files__dialog__share-link')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('files__share-generate').click();
      await expect(page.getByTestId('files__share-link-value')).toBeVisible({ timeout: 30_000 });
      await page.keyboard.press('Escape');
      await movedRow.getByRole('button').click({ modifiers: [multiSelectModifier] });
      await expect(movedCheckbox).toBeChecked();
      await page.getByTestId('files__delete').click();
      await page.getByTestId('files__dialog__delete').getByRole('button', { name: /Delete|删除/i }).click();
      await expect(page.locator('text=' + runtime.renamedFileName)).toHaveCount(0);
      await trace.capture(page, { stepId: 'manage-files-from-web' });
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
