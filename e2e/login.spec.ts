import { test, expect } from './fixtures/test-base';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait, waitForPageReady } from './utils/navigation';

async function clearAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('agentsmith-auth');
  });
}

test.describe('Login Entry', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('redirects default login entry to workspace selection in English', async ({ page }) => {
    await gotoAndWait(page, '/en-US/login');
    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 10_000 });
    await waitForPageReady(page);

    await expect(page.getByTestId('page-state__success')).toBeVisible();
    await expect(page.getByTestId('workspace-select__heading')).toBeVisible();
    await expect(page.getByTestId('workspace-select__system-link')).toBeVisible();
  });

  test('shows login entry heading in Chinese', async ({ page }) => {
    await gotoAndWait(page, '/zh-CN/login');
    await page.waitForURL(/\/zh-CN\/login\/workspace/, { timeout: 10_000 });
    await waitForPageReady(page);

    await expect(page.getByTestId('workspace-select__heading')).toHaveText('选择您的工作空间');
  });

  test('system 管理侧入口仍然可以从工作区选择页进入', async ({ page }) => {
    await gotoAndWait(page, '/en-US/login');
    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 10_000 });
    await waitForPageReady(page);

    await page.getByTestId('workspace-select__system-link').click();
    await page.waitForURL(/\/en-US\/system\/login/, { timeout: 10_000 });
    await expect(page.getByTestId('system-login__heading')).toBeVisible();
  });

  test('authenticated user on /login is redirected to workspace selection', async ({ page }) => {
    await withAuth(page, 'ws_default', 'test@example.com');

    await gotoAndWait(page, '/en-US/login');
    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 10_000 });
    await waitForPageReady(page);
    await expect(page.getByTestId('workspace-select__heading')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Workspace Login Journey', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('workspace select leads to workspace-scoped login', async ({ page }) => {
    await gotoAndWait(page, '/en-US/login/workspace');
    await waitForPageReady(page);

    await page.getByTestId('workspace-select__card--ws_default').click();
    await page.waitForURL(/\/en-US\/workspaces\/ws_default\/login/, { timeout: 10_000 });
    await expect(page.getByTestId('workspace-login__heading')).toBeVisible();
  });

  test('mock workspace login reaches workspace business surface', async ({ page }) => {
    await gotoAndWait(page, '/en-US/login/workspace');
    await waitForPageReady(page);

    await page.getByTestId('workspace-select__card--ws_default').click();
    await page.waitForURL(/\/en-US\/workspaces\/ws_default\/login/, { timeout: 10_000 });

    await page.getByTestId('workspace-login__email-input').fill('user@test.com');
    await page.getByTestId('workspace-login__submit').click();

    await page.waitForURL(/\/en-US\/workspaces\/ws_default$/, { timeout: 15_000 });
    await expect(page.getByTestId('projects__page')).toBeVisible();
    await expect(page.getByTestId('projects__create-btn')).toBeVisible();
  });

  test('workspace-scoped login does not expose the system 管理侧入口', async ({ page }) => {
    await gotoAndWait(page, '/en-US/login/workspace');
    await waitForPageReady(page);

    await page.getByTestId('workspace-select__card--ws_default').click();
    await page.waitForURL(/\/en-US\/workspaces\/ws_default\/login/, { timeout: 10_000 });
    await expect(page.getByText('System administration')).toHaveCount(0);
  });
});
