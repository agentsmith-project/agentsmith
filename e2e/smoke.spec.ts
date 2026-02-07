/**
 * Smoke Tests — runs in the `smoke` Playwright project.
 *
 * Validates that every known route loads without crashing and that
 * authenticated pages render the expected app shell.
 */

import { test, expect, goTo, goToProject, projectUrl, WS_ID } from './fixtures/test-base';
import { ROUTES } from './fixtures/routes';
import { withAuth } from './fixtures/authenticated';
import { waitForPageReady } from './utils/navigation';

// Keep smoke serial for route-health determinism in local dev server mode.
test.describe.configure({ mode: 'default' });

// ── Acceptable console errors in MSW-backed dev environment ──────────────────

const ACCEPTABLE_ERROR_PATTERNS = [
  'ERR_EMPTY_RESPONSE',
  'net::ERR_EMPTY_RESPONSE',
  '404 (Not Found)',
  '500 (Internal Server Error)',
  'Failed to load resource',
  '[MSW]',
  'MSW',
  'mockServiceWorker',
  'Hydration failed',             // React hydration mismatches in dev
  'Text content does not match',  // React hydration text mismatch
  'There was an error while hydrating', // React 18 hydration
  'Minified React error',
  'IntlError',                    // Missing i18n keys in dev
];

function isAcceptableError(text: string): boolean {
  return ACCEPTABLE_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve the locator for a route's expected element. */
function routeExpectation(
  page: import('@playwright/test').Page,
  route: { title?: RegExp; testId?: string },
) {
  if (route.testId) return page.getByTestId(route.testId);
  if (route.title) return page.getByRole('heading', { name: route.title });
  return page.getByTestId('page-state__success');
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Smoke: Public Routes', () => {
  test.setTimeout(120_000);

  for (const route of ROUTES.public) {
    test(`loads ${route.path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !isAcceptableError(msg.text())) {
          errors.push(msg.text());
        }
      });

      await page.goto(route.path);
      await waitForPageReady(page);

      // Every public page should reach a success or layout state
      await expect(
        page.getByTestId('page-state__success').or(page.getByTestId('page-layout')).first(),
      ).toBeVisible();

      // Verify route-specific expectation if available
      if (route.title) {
        await expect(
          page.getByRole('heading', { name: route.title }).first(),
        ).toBeVisible({ timeout: 5_000 });
      }

      expect(errors, `Unexpected console errors on ${route.path}`).toHaveLength(0);
    });
  }
});

test.describe('Smoke: User Routes', () => {
  test.setTimeout(120_000);

  for (const route of ROUTES.user) {
    test(`loads ${route.path}`, async ({ authedPage }) => {
      const errors: string[] = [];
      authedPage.on('console', (msg) => {
        if (msg.type() === 'error' && !isAcceptableError(msg.text())) {
          errors.push(msg.text());
        }
      });

      await goTo(authedPage, route.path);

      await expect(
        authedPage.getByTestId('page-state__success').or(authedPage.getByTestId('page-layout')).first(),
      ).toBeVisible();

      if (route.title) {
        await expect(
          authedPage.getByRole('heading', { name: route.title }).first(),
        ).toBeVisible({ timeout: 5_000 });
      }

      expect(errors, `Unexpected console errors on ${route.path}`).toHaveLength(0);
    });
  }
});

test.describe('Smoke: Workspace Routes', () => {
  test.setTimeout(120_000);

  for (const route of ROUTES.workspace) {
    test(`loads ${route.path}`, async ({ authedPage }) => {
      const errors: string[] = [];
      authedPage.on('console', (msg) => {
        if (msg.type() === 'error' && !isAcceptableError(msg.text())) {
          errors.push(msg.text());
        }
      });

      await goTo(authedPage, route.path);

      await expect(
        authedPage.getByTestId('page-state__success').or(authedPage.getByTestId('page-layout')).first(),
      ).toBeVisible();

      if (route.title) {
        await expect(
          authedPage.getByRole('heading', { name: route.title }).first(),
        ).toBeVisible({ timeout: 5_000 });
      }

      expect(errors, `Unexpected console errors on ${route.path}`).toHaveLength(0);
    });
  }
});

test.describe('Smoke: Project Routes', () => {
  test.setTimeout(120_000);

  for (const route of ROUTES.project) {
    test(`loads ${route.path}`, async ({ authedPage }) => {
      const errors: string[] = [];
      authedPage.on('console', (msg) => {
        if (msg.type() === 'error' && !isAcceptableError(msg.text())) {
          errors.push(msg.text());
        }
      });

      await goTo(authedPage, route.path);

      // Page should reach a renderable state
      await expect(
        authedPage.getByTestId('page-state__success').or(authedPage.getByTestId('page-layout')).first(),
      ).toBeVisible();

      // Verify route-specific element
      await expect(routeExpectation(authedPage, route).first()).toBeVisible({
        timeout: 5_000,
      });

      expect(errors, `Unexpected console errors on ${route.path}`).toHaveLength(0);
    });
  }
});

test.describe('Smoke: App Shell on Project Pages', () => {
  test.setTimeout(120_000);

  // Pick a representative project page for app-shell checks
  const representativeRoutes = ROUTES.project.slice(0, 3);

  for (const route of representativeRoutes) {
    test(`renders topbar and sidebar on ${route.path}`, async ({ authedPage }) => {
      await goTo(authedPage, route.path);

      // Topbar
      const topbar = authedPage.getByTestId('topbar');
      await expect(topbar).toBeVisible({ timeout: 5_000 });
      await expect(authedPage.getByTestId('topbar__workspace-switcher')).toBeVisible();
      await expect(authedPage.getByTestId('topbar__project-switcher')).toBeVisible();
      await expect(authedPage.getByTestId('topbar__user-menu')).toBeVisible();

      // Sidebar
      const sidebar = authedPage.getByTestId('sidebar');
      await expect(sidebar).toBeVisible({ timeout: 5_000 });
    });
  }
});
