import { Page } from '@playwright/test';

const DEFAULT_NAVIGATION_TIMEOUT = 60000;

/** Navigate to a URL with retry on ERR_ABORTED */
export async function gotoAndWait(
  page: Page,
  url: string,
  timeout = DEFAULT_NAVIGATION_TIMEOUT,
) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('net::ERR_ABORTED')) {
      throw error;
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  }
}

/** Wait for the page to reach a ready state */
export async function waitForPageReady(page: Page, timeout = 30000) {
  await page.waitForSelector(
    '[data-testid="page-state__success"], [data-testid="page-state__error"], [data-testid="page-layout"]',
    { timeout },
  );
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
