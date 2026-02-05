import { test, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

const base = '/en-US/workspaces/ws_default/projects/proj_001';

test.describe('Project misc pages', () => {
  test('credentials page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, `${base}/credentials`);
    await expect(page.getByTestId('page-state__success')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Credentials|Keys/i })).toBeVisible();
  });

  test('userdata page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, `${base}/userdata`);
    await expect(page.getByTestId('page-state__success')).toBeVisible();
    await expect(page.getByRole('heading', { name: /UserData|User Data/i })).toBeVisible();
  });

  test('workbench recipe page loads', async ({ page }) => {
    await withAuth(page);
    await gotoAndWait(page, `${base}/workbench/recipes/recipe_001`);
    await expect(page.getByTestId('page-state__success')).toBeVisible();
    await expect(page.getByTestId('workbench-recipe-header')).toBeVisible();
  });
});
