/**
 * Credentials Page – E2E Tests
 *
 * Covers table rendering, create dialog, rotate dialog, and delete dialog
 * using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Credentials Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'credentials');
  });

  test('table renders with credential rows', async ({ authedPage }) => {
    const table = authedPage.getByTestId('credentials__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator('[data-testid="credentials__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });

  test('displays credential names from mock data', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    // Credential names from credentialFixtures: "OpenAI API Key", "Anthropic API Key"
    await expect(authedPage.getByText('OpenAI API Key')).toBeVisible();
    await expect(authedPage.getByText('Anthropic API Key')).toBeVisible();
  });

  test('create dialog opens with name field', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('credentials__create-btn');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    const dialog = authedPage.getByTestId('credentials__create-dialog');
    await expect(dialog).toBeVisible();

    // Verify the dialog has name and value inputs
    await expect(dialog.locator('#cred-name')).toBeVisible();
    await expect(dialog.locator('#cred-value')).toBeVisible();
  });

  test('rotate dialog opens from row action', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    // Click the rotate (RotateCcw) button on the first credential row
    const firstRow = authedPage.getByTestId('credentials__table__row').first();
    await expect(firstRow).toBeVisible();
    const rotateBtn = firstRow.getByRole('button', { name: /rotate/i });
    await rotateBtn.click();

    const rotateDialog = authedPage.getByTestId('credentials__rotate-dialog');
    await expect(rotateDialog).toBeVisible();

    // Verify the dialog has a new value input
    await expect(rotateDialog.locator('#rotate-value')).toBeVisible();
  });

  test('delete dialog opens from row action', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    // Click the delete (Trash) button on the first credential row
    const firstRow = authedPage.getByTestId('credentials__table__row').first();
    await expect(firstRow).toBeVisible();
    const deleteBtn = firstRow.getByRole('button', { name: /delete/i });
    await deleteBtn.click();

    const deleteDialog = authedPage.getByTestId('credentials__delete-dialog');
    await expect(deleteDialog).toBeVisible();
  });
});
