/**
 * Overview Page Tests
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

test.describe('Overview Page', () => {
  test('should display overview with KPI cards', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`);

    await expect(authenticatedPage.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();
    await expect(authenticatedPage.getByText(/Requests Today/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/Errors Today/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/Tokens Today/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/UserData Storage/i)).toBeVisible();
  });

  test('should display quick access navigation', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`);

    await expect(authenticatedPage.getByText('Quick Access')).toBeVisible();
    await expect(authenticatedPage.getByText('Chat').first()).toBeVisible();
    await expect(authenticatedPage.getByText('Workbench').first()).toBeVisible();
    await expect(authenticatedPage.getByText('Agents').first()).toBeVisible();
  });
});
