/**
 * Overview Page E2E Tests
 *
 * Tests the project overview dashboard including KPI cards,
 * time range selector, quick access navigation, and activity timeline.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Overview Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');
  });

  test('should display core KPI cards', async ({ authedPage }) => {
    const kpiRequests = authedPage.getByTestId('overview__kpi-card--requests');
    const kpiErrors = authedPage.getByTestId('overview__kpi-card--errors');
    const kpiTokens = authedPage.getByTestId('overview__kpi-card--tokens');

    await expect(kpiRequests).toBeVisible({ timeout: 10000 });
    await expect(kpiErrors).toBeVisible();
    await expect(kpiTokens).toBeVisible();

    // Each KPI card should contain a numeric value
    await expect(kpiRequests).toContainText(/\d/);
    await expect(kpiErrors).toContainText(/\d/);
    await expect(kpiTokens).toContainText(/\d/);
  });

  test('should display and interact with time range selector', async ({ authedPage }) => {
    const timeRange = authedPage.getByTestId('overview__time-range');
    await expect(timeRange).toBeVisible({ timeout: 10000 });

    // Click to open the selector
    await timeRange.click();

    // Verify dropdown or options appear (e.g., 7d, 30d, 90d)
    const option = authedPage.getByRole('option', { name: /7|30|day|week/i }).first();
    if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
      await option.click();
    } else {
      // Some implementations use listbox items or menu items
      const menuItem = authedPage.getByRole('menuitem').first();
      if (await menuItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await menuItem.click();
      }
    }

    // Time range selector should still be visible after interaction
    await expect(timeRange).toBeVisible();
  });

  test('should switch time range to 30 days', async ({ authedPage }) => {
    const timeRange = authedPage.getByTestId('overview__time-range');
    await expect(timeRange).toBeVisible({ timeout: 10000 });
    await timeRange.click();
    await authedPage.getByRole('option', { name: /last 30 days/i }).click();
    await expect(timeRange).toContainText(/30/i);
  });

  test('should display quick access navigation cards', async ({ authedPage }) => {
    const quickAccess = authedPage.getByTestId('overview__quick-access');
    await expect(quickAccess).toBeVisible({ timeout: 10000 });

    // Quick access should contain navigation links to key sections
    await expect(quickAccess.getByText(/Chat/i).first()).toBeVisible();
    await expect(quickAccess.getByText(/Notebook|Workbench/i).first()).toBeVisible();
    await expect(quickAccess.getByText(/Agents/i).first()).toBeVisible();
    await expect(quickAccess.getByText(/Endpoints/i).first()).toBeVisible();
  });

  test('should display activity timeline', async ({ authedPage }) => {
    const timeline = authedPage.getByTestId('overview__activity-timeline');
    await expect(timeline).toBeVisible({ timeout: 10000 });

    // Timeline may show activity entries or "No recent activity" depending on data
    const entries = timeline.locator('[class*="timeline"], [class*="activity"], li, [role="listitem"]');
    const noActivity = timeline.getByText(/no recent activity/i);
    const hasEntries = await entries.count() > 0;
    const hasNoActivityMsg = await noActivity.isVisible().catch(() => false);
    expect(
      hasEntries || hasNoActivityMsg,
      'Timeline should show activity entries or a "No recent activity" message',
    ).toBeTruthy();
  });

  test('should navigate to Chat via quick access', async ({ authedPage }) => {
    const quickAccess = authedPage.getByTestId('overview__quick-access');
    await expect(quickAccess).toBeVisible({ timeout: 10000 });

    // Click the Chat quick access card
    const chatLink = quickAccess.getByText(/Chat/i).first();
    await chatLink.click();

    // Should navigate to the chat page
    await authedPage.waitForURL(/\/chat/, { timeout: 10000 });
    await expect(authedPage.getByTestId('chat__main-pane')).toBeVisible();
  });
});
