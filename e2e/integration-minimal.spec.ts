import { test, expect } from '@playwright/test';
import { ensureWorkspaceProjectCreatorAccess, readStoredAuthToken } from './integration-workspace-access';

test.describe('@lane-real minimal integration flow', () => {
  test('keycloak login and create project', async ({ page }) => {
    test.setTimeout(180_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    await page.goto(`/${locale}/workspaces/ws_default/login`);
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
    await page.locator('#kc-login, button[type="submit"]').first().click();
    await expect
      .poll(() => page.url(), { timeout: 60_000 })
      .toMatch(new RegExp(`/${locale}/workspaces/ws_default(?:$|/projects)`));
    if (!new RegExp(`/${locale}/workspaces/ws_default/projects`).test(page.url())) {
      await page.goto(`/${locale}/workspaces/ws_default/projects`);
    }
    await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects(?:$|/)`), { timeout: 30_000 });
    const apiBase = process.env.INTEGRATION_API_BASE || 'http://localhost:20010';
    const token = await readStoredAuthToken(page);
    await ensureWorkspaceProjectCreatorAccess({ page, apiBase, token, username });
    await page.goto(`/${locale}/workspaces/ws_default/projects`);

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
