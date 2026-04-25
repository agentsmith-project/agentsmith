import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  createFileLibraryViaUi,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
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

type ContentDispositionFilename = {
  source: 'filename' | 'filename_star';
  value: string;
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

function stripContentDispositionQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

function extractFilenameFromContentDisposition(header: string | null | undefined): ContentDispositionFilename | null {
  if (typeof header !== 'string' || header.trim().length === 0) {
    return null;
  }

  const filenameStarMatch = header.match(/(?:^|;)\s*filename\*\s*=\s*([^;]+)/i);
  if (filenameStarMatch) {
    const encodedValue = stripContentDispositionQuotes(filenameStarMatch[1]);
    const rfc5987Match = encodedValue.match(/^([^']*)'[^']*'(.*)$/);
    const encodedFilename = rfc5987Match ? rfc5987Match[2] : encodedValue;
    try {
      return {
        source: 'filename_star',
        value: decodeURIComponent(encodedFilename),
      };
    } catch {
      return {
        source: 'filename_star',
        value: encodedFilename,
      };
    }
  }

  const filenameMatch = header.match(/(?:^|;)\s*filename\s*=\s*("(?:[^"\\]|\\.)*"|[^;]+)/i);
  if (!filenameMatch) {
    return null;
  }

  return {
    source: 'filename',
    value: stripContentDispositionQuotes(filenameMatch[1]),
  };
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
    const unicodeToken = Date.now();
    const unicodeUploadFileName = `客户周报-${unicodeToken}.txt`;
    const unicodeContent = `Round-trip verification ${unicodeToken}\n报告内容：跨边界文件可靠性校验`;
    const unicodeRenamedFileName = `已归档-季度总结-${unicodeToken}.txt`;
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
      const createFolderResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes(`/workspaces/${workspaceId}/projects/${projectId}/file-libraries/`)
        && response.url().includes('/folders')
      ));
      await page.getByTestId('files__dialog__new-folder').getByRole('button', { name: /Create|创建/i }).click();
      const createFolderResponse = await createFolderResponsePromise;
      expect(createFolderResponse.status()).toBe(204);
      await expect(page.getByRole('button', { name: folderName }).first()).toHaveCount(1, { timeout: 30_000 });
      await page.getByRole('button', { name: /^root$/i }).click();
      await expect(page.getByRole('button', { name: /^root$/i })).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator('[data-testid="files__object-row"]').filter({ hasText: folderName }).first(),
      ).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('files__upload').click();
      await page.locator('input[type="file"]').setInputFiles({
        name: unicodeUploadFileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(unicodeContent, 'utf-8'),
      });
      await expect(page.locator('text=' + unicodeUploadFileName)).toBeVisible({ timeout: 30_000 });

      const uploadedRow = page
        .locator('[data-testid="files__object-row"]')
        .filter({ hasText: unicodeUploadFileName })
        .first();
      await uploadedRow.getByRole('button').click({ modifiers: [multiSelectModifier] });
      await uploadedRow.locator('input[type="checkbox"]').check();

      await page.getByTestId('files__rename').click();
      await page.getByTestId('files__move__dest-prefix').fill(`${folderName}/`);
      await page.getByTestId('files__move__name').fill(unicodeRenamedFileName);
      await page.getByTestId('files__move__submit').click();
      await expect(
        page.locator('[data-testid="files__object-row"]').filter({ hasText: unicodeUploadFileName }),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-testid="files__object-row"]').filter({ hasText: unicodeRenamedFileName }),
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
        .filter({ hasText: unicodeRenamedFileName })
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
      const downloadResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'GET'
        && response.url().includes(`/workspaces/${workspaceId}/projects/${projectId}/file-libraries/`)
        && response.url().includes('/download')
        && response.status() === 200
      ));
      await page.getByTestId('files__download').click();
      const uiDownloadResponse = await downloadResponsePromise;
      expect(uiDownloadResponse.ok()).toBeTruthy();
      expect(uiDownloadResponse.url()).toContain(`path=${encodeURIComponent(`${folderName}/${unicodeRenamedFileName}`)}`);
      expect(uiDownloadResponse.headers()['content-type']).toContain('text/');
      const authToken = await readStoredAuthToken(page);
      expect(authToken).toBeTruthy();
      const verifiedDownload = await page.request.get(uiDownloadResponse.url(), {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      expect(verifiedDownload.ok()).toBeTruthy();
      const contentDisposition = verifiedDownload.headers()['content-disposition']
        ?? uiDownloadResponse.headers()['content-disposition']
        ?? null;
      expect(contentDisposition).toBeTruthy();
      expect(contentDisposition?.toLowerCase()).toContain('attachment');
      expect(contentDisposition).toMatch(/(?:^|;)\s*filename\*?\s*=/i);
      const downloadedFilename = extractFilenameFromContentDisposition(contentDisposition);
      expect(downloadedFilename).toBeTruthy();
      expect(downloadedFilename?.value).toBe(unicodeRenamedFileName);
      await expect(verifiedDownload.text()).resolves.toBe(unicodeContent);
      await expect(movedCheckbox).toBeChecked();
      await page.getByTestId('files__delete').click();
      await page.getByTestId('files__dialog__delete').getByRole('button', { name: /Delete|删除/i }).click();
      await expect(page.locator('text=' + unicodeRenamedFileName)).toHaveCount(0);
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
