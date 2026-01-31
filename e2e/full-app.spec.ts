import { test, expect } from '@playwright/test';

/**
 * Comprehensive E2E Tests for MBOS Frontend v1
 *
 * Covers all pages and user flows as specified in:
 * - 文档/UXUI/2026-01-31-页面清单-模块与权限可见性-v1.md
 * - 文档/UXUI/2026-01-31-UXUI-覆盖矩阵与缺口清单-v1.md
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

    // Force a page reload to ensure zustand picks up the localStorage change
    // This is necessary because skipHydration: true means the store won't auto-hydrate
    location.reload();
  }, { wsId: workspaceId, userEmail: email, userName: name });

  // Wait for the reload to complete
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

test.describe('MBOS Frontend v1 - Complete E2E Tests', () => {
  // Fixtures
  const baseUrl = 'http://localhost:3000';
  const workspaceId = 'ws_default';
  const projectId = 'proj_001';
  const testEmail = 'test@example.com';

  // =========================================================================
  // 1. Homepage & Login
  // =========================================================================

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

  // =========================================================================
  // 2. Projects Page
  // =========================================================================

  test.describe('Projects Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display projects list', async ({ page }) => {
      await expect(page.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();
      await expect(page.locator('h3').filter({ hasText: /AI Assistant Project/ })).toBeVisible();
    });

    test('should display project cards with correct info', async ({ page }) => {
      await expect(page.locator('h3').filter({ hasText: /AI Assistant Project/ })).toBeVisible();

      // Check for visibility badge
      const projectCard = page.locator('h3').filter({ hasText: /AI Assistant Project/ }).locator('..').locator('..');
      await expect(projectCard.getByText(/public|private/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 3. Overview Page
  // =========================================================================

  test.describe('Overview Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display overview with KPI cards', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`);

      await expect(page.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();
      await expect(page.locator('text=/Total Turns/i')).toBeVisible();
      await expect(page.locator('text=/Errors/i')).toBeVisible();
      await expect(page.locator('text=/Queued Turns/i')).toBeVisible();
      await expect(page.locator('text=/Online Agents/i')).toBeVisible();
    });

    test('should display quick access navigation', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`);

      await expect(page.getByText('Quick Access')).toBeVisible();
      await expect(page.getByText('Chat').first()).toBeVisible();
      await expect(page.getByText('Workbench').first()).toBeVisible();
      await expect(page.getByText('Agents').first()).toBeVisible();
    });
  });

  // =========================================================================
  // 4. Chat Page
  // =========================================================================

  test.describe('Chat Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display chat workspace', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);

      await expect(page.getByText('New Chat').first()).toBeVisible();
    });

    test('should create new chat session', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);

      await page.getByText('New Chat').first().click();
      await page.waitForTimeout(1000);

      // Should show chat interface
      await expect(page.getByPlaceholderText(/Type a message/i)).toBeVisible();
      await expect(page.getByText('Send').first()).toBeVisible();
    });

    test('should display three-column layout', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);
      await page.getByText('New Chat').first().click();
      await page.waitForTimeout(1000);

      // Left panel - sessions
      await expect(page.locator('.w-80').first()).toBeVisible();

      // Center panel - messages
      await expect(page.locator('.flex-1').first()).toBeVisible();

      // Right panel - session info
      await expect(page.locator('.w-72')).toBeVisible();
    });
  });

  // =========================================================================
  // 5. Workbench Page
  // =========================================================================

  test.describe('Workbench Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display workbench workspace', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`);

      await expect(page.getByText('Workbench')).toBeVisible();
    });

    test('should display thread controls', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`);

      // Check for thread controls
      await expect(page.getByText(/New Thread/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 6. Agents Page
  // =========================================================================

  test.describe('Agents Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display agents list', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);

      await expect(page.getByText('Agents').first()).toBeVisible();
    });

    test('should show agent management options', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);

      // Should have create agent option
      await expect(page.getByText(/Create Agent|Add Agent/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 7. Endpoints Page
  // =========================================================================

  test.describe('Endpoints Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display endpoints list', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/endpoints`);

      await expect(page.getByText('Endpoints').first()).toBeVisible();
    });
  });

  // =========================================================================
  // 8. Members Page
  // =========================================================================

  test.describe('Members Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display members list', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/members`);

      await expect(page.getByText('Members').first()).toBeVisible();
    });

    test('should show permission management options', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/members`);

      // Check for invite members option
      await expect(page.getByText(/Invite|Add Member/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 9. Audit Page
  // =========================================================================

  test.describe('Audit Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display audit log', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/audit`);

      await expect(page.getByText('Audit').first()).toBeVisible();
    });

    test('should show filter options', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/audit`);

      // Should have filter controls
      await expect(page.locator('select, input[type="text"]').first()).toBeVisible();
    });
  });

  // =========================================================================
  // 10. Usage Page
  // =========================================================================

  test.describe('Usage Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display usage statistics', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/usage`);

      await expect(page.getByText('Usage').first()).toBeVisible();
    });
  });

  // =========================================================================
  // 11. Settings Page
  // =========================================================================

  test.describe('Settings Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display settings options', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`);

      await expect(page.getByText('Settings').first()).toBeVisible();
    });

    test('should show project configuration options', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`);

      // Should have config sections
      await expect(page.getByText(/Config|Policy|General/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 12. UserData Page
  // =========================================================================

  test.describe('UserData Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);
    });

    test('should display userdata capabilities', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/userdata`);

      await expect(page.getByText('UserData').first()).toBeVisible();
    });

    test('should show quota information', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/userdata`);

      // Should have capability toggles or quota displays
      await expect(page.getByText(/DocDB|VectorDB|Storage|Quota/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 13. Navigation Tests
  // =========================================================================

  test.describe('Navigation Between Pages', () => {
    test('should navigate through all main pages', async ({ page }) => {
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await mockLogin(page, workspaceId, testEmail);

      const pages = [
        { path: 'overview', title: 'Overview' },
        { path: 'chat', title: 'New Chat', useButton: true },
        { path: 'workbench', title: 'Workbench', useButton: true },
        { path: 'agents', title: 'Agents', useButton: true },
        { path: 'endpoints', title: 'Endpoints', useButton: true },
        { path: 'members', title: 'Members', useButton: true },
        { path: 'audit', title: 'Audit', useButton: true },
        { path: 'usage', title: 'Usage', useButton: true },
        { path: 'settings', title: 'Settings', useButton: true },
        { path: 'userdata', title: 'UserData', useButton: true },
      ];

      for (const pageDef of pages) {
        await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/${pageDef.path}`);
        await page.waitForTimeout(500);

        // Try different selector strategies
        if (pageDef.useButton) {
          await expect(page.getByText(pageDef.title).first()).toBeVisible({ timeout: 5000 });
        } else {
          await expect(page.getByText(pageDef.title).or(page.locator('h1').filter({ hasText: pageDef.title }))).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });

  // =========================================================================
  // 14. Full User Journey Test
  // =========================================================================

  test.describe('Complete User Journey', () => {
    test('should complete full user workflow', async ({ page }) => {
      // 1. Start at homepage
      await page.goto(baseUrl);
      await expect(page.getByText('MBOS Frontend')).toBeVisible();

      // 2. Login
      await page.getByText('English Login').click();
      await page.locator('input[placeholder*="user@example.com"]').fill(testEmail);
      await page.getByText('Quick Login').click();
      await page.waitForURL(/\/en-US\/workspaces\/ws_default\/projects/, { timeout: 10000 });

      // Mock login for tests
      await mockLogin(page, workspaceId, testEmail);

      // 3. Navigate to projects
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects`);
      await expect(page.locator('h1').filter({ hasText: 'Projects' })).toBeVisible();

      // 4. Navigate to overview
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`);
      await expect(page.locator('h1').filter({ hasText: 'Overview' })).toBeVisible();

      // 5. Navigate to chat
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);
      await expect(page.getByText('New Chat').first()).toBeVisible();
      await page.getByText('New Chat').first().click();
      await page.waitForTimeout(1000);

      // 6. Navigate to workbench
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`);
      await expect(page.getByText('Workbench').first()).toBeVisible();

      // 7. Navigate to agents
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);
      await expect(page.getByText('Agents').first()).toBeVisible();

      // 8. Navigate to settings
      await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`);
      await expect(page.getByText('Settings').first()).toBeVisible();
    });
  });
});
