import { expect, test } from '@playwright/test';
import { keycloakLoginToWorkspace, LOCALE } from './integration-real-helpers';

const PROJECT_CREATOR_EMAIL = 'integration-user@example.com';

test.describe('@lane-real integration workspace settings directory search', () => {
  test('workspace settings can search project creators from the workspace directory', async ({ page }) => {
    await keycloakLoginToWorkspace(page, 'ws_default');

    await page.goto(`/${LOCALE}/workspaces/ws_default/settings`);
    await expect(page.getByTestId('ws-settings__project-creators')).toBeVisible({ timeout: 30_000 });

    const searchInput = page.getByTestId('ws-settings__project-creators-input');
    await searchInput.fill(PROJECT_CREATOR_EMAIL);

    const creatorOption = page.getByTestId('ws-settings__project-creators-results').getByRole('button', {
      name: new RegExp(PROJECT_CREATOR_EMAIL.replace('.', '\\.')),
    });
    await expect(creatorOption).toBeVisible({ timeout: 15_000 });
  });
});
