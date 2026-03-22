import { expect, test } from '@playwright/test';
import { LOCALE } from './integration-real-helpers';

test.describe('@lane-real integration workspace public login truth', () => {
  test('workspace public metadata and login page expose the same workspace identity', async ({ page }) => {
    const listResponse = await page.request.get('/api/public/workspaces');
    expect(listResponse.ok()).toBeTruthy();
    const listBody = (await listResponse.json()) as { items?: Array<{ id: string; name: string }> };
    const defaultWorkspace = listBody.items?.find((item) => item.id === 'ws_default');
    expect(defaultWorkspace?.name).toBeTruthy();

    const detailResponse = await page.request.get('/api/public/workspaces/ws_default');
    expect(detailResponse.ok()).toBeTruthy();
    const detailBody = (await detailResponse.json()) as {
      id: string;
      name: string;
      login_idp?: { url?: string; realm?: string; client_id?: string };
    };

    expect(detailBody.id).toBe('ws_default');
    expect(detailBody.name).toBe(defaultWorkspace?.name);
    expect(detailBody.login_idp?.url).toBeTruthy();
    expect(detailBody.login_idp?.realm).toBeTruthy();
    expect(detailBody.login_idp?.client_id).toBeTruthy();

    await page.goto(`/${LOCALE}/workspaces/ws_default/login`);
    await expect(page.getByTestId('workspace-login__heading')).toHaveText(detailBody.name, { timeout: 30_000 });
    await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workspace-login__error')).toHaveCount(0);

    const runtimeConfig = await page.evaluate(() => window.__MBOS_PUBLIC_RUNTIME_CONFIG__);
    expect(runtimeConfig?.apiBase).toBeTruthy();
    expect(runtimeConfig?.keycloakUrl).toBeTruthy();

    const pageHost = new URL(page.url()).hostname;
    if (pageHost !== 'localhost' && pageHost !== '127.0.0.1') {
      expect(new URL(runtimeConfig!.apiBase).hostname).not.toBe('localhost');
      expect(new URL(runtimeConfig!.apiBase).hostname).not.toBe('127.0.0.1');
      expect(new URL(runtimeConfig!.keycloakUrl).hostname).not.toBe('localhost');
      expect(new URL(runtimeConfig!.keycloakUrl).hostname).not.toBe('127.0.0.1');
    }
  });
});
