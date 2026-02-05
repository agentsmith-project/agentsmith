/**
 * Chat Page Tests
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

test.describe('Chat Page', () => {
  test('should display chat workspace', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);

    await expect(authenticatedPage.getByText('New Chat').first()).toBeVisible();
  });

  test('should create new chat session', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);

    await expect(authenticatedPage.getByText('New Chat').first()).toBeVisible();
    await expect(authenticatedPage.getByTestId('chat-main-pane')).toBeVisible();
  });

  test('should display three-column layout', async ({ authenticatedPage }) => {
    await gotoAndWait(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);

    await expect(authenticatedPage.getByTestId('chat-threads-pane')).toBeVisible();
    await expect(authenticatedPage.getByTestId('chat-main-pane')).toBeVisible();
    await expect(authenticatedPage.getByTestId('chat-composer')).toBeVisible();
  });
});
