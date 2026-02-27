import { test as base, type Page } from '@playwright/test';
import { withAuth } from './authenticated';
import { gotoAndWait, waitForPageReady } from '../utils/navigation';

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
  const url = projectUrl(section);
  await gotoAndWait(page, url);
  try {
    await waitForPageReady(page);
  } catch {
    await gotoAndWait(page, url);
    try {
      await waitForPageReady(page);
    } catch {
      throw new Error(`Failed to load project route: ${url}`);
    }
  }
}

/** Navigate to any page and wait for ready */
export async function goTo(page: Page, path: string) {
  await gotoAndWait(page, path);
  try {
    await waitForPageReady(page);
  } catch {
    await gotoAndWait(page, path);
    try {
      await waitForPageReady(page);
    } catch {
      throw new Error(`Failed to load route: ${path}`);
    }
  }
}
