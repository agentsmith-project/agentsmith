/**
 * Console Errors & Warnings Test
 *
 * Visits all pages and captures console errors, warnings, and issues.
 * This test helps identify problems that might not cause test failures
 * but should be fixed for production readiness.
 */

import { test as base, expect } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';
import { ROUTES } from './fixtures/routes';

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

test.describe('Console Errors & Warnings Detection', () => {
  test.beforeEach(async ({ page }) => {
    // Listen to console for debugging
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[CONSOLE ${msg.type().toUpperCase()}]`, msg.text());
      }
    });
  });

  test('should check all pages for console errors and warnings', async ({ page, consoleLogs }) => {
    // Increase timeout for this comprehensive test (11 pages * ~5 seconds each)
    test.setTimeout(120000);

    const pages = [
      ...ROUTES.public.map((route) => ({ path: route.path, name: `Public ${route.path}` })),
      ...ROUTES.user.map((route) => ({ path: route.path, name: `User ${route.path}` })),
      ...ROUTES.workspace.map((route) => ({ path: route.path, name: `Workspace ${route.path}` })),
      ...ROUTES.project.map((route) => ({ path: route.path, name: `Project ${route.path}` })),
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

      if (pageInfo.path.startsWith('/en-US/workspaces') || pageInfo.path.startsWith('/en-US/user')) {
        await withAuth(page, workspaceId, testEmail);
      }

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
      await gotoAndWait(page, `${baseUrl}${pageInfo.path}`);

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
    await gotoAndWait(page, `${baseUrl}/en-US/workspaces/${workspaceId}/projects/${projectId}/overview`);
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
    test.setTimeout(60000);
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

    // Visit all authenticated pages
    const pages = [
      ...ROUTES.user.map((route) => route.path),
      ...ROUTES.workspace.map((route) => route.path),
      ...ROUTES.project.map((route) => route.path),
    ];

    await withAuth(page, workspaceId, testEmail);
    for (const pagePath of pages) {
      await gotoAndWait(page, `${baseUrl}${pagePath}`);
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
