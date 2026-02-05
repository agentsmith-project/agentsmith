/**
 * Navigation Tests
 */

import { test as base, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';
import { ROUTES } from './fixtures/routes';

const baseUrl = 'http://localhost:3000';
const workspaceId = 'ws_default';
const projectId = 'proj_001';
const testEmail = 'test@example.com';

export const test = base.extend<{
  authenticatedPage: typeof base['page']['object'];
}>({
  authenticatedPage: async ({ page }, use) => {
    await withAuth(page, workspaceId, testEmail);
    await use(page);
  },
});

test.describe('Navigation Between Pages', () => {
  const getRouteExpectation = (page: typeof base['page']['object'], route: { title?: RegExp; testId?: string }) => {
    if (route.testId) {
      return page.getByTestId(route.testId);
    }
    if (route.title) {
      return page.getByRole('heading', { name: route.title });
    }
    throw new Error('Route requires either title or testId');
  };

  test('should navigate through all main pages', async ({ authenticatedPage }) => {
    test.setTimeout(60000);
    for (const route of ROUTES.project) {
      await gotoAndWait(authenticatedPage, `${baseUrl}${route.path}`);
      await expect(getRouteExpectation(authenticatedPage, route).first()).toBeVisible({ timeout: 5000 });
    }
  });
});
