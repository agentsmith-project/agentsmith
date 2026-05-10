import { expect, test } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  createFileLibraryViaUi,
  createProjectInWorkspace,
  keycloakLoginToWorkspace,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import { readStoredAuthToken } from './integration-workspace-access';

const FILES_CRUD_SYNC_STORY = loadStoryDefinitionSync('files-crud-and-sync');
const FILES_CRUD_SYNC_BINDING = buildTraceStoryBinding(FILES_CRUD_SYNC_STORY);
const WORKSPACE_ID = FILES_CRUD_SYNC_STORY.seedData?.[0];

type FilesCrudRuntime = {
  projectNamePrefix: string;
  libraryNamePrefix: string;
  uploadFileName: string;
  uploadContent: string;
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
    'uploadFileName',
    'uploadContent',
  ] as const;
  for (const field of fields) {
    if (typeof webCrud[field] !== 'string' || webCrud[field].trim().length === 0) {
      throw new Error(`missing_files_crud_sync_runtime:webCrud.${field}`);
    }
  }

  return webCrud as unknown as FilesCrudRuntime;
}

test.describe('@lane-real files connector surface absence', () => {
  test('keeps Files usable through Web/API without local connector entry points', async ({ page }) => {
    test.setTimeout(300_000);
    const runtime = requireFilesCrudRuntime();
    const workspaceId = requireWorkspaceId();
    const libraryName = `${runtime.libraryNamePrefix} ${Date.now()}`;
    const uploadName = `${Date.now()}-${runtime.uploadFileName}`;
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-files-connector-absence',
      storyId: FILES_CRUD_SYNC_STORY.storyId,
      title: FILES_CRUD_SYNC_STORY.title,
      actor: FILES_CRUD_SYNC_STORY.actor,
      route: FILES_CRUD_SYNC_STORY.entryRoute,
      specFile: 'e2e/integration-files-connector-absence.spec.ts',
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
      const libraryId = await createFileLibraryViaUi(page, workspaceId, projectId, libraryName);

      const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: libraryName }).first();
      await expect(libraryItem).toBeVisible({ timeout: 30_000 });
      await libraryItem.click();
      await expect(page.locator('[data-testid^="files__library-desktop-access--"]')).toHaveCount(0);
      await expect(page.getByTestId('files__dialog__desktop-mount-access')).toHaveCount(0);
      await trace.capture(page, { stepId: 'open-files-library' });

      const token = await readStoredAuthToken(page);
      for (const suffix of ['backend', 'storage-credential-exchange', 'desktop-mount-access']) {
        const response = await page.request.fetch(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/${suffix}`,
          {
            method: suffix === 'backend' ? 'GET' : 'POST',
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        expect(response.status(), suffix).toBe(404);
      }

      await page.getByTestId('files__upload').click({ force: true });
      await page.locator('input[type="file"]').setInputFiles({
        name: uploadName,
        mimeType: 'text/plain',
        buffer: Buffer.from(runtime.uploadContent, 'utf-8'),
      });
      await expect(
        page.getByTestId('files__object-row').filter({ hasText: uploadName }).first(),
      ).toBeVisible({ timeout: 30_000 });
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
