import { test, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

const PROJECT_ROUTES = [
  '/zh-CN/workspaces/ws_default/projects/proj_001/overview',
  '/zh-CN/workspaces/ws_default/projects/proj_001/chat',
  '/zh-CN/workspaces/ws_default/projects/proj_001/workbench',
  '/zh-CN/workspaces/ws_default/projects/proj_001/agents',
  '/zh-CN/workspaces/ws_default/projects/proj_001/endpoints',
  '/zh-CN/workspaces/ws_default/projects/proj_001/members',
  '/zh-CN/workspaces/ws_default/projects/proj_001/audit',
  '/zh-CN/workspaces/ws_default/projects/proj_001/usage',
  '/zh-CN/workspaces/ws_default/projects/proj_001/userdata',
  '/zh-CN/workspaces/ws_default/projects/proj_001/sources',
  '/zh-CN/workspaces/ws_default/projects/proj_001/settings',
];

test.describe('UX guardrails', () => {
  test('login has primary CTA', async ({ page }) => {
    await gotoAndWait(page, '/zh-CN/login');
    await expect(page.getByTestId('page-state__success')).toBeVisible();
    await expect(page.getByTestId('login__submit')).toBeVisible();
  });

  test('project pages render shell and avoid horizontal overflow', async ({ page }) => {
    test.setTimeout(90000);
    await withAuth(page);

    for (const path of PROJECT_ROUTES) {
      await gotoAndWait(page, path);
      await expect(page.getByTestId('page-state__success')).toBeVisible();

      await expect(page.locator('header').first()).toBeVisible();
      await expect(page.locator('aside').first()).toBeVisible();

      const hasOverflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > window.innerWidth + 1;
      });
      expect(hasOverflow, `Unexpected horizontal overflow at ${path}`).toBeFalsy();
    }
  });
});
