/**
 * Login Flow E2E Tests
 *
 * Tests the unauthenticated login experience:
 * page display, i18n, workspace selection, email validation,
 * the Quick Login flow, full user journey, and persisted-login redirect.
 *
 * Uses raw `page` (not `authedPage`) because we are testing unauthenticated state.
 */

import { test, expect } from './fixtures/test-base';
import { withAuth } from './fixtures/authenticated';
import { waitForPageReady } from './utils/navigation';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Clear any persisted auth so the login form is shown instead of a redirect. */
async function clearAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('mbos-auth');
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Login Page Display (EN)', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await page.goto('/en-US/login');
    await waitForPageReady(page);
  });

  test('shows page-state success', async ({ page }) => {
    await expect(page.getByTestId('page-state__success')).toBeVisible();
  });

  test('shows "Welcome to MBOS" heading', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Welcome to MBOS' }),
    ).toBeVisible();
  });

  test('shows "Intelligent Agent Platform" subtitle', async ({ page }) => {
    await expect(
      page.getByText('Intelligent Agent Platform', { exact: true }),
    ).toBeVisible();
  });

  test('shows Keycloak login button', async ({ page }) => {
    await expect(page.getByTestId('login__keycloak-btn')).toBeVisible();
  });

  test('shows workspace selector', async ({ page }) => {
    await expect(page.getByTestId('login__workspace-select')).toBeVisible();
  });

  test('shows email input', async ({ page }) => {
    await expect(page.getByTestId('login__email-input')).toBeVisible();
  });

  test('shows Quick Login button — disabled initially', async ({ page }) => {
    const submitBtn = page.getByTestId('login__submit');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });
});

test.describe('Login Page Display (ZH)', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await page.goto('/zh-CN/login');
    await waitForPageReady(page);
  });

  test('shows page-state success', async ({ page }) => {
    await expect(page.getByTestId('page-state__success')).toBeVisible();
  });

  test('shows Chinese welcome text', async ({ page }) => {
    await expect(page.getByText('欢迎使用 MBOS')).toBeVisible();
  });
});

test.describe('Workspace Selector', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await page.goto('/en-US/login');
    await waitForPageReady(page);
  });

  test('dropdown shows Default and Test workspace options', async ({ page }) => {
    const selector = page.getByTestId('login__workspace-select');
    await selector.click();

    await expect(
      page.getByRole('menuitem', { name: 'Default Workspace' }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Test Workspace' }),
    ).toBeVisible();
  });
});

test.describe('Email Enables Login', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await page.goto('/en-US/login');
    await waitForPageReady(page);
  });

  test('Quick Login button becomes enabled after entering email', async ({ page }) => {
    const emailInput = page.getByTestId('login__email-input');
    const submitBtn = page.getByTestId('login__submit');

    // Initially disabled
    await expect(submitBtn).toBeDisabled();

    // Fill email
    await emailInput.fill('test@example.com');

    // Now enabled
    await expect(submitBtn).toBeEnabled();
  });
});

test.describe('Quick Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
    await page.goto('/en-US/login');
    await waitForPageReady(page);
  });

  test('fills email, clicks Quick Login, redirects to workspace selection', async ({
    page,
  }) => {
    const emailInput = page.getByTestId('login__email-input');
    const submitBtn = page.getByTestId('login__submit');

    await emailInput.fill('test@example.com');
    await submitBtn.click();

    // Should redirect to workspace selection
    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/en-US\/login\/workspace/);

    // Workspace selection page should show heading
    await expect(
      page.getByTestId('workspace-select__heading'),
    ).toBeVisible({ timeout: 10_000 });

    // Should show workspace cards
    await expect(
      page.getByTestId('workspace-select__card--ws_default'),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Full Login Journey', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('login → select workspace → projects → navigate to overview', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // 1. Start at login page
    await page.goto('/en-US/login');
    await waitForPageReady(page);
    await expect(page.getByText('Welcome to MBOS')).toBeVisible({ timeout: 10_000 });

    // 2. Enter email and click Quick Login
    await page.getByTestId('login__email-input').fill('user@test.com');
    await page.getByTestId('login__submit').click();

    // 3. Should navigate to workspace selection
    await page.waitForURL(/\/login\/workspace/, { timeout: 15_000 });
    await expect(
      page.getByTestId('workspace-select__heading'),
    ).toBeVisible({ timeout: 15_000 });

    // 4. Select workspace
    await page.getByText('Default Workspace').click();

    // 5. Should land on projects page
    await page.waitForURL(/\/workspaces\/ws_default\/projects/, {
      timeout: 15_000,
    });
    await expect(
      page.locator('h1').filter({ hasText: 'Projects' }),
    ).toBeVisible({ timeout: 15_000 });

    // 6. Verify project data is loaded
    await expect(
      page.getByTestId('projects__table').or(page.getByText(/AI Assistant/i)).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Persisted Login Redirect', () => {
  test('authenticated user on /login is redirected to workspace selection', async ({
    page,
  }) => {
    // Set auth via the shared withAuth helper (same as authedPage uses)
    await withAuth(page, 'ws_default', 'test@example.com');

    await page.goto('/en-US/login');

    // The login page should detect existing auth and redirect
    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 10_000 });
    await expect(
      page.getByRole('heading', { name: /Select your workspace|选择工作区/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
