/**
 * Settings Page Tests
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

test.describe('Settings Page', () => {
  test('should display settings options', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`);

    await expect(authenticatedPage.getByText('Settings').first()).toBeVisible();
  });

  test('should show project configuration options', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`);

    await expect(authenticatedPage.getByRole('tab', { name: 'General' })).toBeVisible();
    await expect(authenticatedPage.getByRole('tab', { name: 'Runtime Preferences' })).toBeVisible();
    await expect(authenticatedPage.getByRole('tab', { name: 'Governance' })).toBeVisible();
    await expect(authenticatedPage.getByRole('tab', { name: 'Limits' })).toBeVisible();
  });
});
