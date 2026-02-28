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
    await expect(authedPage.getByText(/Join Policy/i).first()).toBeVisible();
  });

  test('tab navigation switches content', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const generalTab = authedPage.getByTestId('settings__tab--general');
    await expect(generalTab).toBeVisible({ timeout: 10000 });

    const tabs = ['runtime'] as const;

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

  test('runtime JSON mode validates malformed JSON and can switch back', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await authedPage.getByTestId('settings__tab--runtime').click();

    await authedPage.getByRole('button', { name: /^json$/i }).click();
    const editor = authedPage.locator('textarea.font-mono').first();
    await expect(editor).toBeVisible();

    await editor.fill('{ invalid json }');
    await expect(authedPage.getByText('Invalid JSON', { exact: true })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /apply json/i })).toBeDisabled();

    await authedPage.getByRole('button', { name: /^form$/i }).click();
    await expect(authedPage.getByText(/locale/i).first()).toBeVisible();
  });

  test('runtime control plane can create provider via API', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await authedPage.getByTestId('settings__tab--runtime').click();
    await expect(authedPage.getByTestId('settings-runtime__panel')).toBeVisible();

    await authedPage.getByTestId('settings-runtime__provider-name').fill('openai');
    await authedPage.getByTestId('settings-runtime__provider-base-url').fill('https://api.openai.com/v1');
    await authedPage.getByTestId('settings-runtime__provider-credential-ref').fill('cred_e2e');

    const providerCreateReq = authedPage.waitForRequest((req) => {
      return req.method() === 'POST'
        && /\/api\/v1\/workspaces\/.*\/projects\/.*\/runtime\/providers$/.test(req.url());
    });

    await authedPage.getByTestId('settings-runtime__provider-create').click();

    const request = await providerCreateReq;
    const payload = request.postDataJSON() as {
      provider?: string;
      base_url?: string;
      credential_ref?: string;
    };
    expect(payload.provider).toBe('openai');
    expect(payload.base_url).toBe('https://api.openai.com/v1');
    expect(payload.credential_ref).toBe('cred_e2e');
  });

  test('runtime control plane page shows observability KPIs', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await authedPage.getByTestId('settings__tab--runtime').click();
    const openControlPlane = authedPage.getByTestId('settings__runtime-open-control-plane');
    await expect(openControlPlane).toBeVisible();
    const clickTarget = (await openControlPlane.locator('a').count()) > 0
      ? openControlPlane.locator('a').first()
      : openControlPlane;
    await Promise.all([
      authedPage.waitForURL(/\/runtime-control-plane$/, { timeout: 10000 }),
      clickTarget.click(),
    ]);

    await expect(authedPage).toHaveURL(/\/runtime-control-plane$/);
    await expect(authedPage.getByTestId('runtime-cp__kpi-total-requests')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-cp__kpi-error-rate')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-cp__kpi-fallback-rate')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-cp__kpi-p95-cost')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-cp__alert-fallback')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-cp__alert-error-rate')).toBeVisible();
  });

  test('legacy governance and limits tabs are not present', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await expect(authedPage.getByTestId('settings__tab--general')).toBeVisible({ timeout: 10000 });

    await expect(authedPage.getByTestId('settings__tab--governance')).toHaveCount(0);
    await expect(authedPage.getByTestId('settings__tab--limits')).toHaveCount(0);
  });

  test('save button is visible on each tab', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');

    const generalTab = authedPage.getByTestId('settings__tab--general');
    await expect(generalTab).toBeVisible({ timeout: 10000 });

    const tabs = ['general', 'runtime'] as const;

    for (const tab of tabs) {
      await authedPage.getByTestId(`settings__tab--${tab}`).click();
      await authedPage.waitForTimeout(300);

      const saveBtn = authedPage.getByTestId('settings__save-btn');
      await expect(saveBtn, `Save button should be visible on ${tab} tab`).toBeVisible();
    }
  });

  test('general save sends project update request payload', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await authedPage.getByTestId('settings__tab--general').click();

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
    const generalTab = authedPage.getByTestId('settings__tab--general');
    await expect(generalTab).toBeVisible({ timeout: 10000 });
    await generalTab.click();

    const deleteBtn = authedPage.getByTestId('settings__delete-project-btn');
    await expect(deleteBtn).toBeVisible();
  });

  test('delete project confirmation dialog opens and can cancel', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await authedPage.getByTestId('settings__tab--general').click();

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
    await expect(authedPage.getByTestId('settings__tab--general')).toBeVisible({ timeout: 10000 });

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
