import { test, expect } from '@playwright/test';

test('login button has testid', async ({ page }) => {
  await page.goto('/en-US/login');
  await expect(page.getByTestId('login__submit')).toBeVisible();
});
