/**
 * Console Errors & Warnings Test
 *
 * Visits all pages and captures console errors, warnings, and issues.
 * This test helps identify problems that might not cause test failures
 * but should be fixed for production readiness.
 */

import { test as base, expect } from '@playwright/test';

type ConsoleLogs = {
  errors: string[];
  warnings: string[];
  infos: string[];
  logs: string[];
};

type PageFixtures = {
  consoleLogs: ConsoleLogs;
  clearConsole: () => void;
};

const test = base.extend<PageFixtures>({
  consoleLogs: async ({ page }, use) => {
    const logs: ConsoleLogs = {
      errors: [],
      warnings: [],
      infos: [],
      logs: [],
    };

    // Listen to all console events
    page.on('console', msg => {
      const text = msg.text();
      const type = msg.type();

      switch (type) {
        case 'error':
          logs.errors.push(text);
          break;
        case 'warning':
          logs.warnings.push(text);
          break;
        case 'info':
          logs.infos.push(text);
          break;
        case 'log':
          logs.logs.push(text);
          break;
      }
    });

    // Listen to page errors
    page.on('pageerror', error => {
      logs.errors.push(`Page Error: ${error.message}`);
    });

    // Listen to request failures
    page.on('requestfailed', request => {
      const failure = request.failure();
      if (failure) {
        logs.errors.push(`Request Failed: ${request.url()} - ${failure}`);
      }
    });

    await use(logs);
  },

  clearConsole: async ({ page }, use) => {
    const clear = () => {
      // This is just a placeholder - logs are per-page instance
    };
    await use(clear);
  },
});

const baseUrl = 'http://localhost:3000';
const workspaceId = 'ws_default';
const projectId = 'proj_001';
const testEmail = 'test@example.com';

/**
 * Create mock auth state that matches zustand persist format
 */
function createMockAuthState(wsId: string, userEmail: string) {
  return {
    state: {
      user: {
        id: `user_${Math.random().toString(36).substring(2, 10)}`,
        email: userEmail,
        name: userEmail.split('@')[0],
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
        { id: 'ws_default', name: 'Default Workspace', role: 'owner' },
        { id: 'ws_test', name: 'Test Workspace', role: 'admin' },
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
      ],
    },
    version: 0,
  };
}

test.describe('Console Errors & Warnings Detection', () => {
  test.beforeEach(async ({ page }) => {
    // Set up mock authentication before React initializes
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

    // Listen to console for debugging
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[CONSOLE ${msg.type().toUpperCase()}]`, msg.text());
      }
    });
  });

  test('should check all pages for console errors and warnings', async ({ page, consoleLogs }) => {
    // Increase timeout for this comprehensive test (11 pages * ~5 seconds each)
    test.setTimeout(60000);

    const pages = [
      { path: `/en-US/workspaces/${workspaceId}/projects`, name: 'Projects List' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`, name: 'Overview' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`, name: 'Chat' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`, name: 'Workbench' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`, name: 'Agents' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/endpoints`, name: 'Endpoints' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/members`, name: 'Members' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/audit`, name: 'Audit' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/usage`, name: 'Usage' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`, name: 'Settings' },
      { path: `/en-US/workspaces/${workspaceId}/projects/${projectId}/sources`, name: 'Sources' },
    ];

    const allErrors: Record<string, string[]> = {};
    const allWarnings: Record<string, string[]> = {};

    // Known acceptable errors in mock environment (MSW)
    const acceptableErrors = [
      'ERR_EMPTY_RESPONSE',  // Unmocked API endpoints
      'net::ERR_EMPTY_RESPONSE',
      '404 (Not Found)',  // Unmocked API routes return 404
      '500 (Internal Server Error)',  // Unmocked API routes return 500
    ];

    for (const pageInfo of pages) {
      console.log(`\n===== Testing: ${pageInfo.name} =====`);

      // Clear previous logs by creating a new context
      const pageErrors: string[] = [];
      const pageWarnings: string[] = [];

      page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error') {
          // Filter out acceptable errors
          const isAcceptable = acceptableErrors.some(pattern => text.includes(pattern));
          if (!isAcceptable) {
            pageErrors.push(text);
          }
        } else if (msg.type() === 'warning') {
          pageWarnings.push(text);
        }
      });

      // Navigate to the page
      await page.goto(`${baseUrl}${pageInfo.path}`, { waitUntil: 'domcontentloaded' });

      // Wait briefly for any delayed console errors
      await page.waitForTimeout(1000);

      // Store errors and warnings
      allErrors[pageInfo.name] = pageErrors;
      allWarnings[pageInfo.name] = pageWarnings;

      // Log errors for this page
      if (pageErrors.length > 0) {
        console.log(`❌ ${pageInfo.name} - ${pageErrors.length} errors:`);
        pageErrors.forEach((err, i) => console.log(`   ${i + 1}. ${err}`));
      } else {
        console.log(`✅ ${pageInfo.name} - No errors`);
      }

      // Log warnings for this page
      if (pageWarnings.length > 0) {
        console.log(`⚠️  ${pageInfo.name} - ${pageWarnings.length} warnings:`);
        pageWarnings.forEach((warn, i) => console.log(`   ${i + 1}. ${warn}`));
      }
    }

    // Summary
    console.log('\n===== SUMMARY =====');
    const totalErrors = Object.values(allErrors).reduce((sum, errs) => sum + errs.length, 0);
    const totalWarnings = Object.values(allWarnings).reduce((sum, warns) => sum + warns.length, 0);

    console.log(`Total Errors: ${totalErrors}`);
    console.log(`Total Warnings: ${totalWarnings}`);

    // Detailed error report
    if (totalErrors > 0) {
      console.log('\n===== ALL ERRORS =====');
      Object.entries(allErrors).forEach(([page, errs]) => {
        if (errs.length > 0) {
          console.log(`\n${page}:`);
          errs.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
        }
      });
    }

    // Detailed warning report
    if (totalWarnings > 0) {
      console.log('\n===== ALL WARNINGS =====');
      Object.entries(allWarnings).forEach(([page, warns]) => {
        if (warns.length > 0) {
          console.log(`\n${page}:`);
          warns.forEach((warn, i) => console.log(`  ${i + 1}. ${warn}`));
        }
      });
    }

    // Assert that there should be no errors
    expect(totalErrors).toBe(0);
  });

  test('should check hydration errors', async ({ page }) => {
    const hydrationErrors: string[] = [];

    page.on('console', msg => {
      const text = msg.text();
      // Common hydration error patterns
      if (text.includes('hydration') ||
          text.includes('HTML') ||
          text.includes('cannot be a child of') ||
          text.includes('nested')) {
        hydrationErrors.push(text);
      }
    });

    // Visit the overview page as it's most likely to have hydration issues
    await page.goto(`${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    if (hydrationErrors.length > 0) {
      console.log('\n===== HYDRATION ERRORS FOUND =====');
      hydrationErrors.forEach((err, i) => {
        console.log(`${i + 1}. ${err}`);
      });
    }

    expect(hydrationErrors.length).toBe(0);
  });

  test('should check for 404 and 500 errors', async ({ page }) => {
    const failedRequests: Array<{ url: string; status: number; error: string }> = [];

    // Acceptable 404 patterns in mock environment
    const acceptable404Patterns = [
      '/api/',  // Unmocked API routes in MSW
    ];

    page.on('response', response => {
      const status = response.status();
      const url = response.url();

      if (status === 404 || status === 500) {
        // Filter out acceptable 404s
        const isAcceptable404 = status === 404 && acceptable404Patterns.some(pattern => url.includes(pattern));
        if (!isAcceptable404) {
          failedRequests.push({
            url,
            status,
            error: response.status().toString(),
          });
        }
      }
    });

    // Visit all pages
    const pages = [
      `/en-US/workspaces/${workspaceId}/projects`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/chat`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/workbench`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/agents`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/endpoints`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/members`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/audit`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/usage`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/settings`,
      `/en-US/workspaces/${workspaceId}/projects/${projectId}/sources`,
    ];

    for (const pagePath of pages) {
      await page.goto(`${baseUrl}${pagePath}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
    }

    if (failedRequests.length > 0) {
      console.log('\n===== FAILED REQUESTS =====');
      failedRequests.forEach((req, i) => {
        console.log(`${i + 1}. ${req.status} - ${req.url}`);
      });
    }

    expect(failedRequests.length).toBe(0);
  });
});
