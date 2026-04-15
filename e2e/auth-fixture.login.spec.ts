import type { Page } from '@playwright/test';
import { ensureProtectedRouteAuthenticated, withAuth } from './fixtures/authenticated';
import { expect, goTo, LOCALE, projectUrl, test, TEST_EMAIL, WS_ID } from './fixtures/test-base';
import { gotoAndWait, waitForPageReady } from './utils/navigation';

type BrowserAuthSnapshot = {
  context: {
    wsId?: string;
    userEmail?: string;
    userId?: string;
    token?: string;
  } | null;
  storageState: {
    user?: {
      id?: string;
      email?: string;
    } | null;
    token?: string | null;
    refreshToken?: string | null;
    tokenExpiresAt?: number | null;
    isAuthenticated?: boolean;
  } | null;
  storeState: {
    user?: {
      id?: string;
      email?: string;
    } | null;
    token?: string | null;
    refreshToken?: string | null;
    tokenExpiresAt?: number | null;
    isAuthenticated?: boolean;
  } | null;
};

async function readBrowserAuthSnapshot(page: Page): Promise<BrowserAuthSnapshot> {
  return page.evaluate(() => {
    let storageState: BrowserAuthSnapshot['storageState'] = null;
    try {
      const raw = window.localStorage.getItem('agentsmith-auth');
      const parsed = raw ? JSON.parse(raw) as { state?: BrowserAuthSnapshot['storageState'] } : null;
      storageState = parsed?.state ?? null;
    } catch {
      storageState = null;
    }

    const state = window.__MBOS_AUTH_STORE__?.getState();
    return {
      context: window.__MBOS_AUTH_E2E_CONTEXT__ ?? null,
      storageState,
      storeState: state
        ? {
            user: state.user,
            token: state.token,
            refreshToken: state.refreshToken,
            tokenExpiresAt: state.tokenExpiresAt,
            isAuthenticated: state.isAuthenticated,
          }
        : null,
    };
  });
}

test.describe('Mock E2E Auth Fixture Contract', () => {
  test('seeds serializable browser auth state before protected app boot', async ({ page }) => {
    await withAuth(page, WS_ID, TEST_EMAIL, 'user_001');

    await gotoAndWait(page, `/${LOCALE}/workspaces/${WS_ID}/projects`);
    await waitForPageReady(page);

    await expect(page.getByTestId('projects__page')).toBeVisible({ timeout: 30_000 });
    const snapshot = await readBrowserAuthSnapshot(page);

    expect(snapshot.context).toMatchObject({
      wsId: WS_ID,
      userEmail: TEST_EMAIL,
      userId: 'user_001',
    });
    expect(snapshot.context?.token).toMatch(/^mock_token_user_001__/);
    expect(snapshot.storageState).toMatchObject({
      isAuthenticated: true,
      token: snapshot.context?.token,
      refreshToken: expect.stringMatching(/^mock_refresh_/),
    });
    expect(snapshot.storageState?.user).toMatchObject({
      id: 'user_001',
      email: TEST_EMAIL,
    });
    expect(snapshot.storeState).toMatchObject({
      isAuthenticated: true,
      token: snapshot.context?.token,
      refreshToken: snapshot.storageState?.refreshToken,
    });
    expect(snapshot.storeState?.user).toMatchObject({
      id: 'user_001',
      email: TEST_EMAIL,
    });
  });

  test('keeps authenticated project deep links on the requested surface', async ({ authedPage }) => {
    const targetPath = projectUrl('members');
    await goTo(authedPage, `${targetPath}?member_tab=people`);

    const currentUrl = new URL(authedPage.url());
    expect(currentUrl.pathname).toBe(targetPath);
    expect(currentUrl.searchParams.get('member_tab')).toBe('people');
    expect(currentUrl.pathname).not.toMatch(/\/(?:login\/workspace|workspaces\/overview)$/);
    await expect(authedPage.getByTestId('members__work-surface')).toBeVisible({ timeout: 30_000 });

    const snapshot = await readBrowserAuthSnapshot(authedPage);
    expect(snapshot.context?.token).toMatch(/^mock_token_user_001__/);
    expect(snapshot.storeState).toMatchObject({
      isAuthenticated: true,
      token: snapshot.context?.token,
    });
  });

  test('rejects tokenless expected auth context instead of treating fallback identity as authenticated', async ({ page }) => {
    await gotoAndWait(page, `/${LOCALE}/join`);
    await waitForPageReady(page);
    await page.evaluate(
      ({ wsId, userEmail, userId }) => {
        window.__MBOS_AUTH_E2E_CONTEXT__ = {
          wsId,
          userEmail,
          userId,
        };
      },
      {
        wsId: WS_ID,
        userEmail: TEST_EMAIL,
        userId: 'user_001',
      },
    );

    await expect(
      ensureProtectedRouteAuthenticated(
        page,
        `/${LOCALE}/workspaces/${WS_ID}/projects`,
        {
          wsId: WS_ID,
          userEmail: TEST_EMAIL,
          userId: 'user_001',
        },
        {
          label: 'tokenless_expected_context',
          maxRecoveries: 0,
        },
      ),
    ).rejects.toThrow(/auth_seed_failed:tokenless_expected_context:missing_expected_context/);
  });
});
