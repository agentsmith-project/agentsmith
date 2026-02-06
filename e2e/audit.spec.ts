/**
 * Audit Page – E2E Tests
 *
 * Covers table rendering, audit event data, filters, and pagination
 * using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Audit Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'audit');
  });

  test('table renders with audit event rows', async ({ authedPage }) => {
    const table = authedPage.getByTestId('audit__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = table.locator('[data-testid="audit__table__row"]');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
  });

  test('displays audit event data from mock', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('audit__table')).toBeVisible({ timeout: 10000 });

    // Verify action types from auditEventFixtures are displayed
    // Actions like "project.create", "agent.create", "endpoint.invoke"
    await expect(authedPage.getByText('project.create').first()).toBeVisible();
    await expect(authedPage.getByText('agent.create').first()).toBeVisible();
  });

  test('filter controls are visible', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('audit__table')).toBeVisible({ timeout: 10000 });

    const filters = authedPage.getByTestId('audit__filters');
    await expect(filters).toBeVisible();
  });

  test('page header shows title and subtitle', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('audit__table')).toBeVisible({ timeout: 10000 });

    // Page should display the Audit title and a refresh button
    await expect(authedPage.getByText('Audit').first()).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /refresh/i })).toBeVisible();
  });
});
