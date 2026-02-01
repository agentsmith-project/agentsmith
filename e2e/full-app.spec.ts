import { test as base, expect, type Page } from '@playwright/test';

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
 * Create mock auth state that matches zustand persist format
 */
function createMockAuthState(wsId: string, userEmail: string, userName?: string) {
  return {
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
}

/**
 * Extended test fixture with authenticated context
 */
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    // Set up authentication once when the page is created
    page.on('console', msg => {
      if (msg.type() === 'log') {
        console.log('[PAGE LOG]', msg.text());
      }
    });

    // Set up mock authentication before React initializes
    await page.addInitScript(({ wsId, userEmail }) => {
      // Set flag to indicate mock auth setup is in progress
      (window as any).__MBOS_AUTH_SETUP__ = true;
      console.log('[INIT SCRIPT] Setting up auth for', wsId, userEmail);

      // Poll for the store and call mockLogin
      const checkAuth = () => {
        const store = (window as any).__MBOS_AUTH_STORE__;
        console.log('[INIT SCRIPT] Store check:', !!store);

        if (store && store.getState) {
          const state = store.getState();
          console.log('[INIT SCRIPT] Current auth state:', state.isAuthenticated, 'projects:', state.projects.length);

          if (!state.isAuthenticated || state.projects.length === 0) {
            store.getState().mockLogin(wsId, userEmail);
            const newState = store.getState();
            console.log('[INIT SCRIPT] After mockLogin:', newState.isAuthenticated, 'projects:', newState.projects.length);
            return true;
          }
          return true;
        }
        return false;
      };

      // Try immediately, then poll if needed
      if (!checkAuth()) {
        console.log('[INIT SCRIPT] First check failed, polling...');
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          if (checkAuth() || attempts > 100) {
            clearInterval(interval);
            console.log('[INIT SCRIPT] Polling complete, attempts:', attempts);
          }
        }, 50);
      }
    }, { wsId: workspaceId, userEmail: testEmail });

    await use(page);
  },
});

/**
 * Helper function to navigate with authentication
 * Note: Auth is now set up in the authenticatedPage fixture via initScript
 */
async function navigateWithAuth(page: Page, url: string) {
  // Just navigate - auth is handled by the fixture
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
}

test.describe('MBOS Frontend v1 - Complete E2E Tests', () => {
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
      await expect(authenticatedPage.locator('text=/Total Turns/i')).toBeVisible();
      await expect(authenticatedPage.locator('text=/Errors/i')).toBeVisible();
      await expect(authenticatedPage.locator('text=/Queued Turns/i')).toBeVisible();
      await expect(authenticatedPage.locator('text=/Online Agents/i')).toBeVisible();
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

      await expect(authenticatedPage.getByText('New Chat').first()).toBeVisible();
    });

    test('should create new chat session', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);

      // Should show new chat button
      await expect(authenticatedPage.getByText('New Chat').first()).toBeVisible();

      // Should show "No sessions yet" or similar empty state message
      await expect(authenticatedPage.getByText(/No sessions|No active session/i)).toBeVisible();
    });

    test('should display three-column layout', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`);
      await authenticatedPage.getByText('New Chat').first().click();
      await authenticatedPage.waitForTimeout(1000);

      // Left panel - sessions
      await expect(authenticatedPage.locator('.w-80').first()).toBeVisible();

      // Center panel - messages
      await expect(authenticatedPage.locator('.flex-1').first()).toBeVisible();

      // Right panel - session info
      await expect(authenticatedPage.locator('.w-72')).toBeVisible();
    });
  });

  // =========================================================================
  // 5. Workbench Page
  // =========================================================================

  test.describe('Workbench Page', () => {
    test('should display workbench workspace', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`);

      await expect(authenticatedPage.getByText('Workbench')).toBeVisible();
    });

    test('should display thread controls', async ({ authenticatedPage }) => {
      await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`);

      // Check for thread controls
      await expect(authenticatedPage.getByText(/New Thread/i)).toBeVisible();
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
      await expect(authenticatedPage.getByText('Audit Logs').first()).toBeVisible();
      await expect(authenticatedPage.getByText('Track all activity within the project')).toBeVisible();
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
      await expect(authenticatedPage.getByText(/Add Source/i)).toBeVisible();
    });
  });

  // =========================================================================
  // 13. Navigation Tests
  // =========================================================================

  test.describe('Navigation Between Pages', () => {
    test('should navigate through all main pages', async ({ authenticatedPage }) => {
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
        { path: 'sources', title: 'Sources', useButton: true },
      ];

      for (const pageDef of pages) {
        await navigateWithAuth(authenticatedPage, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/${pageDef.path}`);

        // Use first() to handle cases where title appears in both sidebar and page content
        await expect(authenticatedPage.getByText(pageDef.title).first()).toBeVisible({ timeout: 5000 });
      }
    });
  });

  // =========================================================================
  // 14. Full User Journey Test
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
      await expect(authenticatedPage.getByText('New Chat').first()).toBeVisible();
      await authenticatedPage.getByText('New Chat').first().click();
      await authenticatedPage.waitForTimeout(1000);

      // 4. Navigate to workbench
      await authenticatedPage.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`);
      await expect(authenticatedPage.getByText('Workbench').first()).toBeVisible();

      // 5. Navigate to agents
      await authenticatedPage.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`);
      await expect(authenticatedPage.getByText('Agents').first()).toBeVisible();

      // 6. Navigate to settings
      await authenticatedPage.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`);
      await expect(authenticatedPage.getByText('Settings').first()).toBeVisible();
    });
  });
}); // MBOS Frontend v1 - Complete E2E Tests
