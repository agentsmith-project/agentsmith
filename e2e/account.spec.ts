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
});
