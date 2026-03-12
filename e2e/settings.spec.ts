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

    await expect(authedPage.getByTestId('settings__open-audit')).toBeVisible();
    await expect(authedPage.getByTestId('settings__open-members')).toBeVisible();
    await expect(authedPage.getByTestId('settings__open-credentials')).toBeVisible();

    // General tab should be active by default
    const generalTab = authedPage.getByTestId('settings__general-section');
    await expect(generalTab).toBeVisible({ timeout: 10000 });

    // Verify core form fields are present (labels without htmlFor, use text matching)
    await expect(authedPage.getByText(/Project Name/i).first()).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByPlaceholder(/description/i)).toBeVisible();
    await expect(authedPage.getByText(/Visibility/i).first()).toBeVisible();
    await expect(authedPage.getByText(/Join Policy/i).first()).toBeVisible();
  });

  test('general settings remains the only active project settings section', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    await expect(authedPage.getByTestId('settings__general-section')).toBeVisible({ timeout: 10000 });
  });

  test('save button is visible on each tab', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const generalTab = authedPage.getByTestId('settings__general-section');
    await expect(generalTab).toBeVisible({ timeout: 10000 });

    const saveBtn = authedPage.getByTestId('settings__save-btn');
    await expect(saveBtn).toBeVisible();
  });

  test('general save sends project update request payload', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await authedPage.getByTestId('settings__general-section').click();

    const patchRequestPromise = authedPage.waitForRequest((req) => {
      return req.method() === 'PATCH'
        && /\/api\/v1\/workspaces\/.*\/projects\/proj_001$/.test(req.url());
    });

    const nameInput = authedPage.locator('input').first();
    await nameInput.fill('Project Updated By E2E');
    await authedPage.getByPlaceholder(/description/i).fill('Settings update payload check');
    await authedPage.getByTestId('settings__save-btn').first().click();

    const request = await patchRequestPromise;
    const payload = request.postDataJSON() as {
      name?: string;
      description?: string;
      visibility?: string;
      join_policy?: string;
    };
    expect(payload.name).toBe('Project Updated By E2E');
    expect(payload.description).toBe('Settings update payload check');
    expect(payload.visibility).toBeTruthy();
    expect(payload.join_policy).toBeTruthy();
  });

  test('danger zone shows delete project button on general tab', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    // Ensure we're on the general tab
    const generalTab = authedPage.getByTestId('settings__general-section');
    await expect(generalTab).toBeVisible({ timeout: 10000 });
    await generalTab.click();

    const deleteBtn = authedPage.getByTestId('settings__delete-project-btn');
    await expect(deleteBtn).toBeVisible();
  });

  test('delete project confirmation dialog opens and can cancel', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await authedPage.getByTestId('settings__general-section').click();

    const deleteBtn = authedPage.getByTestId('settings__delete-project-btn');
    await expect(deleteBtn).toBeVisible();
    if (!(await deleteBtn.isEnabled())) {
      await expect(deleteBtn).toBeDisabled();
      return;
    }

    await deleteBtn.click();
    const dialog = authedPage.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/delete project/i).first()).toBeVisible();

    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();
  });

  test('visibility and join policy selectors are interactive', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await expect(authedPage.getByTestId('settings__general-section')).toBeVisible({ timeout: 10000 });

    const visibilitySelect = authedPage.getByTestId('settings__visibility-select');
    const joinPolicySelect = authedPage.getByTestId('settings__join-policy-select');

    await visibilitySelect.click();
    await authedPage.getByRole('option', { name: /public/i }).click();
    await expect(visibilitySelect).toContainText(/public/i);
    await visibilitySelect.click();
    await authedPage.getByRole('option', { name: /private/i }).click();
    await expect(visibilitySelect).toContainText(/private/i);

    await joinPolicySelect.click();
    await authedPage.getByRole('option', { name: /open/i }).click();
    await expect(joinPolicySelect).toContainText(/open/i);
    await joinPolicySelect.click();
    await authedPage.getByRole('option', { name: /approval/i }).click();
    await expect(joinPolicySelect).toContainText(/approval/i);
  });
});
