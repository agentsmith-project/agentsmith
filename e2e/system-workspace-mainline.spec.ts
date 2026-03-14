import { test, expect } from './fixtures/test-base';
import { waitForPageReady } from './utils/navigation';

async function loginAsSystemAdmin(page: import('@playwright/test').Page) {
  await page.goto('/en-US/system/login');
  await waitForPageReady(page);
  await expect(page.getByTestId('system-login__heading')).toBeVisible();
  await page.getByTestId('system-login__username').fill('mbos-admin');
  await page.getByTestId('system-login__password').fill('mbos-admin');
  await page.getByTestId('system-login__submit').click();
  await page.waitForURL(/\/en-US\/system\/workspaces$/, { timeout: 15_000 });
  await expect(page.getByTestId('system-workspaces__heading')).toBeVisible();
}

async function waitForWorkspaceId(page: import('@playwright/test').Page, workspaceName: string) {
  await expect
    .poll(
      async () => {
        const response = await page.evaluate(async (name) => {
          const result = await fetch('/api/system/workspaces', { cache: 'no-store' });
          const payload = (await result.json()) as { items?: Array<{ id: string; name: string }> };
          return payload.items?.find((item) => item.name === name)?.id ?? null;
        }, workspaceName);
        return response;
      },
      { timeout: 15_000 },
    )
    .not.toBeNull();

  return page.evaluate(async (name) => {
    const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
    const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
    return payload.items?.find((item) => item.name === name)?.id ?? null;
  }, workspaceName);
}

test.describe('System Workspace Mainline', () => {
  test('system admin can configure a workspace and a user can enter it and create a project', async ({ page }) => {
    await loginAsSystemAdmin(page);

    const workspaceName = `Mainline Workspace ${Date.now()}`;
    const userEmail = `mainline-${Date.now()}@example.com`;
    const projectName = `Mainline Project ${Date.now()}`;

    await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
    await page.getByTestId('system-workspaces__draft-admin').fill('mainline-admin@example.com');
    await page.getByTestId('system-workspaces__draft-idp-url').fill('https://login.example.com');
    await page.getByTestId('system-workspaces__draft-idp-realm').fill('mainline');
    await page.getByTestId('system-workspaces__draft-idp-client-id').fill('mainline-client');
    await page.getByTestId('system-workspaces__draft-idp-client-secret').fill('mainline-secret');
    await page.getByTestId('system-workspaces__save').click();

    const workspaceId = await waitForWorkspaceId(page, workspaceName);

    expect(workspaceId).toBeTruthy();

    await page.getByTestId(`system-workspaces__configure--${workspaceId}`).click();
    await page.getByTestId('system-workspaces__publish').click();
    await expect(page.getByTestId('system-workspaces__save-notice')).toHaveText('Workspace published.');

    const loginLink = page.getByTestId(`system-workspaces__open-workspace-login--${workspaceId}`);
    await expect(loginLink).toHaveAttribute('href', new RegExp(`/en-US/workspaces/${workspaceId}/login$`));
    await loginLink.click();

    await page.waitForURL(new RegExp(`/en-US/workspaces/${workspaceId}/login$`), { timeout: 15_000 });
    await waitForPageReady(page);
    await expect(page.getByTestId('workspace-login__heading')).toHaveText(workspaceName);

    await page.getByTestId('workspace-login__email-input').fill(userEmail);
    await page.getByTestId('workspace-login__submit').click();

    await page.waitForURL(new RegExp(`/en-US/workspaces/${workspaceId}$`), { timeout: 15_000 });
    await expect(page.getByTestId('workspace-home__page')).toBeVisible();
    await expect(page.getByTestId('workspace-home__workspace-id')).toHaveText(workspaceId);

    await page.getByTestId('workspace-home__open-projects').click();
    await page.waitForURL(new RegExp(`/en-US/workspaces/${workspaceId}/projects$`), { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: /projects/i })).toBeVisible();

    const toolbarCreateButton = page.getByTestId('projects__create-btn');
    const emptyStateCreateButton = page.getByRole('button', { name: /new project/i }).last();
    if (await toolbarCreateButton.isVisible().catch(() => false)) {
      await toolbarCreateButton.click();
    } else {
      await emptyStateCreateButton.click();
    }
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#project-name').fill(projectName);
    await dialog.locator('#project-description').fill('Created by the system workspace mainline E2E.');

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new RegExp(`/api/v1/workspaces/${workspaceId}/projects$`).test(response.url()) &&
        response.status() === 201,
    );

    await dialog.getByRole('button', { name: /create/i }).click();
    const createResponse = await createResponsePromise;
    const createdProject = (await createResponse.json()) as { id?: string; name?: string };

    expect(createdProject.id).toBeTruthy();
    expect(createdProject.name).toBe(projectName);

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });

    const createdRow = page.getByTestId('projects__table__row').filter({ hasText: projectName });
    await expect(createdRow).toBeVisible();
    await createdRow.getByRole('button', { name: /open/i }).click();

    await page.waitForURL(new RegExp(`/en-US/workspaces/${workspaceId}/projects/${createdProject.id}/overview$`), {
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { level: 1, name: /project hub/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 10_000 });
  });
});
