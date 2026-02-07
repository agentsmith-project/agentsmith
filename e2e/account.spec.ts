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

  test('saving profile sends profile update request', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/profile`);

    const displayName = authedPage.getByTestId('profile__display-name');
    await expect(displayName).toBeVisible({ timeout: 10000 });
    await displayName.clear();
    await displayName.fill('E2E Profile Network Name');

    const saveRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'PATCH' && /\/api\/v1\/me\/profile$/.test(req.url());
    });

    await authedPage.getByTestId('profile__save-btn').click();
    const request = await saveRequestPromise;
    const payload = request.postDataJSON() as { display_name?: string };
    expect(payload.display_name).toBe('E2E Profile Network Name');
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

  test('create api key sends expected payload', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/api-keys`);

    const createBtn = authedPage.getByTestId('api-keys__create-btn');
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    const dialog = authedPage.getByTestId('api-keys__create-dialog');
    await expect(dialog).toBeVisible();

    const inputs = dialog.locator('input');
    await inputs.nth(0).fill('E2E key note');
    await inputs.nth(1).fill('7');

    const createRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/user\/keys$/.test(req.url());
    });

    await dialog.getByRole('button', { name: /create/i }).click();
    const request = await createRequestPromise;
    const payload = request.postDataJSON() as { note?: string; expires_in?: number };

    expect(payload.note).toBe('E2E key note');
    expect(payload.expires_in).toBe(7);
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

  test('revoke api key sends delete request', async ({ authedPage }) => {
    await goTo(authedPage, `/${LOCALE}/user/api-keys`);

    const table = authedPage.getByTestId('api-keys__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const row = table.locator('tbody tr, [role="row"]').first();
    await expect(row).toBeVisible({ timeout: 10000 });

    const revokeBtn = row.getByRole('button', { name: /revoke|delete/i });
    if (!(await revokeBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No active key row with revoke button in current fixture');
      return;
    }

    await revokeBtn.click();

    const deleteRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'DELETE' && /\/api\/v1\/user\/keys\/.+/.test(req.url());
    });

    const confirmBtn = authedPage.getByRole('button', { name: /revoke|delete/i }).last();
    await confirmBtn.click();
    await deleteRequestPromise;
  });
});
