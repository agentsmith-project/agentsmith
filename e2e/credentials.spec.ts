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

  test('create credential via dialog submission', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('credentials__create-btn');
    await createBtn.click();

    const dialog = authedPage.getByTestId('credentials__create-dialog');
    await expect(dialog).toBeVisible();

    // Fill in the form
    await dialog.locator('#cred-name').fill('E2E Test Credential');
    await dialog.locator('#cred-value').fill('sk-test-e2e-credential-value-12345');

    // Submit the form
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Dialog should close after successful creation
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // New credential should appear in the table
    await expect(authedPage.getByText('E2E Test Credential')).toBeVisible({ timeout: 10000 });
  });

  test('create credential with empty fields should not submit', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    const createBtn = authedPage.getByTestId('credentials__create-btn');
    await createBtn.click();

    const dialog = authedPage.getByTestId('credentials__create-dialog');
    await expect(dialog).toBeVisible();

    // Submit button should be disabled when both fields are empty
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    await expect(submitBtn).toBeDisabled();

    // Fill only name - should still be disabled
    await dialog.locator('#cred-name').fill('Test');
    await expect(submitBtn).toBeDisabled();
  });

  test('rotate credential via dialog', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    const firstRow = authedPage.getByTestId('credentials__table__row').first();
    await expect(firstRow).toBeVisible();
    const rotateBtn = firstRow.getByRole('button', { name: /rotate/i });
    await rotateBtn.click();

    const rotateDialog = authedPage.getByTestId('credentials__rotate-dialog');
    await expect(rotateDialog).toBeVisible();

    // Fill in the new value
    await rotateDialog.locator('#rotate-value').fill('sk-new-rotated-value-12345');

    // Submit the rotation
    const confirmBtn = rotateDialog.getByRole('button', { name: /rotate|confirm|save/i });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Dialog should close
    await expect(rotateDialog).toBeHidden({ timeout: 10000 });
  });

  test('rotate credential sends rotate request payload', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    const firstRow = authedPage.getByTestId('credentials__table__row').first();
    await expect(firstRow).toBeVisible();
    await firstRow.getByRole('button', { name: /rotate/i }).click();

    const rotateDialog = authedPage.getByTestId('credentials__rotate-dialog');
    await expect(rotateDialog).toBeVisible();

    const rotateBtn = rotateDialog.getByRole('button', { name: /rotate/i });
    await expect(rotateBtn).toBeDisabled();

    const rotateRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/credentials\/.*\/rotate$/.test(req.url());
    });

    await rotateDialog.locator('#rotate-value').fill('sk-new-rotated-value-network-check');
    await expect(rotateBtn).toBeEnabled();
    await rotateBtn.click();

    const request = await rotateRequestPromise;
    const payload = request.postDataJSON() as { value?: string };
    expect(payload.value).toBe('sk-new-rotated-value-network-check');
  });

  test('delete credential via dialog', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    const firstRow = authedPage.getByTestId('credentials__table__row').first();
    await expect(firstRow).toBeVisible();
    const deleteBtn = firstRow.getByRole('button', { name: /delete/i });
    await deleteBtn.click();

    const deleteDialog = authedPage.getByTestId('credentials__delete-dialog');
    await expect(deleteDialog).toBeVisible();

    // Confirm deletion
    const confirmBtn = deleteDialog.getByRole('button', { name: /delete|confirm/i });
    await confirmBtn.click();

    // Dialog should close
    await expect(deleteDialog).toBeHidden({ timeout: 10000 });
  });

  test('create credential sends expected payload', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    await authedPage.getByTestId('credentials__create-btn').click();
    const dialog = authedPage.getByTestId('credentials__create-dialog');
    await expect(dialog).toBeVisible();

    const createRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/credentials$/.test(req.url());
    });

    await dialog.locator('#cred-name').fill('E2E Payload Credential');
    await dialog.locator('#cred-value').fill('sk-e2e-payload-credential-value');
    await dialog.getByRole('button', { name: /create/i }).click();

    const request = await createRequestPromise;
    const payload = request.postDataJSON() as { name?: string; type?: string; value?: string };
    expect(payload.name).toBe('E2E Payload Credential');
    expect(payload.type).toBe('api_key');
    expect(payload.value).toBe('sk-e2e-payload-credential-value');
  });

  test('create dialog show/hide toggles credential value input type', async ({ authedPage }) => {
    await authedPage.getByTestId('credentials__create-btn').click();
    const dialog = authedPage.getByTestId('credentials__create-dialog');
    await expect(dialog).toBeVisible();

    const valueInput = dialog.locator('#cred-value');
    await expect(valueInput).toHaveAttribute('type', 'password');

    await dialog.getByRole('button', { name: /show|hide/i }).click();
    await expect(valueInput).toHaveAttribute('type', 'text');

    await dialog.getByRole('button', { name: /show|hide/i }).click();
    await expect(valueInput).toHaveAttribute('type', 'password');
  });

  test('rotate dialog show/hide toggles new value input type', async ({ authedPage }) => {
    const firstRow = authedPage.getByTestId('credentials__table__row').first();
    await expect(firstRow).toBeVisible();
    await firstRow.getByRole('button', { name: /rotate/i }).click();

    const dialog = authedPage.getByTestId('credentials__rotate-dialog');
    await expect(dialog).toBeVisible();
    const valueInput = dialog.locator('#rotate-value');
    await expect(valueInput).toHaveAttribute('type', 'password');

    await dialog.getByRole('button', { name: /show|hide/i }).click();
    await expect(valueInput).toHaveAttribute('type', 'text');
  });

  test('delete credential sends delete request', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    const firstRow = authedPage.getByTestId('credentials__table__row').first();
    await expect(firstRow).toBeVisible();
    await firstRow.getByRole('button', { name: /delete/i }).click();

    const deleteDialog = authedPage.getByTestId('credentials__delete-dialog');
    await expect(deleteDialog).toBeVisible();

    const deleteRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'DELETE' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/credentials\/.+/.test(req.url());
    });

    await deleteDialog.getByRole('button', { name: /delete|confirm/i }).click();
    await deleteRequestPromise;
  });
});
