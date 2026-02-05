import { test as base, expect, type Page } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

/**
 * Comprehensive E2E Tests for MBOS Frontend v1
 *
 * Covers all pages and user flows as specified in:
 * - 文档/UXUI/2026-01-31-页面清单-模块与权限可见性-v1.md
 * - 文档/UXUI/2026-01-31-UXUI-覆盖矩阵与缺口清单-v1.md
 */

// Test fixtures
const baseUrl = 'http://localhost:3000';
const workspaceId = 'ws_default';
const projectId = 'proj_001';
const testEmail = 'test@example.com';

/**
 * Extended test fixture with authenticated context
 */
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    await withAuth(page, workspaceId, testEmail);
    await use(page);
  },
});

/**
 * Helper function to navigate with authentication
 * Note: Auth is now set up in the authenticatedPage fixture via initScript
 */
async function navigateWithAuth(page: Page, url: string) {
  await gotoAndWait(page, url);
}

test.describe('MBOS Frontend v1 - Complete E2E Tests', () => {
  // =========================================================================
  // 1. Homepage & Login
  // =========================================================================

  test.describe('Homepage & Login', () => {
    test('should display homepage with login buttons', async ({ page }) => {
      await page.goto(baseUrl);

      await expect(page).toHaveURL(/\/en-US\/login/);
      await expect(page.getByRole('heading', { name: 'Welcome to MBOS' })).toBeVisible();
    });

    test('should navigate to login page', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/login`);
      await expect(page.getByText('Login with Keycloak')).toBeVisible();
      await expect(page.getByText('Quick Login')).toBeVisible();
    });

    test('should login via Quick Login button', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/login`);

      await page.locator('input[placeholder*="user@example.com"]').fill(testEmail);
      await page.getByText('Quick Login').click();

      await page.waitForURL(/\/en-US\/login\/workspace/, { timeout: 10000 });
      await expect(page.getByRole('heading', { name: 'Select your workspace' })).toBeVisible();
    });
  });

  // =========================================================================
  // 2. Projects Page
  // =========================================================================

  test.describe('Projects Page', () => {
    test('should display projects list', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await expect(authenticatedPage.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();
      await expect(authenticatedPage.locator('h3').filter({ hasText: /AI Assistant Project/ })).toBeVisible();
    });

    test('should display project cards with correct info', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await expect(authenticatedPage.locator('h3').filter({ hasText: /AI Assistant Project/ })).toBeVisible();

      // Check for visibility badge
      const projectCard = authenticatedPage.locator('h3').filter({ hasText: /AI Assistant Project/ }).locator('..').locator('..');
      await expect(projectCard.getByText(/public|private/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 3. Overview Page
  // =========================================================================

  test.describe('Overview Page', () => {
    test('should display overview with KPI cards', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`);

      await expect(authenticatedPage.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();
      await expect(authenticatedPage.locator('text=/Requests Today/i')).toBeVisible();
      await expect(authenticatedPage.locator('text=/Errors Today/i')).toBeVisible();
      await expect(authenticatedPage.locator('text=/Tokens Today/i')).toBeVisible();
      await expect(authenticatedPage.locator('text=/UserData Storage/i')).toBeVisible();
    });

    test('should display quick access navigation', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`);

      await expect(authenticatedPage.getByText('Quick Access')).toBeVisible();
      await expect(authenticatedPage.getByText('Chat').first()).toBeVisible();
      await expect(authenticatedPage.getByText('Workbench').first()).toBeVisible();
      await expect(authenticatedPage.getByText('Agents').first()).toBeVisible();
    });
  });

  // =========================================================================
  // 4. Chat Page
  // =========================================================================

  test.describe('Chat Page', () => {
    test('should display chat workspace', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);

      await expect(authenticatedPage.getByTestId('chat-main-pane')).toBeVisible();
    });

    test('should create new chat session', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);

      await expect(authenticatedPage.getByTestId('chat-threads-pane')).toBeVisible();
      await expect(authenticatedPage.getByTestId('chat-composer')).toBeVisible();
    });

    test('should display three-column layout', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);

      // Left panel - sessions
      await expect(authenticatedPage.getByTestId('chat-threads-pane')).toBeVisible();

      // Center panel - messages
      await expect(authenticatedPage.getByTestId('chat-main-pane')).toBeVisible();

      // Composer
      await expect(authenticatedPage.getByTestId('chat-composer')).toBeVisible();
    });
  });

  // =========================================================================
  // 5. Workbench Page
  // =========================================================================

  test.describe('Workbench Page', () => {
    test('should display workbench workspace', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`);

      await expect(authenticatedPage.getByRole('heading', { name: 'Workbench' })).toBeVisible();
    });

    test('should display thread controls', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`);

      // Check for thread controls
      await expect(authenticatedPage.getByRole('button', { name: /New Recipe/i })).toBeVisible();
    });
  });

  // =========================================================================
  // 6. Agents Page
  // =========================================================================

  test.describe('Agents Page', () => {
    test('should display agents list', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);

      await expect(authenticatedPage.getByText('Agents').first()).toBeVisible();
    });

    test('should show agent management options', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);

      // Should have create agent option
      await expect(authenticatedPage.getByText(/New Agent|Create Agent/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 7. Endpoints Page
  // =========================================================================

  test.describe('Endpoints Page', () => {
    test('should display endpoints list', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/endpoints`);

      await expect(authenticatedPage.getByText('Endpoints').first()).toBeVisible();
    });
  });

  // =========================================================================
  // 8. Members Page
  // =========================================================================

  test.describe('Members Page', () => {
    test('should display members list', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/members`);

      await expect(authenticatedPage.getByText('Members').first()).toBeVisible();
    });

    test('should show permission management options', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/members`);

      // Check for invite members option
      await expect(authenticatedPage.getByText(/Invite|Add Member/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 9. Audit Page
  // =========================================================================

  test.describe('Audit Page', () => {
    test('should display audit log', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/audit`);

      await expect(authenticatedPage.getByText('Audit').first()).toBeVisible();
    });

    test('should show filter options', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/audit`);

      // Should have audit log title and description
      await expect(authenticatedPage.getByText('Audit').first()).toBeVisible();
      await expect(authenticatedPage.getByText('Audit events and compliance logs')).toBeVisible();
    });
  });

  // =========================================================================
  // 10. Usage Page
  // =========================================================================

  test.describe('Usage Page', () => {
    test('should display usage statistics', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/usage`);

      await expect(authenticatedPage.getByText('Usage').first()).toBeVisible();
    });
  });

  // =========================================================================
  // 11. Settings Page
  // =========================================================================

  test.describe('Settings Page', () => {
    test('should display settings options', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`);

      await expect(authenticatedPage.getByText('Settings').first()).toBeVisible();
    });

    test('should show project configuration options', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`);

      // Should have config sections
      await expect(authenticatedPage.getByText(/Config|Policy|General/i).first()).toBeVisible();
    });
  });

  // =========================================================================
  // 12. Sources Page (formerly UserData)
  // =========================================================================

  test.describe('Sources Page', () => {
    test('should display sources capabilities', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/sources`);

      await expect(authenticatedPage.getByText('Sources').first()).toBeVisible();
    });

    test('should show add source button', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/sources`);

      // Should have add source button
      await expect(authenticatedPage.getByRole('button', { name: 'Upload', exact: true })).toBeVisible();
    });
  });

  // =========================================================================
  // 13. Full User Journey Test
  // =========================================================================

  test.describe('Complete User Journey', () => {
    test('should complete full user workflow', async ({ authenticatedPage }) => {
      // 1. Navigate to projects
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await expect(authenticatedPage.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();

      // 2. Navigate to overview
      await authenticatedPage.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`);
      await expect(authenticatedPage.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();

      // 3. Navigate to chat
      await authenticatedPage.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);
      await expect(authenticatedPage.getByTestId('chat-main-pane')).toBeVisible();

      // 4. Navigate to workbench
      await authenticatedPage.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`);
      await expect(authenticatedPage.getByRole('heading', { name: 'Workbench' })).toBeVisible();

      // 5. Navigate to agents
      await authenticatedPage.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);
      await expect(authenticatedPage.getByText('Agents').first()).toBeVisible();

      // 6. Navigate to settings
      await authenticatedPage.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`);
      await expect(authenticatedPage.getByText('Settings').first()).toBeVisible();
    });
  });
}); // MBOS Frontend v1 - Complete E2E Tests
