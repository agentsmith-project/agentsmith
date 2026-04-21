import { expect, Page } from '@playwright/test';

const DEFAULT_NAVIGATION_TIMEOUT = 60000;
const SIDEBAR_NAVIGATION_TIMEOUT = 20000;
const TRANSIENT_NAVIGATION_ERRORS = [
  'net::ERR_ABORTED',
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_EMPTY_RESPONSE',
];

type ProjectSidebarNavOptions = {
  workspace?: string;
  project?: string;
  locale?: string;
  item: string;
  expectedPath?: string;
  readyTestId?: string;
  timeout?: number;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function projectSidebarPath(options: ProjectSidebarNavOptions) {
  if (options.expectedPath) {
    return options.expectedPath;
  }
  const locale = options.locale ?? 'en-US';
  const workspace = options.workspace ?? 'ws_default';
  const project = options.project ?? 'proj_001';
  return `/${locale}/workspaces/${workspace}/projects/${project}/${options.item}`;
}

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

/** Navigate to an entry URL while waiting for the full redirect chain to settle on the target URL. */
export async function gotoAndWaitForRedirect(
  page: Page,
  entryUrl: string,
  expectedUrl: RegExp,
  timeout = DEFAULT_NAVIGATION_TIMEOUT,
  readyTimeout = 30000,
) {
  await Promise.all([
    page.waitForURL(expectedUrl, { timeout }),
    gotoAndWait(page, entryUrl, timeout),
  ]);
  await waitForPageReady(page, readyTimeout);
}

/** Wait for the page to reach a ready state */
export async function waitForPageReady(page: Page, timeout = 30000) {
  // Some routes briefly render an MSW bootstrapping screen before the app layout is mounted.
  // Accept the bootstrap text as an initial state, then wait for terminal page markers.
  const readyMarker = page
    .locator(
      '[data-testid="page-state__success"], [data-testid="page-state__error"], [data-testid="page-layout"], [data-testid="page-state__loading"]',
    )
    .first();
  const bootMessage = page.getByText('Starting mocks...');

  await Promise.race([
    readyMarker.waitFor({ state: 'visible', timeout }),
    bootMessage.waitFor({ state: 'visible', timeout }),
  ]);

  if (await bootMessage.isVisible().catch(() => false)) {
    try {
      await bootMessage.waitFor({ state: 'hidden', timeout });
    } catch (error) {
      throw new Error(
        `mock_bootstrap_stalled:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
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

/** Click a project sidebar item as a user would, with lane-grade route settling. */
export async function clickProjectSidebarNav(
  page: Page,
  options: ProjectSidebarNavOptions,
) {
  const timeout = options.timeout ?? SIDEBAR_NAVIGATION_TIMEOUT;
  const expectedPath = projectSidebarPath(options);
  const navLink = page.getByTestId(`sidebar__nav-item--${options.item}`);

  await expect(navLink).toHaveCount(1, { timeout });
  await expect(navLink).toBeVisible({ timeout });
  await expect(navLink).toHaveAttribute('href', expectedPath, { timeout });

  await Promise.all([
    page.waitForURL(new RegExp(`${escapeRegExp(expectedPath)}(?:$|[?#])`), { timeout }),
    navLink.click(),
  ]);
  await waitForPageReady(page, timeout);

  if (options.readyTestId) {
    await expect(page.getByTestId(options.readyTestId).first()).toBeVisible({ timeout });
  }
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
