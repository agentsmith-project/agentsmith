import { test, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

test('auth fixture seeds login', async ({ page }) => {
  await withAuth(page);
  await gotoAndWait(page, '/en-US/workspaces/ws_default/projects');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
});
