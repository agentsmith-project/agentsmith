import { expect, test } from '@playwright/test';
import { keycloakLoginToWorkspace, LOCALE } from './integration-real-helpers';

test.describe('@lane-real integration workspace entry', () => {
  test('dev-admin reaches ws_default projects entry without denied flicker', async ({ page }) => {
    await keycloakLoginToWorkspace(page, 'ws_default');

    await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/ws_default/projects(?:$|/)`), {
      timeout: 30_000,
    });
    await expect(page.getByTestId('projects__page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('permission_denied_title')).not.toBeVisible();
  });
});
