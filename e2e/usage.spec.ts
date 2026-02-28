/**
 * Usage Page – E2E Tests
 *
 * Covers table/data rendering, filter controls, and KPI/metrics cards
 * using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Usage Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'usage');
  });

  test('table renders with usage data', async ({ authedPage }) => {
    const table = authedPage.getByTestId('usage__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator('[data-testid="usage__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
  });

  test('filter controls are visible', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__table')).toBeVisible({ timeout: 10000 });

    const filters = authedPage.getByTestId('usage__filters');
    await expect(filters).toBeVisible();
    await expect(filters.getByText(/Resource Type/i)).toBeVisible();
    await expect(filters.getByText(/Resource ID/i)).toBeVisible();
    await expect(filters.getByText(/End User ID/i)).toBeVisible();
  });

  test('KPI cards display usage statistics', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // UsageKPICards renders summary stats from usageKPI fixture
    // Look for KPI values (requests_today: 4523, errors_today: 23, tokens_today: 2456000)
    // The cards should render formatted numbers
    await expect(authedPage.getByText('Usage').first()).toBeVisible();

    // At least one KPI card should be visible
    // UsageKPICards renders in the section between header and filters
    await expect(authedPage.getByText(/requests/i).first()).toBeVisible();
  });

  test('page header shows title and refresh button', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    await expect(authedPage.getByText('Usage').first()).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /refresh/i })).toBeVisible();
    await expect(authedPage.getByTestId('usage__export-trigger')).toBeVisible();
  });

  test('export dropdown exposes csv and json actions', async ({ authedPage }) => {
    await authedPage.getByTestId('usage__export-trigger').click();
    await expect(authedPage.getByTestId('usage__export-option-csv')).toBeVisible();
    await expect(authedPage.getByTestId('usage__export-option-json')).toBeVisible();
  });

  test('scheduled report panel can open create dialog', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__report-schedules')).toBeVisible();
    await authedPage.getByTestId('usage__report-schedules-create').click();
    await expect(authedPage.getByTestId('usage__report-schedules-form-name')).toBeVisible();
  });

  test('scheduled report panel exposes evidence and delivery actions', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('usage__report-evidence')).toBeVisible();
    await expect(authedPage.getByTestId('usage__report-schedules-run-due')).toBeVisible();
    await expect(authedPage.locator('[data-testid^="usage__report-schedule-run-"]').first()).toBeVisible();
    await expect(authedPage.locator('[data-testid^="usage__report-schedule-deliveries-"]').first()).toBeVisible();
  });

  test('text filter and clear filters interaction works', async ({ authedPage }) => {
    const filters = authedPage.getByTestId('usage__filters');
    await expect(filters).toBeVisible({ timeout: 10000 });

    const resourceIdInput = filters.getByPlaceholder(/filter by resource id/i);
    await resourceIdInput.fill('agent_1');
    await expect(filters.getByRole('button', { name: /clear filters/i })).toBeVisible();
  });
});
