import { Page } from '@playwright/test';

export async function withAuth(page: Page, wsId = 'ws_default', userEmail = 'test@example.com') {
  // Use the app's supported "MSW quick login" path so E2E doesn't depend on auth-store internals.
  await page.goto('/en-US/login', { waitUntil: 'domcontentloaded' });

  const quickLoginEmail = page.getByTestId('login__email-input');
  const quickLoginSubmit = page.getByTestId('login__submit');

  // In case MSW is disabled, these won't exist and tests should fail loudly.
  await quickLoginEmail.fill(userEmail);
  await quickLoginSubmit.click();

  // Workspace selection is the expected post-login step.
  await page.getByTestId('workspace-select__heading').waitFor({ timeout: 10_000 });

  // Pick default workspace so subsequent project routes are valid.
  await page.getByTestId(`workspace-select__card--${wsId}`).click();

  // Ensure login persisted state exists, otherwise protected-route reloads will keep bouncing to login.
  const persisted = await page.evaluate(() => localStorage.getItem('mbos-auth'));
  if (!persisted) {
    throw new Error('E2E auth failed: expected localStorage key "mbos-auth" to exist after quick login');
  }
}
