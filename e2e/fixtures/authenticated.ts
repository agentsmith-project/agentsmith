import { Page } from '@playwright/test';

export async function withAuth(page: Page, wsId = 'ws_default', userEmail = 'test@example.com', userId = 'user_001') {
  await page.addInitScript(({ wsId, userEmail, userId }) => {
    window.__MBOS_AUTH_SETUP__ = true;
    window.__MBOS_AUTH_E2E_CONTEXT__ = { wsId, userEmail, userId };

    const user = {
      id: userId,
      email: userEmail,
      name: userEmail.split('@')[0],
      locale: 'en-US',
    };

    const token = `mock_token_${userId}_${Date.now()}`;
    const refreshToken = `mock_refresh_${Date.now()}`;
    const tokenExpiresAt = Date.now() + 60 * 60 * 1000;

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
  }, { wsId, userEmail, userId });
}
