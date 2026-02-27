/**
 * Console Errors & Warnings Tests
 *
 * Visits pages and captures console errors, hydration issues,
 * and failed HTTP requests to ensure production readiness.
 */

import { test as base, expect } from '@playwright/test';
import { ROUTES } from './fixtures/routes';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait } from './utils/navigation';

const WS_ID = 'ws_default';
const TEST_EMAIL = 'test@example.com';

/** Patterns that are expected in the MSW/test environment and should be ignored */
const ACCEPTABLE_ERROR_PATTERNS = [
  'ERR_EMPTY_RESPONSE',
  'net::ERR_EMPTY_RESPONSE',
  'net::ERR_FAILED',
  '404 (Not Found)',
  '500 (Internal Server Error)',
  '[MSW]',
  'mockServiceWorker',
  'Failed to load resource',
  'IntlError',
  'MISSING_MESSAGE',
  'INSUFFICIENT_PATH',
  'ReactDOM.hydrate',
  'act(...)',
  'Warning:',
  'DevTools',
  'Download the React DevTools',
] as const;

function isAcceptableError(text: string): boolean {
  return ACCEPTABLE_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

/** All authenticated routes combined */
const AUTHED_ROUTES = [...ROUTES.user, ...ROUTES.workspace, ...ROUTES.project];

/** All routes (public + authenticated) */
const ALL_ROUTES = [...ROUTES.public, ...AUTHED_ROUTES];

base.describe('Console Errors Detection', () => {
  base('check all pages for console errors', async ({ page }) => {
    base.setTimeout(120000);

    const errorsByPage: Record<string, string[]> = {};
    let authInjected = false;

    for (const route of ALL_ROUTES) {
      const pageErrors: string[] = [];

      const handler = (msg: import('@playwright/test').ConsoleMessage) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (!isAcceptableError(text)) {
            pageErrors.push(text);
          }
        }
      };

      page.on('console', handler);

      // Authenticated routes need auth setup
      const needsAuth =
        route.path.includes('/workspaces/') || route.path.includes('/user/');
      if (needsAuth) {
        if (!authInjected) {
          await withAuth(page, WS_ID, TEST_EMAIL);
          authInjected = true;
        }
      }

      await gotoAndWait(page, route.path);
      await page.waitForTimeout(1000);

      page.off('console', handler);

      if (pageErrors.length > 0) {
        errorsByPage[route.path] = pageErrors;
      }
    }

    // Report
    const totalErrors = Object.values(errorsByPage).reduce(
      (sum, errs) => sum + errs.length,
      0,
    );

    if (totalErrors > 0) {
      const report = Object.entries(errorsByPage)
        .map(
          ([path, errs]) =>
            `\n  ${path}:\n${errs.map((e, i) => `    ${i + 1}. ${e}`).join('\n')}`,
        )
        .join('');
      console.log(`Console errors found:${report}`);
    }

    expect(totalErrors, 'Unexpected console errors detected across pages').toBe(0);
  });

  base('no hydration errors on overview page', async ({ page }) => {
    const hydrationErrors: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('hydration') ||
        text.includes('Hydration') ||
        text.includes('did not match') ||
        text.includes('cannot be a child of') ||
        text.includes('In HTML,') ||
        text.includes('server-rendered HTML')
      ) {
        hydrationErrors.push(text);
      }
    });

    await withAuth(page, WS_ID, TEST_EMAIL);
    await gotoAndWait(
      page,
      '/en-US/workspaces/ws_default/projects/proj_001/overview',
    );
    await page.waitForTimeout(3000);

    if (hydrationErrors.length > 0) {
      console.log('Hydration errors found:');
      hydrationErrors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
    }

    expect(hydrationErrors.length, 'Hydration errors detected').toBe(0);
  });

  base('no unexpected 404/500 on authenticated pages', async ({ page }) => {
    base.setTimeout(120000);

    const failedRequests: Array<{ url: string; status: number; path: string }> = [];

    /** Patterns for URLs whose 404/500 we accept (e.g. unmocked API routes) */
    const ACCEPTABLE_URL_PATTERNS = ['/api/'];

    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();

      if (status === 404 || status === 500) {
        const isAcceptable = ACCEPTABLE_URL_PATTERNS.some((p) => url.includes(p));
        if (!isAcceptable) {
          failedRequests.push({ url, status, path: '' });
        }
      }
    });

    await withAuth(page, WS_ID, TEST_EMAIL);

    for (const route of AUTHED_ROUTES) {
      await gotoAndWait(page, route.path);
    }

    if (failedRequests.length > 0) {
      console.log('Failed requests:');
      failedRequests.forEach((req, i) =>
        console.log(`  ${i + 1}. [${req.status}] ${req.url}`),
      );
    }

    expect(
      failedRequests.length,
      'Unexpected 404/500 responses detected',
    ).toBe(0);
  });
});
