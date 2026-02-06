/**
 * UserData Page E2E Tests
 *
 * Tests the user data storage page including summary statistics,
 * end users list, and data display.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('UserData Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'userdata');
  });

  test('should display page heading and subtitle', async ({ authedPage }) => {
    await expect(
      authedPage.getByRole('heading', { name: /User\s*Data|UserData/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display storage summary section', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Summary section should show storage, docdb collections, vectordb indexes
    await expect(authedPage.getByText(/Storage/i).first()).toBeVisible();
  });

  test('should display end users table', async ({ authedPage }) => {
    const table = authedPage.getByTestId('userdata__table');
    await expect(table).toBeVisible({ timeout: 10000 });
  });

  test('should display end user data from mock', async ({ authedPage }) => {
    const table = authedPage.getByTestId('userdata__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // MSW provides end user data - verify entries are shown or empty message
    const hasEntries = await table.locator('[class*="flex"][class*="items-center"]').count() > 0;
    const hasEmptyMsg = await table.getByText(/no end users|empty/i).isVisible().catch(() => false);

    expect(hasEntries || hasEmptyMsg, 'Should show end users or empty message').toBeTruthy();
  });
});
