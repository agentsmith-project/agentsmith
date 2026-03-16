/**
 * Usage Page - E2E Tests
 *
 * Covers the personal usage view:
 * - 4 primary limit cards
 * - rolling 30 day trend
 * - endpoint tab switching when multiple endpoints exist
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Usage Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'usage');
  });

  test('renders usage panel with resource tabs and progress cards', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__view')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('usage__my-scope-badge')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limits')).toBeVisible();
    await expect(authedPage.locator('[data-testid="usage__progress-card"]')).toHaveCount(4);
    await expect(authedPage.locator('[data-testid="usage__trend-bar"]')).toHaveCount(30);
    const endpointTabs = authedPage.getByTestId('usage__endpoint-tabs');
    const resourceTabs = authedPage.locator('[data-testid^="usage__resource-tab-"]');
    if (await endpointTabs.count()) {
      await expect(endpointTabs).toBeVisible();
      expect(await resourceTabs.count()).toBeGreaterThan(1);
    }
  });

  test('shows compact usage structure without legacy controls', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__trend')).toBeVisible();
    await expect(authedPage.getByTestId('usage__period-badge')).toBeVisible();

    await expect(authedPage.getByTestId('usage__filters')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__table')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__export-trigger')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__limit-mode-all')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__period-24')).toHaveCount(0);
  });

  test('can switch resource tabs', async ({ authedPage }) => {
    const endpointTabs = authedPage.getByTestId('usage__endpoint-tabs');
    if ((await endpointTabs.count()) === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'usage currently exposes a single resource in mock lane; resource tabs are hidden by design',
      });
      await expect(authedPage.locator('[data-testid="usage__progress-card"]').first()).toBeVisible();
      return;
    }

    await expect(endpointTabs).toBeVisible();

    const resourceTabs = authedPage.locator('[data-testid^="usage__resource-tab-"]');
    const resourceTabCount = await resourceTabs.count();
    expect(resourceTabCount).toBeGreaterThan(0);

    if (resourceTabCount > 1) {
      await resourceTabs.nth(1).click();
      await expect(authedPage.getByTestId('usage__selected-endpoint')).toBeVisible();
    } else {
      await expect(resourceTabs.first()).toBeVisible();
    }
  });
});
