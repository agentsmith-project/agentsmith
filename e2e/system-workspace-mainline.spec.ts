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

test.describe('System Workspace Mainline', () => {
  test('system admin can configure a workspace and a user can enter it and create a project', async ({ page }) => {
    await mockWorkspaceAdminDirectory(page);
    await loginAsSystemAdmin(page);

    const workspaceName = `Mainline Workspace ${Date.now()}`;
    const userEmail = `mainline-${Date.now()}@example.com`;
    const projectName = `Mainline Project ${Date.now()}`;

    await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
    await page.getByTestId('system-workspaces__draft-idp-url').fill('https://login.example.com');
    await page.getByTestId('system-workspaces__draft-idp-realm').fill('mainline');
    await page.getByTestId('system-workspaces__draft-idp-client-id').fill('mainline-client');
    await page.getByTestId('system-workspaces__draft-idp-client-secret').fill('mainline-secret');
    await verifyIdentityProvider(page);
    await selectWorkspaceAdmin(page, 'dev-admin@example.com');
    await page.getByTestId('system-workspaces__save').click();

    const workspaceId = await waitForWorkspaceId(page, workspaceName);

    expect(workspaceId).toBeTruthy();

    await page.getByTestId(`system-workspaces__configure--${workspaceId}`).click();
    await page.getByTestId('system-workspaces__publish').click();
    const loginLink = page.getByTestId(`system-workspaces__open-workspace-login--${workspaceId}`);
    await expect(loginLink).toHaveAttribute('href', new RegExp(`/en-US/workspaces/${workspaceId}/login$`));
    await loginLink.click();

    await page.waitForURL(new RegExp(`/en-US/workspaces/${workspaceId}/login$`), { timeout: 15_000 });
    await waitForPageReady(page);
    await expect(page.getByTestId('workspace-login__heading')).toHaveText(workspaceName);

    await page.getByTestId('workspace-login__email-input').fill(userEmail);
    await page.getByTestId('workspace-login__submit').click();

    await page.waitForURL(new RegExp(`/en-US/workspaces/${workspaceId}$`), { timeout: 15_000 });
    await expect(page.getByTestId('projects__page')).toBeVisible();
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
