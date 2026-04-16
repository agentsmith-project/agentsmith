/**
 * Usage Page - E2E Tests
 *
 * Covers the personal usage view:
 * - compact work surface with 4 primary limit rows
 * - rolling 30 day trend
 * - endpoint tab switching when multiple endpoints exist
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Usage Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'usage');
  });

  test('renders compact usage work surface with limit rows and trend bars', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__view')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('usage__my-scope-badge')).toBeVisible();
    await expect(authedPage.getByTestId('usage__summary-line')).toBeVisible();
    await expect(authedPage.getByTestId('usage__work-surface')).toBeVisible();
    await expect(authedPage.getByTestId('usage__selected-endpoint')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limits')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limit-row')).toHaveCount(4);
    await expect(authedPage.getByTestId('usage__trend')).toBeVisible();
    await expect(authedPage.locator('[data-testid="usage__trend-bar"]')).toHaveCount(30);

    const endpointTabs = authedPage.getByTestId('usage__endpoint-tabs');
    const resourceTabs = authedPage.locator('[data-testid^="usage__resource-tab-"]');
    if (await endpointTabs.count()) {
      await expect(endpointTabs).toBeVisible();
      expect(await resourceTabs.count()).toBeGreaterThan(1);
    } else {
      await expect(resourceTabs).toHaveCount(0);
    }
  });

  test('shows compact usage structure without legacy controls', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__work-surface')).toBeVisible();
    await expect(authedPage.getByTestId('usage__summary-line')).toBeVisible();
    await expect(authedPage.getByTestId('usage__trend')).toBeVisible();

    await expect(authedPage.getByTestId('usage__progress-card')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__period-badge')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__filters')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__table')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__export-trigger')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__limit-mode-all')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__period-24')).toHaveCount(0);
  });

  test('can switch resource tabs', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__selected-endpoint')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limit-row')).toHaveCount(4);

    const endpointTabs = authedPage.getByTestId('usage__endpoint-tabs');
    if ((await endpointTabs.count()) === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'usage currently exposes a single resource in mock lane; resource tabs are hidden by design',
      });
      await expect(authedPage.locator('[data-testid^="usage__resource-tab-"]')).toHaveCount(0);
      return;
    }

    await expect(endpointTabs).toBeVisible();

    const resourceTabs = authedPage.locator('[data-testid^="usage__resource-tab-"]');
    const resourceTabCount = await resourceTabs.count();
    expect(resourceTabCount).toBeGreaterThan(0);

    if (resourceTabCount > 1) {
      const targetEndpointName = (await resourceTabs.nth(1).textContent())?.trim() ?? '';
      expect(targetEndpointName.length).toBeGreaterThan(0);
      await resourceTabs.nth(1).click();
      await expect(authedPage.getByTestId('usage__selected-endpoint')).toHaveText(targetEndpointName);
      await expect(authedPage.getByTestId('usage__limit-row')).toHaveCount(4);
    } else {
      await expect(resourceTabs.first()).toBeVisible();
    }
  });
});
