/**
 * Audit Page Tests
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

test.describe('Audit Page', () => {
  test('should display audit log', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/audit`);

    await expect(authenticatedPage.getByTestId('page-state__success')).toBeVisible();
    await expect(authenticatedPage.getByText('Audit').first()).toBeVisible();
  });

  test('should show audit log title and description', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/audit`);

    await expect(authenticatedPage.getByTestId('page-state__success')).toBeVisible();
    await expect(authenticatedPage.getByText('Audit').first()).toBeVisible();
    await expect(authenticatedPage.getByText('Audit events and compliance logs')).toBeVisible();
  });
});
