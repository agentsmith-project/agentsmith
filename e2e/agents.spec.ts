/**
 * Agents Page Tests
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

test.describe('Agents Page', () => {
  test('should display agents list', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);

    await expect(authenticatedPage.getByTestId('page-state__success')).toBeVisible();
    await expect(authenticatedPage.getByText('Agents').first()).toBeVisible();
  });

  test('should show agent management options', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);

    await expect(authenticatedPage.getByTestId('page-state__success')).toBeVisible();
    // Look for "New Agent" button or "Create Agent" in empty state
    await expect(authenticatedPage.getByText(/New Agent|Create Agent/i)).toBeVisible();
  });
});
