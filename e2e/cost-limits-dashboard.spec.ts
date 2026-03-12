import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Usage Limits Board', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'usage');
  });

  test('renders overview, limits, and trend sections', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__view')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('usage__planning-controls')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limits')).toBeVisible();
    await expect(authedPage.getByTestId('usage__trend')).toBeVisible();
    await expect(authedPage.locator('[data-testid="usage__progress-card"]').first()).toBeVisible();
  });

  test('supports limit mode switching without removed dashboard panels', async ({ authedPage }) => {
    await authedPage.getByTestId('usage__limit-mode-rate').click();
    await expect(authedPage.locator('[data-testid="usage__progress-card"]').first()).toBeVisible();

    await authedPage.getByTestId('usage__limit-mode-spending').click();
    await expect(authedPage.locator('[data-testid="usage__progress-card"]').first()).toBeVisible();

    await expect(authedPage.getByTestId('usage__panel-tab--dashboard')).toHaveCount(0);
    await expect(authedPage.getByTestId('dashboard-top-resources')).toHaveCount(0);
    await expect(authedPage.getByTestId('dashboard-anomalies')).toHaveCount(0);
  });

  test('supports resource tab switching in the limits board', async ({ authedPage }) => {
    const resourceTabs = authedPage.locator('[data-testid^="usage__resource-tab-"]');
    const resourceTabCount = await resourceTabs.count();

    if (resourceTabCount > 1) {
      await resourceTabs.nth(1).click();
      await expect(resourceTabs.nth(1)).toHaveAttribute('data-state', 'active');
    } else if (resourceTabCount === 1) {
      await expect(resourceTabs.first()).toHaveAttribute('data-state', 'active');
    } else {
      await expect(authedPage.locator('[data-testid="usage__progress-card"]').first()).toBeVisible();
    }
  });
});
