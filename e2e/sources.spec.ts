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
    const dialog = authedPage.getByTestId('sources__dialog__rename');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill('e2e-renamed.txt');
    await dialog.getByRole('button', { name: /^save$/i }).click();

    await expect(authedPage.getByTestId('sources__object-row').filter({ hasText: 'e2e-renamed.txt' }).first()).toBeVisible();
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

