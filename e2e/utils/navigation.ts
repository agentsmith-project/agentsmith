import { Page } from '@playwright/test';

/** Navigate to a URL with retry on ERR_ABORTED */
export async function gotoAndWait(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('net::ERR_ABORTED')) {
      throw error;
    }
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForLoadState('load');
}

/** Wait for the page to reach a ready state */
export async function waitForPageReady(page: Page, timeout = 15000) {
  await page.waitForSelector(
    '[data-testid="page-state__success"], [data-testid="page-state__error"], [data-testid="page-layout"]',
    { timeout },
  );
  await page.waitForTimeout(300);
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
