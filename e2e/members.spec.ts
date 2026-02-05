/**
 * Members Page Tests
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

test.describe('Members Page', () => {
  test('should display members list', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/members`);

    await expect(authenticatedPage.getByTestId('page-state__success')).toBeVisible();
    await expect(authenticatedPage.getByText('Members').first()).toBeVisible();
  });

  test('should show permission management options', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/members`);

    await expect(authenticatedPage.getByTestId('page-state__success')).toBeVisible();
    await expect(authenticatedPage.getByText(/Invite|Add Member/i)).toBeVisible();
  });
});
