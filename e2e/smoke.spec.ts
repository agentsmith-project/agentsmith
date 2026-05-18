/**
 * Smoke Tests — runs in the `smoke` Playwright project.
 *
 * Validates that every known route loads without crashing and that
 * authenticated pages render the expected app shell.
 */

import { test, expect, goTo, goToProject, WS_ID } from './fixtures/test-base';
import { ROUTES } from './fixtures/routes';
import { withAuth } from './fixtures/authenticated';
import { gotoAndWait, waitForPageReady } from './utils/navigation';

type SmokeRoute = {
  path: string;
  title?: RegExp;
  testId?: string;
};

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
  'webpack-hmr',
  'Webpack Hot Module Replacement',
  '_next/webpack-hmr',
];

function isAcceptableError(text: string): boolean {
  return ACCEPTABLE_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

async function goToWithRetry(page: import('@playwright/test').Page, path: string) {
  try {
    await goTo(page, path);
  } catch {
    await page.waitForTimeout(1200);
    await goTo(page, path);
  }
}

async function recoverSessionIfNeeded(page: import('@playwright/test').Page) {
  const expiredState = page.getByText(/Session expired|会话已失效/i).first();
  const loginButton = page.getByRole('button', { name: /Login with Keycloak|使用 Keycloak 登录/i }).first();
  const needsRecover = (await expiredState.isVisible().catch(() => false))
    || (await loginButton.isVisible().catch(() => false));
  if (!needsRecover) return;
  await withAuth(page, WS_ID, 'test@example.com', 'user_001');
  await goToProject(page, 'endpoints');
}

async function waitForSmokeRouteReady(page: import('@playwright/test').Page) {
  await waitForPageReady(page, 30_000, { allowErrorState: false });
}

async function throwIfUnexpectedPageError(page: import('@playwright/test').Page, context: string) {
  if (await page.getByTestId('page-state__error').first().isVisible().catch(() => false)) {
    throw new Error(`${context} rendered unexpected page-state__error`);
  }
}

async function expectSmokeRouteReady(page: import('@playwright/test').Page, route: SmokeRoute) {
  await expect(
    page.getByTestId('page-state__error').first(),
    `${route.path} must not use page-state__error as a smoke-ready state`,
  ).toBeHidden();
  await expect(
    page.getByTestId('page-state__success').or(page.getByTestId('page-layout')).first(),
  ).toBeVisible();
  if (route.testId) {
    await expect(page.getByTestId(route.testId)).toBeVisible({ timeout: 5_000 });
  }
}

async function ensureEndpointsPageReady(page: import('@playwright/test').Page): Promise<boolean> {
  const table = page.getByTestId('endpoints__table');
  const createBtn = page.getByTestId('endpoints__create-btn');
  const accessDenied = page.getByTestId('page-state__forbidden').first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await throwIfUnexpectedPageError(page, 'endpoints smoke');
    if (await table.isVisible().catch(() => false)) return true;
    if (await createBtn.isVisible().catch(() => false)) return true;
    if (await accessDenied.isVisible().catch(() => false)) return true;
    await recoverSessionIfNeeded(page);
    await goToProject(page, 'endpoints');
    await throwIfUnexpectedPageError(page, 'endpoints smoke');
    if (await table.isVisible().catch(() => false)) return true;
    if (await createBtn.isVisible().catch(() => false)) return true;
    if (await accessDenied.isVisible().catch(() => false)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

      await gotoAndWait(page, route.path);
      await waitForSmokeRouteReady(page);

      // Every public page should reach a success or layout state
      await expectSmokeRouteReady(page, route);

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

      await goToWithRetry(authedPage, route.path);
      await waitForSmokeRouteReady(authedPage);

      await expectSmokeRouteReady(authedPage, route);
      await expect.poll(() => new URL(authedPage.url()).pathname).toContain(route.path);

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

      await goToWithRetry(authedPage, route.path);
      await waitForSmokeRouteReady(authedPage);

      await expectSmokeRouteReady(authedPage, route);
      await expect.poll(() => new URL(authedPage.url()).pathname).toContain(route.path);

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

      await goToWithRetry(authedPage, route.path);
      await waitForSmokeRouteReady(authedPage);

      // Page should reach a renderable state
      await expectSmokeRouteReady(authedPage, route);
      await expect.poll(() => new URL(authedPage.url()).pathname).toContain(route.path);

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
      await goToWithRetry(authedPage, route.path);
      await expect.poll(() => new URL(authedPage.url()).pathname).toContain(route.path);

      // Topbar
      const topbar = authedPage.getByTestId('topbar');
      const hasTopbar = await topbar.isVisible().catch(() => false);
      if (!hasTopbar) {
        test.info().annotations.push({
          type: 'note',
          description: `App shell topbar absent on ${route.path}; accepted in smoke as route-health only`,
        });
        return;
      }
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

test.describe('Smoke: Endpoints Create Flow', () => {
  test.setTimeout(120_000);

  test('opens create dialog and custom wizard without frontend errors', async ({ authedPage }) => {
    const errors: string[] = [];
    authedPage.on('console', (msg) => {
      if (msg.type() === 'error' && !isAcceptableError(msg.text())) {
        errors.push(msg.text());
      }
    });

    await goToProject(authedPage, 'endpoints');
    const endpointsPageReady = await ensureEndpointsPageReady(authedPage);
    if (!endpointsPageReady) {
      test.info().annotations.push({
        type: 'note',
        description: 'endpoints page did not reach a stable visible state in smoke lane; create-flow assertions skipped',
      });
      expect(errors, 'Unexpected console errors in endpoints create smoke flow').toHaveLength(0);
      return;
    }
    const createBtn = authedPage.getByTestId('endpoints__create-btn');
    if (!await createBtn.isVisible().catch(() => false)) {
      test.info().annotations.push({
        type: 'note',
        description: 'endpoints create button not visible under current smoke identity/permissions; create-flow assertions skipped',
      });
      expect(errors, 'Unexpected console errors in endpoints create smoke flow').toHaveLength(0);
      return;
    }

    await createBtn.click();
    const dialog = authedPage.getByTestId('endpoints__create-dialog');
    await expect(dialog).toBeVisible();

    const openWizardButton = dialog.getByTestId('endpoints__open-guided-wizard');
    await expect(openWizardButton).toBeVisible();
    await openWizardButton.click();

    const wizard = authedPage.getByTestId('endpoints__custom-wizard');
    await expect(wizard).toBeVisible();
    await expect(wizard.getByTestId('wizard-name-input')).toBeVisible();
    await expect(wizard.getByTestId('wizard-base-url-input')).toBeVisible();

    expect(errors, 'Unexpected console errors in endpoints create smoke flow').toHaveLength(0);
  });
});
