import { test as base, type Page } from '@playwright/test';
import { withAuth } from './authenticated';
import { gotoAndWait, waitForPageReady } from '../utils/navigation';

/** Default test constants */
export const WS_ID = 'ws_default';
export const PROJECT_ID = 'proj_001';
export const TEST_EMAIL = 'test@example.com';
export const LIMITED_TEST_EMAIL = 'viewer@example.com';
export const LOCALE = 'en-US';
const LOGIN_PATH_REGEX = /^\/(en-US|zh-CN)\/login(?:\/workspace)?\/?$/;
const PROTECTED_ROUTE_REGEX = /^\/(en-US|zh-CN)\/(?:user|workspaces)\//;

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
}>({
  authedPage: async ({ page }, use) => {
    await withAuth(page, WS_ID, TEST_EMAIL);
    await ensureAuthenticatedSession(page, `/${LOCALE}/workspaces/${WS_ID}/projects`);
    await use(page);
  },
  limitedPage: async ({ page }, use) => {
    await withAuth(page, WS_ID, LIMITED_TEST_EMAIL, 'user_004');
    await ensureAuthenticatedSession(page, `/${LOCALE}/workspaces/${WS_ID}/projects`);
    await use(page);
  },
});

export { expect } from '@playwright/test';

async function ensureAuthenticatedSession(page: Page, bootstrapPath: string): Promise<void> {
  await gotoAndWait(page, bootstrapPath);
  await waitForPageReady(page);
  if (!LOGIN_PATH_REGEX.test(new URL(page.url()).pathname)) return;

  const ctx = await page.evaluate(() => window.__MBOS_AUTH_E2E_CONTEXT__ ?? null).catch(() => null);
  if (ctx && typeof ctx.userEmail === 'string' && typeof ctx.userId === 'string') {
    await withAuth(page, ctx.wsId || WS_ID, ctx.userEmail, ctx.userId);
  } else {
    await withAuth(page, WS_ID, TEST_EMAIL);
  }

  await gotoAndWait(page, bootstrapPath);
  await waitForPageReady(page);
  if (LOGIN_PATH_REGEX.test(new URL(page.url()).pathname)) {
    throw new Error(`Failed to bootstrap authenticated session at ${bootstrapPath}`);
  }
}

/** Navigate to a project page with auth already set up */
export async function goToProject(page: Page, section: string) {
  const url = projectUrl(section);
  await goTo(page, url);
}

/** Navigate to any page and wait for ready */
export async function goTo(page: Page, path: string) {
  const targetPath = path.startsWith('http') ? new URL(path).pathname : path;
  const isProtectedRoute = PROTECTED_ROUTE_REGEX.test(targetPath);

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
      if (attempt < 2) {
        await page.waitForTimeout(250);
      }
    }
  }

  if (navigateError) {
    throw new Error(`Failed to load route: ${path}`);
  }

  if (!isProtectedRoute) return;

  const reseedAuth = async () => {
    const ctx = await page.evaluate(() => window.__MBOS_AUTH_E2E_CONTEXT__ ?? null).catch(() => null);
    if (ctx && typeof ctx.userEmail === 'string' && typeof ctx.userId === 'string') {
      await withAuth(page, ctx.wsId || WS_ID, ctx.userEmail, ctx.userId);
      return;
    }
    await withAuth(page, WS_ID, TEST_EMAIL);
  };

  const maybeRecoverFromLoginRedirect = async () => {
    const currentPath = new URL(page.url()).pathname;
    if (!LOGIN_PATH_REGEX.test(currentPath)) return;
    await reseedAuth();
    await gotoAndWait(page, path);
    await waitForPageReady(page);
  };

  for (let i = 0; i < 3; i += 1) {
    await maybeRecoverFromLoginRedirect();
    if (!LOGIN_PATH_REGEX.test(new URL(page.url()).pathname)) {
      break;
    }
  }

  const finalPath = new URL(page.url()).pathname;
  if (LOGIN_PATH_REGEX.test(finalPath)) {
    throw new Error(`Protected route redirected to login after recovery: ${path}`);
  }
}
