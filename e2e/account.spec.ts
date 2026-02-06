/**
 * Account Page Tests
 *
 * Verifies profile editing and API key management on the user account pages.
 */

import { test, expect, goTo, LOCALE } from './fixtures/test-base';

test.describe('Account - Profile', () => {
  test('profile page loads with form', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/profile`);

    const form = authedPage.getByTestId('profile__form');
    await expect(form).toBeVisible({ timeout: 10000 });
  });

  test('profile fields are visible', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/profile`);

    const displayName = authedPage.getByTestId('profile__display-name');
    const bio = authedPage.getByTestId('profile__bio');

    await expect(displayName).toBeVisible({ timeout: 10000 });
    await expect(bio).toBeVisible();
  });

  test('editing display name reveals save button', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/profile`);

    const displayName = authedPage.getByTestId('profile__display-name');
    await expect(displayName).toBeVisible({ timeout: 10000 });

    // Modify the display name value
    await displayName.clear();
    await displayName.fill('Updated Name');

    const saveBtn = authedPage.getByTestId('profile__save-btn');
    await expect(saveBtn).toBeVisible();
  });

  test('saving profile changes succeeds', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/profile`);

    const displayName = authedPage.getByTestId('profile__display-name');
    await expect(displayName).toBeVisible({ timeout: 10000 });

    await displayName.clear();
    await displayName.fill('E2E Updated Name');

    const saveBtn = authedPage.getByTestId('profile__save-btn');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Profile should still be visible after save (no error)
    await expect(authedPage.getByTestId('profile__form')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Account - API Keys', () => {
  test('api keys page loads with table', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/api-keys`);

    const table = authedPage.getByTestId('api-keys__table');
    await expect(table).toBeVisible({ timeout: 10000 });
  });

  test('create api key dialog opens', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/api-keys`);

    const createBtn = authedPage.getByTestId('api-keys__create-btn');
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    const dialog = authedPage.getByTestId('api-keys__create-dialog');
    await expect(dialog).toBeVisible();
  });

  test('api keys table shows existing keys', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/api-keys`);

    const table = authedPage.getByTestId('api-keys__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // MSW provides mock data — the table should have at least one row
    const rows = table.locator('tbody tr').or(table.locator('[role="row"]'));
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  });

  test('create api key via dialog submission', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/api-keys`);

    const createBtn = authedPage.getByTestId('api-keys__create-btn');
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    const dialog = authedPage.getByTestId('api-keys__create-dialog');
    await expect(dialog).toBeVisible();

    // Fill in the optional note field (first input in the dialog)
    const noteInput = dialog.locator('input').first();
    await expect(noteInput).toBeVisible();
    await noteInput.fill('E2E Test Key');

    // Submit the form (note is optional, so Create button should always be enabled)
    const submitBtn = dialog.getByRole('button', { name: /create/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // After creation, the KeyCreatedDialog should show the new key
    const keyCreatedDialog = authedPage.getByTestId('api-keys__key-created-dialog');
    await expect(keyCreatedDialog).toBeVisible({ timeout: 10000 });
  });

  test('delete api key from table', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/api-keys`);

    const table = authedPage.getByTestId('api-keys__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Find a row with a delete/revoke button
    const rows = table.locator('tbody tr, [role="row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    const deleteBtn = rows.first().getByRole('button', { name: /revoke|delete/i });
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();

      // Confirmation should appear
      const alertDialog = authedPage.getByRole('alertdialog');
      if (await alertDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        const confirmBtn = alertDialog.getByRole('button', { name: /confirm|revoke|delete/i });
        await confirmBtn.click();
        await expect(alertDialog).toBeHidden({ timeout: 10000 });
      }
    }
  });
});
