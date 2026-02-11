/**
 * Sources Page – E2E Tests (Object Browser)
 *
 * This suite validates the MinIO-like file manager UX over MSW:
 * - libraries list
 * - browse folder via prefix rows and breadcrumb
 * - create folder
 * - upload / rename / delete / download object
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Sources Page (object browser)', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'sources');
  });

  test('renders libraries and objects table', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('sources__library-list')).toBeVisible();
    await expect(authedPage.getByTestId('sources__objects-table')).toBeVisible();
    await expect(authedPage.getByTestId('sources__object-row').first()).toBeVisible();
  });

  test('can browse into a folder and back to root via breadcrumb', async ({ authedPage }) => {
    const docsRow = authedPage.getByTestId('sources__object-row').filter({ hasText: 'docs' }).first();
    await expect(docsRow).toBeVisible();
    await docsRow.getByRole('button').click();

    await expect(authedPage.getByTestId('sources__breadcrumb-root')).toBeVisible();
    // After navigating into docs/, the root breadcrumb remains clickable.
    await authedPage.getByTestId('sources__breadcrumb-root').click();
    await expect(authedPage.getByTestId('sources__objects-table')).toBeVisible();
  });

  test('can navigate to parent folder via go-up action', async ({ authedPage }) => {
    const docsRow = authedPage.getByTestId('sources__object-row').filter({ hasText: 'docs' }).first();
    await expect(docsRow).toBeVisible();
    await docsRow.getByRole('button').click();

    await expect(authedPage.getByTestId('sources__go-up')).toBeVisible();
    await authedPage.getByTestId('sources__go-up').click();
    await expect(authedPage.getByTestId('sources__object-row').filter({ hasText: 'docs' }).first()).toBeVisible();
  });

  test('create folder navigates into it', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__new-folder').click();
    const dialog = authedPage.getByTestId('sources__dialog__new-folder');
    await expect(dialog).toBeVisible();

    const name = `e2e-folder-${Date.now()}`;
    await dialog.getByRole('textbox').fill(name);
    await dialog.getByRole('button', { name: /create/i }).click();

    // Breadcrumb should include the created folder name.
    await expect(authedPage.getByText(name).first()).toBeVisible();
  });

  test('upload object and rename it', async ({ authedPage }) => {
    // Upload
    await authedPage.getByTestId('sources__upload').click();
    const fileInput = authedPage.locator('input[type="file"]');
    await fileInput.setInputFiles([
      {
        name: 'e2e-upload.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello-upload'),
      },
    ]);

    // Wait for row to appear.
    const uploadedRow = authedPage.getByTestId('sources__object-row').filter({ hasText: 'e2e-upload.txt' }).first();
    await expect(uploadedRow).toBeVisible({ timeout: 10_000 });

    // Select by clicking the row name button (object rows toggle selection).
    await uploadedRow.getByRole('button').click();

    // Rename
    await authedPage.getByTestId('sources__rename').click();
    const dialog = authedPage.getByTestId('sources__dialog__move');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('sources__move__name').fill('e2e-renamed.txt');
    await dialog.getByTestId('sources__move__submit').click();

    await expect(authedPage.getByTestId('sources__object-row').filter({ hasText: 'e2e-renamed.txt' }).first()).toBeVisible();
  });

  test('can cancel an in-progress upload', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'slow-upload.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('slow-upload-content'),
      },
    ]);

    await expect(authedPage.getByTestId('sources__upload-progress')).toBeVisible();
    await authedPage.getByTestId('sources__upload-cancel').click();

    await expect(authedPage.getByTestId('sources__upload-progress')).toHaveCount(0);
    await expect(
      authedPage.getByTestId('sources__object-row').filter({ hasText: 'slow-upload.txt' }).first(),
    ).toHaveCount(0);
  });

  test('handles upload conflicts with keep-both rename', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'README.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('conflict-rename'),
      },
    ]);

    const conflictDialog = authedPage.getByTestId('sources__dialog__upload-conflict');
    await expect(conflictDialog).toBeVisible();
    await authedPage.getByTestId('sources__upload-conflict__rename').click();

    await expect(
      authedPage.getByTestId('sources__object-row').filter({ hasText: 'README (1).txt' }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('handles upload conflicts with overwrite', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'e2e-overwrite.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('v1'),
      },
    ]);
    await expect(
      authedPage.getByTestId('sources__object-row').filter({ hasText: 'e2e-overwrite.txt' }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await authedPage.getByTestId('sources__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'e2e-overwrite.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('v2'),
      },
    ]);

    const conflictDialog = authedPage.getByTestId('sources__dialog__upload-conflict');
    await expect(conflictDialog).toBeVisible();
    await authedPage.getByTestId('sources__upload-conflict__overwrite').click();
    await expect(conflictDialog).toBeHidden();

    await expect(
      authedPage.getByTestId('sources__object-row').filter({ hasText: 'e2e-overwrite.txt' }),
    ).toHaveCount(1);
  });

  test('download object triggers download endpoint request', async ({ authedPage }) => {
    const row = authedPage.getByTestId('sources__object-row').filter({ hasText: 'README.txt' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button').click();

    const respPromise = authedPage.waitForResponse((resp) => {
      return resp.url().includes('/objects/download') && resp.status() === 200;
    });
    await authedPage.getByTestId('sources__download').click();
    await respPromise;
  });

  test('details panel supports overview and technical tabs with preview', async ({ authedPage }) => {
    const row = authedPage.getByTestId('sources__object-row').filter({ hasText: 'README.txt' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button').click();

    await expect(authedPage.getByTestId('sources__details-panel')).toBeVisible();
    await expect(authedPage.getByTestId('sources__details-tabs')).toBeVisible();
    await expect(authedPage.getByTestId('sources__details-preview')).toBeVisible();

    await authedPage.getByTestId('sources__details-tab--technical').click();
    await expect(authedPage.getByTestId('sources__details-tabs').getByText(/README\.txt/i)).toBeVisible();
  });

  test('shows selection summary when rows are selected', async ({ authedPage }) => {
    const row = authedPage.getByTestId('sources__object-row').filter({ hasText: 'README.txt' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button').click();

    await expect(authedPage.getByTestId('sources__selection-summary')).toBeVisible();
    await authedPage.getByTestId('sources__clear-selection').click();
    await expect(authedPage.getByTestId('sources__selection-summary')).toHaveCount(0);
  });

  test('downloads multiple selected files', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'e2e-download-a.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello-a'),
      },
      {
        name: 'e2e-download-b.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello-b'),
      },
    ]);

    const rowA = authedPage.getByTestId('sources__object-row').filter({ hasText: 'e2e-download-a.txt' }).first();
    const rowB = authedPage.getByTestId('sources__object-row').filter({ hasText: 'e2e-download-b.txt' }).first();
    await expect(rowA).toBeVisible({ timeout: 10_000 });
    await expect(rowB).toBeVisible({ timeout: 10_000 });

    await rowA.getByRole('button').click();
    await rowB.getByRole('button').click();

    let downloadResponses = 0;
    const handler = (resp: { url: () => string; status: () => number }) => {
      if (resp.url().includes('/objects/download') && resp.status() === 200) {
        downloadResponses += 1;
      }
    };
    authedPage.on('response', handler);
    await authedPage.getByTestId('sources__download').click();
    await expect.poll(() => downloadResponses, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    authedPage.off('response', handler);
  });

  test('shows failed download result and can retry failed items', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: '__fail_once_download__a.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]),
      },
    ]);

    const row = authedPage
      .getByTestId('sources__object-row')
      .filter({ hasText: '__fail_once_download__a.bin' })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole('button').click();

    await authedPage.getByTestId('sources__download').click();
    const resultDialog = authedPage.getByTestId('sources__dialog__batch-result');
    await expect(resultDialog).toBeVisible({ timeout: 10_000 });
    await expect(resultDialog.getByTestId('sources__batch-result__row')).toContainText('__fail_once_download__a.bin');
    await authedPage.getByTestId('sources__batch-result__retry').click();
    await expect(resultDialog).toHaveCount(0);
  });

  test('shows failed delete result and can retry failed items', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: '__fail_once_delete__a.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('delete-fail-once'),
      },
      {
        name: 'delete-ok-b.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('delete-ok'),
      },
    ]);

    const failRow = authedPage
      .getByTestId('sources__object-row')
      .filter({ hasText: '__fail_once_delete__a.txt' })
      .first();
    const okRow = authedPage
      .getByTestId('sources__object-row')
      .filter({ hasText: 'delete-ok-b.txt' })
      .first();
    await expect(failRow).toBeVisible({ timeout: 10_000 });
    await expect(okRow).toBeVisible({ timeout: 10_000 });
    await failRow.getByRole('button').click();
    await okRow.getByRole('button').click();

    await authedPage.getByTestId('sources__delete').click();
    await authedPage.getByTestId('sources__dialog__delete').getByRole('button', { name: /^delete$/i }).click();

    const resultDialog = authedPage.getByTestId('sources__dialog__batch-result');
    await expect(resultDialog).toBeVisible({ timeout: 10_000 });
    await expect(resultDialog.getByTestId('sources__batch-result__row')).toContainText('__fail_once_delete__a.txt');
    await authedPage.getByTestId('sources__batch-result__retry').click();
    await expect(resultDialog).toHaveCount(0);
    await expect(
      authedPage.getByTestId('sources__object-row').filter({ hasText: '__fail_once_delete__a.txt' }),
    ).toHaveCount(0);
  });

  test('delete object removes it from the table', async ({ authedPage }) => {
    // Upload a file so we can delete deterministically.
    await authedPage.getByTestId('sources__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'e2e-delete.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello-delete'),
      },
    ]);

    const row = authedPage.getByTestId('sources__object-row').filter({ hasText: 'e2e-delete.txt' }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole('button').click();

    await authedPage.getByTestId('sources__delete').click();
    const dialog = authedPage.getByTestId('sources__dialog__delete');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^delete$/i }).click();

    await expect(authedPage.getByTestId('sources__object-row').filter({ hasText: 'e2e-delete.txt' }).first()).toBeHidden();
  });
});
