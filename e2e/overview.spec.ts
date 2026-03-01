import { test, expect, goToProject } from './fixtures/test-base';

test.describe('AI Ops Home', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');
  });

  test('shows project status strip and attention panel', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('overview__ai-ops-home')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('overview__status-runtime')).toBeVisible();
    await expect(authedPage.getByTestId('overview__status-cost')).toBeVisible();
    await expect(authedPage.getByTestId('overview__status-release')).toBeVisible();
    await expect(authedPage.getByTestId('overview__status-incidents')).toBeVisible();
    await expect(authedPage.getByTestId('overview__attention')).toBeVisible();
  });

  test('supports time range switching', async ({ authedPage }) => {
    const timeRange = authedPage.getByTestId('overview__time-range');
    await expect(timeRange).toBeVisible({ timeout: 10000 });
    await timeRange.click();
    await authedPage.getByRole('option', { name: /last 7 days/i }).click();
    await expect(timeRange).toContainText(/7/i);
  });

  test('renders snapshot sections and quick actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('overview__snapshot-runtime')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('overview__snapshot-cost')).toBeVisible();
    await expect(authedPage.getByTestId('overview__snapshot-release')).toBeVisible();
    await expect(authedPage.getByTestId('overview__snapshot-incidents')).toBeVisible();
    await expect(authedPage.getByTestId('overview__quick-actions')).toBeVisible();
    await expect(authedPage.getByTestId('overview__snapshot-runtime-link')).toHaveAttribute('href', /runtime-observability\?/);
    await expect(authedPage.getByTestId('overview__snapshot-cost-link')).toHaveAttribute('href', /usage\?/);
    await expect(authedPage.getByTestId('overview__snapshot-release-link')).toHaveAttribute('href', /release-ops\?/);
  });

  test('navigates to chat from quick actions', async ({ authedPage }) => {
    const quickActions = authedPage.getByTestId('overview__quick-actions');
    await expect(quickActions).toBeVisible({ timeout: 10000 });
    await quickActions.getByText(/Chat/i).first().click();
    await authedPage.waitForURL(/\/chat/, { timeout: 10000 });
    await expect(authedPage.getByTestId('chat__main-pane')).toBeVisible();
  });
});
