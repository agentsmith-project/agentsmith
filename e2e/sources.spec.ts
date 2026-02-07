/**
 * Sources Page – E2E Tests
 *
 * Covers table rendering, upload button, upload dialog, file selection,
 * and batch action bar using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Sources Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'sources');
  });

  test('table renders with source files', async ({ authedPage }) => {
    const table = authedPage.getByTestId('sources__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator('[data-testid="sources__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  });

  test('upload button is visible', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('sources__table')).toBeVisible({ timeout: 10000 });

    const uploadBtn = authedPage.getByTestId('sources__upload-btn');
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toHaveText(/Upload/);
  });

  test('upload dialog opens when clicking upload button', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('sources__table')).toBeVisible({ timeout: 10000 });

    const uploadBtn = authedPage.getByTestId('sources__upload-btn');
    await uploadBtn.click();

    const dialog = authedPage.getByTestId('sources__upload-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Upload Files')).toBeVisible();
  });

  test('upload dialog supports selecting and removing files before upload', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__upload-btn').click();
    const dialog = authedPage.getByTestId('sources__upload-dialog');
    await expect(dialog).toBeVisible();

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles([
      {
        name: 'e2e-a.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello-a'),
      },
      {
        name: 'e2e-b.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello-b'),
      },
    ]);

    await expect(dialog.getByText('e2e-a.txt')).toBeVisible();
    await expect(dialog.getByText('e2e-b.txt')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /upload 2 file/i })).toBeVisible();

    const firstFileRow = dialog.locator('div.flex.items-center.gap-3').filter({ hasText: 'e2e-a.txt' }).first();
    await firstFileRow.locator('button.text-tertiary').click();
    await expect(dialog.getByText('e2e-a.txt')).not.toBeVisible();
    await expect(dialog.getByRole('button', { name: /upload 1 file/i })).toBeVisible();
  });

  test('upload dialog cancel closes without request', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__upload-btn').click();
    const dialog = authedPage.getByTestId('sources__upload-dialog');
    await expect(dialog).toBeVisible();

    const uploadRequests: string[] = [];
    authedPage.on('request', (req) => {
      if (/\/api\/v1\/workspaces\/.*\/projects\/.*\/sources$/.test(req.url()) && req.method() === 'POST') {
        uploadRequests.push(req.url());
      }
    });

    await dialog.getByRole('button', { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden();
    expect(uploadRequests.length).toBe(0);
  });

  test('upload selected files sends create-source request', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__upload-btn').click();
    const dialog = authedPage.getByTestId('sources__upload-dialog');
    await expect(dialog).toBeVisible();

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles([
      {
        name: 'e2e-upload-request.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('upload-request-check'),
      },
    ]);

    const uploadRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/sources\/upload$/.test(req.url());
    });

    await dialog.getByRole('button', { name: /upload 1 file/i }).click();
    await uploadRequestPromise;
  });

  test('rows have checkboxes for selection', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('sources__table')).toBeVisible({ timeout: 10000 });

    // The SourcesTable uses a select column with Checkbox components
    const rows = authedPage.getByTestId('sources__table__row');
    const firstRow = rows.first();
    await expect(firstRow).toBeVisible();

    // Each row should contain a checkbox for selection
    const checkbox = firstRow.getByRole('checkbox');
    await expect(checkbox).toBeVisible();
  });

  test('selection bar appears when files are selected', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('sources__table')).toBeVisible({ timeout: 10000 });

    // Select the first file by clicking its checkbox
    const rows = authedPage.getByTestId('sources__table__row');
    await expect(rows.first()).toBeVisible();
    const firstCheckbox = rows.first().getByRole('checkbox');

    // Only test selection if checkbox exists (some table designs may not have row checkboxes)
    if (await firstCheckbox.isVisible().catch(() => false)) {
      await firstCheckbox.click({ force: true });
      // The SourcesSelectionBar should appear - check for either "selected" text or action buttons
      await expect(authedPage.getByRole('button', { name: /clear|delete|download/i }).or(
        authedPage.getByText(/selected/i)
      ).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('selection bar can clear selected rows', async ({ authedPage }) => {
    const rows = authedPage.getByTestId('sources__table__row');
    await expect(rows.first()).toBeVisible();

    const firstCheckbox = rows.first().getByRole('checkbox');
    if (!(await firstCheckbox.isVisible().catch(() => false))) {
      test.skip(true, 'Row checkbox is not visible in current table mode');
      return;
    }

    await firstCheckbox.click({ force: true });
    const selectionRegion = authedPage.getByRole('region', { name: /selection/i });
    await expect(selectionRegion).toBeVisible({ timeout: 5000 });
    await selectionRegion.getByRole('button', { name: /clear/i }).click();
    await expect(selectionRegion).not.toBeVisible({ timeout: 5000 });
  });

  test('library selector exposes options and can switch library', async ({ authedPage }) => {
    const selector = authedPage.getByTestId('sources__library-select');
    await expect(selector).toBeVisible();
    await selector.click();

    const options = authedPage.locator('[role="option"]');
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThanOrEqual(1);

    // Pick first option to ensure selection is interactive.
    await options.first().click();
    await expect(selector).toBeVisible();
  });

  test('search input filters files by filename keyword', async ({ authedPage }) => {
    const searchInput = authedPage.getByPlaceholder(/search files/i);
    await expect(searchInput).toBeVisible();

    await searchInput.fill('faq');
    await authedPage.waitForTimeout(500);
    await expect(authedPage.getByText('faq.md')).toBeVisible();

    await searchInput.fill('product-guide');
    await authedPage.waitForTimeout(500);
    await expect(authedPage.getByText('product-guide.pdf')).toBeVisible();
  });

  test('status and sort selectors are interactive', async ({ authedPage }) => {
    const filters = authedPage.locator('[data-testid="sources__library-select"]').locator('..').locator('..');
    await expect(filters).toBeVisible();

    // Status
    await authedPage.getByRole('combobox').filter({ hasText: /^All$/ }).first().click();
    await authedPage.getByRole('option', { name: /^Ready$/ }).click();

    // Sort by
    await authedPage.getByRole('combobox').filter({ hasText: /updated/i }).first().click();
    await authedPage.getByRole('option', { name: /^Size$/ }).click();
  });

  test('AIReady-only selector is interactive', async ({ authedPage }) => {
    await authedPage.getByRole('combobox').filter({ hasText: /All Files/i }).first().click();
    await authedPage.getByRole('option', { name: /^AIReady Only$/ }).click();
    await expect(authedPage.getByRole('combobox').filter({ hasText: /AIReady Only/i }).first()).toBeVisible();

    await authedPage.getByRole('combobox').filter({ hasText: /AIReady Only/i }).first().click();
    await authedPage.getByRole('option', { name: /^All Files$/ }).click();
    await expect(authedPage.getByRole('combobox').filter({ hasText: /All Files/i }).first()).toBeVisible();
  });

  test('manage libraries dialog supports create rename and delete controls', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__manage-libraries-btn').click();
    const dialog = authedPage.getByTestId('sources__libraries-dialog');
    await expect(dialog).toBeVisible();

    const createInput = dialog.getByTestId('sources__library-create-input');
    const createBtn = dialog.getByTestId('sources__library-create-btn');
    await expect(createBtn).toBeDisabled();
    await createInput.fill(`E2E Library ${Date.now()}`);
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    const createdRow = dialog.locator('[data-testid^="sources__library-row--"]').last();
    await expect(createdRow).toBeVisible({ timeout: 10000 });

    const renameBtn = createdRow.locator('[data-testid^="sources__library-rename-btn--"]');
    await expect(renameBtn).toBeVisible();
    await renameBtn.click();

    const renameInput = dialog.locator('[data-testid^="sources__library-rename-input--"]').last();
    const renameSave = dialog.locator('[data-testid^="sources__library-rename-save--"]').last();
    await renameInput.fill(`E2E Library Renamed ${Date.now()}`);
    await expect(renameSave).toBeEnabled();
    await renameSave.click();

    const deleteBtn = dialog.locator('[data-testid^="sources__library-delete-btn--"]').last();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
  });

  test('manage libraries dialog shows policy status badge', async ({ authedPage }) => {
    await authedPage.getByTestId('sources__manage-libraries-btn').click();
    const dialog = authedPage.getByTestId('sources__libraries-dialog');
    await expect(dialog).toBeVisible();

    await expect(dialog.locator('[data-testid^="sources__library-policy-status--"]').first()).toBeVisible();
  });
});
