import { test, expect } from '@playwright/test';

const RUN_REAL_INTEGRATION = process.env.RUN_REAL_INTEGRATION_E2E === 'true';

test.describe('minimal real integration flow', () => {
  test.skip(!RUN_REAL_INTEGRATION, 'Enable with RUN_REAL_INTEGRATION_E2E=true');

  test('keycloak login, create project, source library and file CRUD', async ({ page }) => {
    test.setTimeout(180_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    await page.goto(`/${locale}/login`);
    await page.getByTestId('login__keycloak-btn').click();

    const usernameInput = page.getByLabel(/Username|Email|用户名|邮箱/i).first();
    await usernameInput.waitFor({ state: 'visible', timeout: 30_000 });
    await usernameInput.fill(username);
    await page.getByLabel(/Password|密码/i).first().fill(password);
    await Promise.all([
      page.waitForURL(new RegExp(`/${locale}/login/workspace`), { timeout: 60_000 }),
      page.getByRole('button', { name: /Sign In|Log in|登录/i }).first().click(),
    ]);

    await page.getByTestId('workspace-select__card--ws_default').click();
    await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`));

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
    const projectId = projectMatch![1];

    await page.getByRole('link', { name: /Sources|文件/i }).first().click();
    await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects/${projectId}/sources`));
    await page.getByTestId('sources__manage-libraries-btn').click();

    await page.getByTestId('sources__library-create-input').fill('Integration Library');
    await page.getByTestId('sources__library-create-btn').click();

    const renameButton = page.locator('[data-testid^="sources__library-rename-btn--"]').first();
    await expect(renameButton).toBeVisible();
    await renameButton.click();
    const renameInput = page.locator('[data-testid^="sources__library-rename-input--"]').first();
    await renameInput.fill('Integration Library Updated');
    await page.locator('[data-testid^="sources__library-rename-save--"]').first().click();
    await expect(page.getByText('Integration Library Updated')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('sources__upload-btn').click();
    await page
      .locator('[data-testid="sources__upload-dialog"] input[type="file"]')
      .setInputFiles({
        name: 'integration-note.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('integration-content', 'utf-8'),
      });
    await page.getByRole('button', { name: /Upload 1 file\(s\)|上传 1/i }).click();
    await expect(page.getByText('integration-note.txt')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('checkbox', { name: /attach integration-note\.txt/i }).check();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download|下载/i }).click(),
    ]);
    expect(download.suggestedFilename()).toContain('integration-note.txt');

    await page.getByRole('button', { name: /^Delete$|删除$/i }).first().click();
    await page
      .getByTestId('sources__delete-dialog')
      .getByRole('button', { name: /^Delete$|删除$/i })
      .click();
    await expect(page.getByText('integration-note.txt')).toHaveCount(0);
  });
});
