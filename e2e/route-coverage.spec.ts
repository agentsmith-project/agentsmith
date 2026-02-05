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
  test('public routes', async ({ page }) => {
    test.setTimeout(60000);
    for (const route of ROUTES.public) {
      await gotoAndWait(page, route.path);
      await expect(getRouteExpectation(page, route).first()).toBeVisible();
    }
  });

  test('authenticated routes', async ({ page }) => {
    test.setTimeout(60000);
    await withAuth(page);
    const allAuthed = [...ROUTES.user, ...ROUTES.workspace, ...ROUTES.project];
    for (const route of allAuthed) {
      await gotoAndWait(page, route.path);
      await expect(getRouteExpectation(page, route).first()).toBeVisible();
    }
  });
});
