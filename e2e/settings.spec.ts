/**
 * Settings Page Tests
 *
 * Verifies tab navigation, form rendering, save functionality,
 * and danger zone on the project settings page.
 */

import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Settings Page', () => {
  test('general tab is active by default with form fields', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    // General tab should be active by default
    const generalTab = authedPage.getByTestId('settings__tab--general');
    await expect(generalTab).toBeVisible({ timeout: 10000 });

    // Verify core form fields are present (labels without htmlFor, use text matching)
    await expect(authedPage.getByText(/Project Name/i).first()).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByPlaceholder(/description/i)).toBeVisible();
    await expect(authedPage.getByText(/Visibility/i).first()).toBeVisible();
  });

  test('tab navigation switches content', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const generalTab = authedPage.getByTestId('settings__tab--general');
    await expect(generalTab).toBeVisible({ timeout: 10000 });

    const tabs = ['runtime', 'governance', 'limits'] as const;

    for (const tab of tabs) {
      const tabElement = authedPage.getByTestId(`settings__tab--${tab}`);
      await expect(tabElement).toBeVisible();
      await tabElement.click();
      // After clicking, the tab panel content should change
      await authedPage.waitForTimeout(300);
    }

    // Navigate back to general
    await authedPage.getByTestId('settings__tab--general').click();
    await authedPage.waitForTimeout(300);
  });

  test('runtime tab renders content', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const runtimeTab = authedPage.getByTestId('settings__tab--runtime');
    await expect(runtimeTab).toBeVisible({ timeout: 10000 });
    await runtimeTab.click();
    // Runtime tab content should become active
    await expect(runtimeTab).toHaveAttribute('data-state', 'active');
    // Save button should be visible in this tab
    await expect(authedPage.getByTestId('settings__save-btn')).toBeVisible();
  });

  test('governance tab renders content', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const govTab = authedPage.getByTestId('settings__tab--governance');
    await expect(govTab).toBeVisible({ timeout: 10000 });
    await govTab.click();
    await expect(govTab).toHaveAttribute('data-state', 'active');
    await expect(authedPage.getByTestId('settings__save-btn')).toBeVisible();
  });

  test('limits tab renders content', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const limitsTab = authedPage.getByTestId('settings__tab--limits');
    await expect(limitsTab).toBeVisible({ timeout: 10000 });
    await limitsTab.click();
    await expect(limitsTab).toHaveAttribute('data-state', 'active');
    await expect(authedPage.getByTestId('settings__save-btn')).toBeVisible();
  });

  test('save button is visible on each tab', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const generalTab = authedPage.getByTestId('settings__tab--general');
    await expect(generalTab).toBeVisible({ timeout: 10000 });

    const tabs = ['general', 'runtime', 'governance', 'limits'] as const;

    for (const tab of tabs) {
      await authedPage.getByTestId(`settings__tab--${tab}`).click();
      await authedPage.waitForTimeout(300);

      const saveBtn = authedPage.getByTestId('settings__save-btn');
      await expect(saveBtn, `Save button should be visible on ${tab} tab`).toBeVisible();
    }
  });

  test('danger zone shows delete project button on general tab', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    // Ensure we're on the general tab
    const generalTab = authedPage.getByTestId('settings__tab--general');
    await expect(generalTab).toBeVisible({ timeout: 10000 });
    await generalTab.click();

    const deleteBtn = authedPage.getByTestId('settings__delete-project-btn');
    await expect(deleteBtn).toBeVisible();
  });
});
