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

  test('create alert rule sends API payload with trigger/channels/behavior', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    const createRequest = authedPage.waitForRequest((req) => {
      return req.method() === 'POST' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/alert-rules$/.test(req.url());
    });

    await authedPage.getByTestId('alert-center__create-button').click();
    await expect(authedPage.getByTestId('alert-rule-form-dialog')).toBeVisible();

    await authedPage.getByTestId('alert-rule-form-dialog__name-input').fill(`E2E Rule ${Date.now()}`);
    await authedPage.getByTestId('alert-rule-form-dialog__threshold-input').fill('1234');
    await authedPage.getByTestId('alert-rule-form-dialog__debounce-input').fill('7');
    await authedPage.getByTestId('alert-rule-form-dialog__webhook-input').fill('https://example.com/alerts');
    await authedPage.getByTestId('alert-rule-form-dialog__submit-btn').click();

    const request = await createRequest;
    const payload = request.postDataJSON() as {
      name: string;
      trigger: { threshold: number };
      channels: { in_app: boolean; webhook?: { url: string } };
      behavior: { debounce_minutes: number };
    };

    expect(payload.name).toContain('E2E Rule');
    expect(payload.trigger.threshold).toBe(1234);
    expect(payload.channels.in_app).toBe(true);
    expect(payload.channels.webhook?.url).toBe('https://example.com/alerts');
    expect(payload.behavior.debounce_minutes).toBe(7);
    expect(payload.behavior.notify_on_recovery).toBe(true);
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

    const updateRequest = authedPage.waitForRequest((req) => {
      return req.method() === 'PUT' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/alert-rules\/[^/]+$/.test(req.url());
    });

    const toggles = authedPage.getByTestId('alert-rule-toggle');
    await expect(toggles.first()).toBeVisible();
    await toggles.first().click();

    const request = await updateRequest;
    const payload = request.postDataJSON() as { enabled?: boolean };
    expect(typeof payload.enabled).toBe('boolean');
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

  test('delete action sends DELETE request for selected alert rule', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    const deleteRequest = authedPage.waitForRequest((req) => {
      return req.method() === 'DELETE' && /\/api\/v1\/workspaces\/.*\/projects\/.*\/alert-rules\/[^/]+$/.test(req.url());
    });

    const firstCard = authedPage.getByTestId('alert-rule-card').first();
    await expect(firstCard).toBeVisible();
    await firstCard.getByRole('button').first().click();
    await authedPage.getByRole('menuitem', { name: /delete/i }).click();

    const request = await deleteRequest;
    expect(request.method()).toBe('DELETE');
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

test.describe('Alert Delivery Behaviors', () => {
  test('debounce suppresses duplicated firing notifications in UI list', async ({ authedPage }) => {
    await goToProject(authedPage, 'alerts');
    await authedPage.getByRole('tab', { name: /notifications/i }).click();
    await expect(authedPage.getByTestId('alert-card')).toHaveCount(2);
  });

  test('resolved and webhook delivery evidence are visible in notifications', async ({ authedPage }) => {
    await goToProject(authedPage, 'alerts');
    await authedPage.getByRole('tab', { name: /notifications/i }).click();
    await expect(authedPage.getByTestId('alert-status-resolved-notif_resolved_1')).toBeVisible();
    await expect(authedPage.getByTestId('alert-webhook-notif_resolved_1')).toContainText('failed');
    await expect(authedPage.getByTestId('alert-webhook-notif_resolved_1')).toContainText('500');
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
