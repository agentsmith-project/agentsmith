/**
 * Projects Page Tests
 */

import { test as base, expect } from '@playwright/test';

const baseUrl = 'http://localhost:3000';
const workspaceId = 'ws_default';
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

test.describe('Projects Page', () => {
  test('should display projects list', async ({ authenticatedPage }) => {
    await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
    await expect(authenticatedPage.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();
    await expect(authenticatedPage.locator('h3').filter({ hasText: /AI Assistant Project/ })).toBeVisible();
  });

  test('should display project cards with correct info', async ({ authenticatedPage }) => {
    await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
    await expect(authenticatedPage.locator('h3').filter({ hasText: /AI Assistant Project/ })).toBeVisible();

    const projectCard = authenticatedPage.locator('h3').filter({ hasText: /AI Assistant Project/ }).locator('..').locator('..');
    await expect(projectCard.getByText(/public|private/i)).toBeVisible();
  });
});
