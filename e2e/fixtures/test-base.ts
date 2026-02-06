import { test as base, type Page } from '@playwright/test';
import { withAuth } from './authenticated';
import { waitForPageReady } from '../utils/navigation';

/** Default test constants */
export const WS_ID = 'ws_default';
export const PROJECT_ID = 'proj_001';
export const TEST_EMAIL = 'test@example.com';
export const LOCALE = 'en-US';

/** Build a project-scoped URL */
export function projectUrl(
  section: string,
  locale = LOCALE,
  wsId = WS_ID,
  projectId = PROJECT_ID,
) {
  return `/${locale}/workspaces/${wsId}/projects/${projectId}/${section}`;
}

/** Custom test fixture with authentication support */
export const test = base.extend<{
  authedPage: Page;
}>({
  authedPage: async ({ page }, use) => {
    await withAuth(page, WS_ID, TEST_EMAIL);
    await use(page);
  },
});

export { expect } from '@playwright/test';

/** Navigate to a project page with auth already set up */
export async function goToProject(page: Page, section: string) {
  await page.goto(projectUrl(section));
  await waitForPageReady(page);
}

/** Navigate to any page and wait for ready */
export async function goTo(page: Page, path: string) {
  await page.goto(path);
  await waitForPageReady(page);
}
