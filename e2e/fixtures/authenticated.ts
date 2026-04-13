import { Page } from '@playwright/test';
import { gotoAndWait, waitForPageReady } from '../utils/navigation';
import { createMockAuthToken } from '@/mocks/utils/mock-auth-token';

const DEFAULT_WS_ID = 'ws_default';
const DEFAULT_USER_EMAIL = 'test@example.com';
const DEFAULT_USER_ID = 'user_001';
const LOGIN_PATH_REGEX = /^\/(en-US|zh-CN)\/login(?:\/workspace)?\/?$/;

export async function withAuth(
  page: Page,
  wsId = DEFAULT_WS_ID,
  userEmail = DEFAULT_USER_EMAIL,
  userId = DEFAULT_USER_ID,
) {
  const inject = ({ wsId, userEmail, userId }: { wsId: string; userEmail: string; userId: string }) => {
    window.__MBOS_AUTH_SETUP__ = true;
    const token = createMockAuthToken({
      userId,
      userEmail,
      issuedAt: Date.now(),
    });
    const refreshToken = `mock_refresh_${Date.now()}`;
    const tokenExpiresAt = Date.now() + 60 * 60 * 1000;
    window.__MBOS_AUTH_E2E_CONTEXT__ = { wsId, userEmail, userId, token };

    const user = {
      id: userId,
      email: userEmail,
      name: userEmail.split('@')[0],
      locale: 'en-US',
    };

    try {
      localStorage.setItem('agentsmith-auth', JSON.stringify({
        state: { user, token, refreshToken, tokenExpiresAt, isAuthenticated: true },
        version: 0,
      }));
    } catch {
      // If localStorage is unavailable, route gates will fail loudly.
    }

    // Also set auth directly into Zustand store to avoid hydration race in ProtectedRoute.
    const trySetAuth = () => {
      const authStore = window.__MBOS_AUTH_STORE__;
      if (!authStore || typeof authStore.getState !== 'function') {
        return false;
      }
      const state = authStore.getState();
      if (typeof state.setAuth === 'function') {
        state.setAuth(user, token, {
          refreshToken,
          expiresIn: 60 * 60,
        });
      }
      return true;
    };

    if (!trySetAuth()) {
      let attempts = 0;
      const interval = window.setInterval(() => {
        attempts += 1;
        if (trySetAuth() || attempts > 100) {
          window.clearInterval(interval);
        }
      }, 50);
    }

    // Preserve signature compatibility (workspace is derived from URL in-app).
    void wsId;
  };

  // 1) Ensure every future document gets auth pre-seeded before app bootstraps.
  await page.addInitScript(inject, { wsId, userEmail, userId });

  // 2) Also seed auth for the current document immediately (if already on app origin),
  // so first-round queries don't race and trigger session recovery redirects.
  await page.evaluate(inject, { wsId, userEmail, userId }).catch(() => {
    // about:blank / cross-origin pages can reject evaluate; initScript path still covers next navigation.
  });
}

export async function readMockAuthTokenFromContext(page: Page): Promise<string | null> {
  const token = await page.evaluate(() => window.__MBOS_AUTH_E2E_CONTEXT__?.token ?? null).catch(() => null);
  return typeof token === 'string' && token.trim().length > 0 ? token : null;
}

export async function ensureAuthenticatedSession(
  page: Page,
  bootstrapPath: string,
  fallback: {
    wsId?: string;
    userEmail?: string;
    userId?: string;
  } = {},
): Promise<void> {
  let bootstrapError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await gotoAndWait(page, bootstrapPath);
      await waitForPageReady(page);
      bootstrapError = null;
      break;
    } catch (error) {
      bootstrapError = error;
      if (page.isClosed()) {
        throw error;
      }
      if (attempt < 2) {
        await page.waitForTimeout(500 * (attempt + 1));
      }
    }
  }

  if (bootstrapError) {
    throw bootstrapError;
  }

  if (!LOGIN_PATH_REGEX.test(new URL(page.url()).pathname)) {
    return;
  }

  const ctx = await page.evaluate(() => window.__MBOS_AUTH_E2E_CONTEXT__ ?? null).catch(() => null);
  if (ctx && typeof ctx.userEmail === 'string' && typeof ctx.userId === 'string') {
    await withAuth(page, ctx.wsId || fallback.wsId || DEFAULT_WS_ID, ctx.userEmail, ctx.userId);
  } else {
    await withAuth(
      page,
      fallback.wsId || DEFAULT_WS_ID,
      fallback.userEmail || DEFAULT_USER_EMAIL,
      fallback.userId || DEFAULT_USER_ID,
    );
  }

  await gotoAndWait(page, bootstrapPath);
  await waitForPageReady(page);
  if (LOGIN_PATH_REGEX.test(new URL(page.url()).pathname)) {
    throw new Error(`Failed to bootstrap authenticated session at ${bootstrapPath}`);
  }
}
