/**
 * Usage Page Tests
 */

import { test as base, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

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

test.describe('Usage Page', () => {
  test('should display usage statistics', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/usage`);

    await expect(authenticatedPage.getByTestId('page-state__success')).toBeVisible();
    await expect(authenticatedPage.getByText('Usage').first()).toBeVisible();
  });
});
