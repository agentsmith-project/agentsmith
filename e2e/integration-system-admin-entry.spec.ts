import { expect, test } from '@playwright/test';

const LOCALE = process.env.INTEGRATION_LOCALE ?? 'en-US';
const SYSTEM_ADMIN_USERNAME = process.env.SYSTEM_ADMIN_USERNAME ?? 'mbos-admin';
const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD ?? 'mbos-admin';

test.describe('@lane-real integration system admin entry', () => {
  test('system admin can sign in and reach the workspaces page', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`/${LOCALE}/system/login`);
    await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('system-login__username').fill(SYSTEM_ADMIN_USERNAME);
    await page.getByTestId('system-login__password').fill(SYSTEM_ADMIN_PASSWORD);

    let loginResponseOk = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const responsePromise = page
        .waitForResponse(
          (response) =>
            response.url().includes('/api/system/session') && response.request().method() === 'POST',
          { timeout: 5_000 },
        )
        .catch(() => null);
      await page.getByTestId('system-login__submit').click();
      const response = await responsePromise;
      if (response) {
        loginResponseOk = response.ok();
        break;
      }
      await page.waitForTimeout(1_000);
    }

    expect(loginResponseOk).toBe(true);
    await expect
      .poll(() => page.url(), { timeout: 30_000 })
      .toMatch(new RegExp(`/${LOCALE}/system/workspaces`));
    await expect(page.getByTestId('system-workspaces__heading')).toBeVisible({ timeout: 30_000 });
  });
});
