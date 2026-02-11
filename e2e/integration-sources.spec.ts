import { expect, test } from '@playwright/test';

test.describe('sources integration flow', () => {
  test('keycloak login, create project, and complete sources object-browser CRUD', async ({ page }) => {
    test.setTimeout(240_000);
    const locale = process.env.INTEGRATION_LOCALE ?? 'en-US';
    const username = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
    const password = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';

    await page.goto(`/${locale}/login`);
    await page.getByTestId('login__keycloak-btn').click();
    await page.waitForURL(/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i, {
      timeout: 30_000,
    });
    await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(username);
    await page.locator('input#password, input[name="password"]').first().fill(password);
    await Promise.all([
      page.waitForURL(new RegExp(`/${locale}/login/workspace`), { timeout: 60_000 }),
      page.locator('#kc-login, button[type="submit"]').first().click(),
    ]);

    await page.getByTestId('workspace-select__card--ws_default').click();
    await page.waitForURL(new RegExp(`/${locale}/workspaces/ws_default/projects`));

    const projectName = `it-src-${Date.now()}`;
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

    await page.getByTestId('sources__library-create').click();
    await page.getByTestId('sources__library-create__name').fill('Integration Library');
    await page.getByTestId('sources__library-create__submit').click();
    const libraryItem = page.locator('[data-testid^="sources__library-item--"]').first();
    await expect(libraryItem).toBeVisible({ timeout: 30_000 });
    await libraryItem.click();

    await page.getByTestId('sources__new-folder').click();
    await page.getByTestId('sources__dialog__new-folder').locator('input').fill('docs');
    await page.getByTestId('sources__dialog__new-folder').getByRole('button', { name: /Create|创建/i }).click();
    await expect(page.locator('text=docs')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('sources__breadcrumb-root').click();

    await page.getByTestId('sources__upload').click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'integration-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('integration-content', 'utf-8'),
    });
    await expect(page.locator('text=integration-note.txt')).toBeVisible({ timeout: 30_000 });

    // Upload same name -> keep both (rename)
    await page.getByTestId('sources__upload').click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'integration-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('integration-content-2', 'utf-8'),
    });
    await expect(page.getByTestId('sources__dialog__upload-conflict')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('sources__upload-conflict__rename').click();
    await expect(page.locator('text=integration-note (1).txt')).toBeVisible({ timeout: 30_000 });

    // Upload same name -> overwrite
    await page.getByTestId('sources__upload').click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'integration-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('integration-content-3', 'utf-8'),
    });
    await expect(page.getByTestId('sources__dialog__upload-conflict')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('sources__upload-conflict__overwrite').click();
    await expect(page.getByTestId('sources__dialog__upload-conflict')).toHaveCount(0);

    const row = page
      .locator('[data-testid="sources__object-row"]')
      .filter({ hasText: 'integration-note.txt' })
      .first();
    await row.locator('input[type="checkbox"]').check();

    await page.getByTestId('sources__rename').click();
    await page.getByTestId('sources__move__dest-prefix').fill('docs/');
    await page.getByTestId('sources__move__name').fill('integration-note-renamed.txt');
    await page.getByTestId('sources__move__submit').click();
    await expect(
      page.locator('[data-testid="sources__object-row"]').filter({ hasText: 'integration-note.txt' }),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="sources__object-row"]').filter({ hasText: 'integration-note-renamed.txt' }),
    ).toHaveCount(0);

    await page
      .locator('[data-testid="sources__object-row"]')
      .filter({ hasText: 'docs' })
      .first()
      .locator('button')
      .first()
      .click();
    const movedRow = page
      .locator('[data-testid="sources__object-row"]')
      .filter({ hasText: 'integration-note-renamed.txt' })
      .first();
    await expect(movedRow).toBeVisible({ timeout: 30_000 });
    const movedCheckbox = movedRow.locator('input[type="checkbox"]');
    await movedCheckbox.check();
    await expect(movedCheckbox).toBeChecked();

    await page.getByTestId('sources__delete').click();
    await page.getByTestId('sources__dialog__delete').getByRole('button', { name: /Delete|删除/i }).click();
    await expect(page.locator('text=integration-note-renamed.txt')).toHaveCount(0);
  });
});
