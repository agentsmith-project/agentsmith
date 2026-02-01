/**
 * Homepage & Login Page Tests
 */

import { test as base, expect } from '@playwright/test';

const baseUrl = 'http://localhost:3000';
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

    await page.addInitScript(({ userEmail }) => {
      (window as any).__MBOS_AUTH_SETUP__ = true;
      const checkAuth = () => {
        const store = (window as any).__MBOS_AUTH_STORE__;
        if (store && store.getState) {
          const state = store.getState();
          if (!state.isAuthenticated || state.projects.length === 0) {
            store.getState().mockLogin('ws_default', userEmail);
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
    }, { userEmail });

    await use(page);
  },
});

test.describe('Homepage & Login', () => {
  test('should display homepage with login buttons', async ({ page }) => {
    await page.goto(baseUrl);

    await expect(page.getByText('MBOS Frontend')).toBeVisible();
    await expect(page.getByText('Intelligent Agent Platform')).toBeVisible();
    await expect(page.getByText('English Login')).toBeVisible();
    await expect(page.getByText('中文登录')).toBeVisible();
  });

  test('should navigate to login page', async ({ page }) => {
    await page.goto(baseUrl);
    await page.getByText('English Login').click();

    await expect(page).toHaveURL(/\/en-US\/login/);
    await expect(page.getByText('Welcome to MBOS')).toBeVisible();
  });

  test('should login via Quick Login button', async ({ page }) => {
    await page.goto(`${baseUrl}/en-US/login`);

    await page.locator('input[placeholder*="user@example.com"]').fill(testEmail);
    await page.getByText('Quick Login').click();

    await page.waitForURL(/\/en-US\/workspaces\/ws_default\/projects/, { timeout: 10000 });
  });
});
