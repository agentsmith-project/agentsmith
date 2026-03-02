/**
 * Workspace Settings Page E2E Tests
 *
 * Tests the workspace-level settings page including workspace info display,
 * members list, and page structure.
 */

import { test, expect, goTo, LOCALE, WS_ID } from './fixtures/test-base';

const wsSettingsPath = `/${LOCALE}/workspaces/${WS_ID}/settings`;

test.describe('Workspace Settings Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goTo(authedPage, wsSettingsPath);
  });

  test('should display workspace settings heading', async ({ authedPage }) => {
    await expect(
      authedPage.getByRole('heading', { name: /Workspace Settings/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display workspace name', async ({ authedPage }) => {
    const wsName = authedPage.getByTestId('ws-settings__name');
    await expect(wsName).toBeVisible({ timeout: 10000 });
    // The workspace name element should display the workspace identifier
    const text = await wsName.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('should display members section', async ({ authedPage }) => {
    const membersSection = authedPage.getByTestId('ws-settings__members');
    await expect(membersSection).toBeVisible({ timeout: 10000 });
  });

  test('should display governance overview and project posture sections', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('ws-settings__governance-overview')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('ws-settings__project-posture')).toBeVisible({ timeout: 10000 });
  });

  test('should expose cross-project governance actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('ws-settings__project-open-settings--proj_001')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('ws-settings__project-open-members--proj_001')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('ws-settings__project-open-resource-policy--proj_001')).toBeVisible({ timeout: 10000 });
  });

  test('should display governance attention feed', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('ws-settings__governance-attention')).toBeVisible({ timeout: 10000 });
  });

  test('should display workspace members from mock data', async ({ authedPage }) => {
    const membersSection = authedPage.getByTestId('ws-settings__members');
    await expect(membersSection).toBeVisible({ timeout: 10000 });

    // Workspace members from MSW fixture should be listed
    // Verify at least one member entry is displayed
    const memberEntries = membersSection.locator('[class*="flex"][class*="items-center"]');
    await expect(memberEntries.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display topbar on workspace settings page', async ({ authedPage }) => {
    const topbar = authedPage.getByTestId('topbar');
    await expect(topbar).toBeVisible({ timeout: 10000 });
  });
});
