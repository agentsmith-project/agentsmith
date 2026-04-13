import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  createFileLibraryViaUi,
  createProjectInWorkspace,
  createTempMountDir,
  keycloakLoginToWorkspace,
  mountJuiceFs,
  writeMountedFile,
} from './integration-real-helpers';
import { buildTraceStoryBinding } from './story-trace-binding';
import { loadStoryDefinitionSync } from './story-loader';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import { readStoredAuthToken } from './integration-workspace-access';

const FILES_CRUD_SYNC_STORY = loadStoryDefinitionSync('files-crud-and-sync');
const FILES_CRUD_SYNC_BINDING = buildTraceStoryBinding(FILES_CRUD_SYNC_STORY);
const WORKSPACE_ID = FILES_CRUD_SYNC_STORY.seedData?.[0];

type FilesMountSyncRuntime = {
  projectNamePrefix: string;
  libraryNamePrefix: string;
  localFileName: string;
  localContent: string;
  webFileName: string;
  webContent: string;
};

function requireWorkspaceId(): string {
  if (typeof WORKSPACE_ID !== 'string' || WORKSPACE_ID.trim().length === 0) {
    throw new Error('missing_files_crud_sync_workspace_seed');
  }
  return WORKSPACE_ID;
}

function requireFilesMountSyncRuntime(): FilesMountSyncRuntime {
  const runtimeRoot = FILES_CRUD_SYNC_STORY.runtimeData as Record<string, unknown> | undefined;
  const filesCrudSync = runtimeRoot?.filesCrudSync as Record<string, unknown> | undefined;
  const mountSync = filesCrudSync?.mountSync as Record<string, unknown> | undefined;
  if (!mountSync) {
    throw new Error('missing_files_crud_sync_runtime:mountSync');
  }

  const fields = [
    'projectNamePrefix',
    'libraryNamePrefix',
    'localFileName',
    'localContent',
    'webFileName',
    'webContent',
  ] as const;
  for (const field of fields) {
    if (typeof mountSync[field] !== 'string' || mountSync[field].trim().length === 0) {
      throw new Error(`missing_files_crud_sync_runtime:mountSync.${field}`);
    }
  }

  return mountSync as unknown as FilesMountSyncRuntime;
}

test.describe('@lane-real files web/local mount sync', () => {
  test('syncs local JuiceFS mount changes with the Files UI in both directions', async ({ page }) => {
    test.setTimeout(720_000);
    const runtime = requireFilesMountSyncRuntime();
    const workspaceId = requireWorkspaceId();
    const libraryName = `${runtime.libraryNamePrefix} ${Date.now()}`;
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-files-mount-sync',
      storyId: FILES_CRUD_SYNC_STORY.storyId,
      title: FILES_CRUD_SYNC_STORY.title,
      actor: FILES_CRUD_SYNC_STORY.actor,
      route: FILES_CRUD_SYNC_STORY.entryRoute,
      specFile: 'e2e/integration-files-mount-sync.spec.ts',
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
      await libraryItem.click();
      await trace.capture(page, { stepId: 'open-files-library' });
      const libraryId = (await libraryItem.getAttribute('data-testid'))?.replace('files__library-item--', '');
      expect(libraryId).toBeTruthy();
      const token = await readStoredAuthToken(page);
      const exchangeRes = await page.request.post(
        `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/file-libraries/${libraryId}/storage-credential-exchange`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(exchangeRes.ok()).toBeTruthy();
      const exchangeBody = (await exchangeRes.json()) as {
        client_mount_access: { metadata_url: string; storage_bucket_url?: string };
      };
      const metadataUrl = exchangeBody.client_mount_access.metadata_url;

      const mountRoot = await createTempMountDir('agentsmith-filelib-ui-sync-');
      const mountPoint = path.join(mountRoot, 'mount');
      const unmount = await mountJuiceFs(metadataUrl, mountPoint, exchangeBody.client_mount_access.storage_bucket_url);

      try {
        await writeMountedFile(mountPoint, runtime.localFileName, runtime.localContent);
        await expect(
          page.getByTestId('files__object-row').filter({ hasText: runtime.localFileName }).first(),
        ).toBeVisible({ timeout: 30_000 });

        await page.getByTestId('files__upload').click({ force: true });
        await page.locator('input[type="file"]').setInputFiles({
          name: runtime.webFileName,
          mimeType: 'text/plain',
          buffer: Buffer.from(runtime.webContent, 'utf-8'),
        });
        await expect(
          page.getByTestId('files__object-row').filter({ hasText: runtime.webFileName }).first(),
        ).toBeVisible({ timeout: 30_000 });

        await expect.poll(
          async () => {
            const content = await readFile(path.join(mountPoint, runtime.webFileName), 'utf-8').catch(() => null);
            return content;
          },
          { timeout: 30_000 },
        ).toBe(runtime.webContent);
        await trace.capture(page, { stepId: 'verify-web-desktop-sync' });
        outcome = 'pass';
      } finally {
        await unmount();
      }
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
