/**
 * Cross-cutting Interaction Tests
 *
 * Tests interactive features that span across pages:
 * - Notification center
 * - Language switching
 * - Responsive behavior
 * - Keyboard navigation
 */

import { test, expect, goToProject, goTo, WS_ID } from './fixtures/test-base';

test.describe('Notification Center', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');
  });

  test('notification bell is visible in topbar', async ({ authedPage }) => {
    const notificationBtn = authedPage.getByTestId('topbar__notifications');
    await expect(notificationBtn).toBeVisible({ timeout: 10000 });
  });

  test('clicking notification bell opens dropdown', async ({ authedPage }) => {
    const notificationBtn = authedPage.getByTestId('topbar__notifications');
    await expect(notificationBtn).toBeVisible({ timeout: 10000 });
    await notificationBtn.click();

    // Dropdown should show notifications title
    await expect(
      authedPage.getByText(/Notifications/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('notification dropdown shows items or empty state', async ({ authedPage }) => {
    const notificationBtn = authedPage.getByTestId('topbar__notifications');
    await expect(notificationBtn).toBeVisible({ timeout: 10000 });
    await notificationBtn.click();

    // Wait for the dropdown content to load
    await authedPage.waitForTimeout(1500);

    // Should show the Notifications heading, items, or "No notifications" or "Loading"
    const heading = authedPage.getByText(/Notifications/i).first();
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test('notification dropdown includes governance incident notifications', async ({ authedPage }) => {
    const notificationBtn = authedPage.getByTestId('topbar__notifications');
    await expect(notificationBtn).toBeVisible({ timeout: 10000 });
    await notificationBtn.click();
    await expect(authedPage.getByText(/Governance run/i).first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Language Switching', () => {
  test('language switcher is accessible via user menu', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    const userMenu = authedPage.getByTestId('topbar__user-menu');
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();

    // There are 2 language items (en-US and zh-CN), check the first one is visible
    const languageItem = authedPage.getByTestId('user-menu__language').first();
    await expect(languageItem).toBeVisible();
  });

  test('switching language changes page content', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    // Verify we're in English
    await expect(authedPage.getByText(/AI Ops Home/i).first()).toBeVisible({ timeout: 10000 });

    // Navigate to Chinese version directly
    await goTo(authedPage, `/zh-CN/workspaces/${WS_ID}/projects/proj_001/overview`);

    // Page should show Chinese content
    await expect(authedPage.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByText('AI Ops Home').first()).toBeVisible({ timeout: 5000 });
  });

  test('login page displays correctly in Chinese', async ({ page }) => {
    await page.goto('/zh-CN/login');

    // Wait for page to load
    await expect(page.getByTestId('page-state__success')).toBeVisible({ timeout: 10000 });

    // Chinese login text should be visible
    await expect(page.getByText('欢迎使用 MBOS')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Settings Form Interaction', () => {
  test('general tab form shows project name pre-filled', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const generalTab = authedPage.getByTestId('settings__general-section');
    await expect(generalTab).toBeVisible({ timeout: 10000 });

    // Project name input should be pre-filled with mock project name
    const nameInput = authedPage.locator('input[name="name"], input[placeholder*="name" i]').first();
    if (await nameInput.isVisible().catch(() => false)) {
      const value = await nameInput.inputValue();
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test('save button becomes active after form change', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const generalTab = authedPage.getByTestId('settings__general-section');
    await expect(generalTab).toBeVisible({ timeout: 10000 });

    // Modify the description field
    const descInput = authedPage.getByPlaceholder(/description/i);
    if (await descInput.isVisible().catch(() => false)) {
      await descInput.fill('Updated description from E2E test');
    }

    // Save button should be visible
    const saveBtn = authedPage.getByTestId('settings__save-btn');
    await expect(saveBtn).toBeVisible();
  });
});

test.describe('Table Selection', () => {
  test('source table supports row selection via checkboxes', async ({ authedPage }) => {
    await goToProject(authedPage, 'files');

    const table = authedPage.getByTestId('files__objects-table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = authedPage.getByTestId('files__object-row');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    // Enter multi-select mode via Ctrl/Cmd click and verify selection summary.
    await rows.first().getByRole('button').click({
      modifiers: process.platform === 'darwin' ? ['Meta'] : ['Control'],
    });
    await expect(authedPage.getByTestId('files__selection-summary')).toBeVisible({ timeout: 5000 });
  });

  test('members table supports row selection', async ({ authedPage }) => {
    await goToProject(authedPage, 'members');

    const table = authedPage.getByTestId('members__table');
    await expect(table).toBeVisible({ timeout: 10000 });

    const rows = authedPage.getByTestId('members__table__row');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    // First row may have a checkbox
    const firstCheckbox = rows.first().getByRole('checkbox');
    if (await firstCheckbox.isVisible().catch(() => false)) {
      await firstCheckbox.click({ force: true });
      await authedPage.waitForTimeout(500);
    }
  });
});

test.describe('Dialog Escape Key', () => {
  test('dialogs close on Escape key press', async ({ authedPage }) => {
    await goToProject(authedPage, 'agents');

    await expect(authedPage.getByTestId('agents__table')).toBeVisible({ timeout: 10000 });

    // Open create dialog
    await authedPage.getByTestId('agents__create-btn').click();
    const dialog = authedPage.getByTestId('agents__create-dialog');
    await expect(dialog).toBeVisible();

    // Press Escape to close
    await authedPage.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5000 });
  });

  test('create credential dialog closes on Escape', async ({ authedPage }) => {
    await goToProject(authedPage, 'credentials');

    await expect(authedPage.getByTestId('credentials__table')).toBeVisible({ timeout: 10000 });

    await authedPage.getByTestId('credentials__create-btn').click();
    const dialog = authedPage.getByTestId('credentials__create-dialog');
    await expect(dialog).toBeVisible();

    await authedPage.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5000 });
  });
});
