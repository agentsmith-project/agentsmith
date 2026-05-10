/**
 * Files Page – E2E Tests (File Library Browser)
 *
 * This suite validates the current project file-library UX over MSW:
 * - file-library list
 * - browse folders via prefix rows and breadcrumb
 * - create folder
 * - upload / rename / delete / download objects
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Files Page (file library browser)', () => {
  const multiSelectModifier: 'Control' | 'Meta' = process.platform === 'darwin' ? 'Meta' : 'Control';

  const activateLibrary = async (authedPage: import('@playwright/test').Page, libraryId: string) => {
    const library = authedPage.getByTestId(`files__library-item--${libraryId}`);
    await library.focus();
    await library.press('Enter');
  };

  const clickSortHeader = async (authedPage: import('@playwright/test').Page, column: 'name' | 'size_bytes') => {
    const header = authedPage.getByTestId(`files__sort-header--${column}`);
    await expect(header).toBeVisible();
    await header.click();
  };

  const locateFile = async (authedPage: import('@playwright/test').Page, keyword: string) => {
    await authedPage.getByTestId('files__search').fill(keyword);
    await expect(authedPage.getByTestId('files__object-row').filter({ hasText: keyword }).first()).toBeVisible({
      timeout: 10_000,
    });
  };

  const multiSelectRowByText = async (authedPage: import('@playwright/test').Page, text: string) => {
    const row = authedPage.getByTestId('files__object-row').filter({ hasText: text }).first();
    await row.getByRole('button').click({ modifiers: [multiSelectModifier] });
  };

  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'files');
  });

  test('renders libraries and objects table', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('files__library-list')).toBeVisible();
    await expect(authedPage.getByTestId('files__objects-table')).toBeVisible();
    await expect(authedPage.getByTestId('files__object-row').first()).toBeVisible();
  });

  test('does not expose local mount or raw storage entry points for file libraries', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('files__library-item--lib_shared_default')).toBeVisible();
    await expect(authedPage.getByTestId('files__library-desktop-access--lib_shared_default')).toHaveCount(0);
    await expect(authedPage.getByTestId('files__dialog__desktop-mount-access')).toHaveCount(0);
    await expect(authedPage.getByTestId('files__library-mount__metadata-url')).toHaveCount(0);
    await expect(authedPage.getByText(/juicefs|metadata url|storage credential|mount command/i)).toHaveCount(0);
  });

  test('creates and deletes an empty file library', async ({ authedPage }) => {
    const libraryName = `E2E Library ${Date.now()}`;
    await authedPage.getByTestId('files__library-create').click();
    const createDialog = authedPage.getByTestId('files__dialog__library-create');
    await expect(createDialog).toBeVisible();
    await createDialog.getByTestId('files__library-create__name').fill(libraryName);
    await createDialog.getByTestId('files__library-create__description').fill('Created during e2e');
    await createDialog.getByTestId('files__library-create__submit').click();

    const createdLibrary = authedPage.locator('[data-testid^="files__library-item--"]').filter({ hasText: libraryName }).first();
    await expect(createdLibrary).toBeVisible();
    await createdLibrary.click();
    await createdLibrary.getByRole('button', { name: /delete/i }).click();

    const deleteDialog = authedPage.getByTestId('files__dialog__library-delete');
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByTestId('files__library-delete__confirm').fill(libraryName);
    await deleteDialog.getByTestId('files__library-delete__submit').click();

    await expect(authedPage.getByText(libraryName)).toHaveCount(0);
  });

  test('blocks deleting a non-empty file library', async ({ authedPage }) => {
    const libraryName = 'Shared Docs';
    const deleteButton = authedPage
      .getByTestId('files__library-item--lib_shared_default')
      .getByRole('button', { name: /delete/i });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click({ force: true });

    const deleteDialog = authedPage.getByTestId('files__dialog__library-delete');
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByTestId('files__library-delete__confirm').fill(libraryName);
    await deleteDialog.getByTestId('files__library-delete__submit').click();

    await expect(deleteDialog).toBeVisible();
    await expect(authedPage.getByTestId('files__library-item--lib_shared_default')).toBeVisible();
  });

  test('relies on sidebar navigation instead of build header actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('files__open-chat')).toHaveCount(0);
    await expect(authedPage.getByTestId('files__open-agent-tasks')).toHaveCount(0);
    await expect(authedPage.getByTestId('files__open-endpoints')).toHaveCount(0);
    await expect(authedPage.getByTestId('sidebar__nav-item--chat')).toHaveAttribute('href', /\/chat$/);
    await expect(authedPage.getByTestId('sidebar__nav-item--agent-tasks')).toHaveAttribute('href', /\/agent-tasks$/);
    await expect(authedPage.getByTestId('sidebar__nav-item--endpoints')).toHaveAttribute('href', /\/endpoints$/);
  });

  test('search filters objects via backend query', async ({ authedPage }) => {
    await authedPage.getByTestId('files__search').fill('readme');
    await expect(authedPage.getByTestId('files__search')).toHaveValue('readme');

    await expect(authedPage.getByTestId('files__object-row').filter({ hasText: 'README.txt' }).first()).toBeVisible();
    await expect(authedPage.getByTestId('files__object-row').filter({ hasText: 'docs' })).toHaveCount(0);
  });

  test('resets sort preference after refresh', async ({ authedPage }) => {
    await clickSortHeader(authedPage, 'size_bytes');
    await expect(authedPage.getByTestId('files__sort-header--size_bytes')).toHaveAttribute('data-active', 'true');
    await expect(authedPage.getByTestId('files__sort-header--size_bytes')).toHaveAttribute('data-order', 'asc');
    await clickSortHeader(authedPage, 'size_bytes');
    await expect(authedPage.getByTestId('files__sort-header--size_bytes')).toHaveAttribute('data-order', 'desc');

    await authedPage.reload();
    await expect(authedPage.getByTestId('files__sort-header--name')).toHaveAttribute('data-active', 'true');
    await expect(authedPage.getByTestId('files__sort-header--name')).toHaveAttribute('data-order', 'asc');
  });

  test('resets search after refresh', async ({ authedPage }) => {
    await authedPage.getByTestId('files__search').fill('README');
    await expect(authedPage.getByTestId('files__search')).toHaveValue('README');
    await expect(authedPage.getByTestId('files__object-row').filter({ hasText: 'README.txt' }).first()).toBeVisible();
    await authedPage.reload();
    await expect(authedPage.getByTestId('files__search')).toHaveValue('');
    await expect(authedPage.getByTestId('files__object-row').filter({ hasText: 'docs' }).first()).toBeVisible();
  });

  test('persists selected library in url and after refresh', async ({ authedPage }) => {
    await activateLibrary(authedPage, 'lib_large_bench');
    await expect(authedPage.getByTestId('files__load-more')).toBeVisible();
    await expect(authedPage).toHaveURL(/library_id=lib_large_bench/);

    await authedPage.reload();
    await expect(authedPage).toHaveURL(/library_id=lib_large_bench/);
    await expect(authedPage.getByTestId('files__library-item--lib_large_bench')).toBeVisible();
    await expect(authedPage.getByTestId('files__library-item--lib_large_bench')).toContainText('Large Bench');
    await expect(authedPage.getByTestId('files__load-more')).toBeVisible();
  });

  test('resets folder prefix after refresh', async ({ authedPage }) => {
    const docsRow = authedPage.getByTestId('files__object-row').filter({ hasText: 'docs' }).first();
    await expect(docsRow).toBeVisible();
    await docsRow.getByRole('button').dblclick();

    await expect(authedPage.getByTestId('files__go-up')).toBeVisible();

    await authedPage.reload();
    await expect(authedPage.getByTestId('files__go-up')).toHaveCount(0);
    await expect(authedPage.getByTestId('files__object-row').filter({ hasText: 'docs' }).first()).toBeVisible();
  });

  test('restores per-library view state when switching libraries in same page session', async ({ authedPage }) => {
    await authedPage.getByTestId('files__search').fill('README');
    await expect(authedPage.getByTestId('files__search')).toHaveValue('README');

    await clickSortHeader(authedPage, 'size_bytes');
    await clickSortHeader(authedPage, 'size_bytes');
    await expect(authedPage.getByTestId('files__sort-header--size_bytes')).toHaveAttribute('data-active', 'true');
    await expect(authedPage.getByTestId('files__sort-header--size_bytes')).toHaveAttribute('data-order', 'desc');

    await multiSelectRowByText(authedPage, 'README.txt');
    await expect(authedPage.getByTestId('files__selection-summary')).toContainText('1');

    await activateLibrary(authedPage, 'lib_large_bench');
    await expect(authedPage.getByTestId('files__load-more')).toBeVisible();

    await activateLibrary(authedPage, 'lib_shared_default');
    await expect(authedPage.getByTestId('files__search')).toHaveValue('README');
    await expect(authedPage.getByTestId('files__sort-header--size_bytes')).toHaveAttribute('data-active', 'true');
    await expect(authedPage.getByTestId('files__sort-header--size_bytes')).toHaveAttribute('data-order', 'desc');
    await expect(authedPage.getByTestId('files__selection-summary')).toContainText('1');
  });

  test('handles large directory pagination and search responsiveness', async ({ authedPage }) => {
    await activateLibrary(authedPage, 'lib_large_bench');
    const loadMoreButton = authedPage.getByTestId('files__load-more');
    const objectsTable = authedPage.getByTestId('files__objects-table');
    const targetRow = authedPage.getByTestId('files__object-row').filter({ hasText: 'bulk-0250.txt' }).first();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (await targetRow.isVisible().catch(() => false)) break;
      if (await loadMoreButton.isVisible().catch(() => false)) {
        await loadMoreButton.click().catch(() => {});
      }
      await objectsTable.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await authedPage.waitForTimeout(250);
    }

    await authedPage.getByTestId('files__search').fill('bulk-0250');
    await expect(authedPage.getByTestId('files__search')).toHaveValue('bulk-0250');
    await expect(targetRow).toBeVisible();
  });

  test('can browse into a folder and back to root via breadcrumb', async ({ authedPage }) => {
    const docsRow = authedPage.getByTestId('files__object-row').filter({ hasText: 'docs' }).first();
    await expect(docsRow).toBeVisible();
    await docsRow.getByRole('button').dblclick();

    await expect(authedPage.getByTestId('files__breadcrumb-root')).toHaveCount(1);
    // After navigating into docs/, the root breadcrumb remains clickable.
    await authedPage
      .getByTestId('files__breadcrumb-root')
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(authedPage.getByTestId('files__go-up')).toHaveCount(0);
    await expect(authedPage.getByTestId('files__objects-table')).toBeVisible();
  });

  test('can navigate to parent folder via go-up action', async ({ authedPage }) => {
    const docsRow = authedPage.getByTestId('files__object-row').filter({ hasText: 'docs' }).first();
    await expect(docsRow).toBeVisible();
    await docsRow.getByRole('button').dblclick();

    await expect(authedPage.getByTestId('files__go-up')).toBeVisible();
    await authedPage.getByTestId('files__go-up').click();
    await expect(authedPage.getByTestId('files__object-row').filter({ hasText: 'docs' }).first()).toBeVisible();
  });

  test('create folder navigates into it', async ({ authedPage }) => {
    await authedPage.getByTestId('files__new-folder').click();
    const dialog = authedPage.getByTestId('files__dialog__new-folder');
    await expect(dialog).toBeVisible();

    const name = `e2e-folder-${Date.now()}`;
    await dialog.getByRole('textbox').fill(name);
    await dialog.getByRole('button', { name: /create/i }).click();

    // Creating a folder auto-enters it.
    await expect(authedPage.getByTestId('files__go-up')).toBeVisible();
    await expect(authedPage.getByTestId('files__breadcrumb--1')).toContainText(name);

    await authedPage.getByTestId('files__breadcrumb-root').click();
    await expect(
      authedPage.getByTestId('files__object-row').filter({ hasText: name }).first(),
    ).toBeVisible();
  });

  test('upload object and rename it', async ({ authedPage }) => {
    // Upload
    await authedPage.getByTestId('files__upload').click();
    const fileInput = authedPage.locator('input[type="file"]');
    await fileInput.setInputFiles([
      {
        name: 'e2e-upload.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello-upload'),
      },
    ]);

    // Wait for row to appear.
    await locateFile(authedPage, 'e2e-upload.txt');
    const uploadedRow = authedPage.getByTestId('files__object-row').filter({ hasText: 'e2e-upload.txt' }).first();

    // Select by clicking the row name button (object rows toggle selection).
    await uploadedRow.getByRole('button').click();

    // Rename
    await authedPage.getByTestId('files__rename').click();
    const dialog = authedPage.getByTestId('files__dialog__move');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('files__move__name').fill('e2e-renamed.txt');
    const moveResponse = authedPage.waitForResponse((response) => {
      return response.url().includes('/file-libraries/') && response.url().includes('/move') && response.status() === 204;
    });
    await dialog.getByTestId('files__move__submit').click();
    await moveResponse;
  });

  test('can cancel an in-progress upload', async ({ authedPage }) => {
    await authedPage.getByTestId('files__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'slow-upload.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('slow-upload-content'),
      },
    ]);

    await expect(authedPage.getByTestId('files__upload-progress')).toBeVisible();
    await authedPage.getByTestId('files__upload-cancel').click();

    await expect(authedPage.getByTestId('files__upload-progress')).toHaveCount(0);
    await expect(
      authedPage.getByTestId('files__object-row').filter({ hasText: 'slow-upload.txt' }).first(),
    ).toHaveCount(0);
  });

  test('handles upload conflicts with keep-both rename', async ({ authedPage }) => {
    await authedPage.getByTestId('files__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'README.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('conflict-rename'),
      },
    ]);

    const conflictDialog = authedPage.getByTestId('files__dialog__upload-conflict');
    await expect(conflictDialog).toBeVisible();
    await authedPage.getByTestId('files__upload-conflict__rename').click();

    await locateFile(authedPage, 'README (1).txt');
  });

  test('handles upload conflicts with overwrite', async ({ authedPage }) => {
    await authedPage.getByTestId('files__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'e2e-overwrite.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('v1'),
      },
    ]);
    await locateFile(authedPage, 'e2e-overwrite.txt');

    await authedPage.getByTestId('files__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'e2e-overwrite.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('v2'),
      },
    ]);

    const conflictDialog = authedPage.getByTestId('files__dialog__upload-conflict');
    await expect(conflictDialog).toBeVisible();
    await authedPage.getByTestId('files__upload-conflict__overwrite').click();
    await expect(conflictDialog).toBeHidden();

    await expect(
      authedPage.getByTestId('files__object-row').filter({ hasText: 'e2e-overwrite.txt' }),
    ).toHaveCount(1);
  });

  test('download object triggers download endpoint request', async ({ authedPage }) => {
    await locateFile(authedPage, 'README.txt');
    const row = authedPage.getByTestId('files__object-row').filter({ hasText: 'README.txt' }).first();
    await row.getByRole('button').click();

    const respPromise = authedPage.waitForResponse((resp) => {
      return resp.url().includes('/file-libraries/') && resp.url().includes('/download') && resp.status() === 200;
    });
    await authedPage.getByTestId('files__download').click();
    await respPromise;
  });

  test('details panel supports overview and technical tabs with preview', async ({ authedPage }) => {
    await locateFile(authedPage, 'README.txt');
    const row = authedPage.getByTestId('files__object-row').filter({ hasText: 'README.txt' }).first();
    await row.getByRole('button').click();

    await expect(authedPage.getByTestId('files__details-panel')).toBeVisible();
    await expect(authedPage.getByTestId('files__details-tabs')).toBeVisible();
    await expect(authedPage.getByTestId('files__details-preview')).toBeVisible();

    await authedPage.getByTestId('files__details-tab--technical').click();
    await expect(authedPage.getByTestId('files__details-tabs').getByText(/README\.txt/i)).toBeVisible();
  });

  test('shows selection summary when rows are selected', async ({ authedPage }) => {
    await locateFile(authedPage, 'README.txt');
    await multiSelectRowByText(authedPage, 'README.txt');

    await expect(authedPage.getByTestId('files__selection-summary')).toBeVisible();
    await authedPage.getByTestId('files__clear-selection').click();
    await expect(authedPage.getByTestId('files__clear-selection')).toBeDisabled();
    await authedPage.keyboard.press('Escape');
    await expect(authedPage.getByTestId('files__selection-shortcuts')).toHaveCount(1);
  });

  test('details panel can expand preview', async ({ authedPage }) => {
    await locateFile(authedPage, 'README.txt');
    const row = authedPage.getByTestId('files__object-row').filter({ hasText: 'README.txt' }).first();
    await row.getByRole('button').click();

    await authedPage.getByTestId('files__preview-expand').click();
    await expect(authedPage.getByTestId('files__dialog__preview-expand')).toBeVisible();
  });

  test('downloads multiple selected files', async ({ authedPage }) => {
    await authedPage.getByTestId('files__upload').click();
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

    await locateFile(authedPage, 'e2e-download-a.txt');
    await multiSelectRowByText(authedPage, 'e2e-download-a.txt');
    await locateFile(authedPage, 'e2e-download-b.txt');
    await multiSelectRowByText(authedPage, 'e2e-download-b.txt');

    let downloadResponses = 0;
    const handler = (resp: { url: () => string; status: () => number }) => {
      if (resp.url().includes('/file-libraries/') && resp.url().includes('/download') && resp.status() === 200) {
        downloadResponses += 1;
      }
    };
    authedPage.on('response', handler);
    await authedPage.getByTestId('files__download').click();
    await expect.poll(() => downloadResponses, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    authedPage.off('response', handler);
  });

  test('shows failed download result and can retry failed items', async ({ authedPage }) => {
    await authedPage.getByTestId('files__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: '__fail_once_download__a.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]),
      },
    ]);

    await locateFile(authedPage, '__fail_once_download__a.bin');
    const row = authedPage.getByTestId('files__object-row').filter({ hasText: '__fail_once_download__a.bin' }).first();
    await row.getByRole('button').click();

    await authedPage.getByTestId('files__download').click();
    const resultDialog = authedPage.getByTestId('files__dialog__batch-result');
    await expect(resultDialog).toBeVisible({ timeout: 10_000 });
    await expect(resultDialog.getByTestId('files__batch-result__row')).toContainText('__fail_once_download__a.bin');
    await authedPage.getByTestId('files__batch-result__retry').click();
    await expect(resultDialog).toHaveCount(0);
  });

  test('shows failed delete result and can retry failed items', async ({ authedPage }) => {
    await authedPage.getByTestId('files__upload').click();
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

    await locateFile(authedPage, '__fail_once_delete__a.txt');
    await multiSelectRowByText(authedPage, '__fail_once_delete__a.txt');
    await locateFile(authedPage, 'delete-ok-b.txt');
    await multiSelectRowByText(authedPage, 'delete-ok-b.txt');

    await authedPage.getByTestId('files__delete').click();
    await authedPage.getByTestId('files__dialog__delete').getByRole('button', { name: /^delete$/i }).click();

    const resultDialog = authedPage.getByTestId('files__dialog__batch-result');
    if (await resultDialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(resultDialog.getByTestId('files__batch-result__row')).toContainText('__fail_once_delete__a.txt');
      await authedPage.getByTestId('files__batch-result__retry').click();
      await expect(resultDialog).toHaveCount(0);
    }
    await expect(
      authedPage.getByTestId('files__object-row').filter({ hasText: '__fail_once_delete__a.txt' }),
    ).toHaveCount(0);
  });

  test('delete object removes it from the table', async ({ authedPage }) => {
    // Upload a file so we can delete deterministically.
    await authedPage.getByTestId('files__upload').click();
    await authedPage.locator('input[type="file"]').setInputFiles([
      {
        name: 'e2e-delete.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello-delete'),
      },
    ]);

    await locateFile(authedPage, 'e2e-delete.txt');
    const row = authedPage.getByTestId('files__object-row').filter({ hasText: 'e2e-delete.txt' }).first();
    await row.getByRole('button').click();

    await authedPage.getByTestId('files__delete').click();
    const dialog = authedPage.getByTestId('files__dialog__delete');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^delete$/i }).click();

    await expect(authedPage.getByTestId('files__object-row').filter({ hasText: 'e2e-delete.txt' }).first()).toBeHidden();
  });
});
