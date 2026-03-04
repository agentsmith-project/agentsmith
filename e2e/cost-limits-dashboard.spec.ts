import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Cost & Limits Dashboard', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'usage');
    await authedPage.getByTestId('usage__panel-tab--dashboard').click();
  });

  test('dashboard panel renders trend/top/anomaly sections', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('dashboard-trend-chart')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('dashboard-top-resources')).toBeVisible();
    await expect(authedPage.getByTestId('dashboard-top-users')).toBeVisible();
    await expect(authedPage.getByTestId('dashboard-anomalies')).toBeVisible();
  });

  test('resource type filter triggers usage timeseries query with resource_type', async ({ authedPage }) => {
    const timeseriesReq = authedPage.waitForRequest((req) => {
      if (req.method() !== 'GET') return false;
      if (!/\/api\/v1\/workspaces\/.*\/projects\/.*\/usage\/timeseries/.test(req.url())) return false;
      return req.url().includes('resource_type=agent');
    });

    await authedPage.getByTestId('dashboard-filters__resource-type').selectOption('agent');
    await timeseriesReq;
  });

  test('top resource drill-down switches to usage panel and sets resource filter', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('dashboard-top-resources__row--ep_1')).toBeVisible();
    await authedPage.getByTestId('dashboard-top-resources__row--ep_1').click();

    await expect(authedPage.getByTestId('usage__filters')).toBeVisible({ timeout: 10000 });
    await expect(
      authedPage.getByPlaceholder(/filter by resource id/i),
    ).toHaveValue('ep_1');
  });

  test('anomaly drill-down switches to usage panel and sets resource filter', async ({ authedPage }) => {
    const anomalyRow = authedPage.locator('[data-testid^="dashboard-anomalies__row--"]').first();
    await expect(anomalyRow).toBeVisible();
    await anomalyRow.click();

    await expect(authedPage.getByTestId('usage__filters')).toBeVisible({ timeout: 10000 });
    await expect(
      authedPage.getByPlaceholder(/filter by resource id/i),
    ).toHaveValue('ep_1');
  });
});
