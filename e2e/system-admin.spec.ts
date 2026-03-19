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

async function waitForWorkspaceDeletion(page: import('@playwright/test').Page, workspaceId: string) {
  await expect
    .poll(
      async () => {
        return page.evaluate(async (id) => {
          const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
          const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
          return payload.items?.some((item) => item.id === id) ?? false;
        }, workspaceId);
      },
      { timeout: 15_000 },
    )
    .toBe(false);
}

async function mockWorkspaceAdminDirectory(page: import('@playwright/test').Page) {
  await page.route('**/api/system/workspaces/idp/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        idp_ok: true,
        directory_search_supported: true,
      }),
    });
  });

  await page.route('**/api/system/workspaces/directory/users', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { query?: string } | undefined;
    const query = body?.query?.trim().toLowerCase() ?? '';
    const users = [
      { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
      { user_id: 'kc-integration-user', email: 'integration-user@example.com', name: 'Integration User' },
    ].filter((user) => user.email.toLowerCase().includes(query));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: users, total: users.length }),
    });
  });
}

async function verifyIdentityProvider(page: import('@playwright/test').Page) {
  const responsePromise = page.waitForResponse(
    (candidate) =>
      candidate.url().includes('/api/system/workspaces/idp/verify') &&
      candidate.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await page.getByTestId('system-workspaces__verify-idp').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId('system-workspaces__idp-status')).toBeVisible();
}

async function selectWorkspaceAdmin(page: import('@playwright/test').Page, email: string) {
  const adminInput = page.getByTestId('system-workspaces__draft-admin');
  let lastFailure = 'directory_request_not_observed';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/system/workspaces/directory/users') &&
        candidate.request().method() === 'POST',
      { timeout: 15_000 },
    ).catch(() => null);
    await adminInput.fill('');
    await adminInput.fill(email);
    const response = await responsePromise;
    if (!response) {
      lastFailure = 'directory_request_timeout';
      continue;
    }

    const payload = (await response.json().catch(() => null)) as
      | { items?: Array<{ user_id?: string; email?: string }> }
      | { error_message?: string }
      | null;
    if (!response.ok()) {
      lastFailure = `directory_response_${response.status()}`;
      continue;
    }

    const matchedUser = Array.isArray(payload?.items)
      ? payload.items.find((item) => item.email === email)
      : null;
    const userId = typeof matchedUser?.user_id === 'string' ? matchedUser.user_id : '';
    if (!userId) {
      lastFailure = 'directory_user_missing';
      continue;
    }

    const adminOption = page.getByTestId(`system-workspaces__admin-option--${userId}`);
    await expect(adminOption).toBeVisible({ timeout: 15_000 });
    await adminOption.click();
    await expect(page.getByTestId('system-workspaces__selected-admin')).toContainText(email);
    return;
  }

  throw new Error(`workspace_admin_directory_user_missing:${email}:${lastFailure}`);
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
    await mockWorkspaceAdminDirectory(page);
    await loginAsSystemAdmin(page);

    const workspaceName = `Platform Ops ${Date.now()}`;
    const updatedAdmin = 'integration-user@example.com';
    const initialRealm = 'platform-ops';

    await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
    await page.getByTestId('system-workspaces__draft-idp-url').fill('https://login.example.com');
    await page.getByTestId('system-workspaces__draft-idp-realm').fill(initialRealm);
    await page.getByTestId('system-workspaces__draft-idp-client-id').fill('platform-ops-client');
    await page.getByTestId('system-workspaces__draft-idp-client-secret').fill('platform-ops-secret');
    await verifyIdentityProvider(page);
    await selectWorkspaceAdmin(page, 'dev-admin@example.com');
    await page.getByTestId('system-workspaces__save').click();

    const createdWorkspaceId = await waitForWorkspaceId(page, workspaceName);

    expect(createdWorkspaceId).toBeTruthy();
    const workspaceCard = page.getByTestId(`system-workspaces__card--${createdWorkspaceId}`);
    await expect(workspaceCard).toBeVisible();
    await expect(page.getByTestId(`system-workspaces__open-workspace-login--${createdWorkspaceId}`)).toBeDisabled();

    await page.getByTestId(`system-workspaces__configure--${createdWorkspaceId}`).click();
    await page.getByTestId('system-workspaces__publish').click();
    const loginLink = page.getByTestId(`system-workspaces__open-workspace-login--${createdWorkspaceId}`);
    await expect(loginLink).toHaveAttribute('href', new RegExp(`/en-US/workspaces/${createdWorkspaceId}/login$`));

    await page.getByTestId(`system-workspaces__configure--${createdWorkspaceId}`).click();
    await page.getByTestId('system-workspaces__draft-idp-client-secret').fill('platform-ops-secret');
    await verifyIdentityProvider(page);
    await selectWorkspaceAdmin(page, updatedAdmin);
    await page.getByTestId('system-workspaces__save').click();

    await expect(workspaceCard).toContainText(updatedAdmin);
    await expect(workspaceCard).toContainText(initialRealm);

    await page.getByTestId('system-workspaces__publish').click();
    await expect(loginLink).toHaveAttribute('href', new RegExp(`/en-US/workspaces/${createdWorkspaceId}/login$`));

    await page.getByTestId('system-workspaces__disable').click();
    await expect(loginLink).toBeDisabled();

    await page.getByTestId('system-workspaces__delete').click();
    await expect(page.getByTestId('system-workspaces__delete-dialog')).toBeVisible();
    await page.getByTestId('system-workspaces__delete-confirm').click();
    await waitForWorkspaceDeletion(page, createdWorkspaceId);
  });
});
