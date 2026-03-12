import { test, expect } from '@playwright/test';

test.describe('@lane-real minimal integration flow', () => {
  test('keycloak login and create project', async ({ page }) => {
    test.setTimeout(180_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    await page.goto(`/${locale}/login/workspace`);
    await page.getByTestId('workspace-select__card--ws_default').click();
    await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/login`), { timeout: 30_000 });
    await page.getByTestId('workspace-login__keycloak-btn').click();

    const keycloakError = page.getByTestId('login__keycloak-error');
    if (await keycloakError.isVisible({ timeout: 3_000 }).catch(() => false)) {
      throw new Error(`Keycloak login bootstrap failed: ${await keycloakError.textContent()}`);
    }

    await page.waitForURL(/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i, {
      timeout: 30_000,
    });

    const usernameInput = page.locator('input#username, input[name="username"], input[name="email"]').first();
    await usernameInput.waitFor({ state: 'visible', timeout: 30_000 });
    await usernameInput.fill(username);
    await page.locator('input#password, input[name="password"]').first().fill(password);
    await Promise.all([
      page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`), { timeout: 60_000 }),
      page.locator('#kc-login, button[type="submit"]').first().click(),
    ]);

    const projectName = `it-proj-${Date.now()}`;
    const createButton = page.getByTestId('projects__create-btn');
    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
    } else {
      await page.getByRole('button', { name: /New Project|Create|创建|新建项目/i }).first().click();
    }
    await page.locator('#project-name').fill(projectName);
    await Promise.all([
      page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/.+/overview`), { timeout: 30_000 }),
      page.getByRole('button', { name: /Create|创建/i }).click(),
    ]);

    const projectMatch = page.url().match(/\/projects\/([^/]+)\//);
    expect(projectMatch?.[1]).toBeTruthy();
  });
});
