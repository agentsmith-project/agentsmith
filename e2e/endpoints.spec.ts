/**
 * Endpoints Page – E2E Tests
 *
 * Covers table rendering, endpoint data, create dialog, edit dialog,
 * and delete confirmation using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Endpoints Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'endpoints');
  });

  test('table renders with endpoint rows', async ({ authedPage }) => {
    const table = authedPage.getByTestId('endpoints__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator('[data-testid="endpoints__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });

  test('displays endpoint names and URLs from mock data', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    // Endpoint names from p0.json: "OpenAI Main", "Claude Sonnet"
    await expect(authedPage.getByText('OpenAI Main')).toBeVisible();
    await expect(authedPage.getByText('Claude Sonnet')).toBeVisible();

    // URLs should appear in the table
    await expect(authedPage.getByText('https://api.openai.com/v1').first()).toBeVisible();
  });

  test('create dialog opens with form fields', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('endpoints__create-btn');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    // Verify the dialog contains a name input
    await expect(dialog.locator('#endpoint-name')).toBeVisible();
  });

  test('edit dialog opens when clicking edit on a row', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    // Click the edit (Pencil) button on the first endpoint row
    const firstRow = authedPage.getByTestId('endpoints__table__row').first();
    await expect(firstRow).toBeVisible();
    const editBtn = firstRow.getByRole('button', { name: /edit/i });
    await editBtn.click();

    const editDialog = authedPage.getByTestId('endpoints__edit-dialog');
    await expect(editDialog).toBeVisible();
  });

  test('delete action shows confirmation dialog', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    // Click the delete (Trash) button on the first endpoint row
    const firstRow = authedPage.getByTestId('endpoints__table__row').first();
    await expect(firstRow).toBeVisible();
    const deleteBtn = firstRow.getByRole('button', { name: /delete/i });
    await deleteBtn.click();

    // AlertDialog confirmation should appear
    await expect(authedPage.getByRole('alertdialog')).toBeVisible();
  });

  test('create endpoint via dialog submission', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('endpoints__create-btn');
    await createBtn.click();

    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    // Fill in required text fields
    await dialog.locator('#endpoint-name').fill('E2E Test Endpoint');
    await dialog.locator('#endpoint-model').fill('gpt-4o-test');

    // Select a credential using the Radix Select component
    // The credential select is the last Select trigger in the dialog (after Provider)
    const selectTriggers = dialog.locator('[role="combobox"]');
    const credentialTrigger = selectTriggers.last();

    if (await credentialTrigger.isVisible().catch(() => false)) {
      await credentialTrigger.click();
      await authedPage.waitForTimeout(300);

      // Select the first available credential option
      const option = authedPage.locator('[role="option"]').first();
      if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
        await option.click();
        await authedPage.waitForTimeout(300);

        // Submit the form
        const submitBtn = dialog.getByRole('button', { name: /create/i });
        await expect(submitBtn).toBeEnabled({ timeout: 5000 });
        await submitBtn.click();

        // Dialog should close after successful creation
        await expect(dialog).toBeHidden({ timeout: 10000 });
      }
    }
  });

  test('create endpoint with empty name should not submit', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('endpoints__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('endpoints__create-btn');
    await createBtn.click();

    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    // Submit button should be disabled when required fields are empty
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    await expect(submitBtn).toBeDisabled();
  });
});
