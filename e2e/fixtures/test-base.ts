import { test as base, type Page } from '@playwright/test';
import { ensureAuthenticatedSession, ensureProtectedRouteAuthenticated, withAuth } from './authenticated';
import { isE2EProtectedRoute } from './route-auth-policy';
import { gotoAndWait, waitForPageReady } from '../utils/navigation';

/** Default test constants */
export const WS_ID = 'ws_default';
export const PROJECT_ID = 'proj_001';
export const TEST_EMAIL = 'test@example.com';
export const LIMITED_TEST_EMAIL = 'viewer@example.com';
export const ADMIN_TEST_EMAIL = 'bob.smith@example.com';
export const GUEST_TEST_EMAIL = 'guest@example.com';
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
  limitedPage: Page;
  adminPage: Page;
  guestPage: Page;
}>({
  authedPage: async ({ page }, fixtureUse) => {
    await withAuth(page, WS_ID, TEST_EMAIL);
    await ensureAuthenticatedSession(page, `/${LOCALE}/workspaces/${WS_ID}/projects`);
    await fixtureUse(page);
  },
  limitedPage: async ({ page }, fixtureUse) => {
    await withAuth(page, WS_ID, LIMITED_TEST_EMAIL, 'user_004');
    await ensureAuthenticatedSession(page, `/${LOCALE}/workspaces/${WS_ID}/projects`);
    await fixtureUse(page);
  },
  adminPage: async ({ page }, fixtureUse) => {
    await withAuth(page, WS_ID, ADMIN_TEST_EMAIL, 'user_002');
    await ensureAuthenticatedSession(page, `/${LOCALE}/workspaces/${WS_ID}/projects`);
    await fixtureUse(page);
  },
  guestPage: async ({ page }, fixtureUse) => {
    await withAuth(page, WS_ID, GUEST_TEST_EMAIL, 'user_009');
    await ensureAuthenticatedSession(page, `/${LOCALE}/workspaces/${WS_ID}/projects`);
    await fixtureUse(page);
  },
});

export { expect } from '@playwright/test';

/** Navigate to a project page with auth already set up */
export async function goToProject(page: Page, section: string) {
  const url = projectUrl(section);
  await goTo(page, url);
}

/** Navigate to any page and wait for ready */
export async function goTo(page: Page, path: string) {
  const targetPath = path.startsWith('http') ? new URL(path).pathname : path;
  const isProtectedRoute = isE2EProtectedRoute(targetPath);

  const navigateOnce = async () => {
    await gotoAndWait(page, path);
    await waitForPageReady(page);
  };

  let navigateError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await navigateOnce();
      navigateError = null;
      break;
    } catch (error) {
      navigateError = error;
      if (page.isClosed()) {
        throw error;
      }
      if (attempt < 2) {
        await page.waitForTimeout(250);
      }
    }
  }

  if (navigateError) {
    throw new Error(`Failed to load route: ${path}`);
  }

  if (!isProtectedRoute) return;

  await ensureProtectedRouteAuthenticated(page, path, {
    wsId: WS_ID,
    userEmail: TEST_EMAIL,
    userId: 'user_001',
  }, {
    label: 'go_to',
  });
}
