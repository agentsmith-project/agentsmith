import { Page } from '@playwright/test';

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
