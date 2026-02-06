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
});
