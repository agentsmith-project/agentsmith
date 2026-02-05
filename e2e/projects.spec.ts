/**
 * Projects Page Tests
 */

import { test as base, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

const baseUrl = 'http://localhost:3000';
const workspaceId = 'ws_default';
const testEmail = 'test@example.com';

export const test = base.extend<{
  authenticatedPage: typeof base['page']['object'];
}>({
  authenticatedPage: async ({ page }, use) => {
    await withAuth(page, workspaceId, testEmail);
    await use(page);
  },
});

test.describe('Projects Page', () => {
  test('should display projects list', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
    await expect(authenticatedPage.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();
    await expect(authenticatedPage.locator('h3').filter({ hasText: /AI Assistant Project/ })).toBeVisible();
  });

  test('should display project cards with correct info', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
    await expect(authenticatedPage.locator('h3').filter({ hasText: /AI Assistant Project/ })).toBeVisible();

    const projectCard = authenticatedPage.locator('h3').filter({ hasText: /AI Assistant Project/ }).locator('..').locator('..');
    await expect(projectCard.getByText(/public|private/i)).toBeVisible();
  });
});
