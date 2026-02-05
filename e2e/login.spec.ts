import { test, expect, type Page } from '@playwright/test';

/**
 * E2E Tests for MBOS Frontend - Login Flow
 */

/**
 * Helper function to mock login by setting localStorage directly
 * This simulates the zustand persist storage format
 */
async function mockLogin(page: Page, workspaceId: string, email: string, name?: string) {
  await page.addInitScript(({ wsId, userEmail, userName }) => {
    (window as any).__MBOS_AUTH_SETUP__ = true;
    const user = {
      id: `user_${Math.random().toString(36).substring(2, 10)}`,
      email: userEmail,
      name: userName || userEmail.split('@')[0],
      locale: 'en-US',
    };
    const checkAuth = () => {
      const store = (window as any).__MBOS_AUTH_STORE__;
      if (store && store.getState) {
        const state = store.getState();
        if (!state.isAuthenticated && typeof state.setAuth === 'function') {
          state.setAuth(user, `mock_jwt_token_${Date.now()}`);
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
  }, { wsId: workspaceId, userEmail: email, userName: name });

  await page.reload();
  await page.waitForTimeout(500);
}

test.describe('Homepage', () => {
  test('should display English login page', async ({ page }) => {
    await page.goto('/en-US/login');
    await expect(page.getByRole('heading', { name: 'Welcome to MBOS' })).toBeVisible();
    await expect(page.getByText('Intelligent Agent Platform', { exact: true })).toBeVisible();
  });

  test('should display Chinese login page', async ({ page }) => {
    await page.goto('/zh-CN/login');
    await expect(page.getByText('欢迎使用 MBOS')).toBeVisible();
  });
});

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en-US/login');
    // Clear persisted auth so login form is shown (not redirect)
    await page.evaluate(() => localStorage.removeItem('mbos-auth'));
    await page.reload();
  });

  test('should display login form correctly', async ({ page }) => {
    // Check heading
    await expect(page.getByRole('heading', { name: 'Welcome to MBOS' })).toBeVisible();
    await expect(page.getByText('Intelligent Agent Platform', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // Check Keycloak button
    await expect(page.getByText('Login with Keycloak')).toBeVisible();

    // Check workspace selector (dropdown) - scope to main to avoid Topbar's workspace switcher
    const workspaceSelect = page.getByRole('main').getByRole('button', { name: 'Default Workspace' });
    await expect(workspaceSelect).toBeVisible();

    // Check email input
    const emailInput = page.locator('input[placeholder*="user@example.com"]');
    await expect(emailInput).toBeVisible();

    // Check Quick Login button
    await expect(page.getByText('Quick Login')).toBeVisible();

    // Check development notice
    await expect(page.getByText('Development Mode')).toBeVisible();
    await expect(page.getByText(/Mock authentication/)).toBeVisible();
  });

  test('should have workspace options', async ({ page }) => {
    const workspaceSelect = page.getByRole('main').getByRole('button', { name: 'Default Workspace' });
    await workspaceSelect.click();
    await expect(page.getByRole('menuitem', { name: 'Default Workspace' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Test Workspace' })).toBeVisible();
  });

  test('should enable login button when email is entered', async ({ page }) => {
    const emailInput = page.locator('input[placeholder*="user@example.com"]');
    const loginBtn = page.getByText('Quick Login');

    // Initially disabled
    await expect(loginBtn).toBeDisabled();

    // Enter email
    await emailInput.fill('test@example.com');

    // Button should be enabled
    await expect(loginBtn).toBeEnabled();
  });

  test('should redirect to projects when already authenticated (persisted login)', async ({ page }) => {
    await page.goto('/en-US/login');
    // Set auth state in localStorage (simulates previous login, e.g. from closed browser session)
    await mockLogin(page, 'ws_default', 'test@example.com', 'Test User');
    // After reload, login page should redirect to workspace selection
    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Select your workspace' })).toBeVisible();
  });

  test('should login successfully and redirect to workspace selection', async ({ page }) => {
    const emailInput = page.locator('input[placeholder*="user@example.com"]');
    const loginBtn = page.getByText('Quick Login');

    // Enter credentials
    await emailInput.fill('test@example.com');

    // Click login
    await loginBtn.click();

    // Should redirect to workspace selection page
    await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 5000 });
    await expect(page).toHaveURL(/\/en-US\/login\/workspace/);
    await expect(page.getByRole('heading', { name: 'Select your workspace' })).toBeVisible();
  });
});

test.describe('Projects Page', () => {
  test('should display projects list after login', async ({ page }) => {
    // Go directly to projects page and mock login
    await page.goto('/en-US/workspaces/ws_default/projects');
    await mockLogin(page, 'ws_default', 'test@example.com', 'Test User');

    // Check projects heading
    const heading = page.locator('h1').filter({ hasText: 'Projects' });
    await expect(heading).toBeVisible({ timeout: 5000 });

    // Check workspace info - use .first() to avoid strict mode violation
    await expect(page.getByText(/Workspace:/i)).toBeVisible();
    await expect(page.getByText('Default Workspace').first()).toBeVisible();

    // Check for project cards - use .first() to avoid strict mode violation
    await expect(page.locator('h3').filter({ hasText: /AI Assistant Project|Research Project/ }).first()).toBeVisible();
  });

  test('should navigate to overview when clicking a project', async ({ page }) => {
    // Go to projects page and mock login
    await page.goto('/en-US/workspaces/ws_default/projects');
    await mockLogin(page, 'ws_default', 'test@example.com', 'Test User');

    // Verify projects are visible - use h3 selector
    await expect(page.locator('h3').filter({ hasText: /AI Assistant Project/ })).toBeVisible();

    // Navigate to overview page
    await page.goto('/en-US/workspaces/ws_default/projects/proj_001/overview');

    // Should be on overview page - use h1 to be specific
    await expect(page.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();
  });
});

test.describe('Overview Page', () => {
  test('should display overview page', async ({ page }) => {
    // Mock login first
    await page.goto('/en-US/workspaces/ws_default/projects');
    await mockLogin(page, 'ws_default', 'test@example.com', 'Test User');

    // Navigate to overview
    await page.goto('/en-US/workspaces/ws_default/projects/proj_001/overview');

    // Check overview elements - use h1 to be specific
    await expect(page.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();

    // Check for KPI cards
    await expect(page.getByText('Requests Today').first()).toBeVisible();
  });
});

test.describe('Full User Journey', () => {
  test('should complete full login and navigation flow', async ({ page }) => {
    // 1. Start at login page
    await page.goto('/en-US/login');
    await expect(page.getByText('Welcome to MBOS')).toBeVisible();

    // 2. Login with email
    await page.locator('input[placeholder*="user@example.com"]').fill('user@test.com');
    await page.getByText('Quick Login').click();

    // 3. Should navigate to workspace selection
    await page.waitForURL(/\/login\/workspace/, { timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Select your workspace' })).toBeVisible();

    // 4. Select workspace
    await page.getByText('Default Workspace').click();

    // 5. Should land on projects page
    await page.waitForURL(/\/workspaces\/ws_default\/projects/, { timeout: 5000 });
    await expect(page.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();

    // 6. Navigate to overview
    await page.goto('/en-US/workspaces/ws_default/projects/proj_001/overview');
    await expect(page.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();
  });

  test('should complete two-step login flow', async ({ page }) => {
    // 1. Navigate to login page
    await page.goto('/en-US/login');

    // 2. Fill in email
    await page.locator('input[placeholder*="user@example.com"]').fill('user@test.com');

    // 3. Click Quick Login
    await page.getByText('Quick Login').click();

    // 4. Should navigate to workspace selection
    await page.waitForURL(/\/login\/workspace/, { timeout: 5000 });
    await expect(page).toHaveURL(/\/en-US\/login\/workspace/);

    // 5. Check workspace selection page is displayed
    await expect(page.getByRole('heading', { name: 'Select your workspace' })).toBeVisible();
    await expect(page.getByText('Choose a workspace to continue')).toBeVisible();

    // 6. Select workspace
    await page.getByText('Default Workspace').click();

    // 7. Should land on projects page
    await page.waitForURL(/\/workspaces\/ws_default\/projects/, { timeout: 5000 });
    await expect(page).toHaveURL(/\/en-US\/workspaces\/ws_default\/projects/);

    // 8. Verify projects page is loaded
    await expect(page.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();
  });
});
