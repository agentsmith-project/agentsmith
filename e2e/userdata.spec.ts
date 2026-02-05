/**
 * Sources Page Tests (formerly UserData)
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

test.describe('Sources Page', () => {
  test('should display sources capabilities', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/sources`);

    await expect(authenticatedPage.getByTestId('page-state__success')).toBeVisible();
    await expect(authenticatedPage.getByText('Sources').first()).toBeVisible();
  });

  test('should show add source button', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/sources`);

    await expect(authenticatedPage.getByTestId('page-state__success')).toBeVisible();
    await expect(authenticatedPage.getByRole('button', { name: 'Upload', exact: true })).toBeVisible();
  });
});
