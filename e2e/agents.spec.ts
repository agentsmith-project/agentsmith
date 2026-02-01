/**
 * Agents Page Tests
 */

import { test as base, expect } from '@playwright/test';

const baseUrl = 'http://localhost:3000';
const workspaceId = 'ws_default';
const projectId = 'proj_001';
const testEmail = 'test@example.com';

export const test = base.extend<{
  authenticatedPage: typeof base['page']['object'];
}>({
  authenticatedPage: async ({ page }, use) => {
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[CONSOLE ${msg.type().toUpperCase()}]`, msg.text());
      }
    });

    await page.addInitScript(({ wsId, userEmail }) => {
      (window as any).__MBOS_AUTH_SETUP__ = true;
      const checkAuth = () => {
        const store = (window as any).__MBOS_AUTH_STORE__;
        if (store && store.getState) {
          const state = store.getState();
          if (!state.isAuthenticated || state.projects.length === 0) {
            store.getState().mockLogin(wsId, userEmail);
            return true;
          }
          return true;
        }
        return false;
      };
      if (!checkAuth()) {
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          if (checkAuth() || attempts > 100) {
            clearInterval(interval);
          }
        }, 50);
      }
    }, { wsId: workspaceId, userEmail: testEmail });

    await use(page);
  },
});

async function navigateWithAuth(page: typeof base['page']['object'], url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
}

test.describe('Agents Page', () => {
  test('should display agents list', async ({ authenticatedPage }) => {
    await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);

    await expect(authenticatedPage.getByText('Agents').first()).toBeVisible();
  });

  test('should show agent management options', async ({ authenticatedPage }) => {
    await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);

    // Look for "New Agent" button or "Create Agent" in empty state
    await expect(authenticatedPage.getByText(/New Agent|Create Agent/i)).toBeVisible();
  });
});
