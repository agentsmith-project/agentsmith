import { test, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

test.describe('Account pages', () => {
  test('profile page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, '/en-US/user/profile');
    await expect(page.getByRole('heading', { name: /Profile/i })).toBeVisible();
  });

  test('api keys page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, '/en-US/user/api-keys');
    await expect(page.getByRole('heading', { name: /API Keys|Keys/i })).toBeVisible();
  });
});
