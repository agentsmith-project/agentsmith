import { expect, test, type Page } from '@playwright/test';
import {
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
} from './integration-real-helpers';

const WORKSPACE_ID = process.env.INTEGRATION_NOTEBOOK_TERMINAL_WORKSPACE_ID ?? 'ws_default';
const PROJECT_ID = process.env.INTEGRATION_NOTEBOOK_TERMINAL_PROJECT_ID ?? 'proj_1775067184556_95890';
const TASK_ID = process.env.INTEGRATION_NOTEBOOK_TERMINAL_TASK_ID ?? 'task_4a307f2e08ad4a9ca6b5823abd4bc2aa';

async function loginThroughWorkspaceSelection(page: Page) {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/login/workspace`);
  await expect(page.getByTestId(`workspace-select__card--${WORKSPACE_ID}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`workspace-select__card--${WORKSPACE_ID}`).click();

  await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('workspace-login__keycloak-btn').click();
  await page.waitForURL(/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i, {
    timeout: 30_000,
  });
  await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(KEYCLOAK_DEV_ADMIN_USERNAME);
  await page.locator('input#password, input[name="password"]').first().fill(KEYCLOAK_DEV_ADMIN_PASSWORD);
  await page.locator('#kc-login, button[type="submit"]').first().click();
  await expect
    .poll(() => page.url(), { timeout: 60_000 })
    .toMatch(new RegExp(`/${LOCALE}/workspaces/${WORKSPACE_ID}(?:$|/projects)`));
}

test.describe('@lane-real notebook terminal UX walkthrough', () => {
  test('shows task-integrated terminal session with real shell output', async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    await loginThroughWorkspaceSelection(page);
    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook/tasks/${TASK_ID}`);

    await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
    const terminalToggle = page.getByTestId('notebook__task-header-terminal');
    await expect(terminalToggle).toBeVisible();
    await expect(terminalToggle).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('notebook-terminal-closed.png'), fullPage: true });

    await terminalToggle.click();

    const panel = page.getByTestId('notebook__task-terminal');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('Terminal');
    await expect(panel).toContainText('Active', { timeout: 30_000 });

    const terminalViewport = panel.locator('.xterm-screen');
    await expect(terminalViewport).toBeVisible({ timeout: 30_000 });
    await terminalViewport.click();

    const marker = `PLAYWRIGHT_TERMINAL_OK_${Date.now()}`;
    await page.keyboard.type(`echo ${marker}`);
    await page.keyboard.press('Enter');

    await expect.poll(async () => (await panel.textContent()) ?? '', {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    }).toContain(marker);

    await expect(panel).not.toContainText('zsh-newuser-install');
    await expect(panel).not.toContainText('You are seeing this message because you have no zsh startup files');

    await page.screenshot({ path: testInfo.outputPath('notebook-terminal-active.png'), fullPage: true });

    await panel.getByRole('button', { name: /close/i }).click();
    await expect(panel).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('notebook-terminal-closed-after-session.png'), fullPage: true });
  });
});
