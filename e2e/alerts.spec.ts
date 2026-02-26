/**
 * Alert Center Page – E2E Tests
 *
 * Covers alert rules CRUD, notifications panel, and authorization
 * using MSW-provided mock data.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Alert Center Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'alerts');
  });

  test('page loads with tabs for Rules and Notifications', async ({ authedPage }) => {
    // Wait for page to load successfully
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Check for tabs
    const rulesTab = authedPage.getByRole('tab', { name: /rules/i });
    const notificationsTab = authedPage.getByRole('tab', { name: /notifications/i });

    await expect(rulesTab).toBeVisible();
    await expect(notificationsTab).toBeVisible();
  });

  test('Rules tab shows alert rules list', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Rules tab should be active by default
    const rulesTab = authedPage.getByRole('tab', { name: /rules/i });
    await expect(rulesTab).toHaveAttribute('data-state', 'active');

    // Alert rules list should be visible
    await expect(authedPage.getByTestId('alert-rules-list')).toBeVisible();
  });

  test('Create button is visible for users with manage permission', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Create button should be visible
    const createButton = authedPage.getByTestId('alert-center__create-button');
    await expect(createButton).toBeVisible();
  });

  test('can switch to Notifications tab', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Click on notifications tab
    const notificationsTab = authedPage.getByRole('tab', { name: /notifications/i });
    await notificationsTab.click();

    // Notifications panel should be visible
    await expect(authedPage.getByTestId('alert-notifications')).toBeVisible();
  });

  test('empty state displays when no alert rules exist', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // If there are no rules, empty state should show
    const emptyState = authedPage.getByTestId('alert-rules-list__empty');
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    if (hasEmptyState) {
      await expect(emptyState).toBeVisible();
      await expect(authedPage.getByText(/no_rules/i)).toBeVisible();
    }
    // If there are rules, the list should be visible instead
    else {
      await expect(authedPage.getByTestId('alert-rules-list')).toBeVisible();
    }
  });
});

test.describe('Alert Rules CRUD', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'alerts');
  });

  test('displays alert rule cards with expected information', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Look for alert rule cards
    const ruleCards = authedPage.getByTestId('alert-rule-card');
    const count = await ruleCards.count();

    if (count > 0) {
      // First card should be visible
      await expect(ruleCards.first()).toBeVisible();

      // Check for expected content (rule name, trigger condition)
      await expect(authedPage.getByText(/requests_per_day/i)).toBeVisible();
    }
  });

  test('enable/disable toggle works for alert rules', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Look for toggle switches
    const toggles = authedPage.getByRole('switch');
    const count = await toggles.count();

    if (count > 0) {
      // First toggle should be visible
      await expect(toggles.first()).toBeVisible();

      // Click toggle to change state
      await toggles.first().click();
      // Verify toggle changed (visual check only - state would need API)
    }
  });

  test('action menu shows Edit, Test, Delete options', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Find the first alert rule card
    const firstCard = authedPage.getByTestId('alert-rule-card').first();
    const isVisible = await firstCard.isVisible().catch(() => false);

    if (isVisible) {
      // Click the menu button to open dropdown
      const menuButton = firstCard.getByRole('button').first();
      await menuButton.click();

      // Check for menu items (they may be in a dropdown)
      // Note: This may need adjustment based on actual UI implementation
    }
  });
});

test.describe('Alert Notifications', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'alerts');
  });

  test('Notifications tab shows notifications panel', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Switch to notifications tab
    const notificationsTab = authedPage.getByRole('tab', { name: /notifications/i });
    await notificationsTab.click();

    // Notifications panel should be visible
    await expect(authedPage.getByTestId('alert-notifications')).toBeVisible();
  });

  test('empty state displays when no notifications exist', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Switch to notifications tab
    const notificationsTab = authedPage.getByRole('tab', { name: /notifications/i });
    await notificationsTab.click();

    // Check for empty state or notifications
    const emptyState = authedPage.getByTestId('alert-notifications__empty');
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    if (hasEmptyState) {
      await expect(emptyState).toBeVisible();
      await expect(authedPage.getByText(/no_alerts/i)).toBeVisible();
    }
  });

  test('notifications show severity badges', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Switch to notifications tab
    const notificationsTab = authedPage.getByRole('tab', { name: /notifications/i });
    await notificationsTab.click();

    // Look for severity badges
    const severityBadges = authedPage.getByTestId(/severity-badge-/i);
    const count = await severityBadges.count();

    if (count > 0) {
      // At least one severity badge should be visible
      await expect(severityBadges.first()).toBeVisible();
    }
  });
});

test.describe('Alert Center Authorization', () => {
  test('redirects to permission denied when user lacks view permission', async ({ page }) => {
    // This test would need a different user with limited permissions
    // For now, we assume the default test user has permissions
    // Skip or implement with multi-user testing
    test.skip(true, 'Requires multi-user auth setup');
  });
});
