import { test, expect } from '@playwright/test';

test('debug store exposure', async ({ page }) => {
  // Listen to console events
  page.on('console', msg => {
    console.log('PAGE CONSOLE:', msg.text());
  });

  // Navigate to the projects page
  await page.goto('http://localhost:3000/en-US/workspaces/ws_default/projects');
  await page.waitForTimeout(2000);

  // Check if the store is exposed
  const storeInfo = await page.evaluate(() => {
    const store = (window as any).__MBOS_AUTH_STORE__;
    return {
      storeExists: !!store,
      hasGetState: store ? typeof store.getState : 'undefined',
      state: store ? store.getState() : null,
    };
  });

  console.log('Store info:', JSON.stringify(storeInfo, null, 2));

  // Try calling setAuth
  await page.evaluate(() => {
    const store = (window as any).__MBOS_AUTH_STORE__;
    if (store && store.getState) {
      const state = store.getState();
      console.log('Before setAuth, isAuthenticated:', state.isAuthenticated);
      if (typeof state.setAuth === 'function') {
        state.setAuth(
          {
            id: 'user_default',
            email: 'test@example.com',
            name: 'test',
            locale: 'en-US',
          },
          `mock_token_${Date.now()}`
        );
      }
      console.log('After setAuth, isAuthenticated:', store.getState().isAuthenticated);
    }
  });

  await page.waitForTimeout(1000);

  // Check the state again
  const stateAfter = await page.evaluate(() => {
    const store = (window as any).__MBOS_AUTH_STORE__;
    return store ? store.getState() : null;
  });

  console.log('State after setAuth:', JSON.stringify(stateAfter, null, 2));

  // Take a screenshot
  await page.screenshot({ path: 'test-results/debug-store-screenshot.png' });
});
