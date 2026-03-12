/**
 * Usage Page - E2E Tests
 *
 * Covers the current low-cognitive personal usage view:
 * - resource tabs
 * - progress cards for endpoint limits
 * - period switching
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Usage Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'usage');
  });

  test('renders usage panel with resource tabs and progress cards', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__view')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('usage__my-scope-badge')).toBeVisible();
    await expect(authedPage.getByTestId('usage__endpoint-tabs')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limits')).toBeVisible();
    await expect(authedPage.locator('[data-testid="usage__progress-card"]').first()).toBeVisible();
  });

  test('shows current low-cognitive usage structure without removed controls', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__planning-controls')).toBeVisible();
    await expect(authedPage.getByTestId('usage__trend')).toBeVisible();

    await expect(authedPage.getByTestId('usage__endpoint-tabs')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limit-mode-all')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limit-mode-rate')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limit-mode-spending')).toBeVisible();

    await expect(authedPage.getByTestId('usage__filters')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__table')).toHaveCount(0);
    await expect(authedPage.getByTestId('usage__export-trigger')).toHaveCount(0);
  });

  test('switches period between 48h and 24h', async ({ authedPage }) => {
    const period24 = authedPage.getByTestId('usage__period-24');
    const period48 = authedPage.getByTestId('usage__period-48');

    await expect(period48).toHaveAttribute('data-active', 'true');
    await period24.click();
    await expect(period24).toHaveAttribute('data-active', 'true');
    await expect(period48).toHaveAttribute('data-active', 'false');
  });

  test('switches limit mode between all and rate', async ({ authedPage }) => {
    const allMode = authedPage.getByTestId('usage__limit-mode-all');
    const rateMode = authedPage.getByTestId('usage__limit-mode-rate');

    await expect(allMode).toBeVisible();
    await rateMode.click();

    await expect(authedPage.locator('[data-testid="usage__progress-card"]').first()).toBeVisible();
  });

  test('can switch resource tabs', async ({ authedPage }) => {
    const endpointTabs = authedPage.getByTestId('usage__endpoint-tabs');
    await expect(endpointTabs).toBeVisible();

    const resourceTabs = authedPage.locator('[data-testid^="usage__resource-tab-"]');
    const resourceTabCount = await resourceTabs.count();
    expect(resourceTabCount).toBeGreaterThan(0);

    if (resourceTabCount > 1) {
      await resourceTabs.nth(1).click();
      await expect(authedPage.locator('[data-testid="usage__endpoint-dimensions"]').first()).toBeVisible();
    } else {
      await expect(resourceTabs.first()).toBeVisible();
    }
  });
});
