import { test, expect } from './fixtures/test-base';
import { waitForPageReady } from './utils/navigation';

async function loginAsSystemAdmin(page: import('@playwright/test').Page) {
  await page.goto('/en-US/system/login');
  await waitForPageReady(page);
  await expect(page.getByTestId('system-login__heading')).toBeVisible();
  await page.getByTestId('system-login__username').fill('mbos-admin');
  await page.getByTestId('system-login__password').fill('mbos-admin');
  await page.getByTestId('system-login__submit').click();
  await page.waitForURL(/\/en-US\/system\/workspaces/, { timeout: 15_000 });
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

test.describe('System Admin', () => {
  test('system admin can open system info', async ({ page }) => {
    await loginAsSystemAdmin(page);

    await expect(page.getByTestId('system-workspaces__open-info')).toBeVisible();
    await page.goto('/en-US/system/info');
    await page.waitForURL(/\/en-US\/system\/info/, { timeout: 15_000 });
    await expect(page.getByTestId('system-info__heading')).toBeVisible();
    await expect(page.getByTestId('system-info__notice')).toBeVisible();
  });

  test('system admin can create, update, and delete a workspace', async ({ page }) => {
    await loginAsSystemAdmin(page);

    const workspaceName = `Platform Ops ${Date.now()}`;
    const updatedAdmin = 'ops-admin-updated@example.com';
    const updatedRealm = 'platform-ops-updated';

    await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
    await page.getByTestId('system-workspaces__draft-admin').fill('ops-admin@example.com');
    await page.getByTestId('system-workspaces__draft-idp-url').fill('https://login.example.com');
    await page.getByTestId('system-workspaces__draft-idp-realm').fill('platform-ops');
    await page.getByTestId('system-workspaces__draft-idp-client-id').fill('platform-ops-client');
    await page.getByTestId('system-workspaces__draft-idp-client-secret').fill('platform-ops-secret');
    await page.getByTestId('system-workspaces__save').click();

    const createdWorkspaceId = await waitForWorkspaceId(page, workspaceName);

    expect(createdWorkspaceId).toBeTruthy();
    const workspaceCard = page.getByTestId(`system-workspaces__card--${createdWorkspaceId}`);
    await expect(workspaceCard).toBeVisible();
    await expect(page.getByTestId(`system-workspaces__open-workspace-login--${createdWorkspaceId}`)).toBeDisabled();

    await page.getByTestId(`system-workspaces__configure--${createdWorkspaceId}`).click();
    await page.getByTestId('system-workspaces__publish').click();
    await expect(page.getByTestId('system-workspaces__save-notice')).toHaveText('Workspace published.');
    await expect(page.getByTestId(`system-workspaces__open-workspace-login--${createdWorkspaceId}`)).toHaveAttribute(
      'href',
      new RegExp(`/en-US/workspaces/${createdWorkspaceId}/login$`),
    );

    await page.getByTestId(`system-workspaces__configure--${createdWorkspaceId}`).click();
    await page.getByTestId('system-workspaces__draft-admin').fill(updatedAdmin);
    await page.getByTestId('system-workspaces__draft-idp-realm').fill(updatedRealm);
    await page.getByTestId('system-workspaces__save').click();

    await expect(page.getByTestId('system-workspaces__save-notice')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('system-workspaces__draft-admin')).toHaveValue(updatedAdmin);
    await expect(page.getByTestId('system-workspaces__draft-idp-realm')).toHaveValue(updatedRealm);

    await page.getByTestId('system-workspaces__publish').click();
    await expect(page.getByTestId('system-workspaces__save-notice')).toHaveText('Workspace published.');

    await page.getByTestId('system-workspaces__disable').click();
    await expect(page.getByTestId('system-workspaces__save-notice')).toHaveText('Workspace disabled.');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('system-workspaces__delete').click();

    await expect(page.getByTestId('system-workspaces__save-notice')).toBeVisible();
    await expect(workspaceCard).not.toBeVisible();
  });
});
