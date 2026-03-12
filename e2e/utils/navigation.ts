import { Page } from '@playwright/test';

const DEFAULT_NAVIGATION_TIMEOUT = 60000;
const TRANSIENT_NAVIGATION_ERRORS = [
  'net::ERR_ABORTED',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_EMPTY_RESPONSE',
];

/** Navigate to a URL with retry on transient dev-server connection failures */
export async function gotoAndWait(
  page: Page,
  url: string,
  timeout = DEFAULT_NAVIGATION_TIMEOUT,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isTransient = TRANSIENT_NAVIGATION_ERRORS.some((pattern) => message.includes(pattern));
      if (!isTransient || attempt >= 3) {
        throw error;
      }
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to navigate to ${url}`);
}

/** Wait for the page to reach a ready state */
export async function waitForPageReady(page: Page, timeout = 30000) {
  // Some routes briefly render an MSW bootstrapping screen before the app layout is mounted.
  // Accept loading marker first, then wait for terminal page markers.
  await page.waitForSelector(
    '[data-testid="page-state__success"], [data-testid="page-state__error"], [data-testid="page-layout"], [data-testid="page-state__loading"]',
    { timeout },
  );
  const hasTerminalMarker = await page
    .locator('[data-testid="page-state__success"], [data-testid="page-state__error"], [data-testid="page-layout"]')
    .first()
    .isVisible()
    .catch(() => false);

  if (!hasTerminalMarker) {
    await page.waitForSelector(
      '[data-testid="page-state__success"], [data-testid="page-state__error"], [data-testid="page-layout"]',
      { timeout },
    );
  }
  // Wait one frame after the ready marker appears to avoid fixed sleeps on every navigation.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
}

/** Navigate to a project page section with standard wait */
export async function navigateToProject(
  page: Page,
  section: string,
  wsId = 'ws_default',
  projectId = 'proj_001',
  locale = 'en-US',
) {
  const url = `/${locale}/workspaces/${wsId}/projects/${projectId}/${section}`;
  await gotoAndWait(page, url);
  await waitForPageReady(page);
}
