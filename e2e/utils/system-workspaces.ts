import { expect, type Locator, type Page } from '@playwright/test';

async function readWorkspaceProvisioningStatus(page: Page, workspaceId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
    const payload = (await response.json()) as {
      items?: Array<{ id: string; provisioning_status: string; last_init_error?: string | null }>;
    };
    const item = payload.items?.find((candidate) => candidate.id === id);
    return item ? `${item.provisioning_status}:${item.last_init_error ?? ''}` : 'missing';
  }, workspaceId);
}

async function waitForWorkspacePublishResult(page: Page, workspaceId: string): Promise<string> {
  let status = 'missing';
  await expect
    .poll(
      async () => {
        status = await readWorkspaceProvisioningStatus(page, workspaceId);
        return status;
      },
      { timeout: 30_000 },
    )
    .toMatch(/^(ready|failed):/);
  return status;
}

export async function waitForWorkspaceLoginReady(page: Page, args: {
  workspaceId: string;
  locale: string;
  maxPublishAttempts?: number;
}): Promise<Locator> {
  const { workspaceId, locale, maxPublishAttempts = 2 } = args;
  const loginLink = page
    .getByTestId(`system-workspaces__card--${workspaceId}`)
    .getByTestId(`system-workspaces__open-workspace-login--${workspaceId}`);

  for (let attempt = 0; attempt < maxPublishAttempts; attempt += 1) {
    await page.getByTestId('system-workspaces__publish').click();
    const status = await waitForWorkspacePublishResult(page, workspaceId);
    if (status.startsWith('ready:')) {
      break;
    }
    if (attempt === maxPublishAttempts - 1) {
      throw new Error(`workspace_publish_failed:${status}`);
    }
  }

  await expect(loginLink).toHaveAttribute(
    'href',
    new RegExp(`/${locale}/workspaces/${workspaceId}/login$`),
    { timeout: 30_000 },
  );
  await expect
    .poll(
      async () => {
        return page.evaluate(async (id) => {
          const response = await fetch(`/api/public/workspaces/${id}`, { cache: 'no-store' });
          return response.ok ? 'ready' : `status:${response.status}`;
        }, workspaceId);
      },
      { timeout: 30_000 },
    )
    .toBe('ready');

  return loginLink;
}
