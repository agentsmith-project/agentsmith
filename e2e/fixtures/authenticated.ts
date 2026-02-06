import { Page } from '@playwright/test';

export async function withAuth(page: Page, wsId = 'ws_default', userEmail = 'test@example.com') {
  await page.addInitScript(({ wsId, userEmail }) => {
    (window as any).__MBOS_AUTH_SETUP__ = true;
    const user = {
      id: 'user_001',
      email: userEmail,
      name: userEmail.split('@')[0],
      locale: 'en-US',
    };
    const checkAuth = () => {
      const store = (window as any).__MBOS_AUTH_STORE__;
      if (store && store.getState) {
        const state = store.getState();
        if (!state.isAuthenticated && typeof state.setAuth === 'function') {
          state.setAuth(user, `mock_token_${Date.now()}`);
        }
        return true;
      }
      return false;
    };
    if (!checkAuth()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (checkAuth() || attempts > 100) {
          clearInterval(interval);
        }
      }, 50);
    }
  }, { wsId, userEmail });
}
