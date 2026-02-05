import { test, expect, type Page } from '@playwright/test';
import { ROUTES } from './fixtures/routes';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

function getRouteExpectation(page: Page, route: { title?: RegExp; testId?: string }) {
  if (route.testId) {
    return page.getByTestId(route.testId);
  }
  if (route.title) {
    return page.getByRole('heading', { name: route.title });
  }
  throw new Error('Route requires either title or testId');
}

test.describe('Route coverage', () => {
  test('required route list', async () => {
    const requiredPaths = [
      '/zh-CN/login',
      '/zh-CN/login/workspace',
      '/zh-CN/join',
      '/zh-CN/workspaces/ws_default/projects',
      '/zh-CN/workspaces/ws_default/settings',
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
      '/zh-CN/workspaces/ws_default/projects/proj_001/credentials',
      '/zh-CN/workspaces/ws_default/projects/proj_001/settings',
      '/zh-CN/user/profile',
      '/zh-CN/user/api-keys',
    ];
    const allRoutes = [...ROUTES.public, ...ROUTES.user, ...ROUTES.workspace, ...ROUTES.project];
    const allPaths = new Set(allRoutes.map((route) => route.path));
    const missing = requiredPaths.filter((path) => !allPaths.has(path));
    expect(missing, `Missing required routes: ${missing.join(', ')}`).toEqual([]);
  });

  test('public routes', async ({ page }) => {
    test.setTimeout(60000);
    for (const route of ROUTES.public) {
      await gotoAndWait(page, route.path);
      await expect(page.getByTestId('page-state__success')).toBeVisible();
      await expect(getRouteExpectation(page, route).first()).toBeVisible();
    }
  });

  test('authenticated routes', async ({ page }) => {
    test.setTimeout(60000);
    await withAuth(page);
    const allAuthed = [...ROUTES.user, ...ROUTES.workspace, ...ROUTES.project];
    for (const route of allAuthed) {
      await gotoAndWait(page, route.path);
      await expect(page.getByTestId('page-state__success')).toBeVisible();
      await expect(getRouteExpectation(page, route).first()).toBeVisible();
    }
  });
});
