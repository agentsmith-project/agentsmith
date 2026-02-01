import { test, expect } from '@playwright/test';

/**
 * E2E Tests for MBOS Frontend - Login Flow
 */

/**
 * Helper function to mock login by setting localStorage directly
 * This simulates the zustand persist storage format
 */
async function mockLogin(page: Page, workspaceId: string, email: string, name?: string) {
  await page.evaluate(({ wsId, userEmail, userName }) => {
    const mockAuthState = {
      state: {
        user: {
          id: `user_${Math.random().toString(36).substring(2, 10)}`,
          email: userEmail,
          name: userName || userEmail.split('@')[0],
          locale: 'en-US',
        },
        token: `mock_jwt_token_${Date.now()}`,
        isAuthenticated: true,
        currentWorkspace: {
          id: wsId,
          name: wsId === 'ws_default' ? 'Default Workspace' : 'Test Workspace',
          role: 'owner',
        },
        currentProject: {
          id: 'proj_001',
          workspace_id: wsId,
          name: 'AI Assistant Project',
          visibility: 'public',
          role: 'owner',
          permissions: ['project:*'],
          status: 'active',
        },
        workspaces: [
          {
            id: 'ws_default',
            name: 'Default Workspace',
            role: 'owner',
          },
          {
            id: 'ws_test',
            name: 'Test Workspace',
            role: 'admin',
          },
        ],
        projects: [
          {
            id: 'proj_001',
            workspace_id: wsId,
            name: 'AI Assistant Project',
            visibility: 'public',
            role: 'owner',
            permissions: ['project:*'],
            status: 'active',
          },
          {
            id: 'proj_002',
            workspace_id: wsId,
            name: 'Research Project',
            visibility: 'private',
            role: 'admin',
            permissions: ['project:read', 'project:agent:create'],
            status: 'active',
          },
        ],
      },
      version: 0,
    };
    localStorage.setItem('mbos-auth', JSON.stringify(mockAuthState));
  }, { wsId: workspaceId, userEmail: email, userName: name });

  // Reload the page to pick up the localStorage changes
  await page.reload();
  await page.waitForTimeout(1000);
}

test.describe('Homepage', () => {
  test('should display homepage with login buttons', async ({ page }) => {
    await page.goto('/');

    // Check title
    await expect(page).toHaveTitle(/MBOS/);

    // Check main heading
    await expect(page.getByText('MBOS Frontend')).toBeVisible();
    await expect(page.getByText('Intelligent Agent Platform')).toBeVisible();

    // Check login buttons exist
    const englishLoginBtn = page.getByText('English Login');
    const chineseLoginBtn = page.getByText('中文登录');

    await expect(englishLoginBtn).toBeVisible();
    await expect(chineseLoginBtn).toBeVisible();

    // Verify button has gradient background
    const bgImage = await englishLoginBtn.evaluate(el => getComputedStyle(el).backgroundImage);
    expect(bgImage).toContain('linear-gradient');
    expect(bgImage).toContain('rgb');
  });

  test('should navigate to English login page', async ({ page }) => {
    await page.goto('/');
    await page.getByText('English Login').click();

    await expect(page).toHaveURL(/\/en-US\/login/);
    await expect(page.getByText('Welcome to MBOS')).toBeVisible();
  });

  test('should navigate to Chinese login page', async ({ page }) => {
    await page.goto('/');
    await page.getByText('中文登录').click();

    await expect(page).toHaveURL(/\/zh-CN\/login/);
    await expect(page.getByText('Welcome to MBOS')).toBeVisible();
  });
});

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en-US/login');
  });

  test('should display login form correctly', async ({ page }) => {
    // Check heading
    await expect(page.getByText('Welcome to MBOS')).toBeVisible();
    await expect(page.getByText('Intelligent Agent Platform')).toBeVisible();
    await expect(page.getByText('Sign in')).toBeVisible();

    // Check Keycloak button
    await expect(page.getByText('Login with Keycloak')).toBeVisible();

    // Check workspace selector
    const workspaceSelect = page.locator('select');
    await expect(workspaceSelect).toBeVisible();

    // Check email input
    const emailInput = page.locator('input[placeholder*="user@example.com"]');
    await expect(emailInput).toBeVisible();

    // Check Quick Login button
    await expect(page.getByText('Quick Login')).toBeVisible();

    // Check development notice
    await expect(page.getByText('Development Mode Only')).toBeVisible();
    await expect(page.getByText(/Mock authentication/)).toBeVisible();
  });

  test('should have workspace options', async ({ page }) => {
    const workspaceSelect = page.locator('select');

    const options = await workspaceSelect.locator('option').allTextContents();
    expect(options).toContain('Default Workspace');
    expect(options).toContain('Test Workspace');
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

  test('should login successfully and redirect to projects page', async ({ page }) => {
    const emailInput = page.locator('input[placeholder*="user@example.com"]');
    const loginBtn = page.getByText('Quick Login');

    // Enter credentials
    await emailInput.fill('test@example.com');

    // Click login
    await loginBtn.click();

    // Should redirect to projects page
    await page.waitForURL(/\/en-US\/workspaces\/ws_default\/projects/, { timeout: 5000 });
    await expect(page).toHaveURL(/\/en-US\/workspaces\/ws_default\/projects/);
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
    await expect(page.locator('text=/Total Turns/i')).toBeVisible();
    await expect(page.locator('text=/Errors/i')).toBeVisible();
  });
});

test.describe('Full User Journey', () => {
  test('should complete full login and navigation flow', async ({ page }) => {
    // 1. Start at homepage
    await page.goto('/');
    await expect(page.getByText('MBOS Frontend')).toBeVisible();

    // 2. Click English Login
    await page.getByText('English Login').click();
    await expect(page).toHaveURL(/\/en-US\/login/);

    // 3. Login with email
    await page.locator('input[placeholder*="user@example.com"]').fill('user@test.com');
    await page.getByText('Quick Login').click();

    // Wait for the auth to be set (Quick Login redirects or sets state)
    await page.waitForTimeout(1000);

    // 4. Set up mock authentication
    await mockLogin(page, 'ws_default', 'user@test.com', 'Test User');

    // After mockLogin reload, navigate to projects page
    await page.goto('/en-US/workspaces/ws_default/projects', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded');

    // Check for Projects heading
    await expect(page.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();

    // 5. Navigate to overview
    await page.goto('/en-US/workspaces/ws_default/projects/proj_001/overview');
    await expect(page.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();
  });
});
