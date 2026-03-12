import { test, expect } from './fixtures/test-base';
import { withAuth } from './fixtures/authenticated';
import { waitForPageReady } from './utils/navigation';

async function clearAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('agentsmith-auth');
  });
}

test.describe('Login Entry', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('shows workspace and system entry actions in English', async ({ page }) => {
    await page.goto('/en-US/login');
    await waitForPageReady(page);

    await expect(page.getByTestId('page-state__success')).toBeVisible();
    await expect(page.getByTestId('login-entry__heading')).toBeVisible();
    await expect(page.getByTestId('login-entry__workspace')).toBeVisible();
    await expect(page.getByTestId('login-entry__system')).toBeVisible();
  });

  test('shows login entry heading in Chinese', async ({ page }) => {
    await page.goto('/zh-CN/login');
    await waitForPageReady(page);

    await expect(page.getByText('选择进入 AgentSmith 的方式')).toBeVisible();
  });

  test('workspace entry opens workspace selection', async ({ page }) => {
    await page.goto('/en-US/login');
    await waitForPageReady(page);

    await page.getByTestId('login-entry__workspace').click();
    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 10_000 });
    await expect(page.getByTestId('workspace-select__heading')).toBeVisible();
  });

  test('system entry opens system login', async ({ page }) => {
    await page.goto('/en-US/login');
    await waitForPageReady(page);

    await page.getByTestId('login-entry__system').click();
    await page.waitForURL(/\/en-US\/system\/login/, { timeout: 10_000 });
    await expect(page.getByTestId('system-login__heading')).toBeVisible();
  });

  test('authenticated user on /login is redirected to workspace selection', async ({ page }) => {
    await withAuth(page, 'ws_default', 'test@example.com');

    await page.goto('/en-US/login');
    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 10_000 });
    await expect(page.getByTestId('workspace-select__heading')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Workspace Login Journey', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('workspace select leads to workspace-scoped login', async ({ page }) => {
    await page.goto('/en-US/login/workspace');
    await waitForPageReady(page);

    await page.getByTestId('workspace-select__card--ws_default').click();
    await page.waitForURL(/\/en-US\/workspaces\/ws_default\/login/, { timeout: 10_000 });
    await expect(page.getByTestId('workspace-login__heading')).toBeVisible();
  });

  test('mock workspace login reaches workspace business surface', async ({ page }) => {
    await page.goto('/en-US/login/workspace');
    await waitForPageReady(page);

    await page.getByTestId('workspace-select__card--ws_default').click();
    await page.waitForURL(/\/en-US\/workspaces\/ws_default\/login/, { timeout: 10_000 });

    await page.getByTestId('workspace-login__email-input').fill('user@test.com');
    await page.getByTestId('workspace-login__submit').click();

    await page.waitForURL(/\/en-US\/workspaces\/ws_default\/projects/, { timeout: 15_000 });
    const projectTable = page.getByTestId('projects__table');
    const permissionDenied = page.getByText('Permission Denied');

    await expect(async () => {
      const tableVisible = await projectTable.isVisible().catch(() => false);
      const deniedVisible = await permissionDenied.isVisible().catch(() => false);
      expect(tableVisible || deniedVisible).toBe(true);
    }).toPass({ timeout: 15_000 });
  });
});
