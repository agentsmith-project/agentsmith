import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  API_BASE,
  createFileLibraryViaUi,
  createProjectInWorkspace,
  createTempMountDir,
  keycloakLoginToWorkspace,
  mountJuiceFs,
  writeMountedFile,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

test.describe('@lane-real files web/local mount sync', () => {
  test('syncs local JuiceFS mount changes with the Files UI in both directions', async ({ page }) => {
    test.setTimeout(720_000);
    const workspaceId = 'ws_default';
    const libraryName = `Mount Sync ${Date.now()}`;

    await keycloakLoginToWorkspace(page, workspaceId);
    const { projectId } = await createProjectInWorkspace(page, workspaceId, 'File Sync');
    await createFileLibraryViaUi(page, workspaceId, projectId, libraryName);

    const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: libraryName }).first();
    await libraryItem.click();
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
      await writeMountedFile(mountPoint, 'from-local.txt', 'hello-from-local\n');
      await expect(
        page.getByTestId('files__object-row').filter({ hasText: 'from-local.txt' }).first(),
      ).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('files__upload').click({ force: true });
      await page.locator('input[type="file"]').setInputFiles({
        name: 'from-web.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello-from-web\n', 'utf-8'),
      });
      await expect(
        page.getByTestId('files__object-row').filter({ hasText: 'from-web.txt' }).first(),
      ).toBeVisible({ timeout: 30_000 });

      await expect.poll(
        async () => {
          const content = await readFile(path.join(mountPoint, 'from-web.txt'), 'utf-8').catch(() => null);
          return content;
        },
        { timeout: 30_000 },
      ).toBe('hello-from-web\n');

      const deleteButton = libraryItem.getByRole('button', { name: /delete/i });
      await deleteButton.click({ force: true });
      const deleteDialog = page.getByTestId('files__dialog__library-delete');
      await expect(deleteDialog).toBeVisible({ timeout: 30_000 });
      await deleteDialog.getByTestId('files__library-delete__confirm').fill(libraryName);
      await deleteDialog.getByTestId('files__library-delete__submit').click();
      await expect(deleteDialog).toBeVisible();

    } finally {
      await unmount();
    }
  });
});
