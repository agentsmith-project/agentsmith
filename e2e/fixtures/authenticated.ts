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

    const token = `mock_token_${Date.now()}`;
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

    // Preserve signature compatibility (workspace is derived from URL in-app).
    void wsId;
  }, { wsId, userEmail });
}
