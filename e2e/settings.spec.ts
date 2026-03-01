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

  test('runtime control plane page shows embedded observability console', async ({ authedPage }) => {
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
    await expect(authedPage.getByTestId('runtime-observability__kpi-total-requests')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-observability__kpi-error-rate')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-observability__kpi-fallback-rate')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-observability__kpi-p95-cost')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-observability__provider-table')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-cp__open-observability')).toBeVisible();
  });

  test('runtime observability console route is reachable from settings', async ({ authedPage }) => {
    await goToProject(authedPage, 'settings');
    await authedPage.getByTestId('settings__tab--runtime').click();
    const openObservability = authedPage.getByTestId('settings__runtime-open-observability');
    const clickTarget = (await openObservability.locator('a').count()) > 0
      ? openObservability.locator('a').first()
      : openObservability;

    await Promise.all([
      authedPage.waitForURL(/\/runtime-observability$/, { timeout: 10000 }),
      clickTarget.click(),
    ]);

    await expect(authedPage).toHaveURL(/\/runtime-observability$/);
    await expect(authedPage.getByTestId('runtime-observability__provider-table')).toBeVisible();
    await expect(authedPage.getByTestId('runtime-observability__model-table')).toBeVisible();
  });

  test('runtime observability drill-down opens usage detail drawer', async ({ authedPage }) => {
    await goToProject(authedPage, 'runtime-observability');

    await expect(authedPage.getByTestId('runtime-observability__provider-table')).toBeVisible({ timeout: 10000 });
    await authedPage.getByTestId('runtime-observability__provider-detail-0').click();

    await expect(authedPage.getByTestId('usage__detail-summary__requests')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('usage__detail-summary__cost')).toBeVisible();
  });

  test('release ops route is reachable from sidebar', async ({ authedPage }) => {
    await goToProject(authedPage, 'overview');

    await authedPage.getByTestId('sidebar__nav-item--release_ops').click();

    await expect(authedPage).toHaveURL(/\/release-ops(\?|$)/);
    await expect(authedPage.getByTestId('release-ops__page')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('release-ops__dashboard')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__evidence-summary')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__online-vs-latest')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__compare-details')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__compare-policy-details')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-search')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-item-0')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__timeline')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__timeline-item-0')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__history-trend')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-detail')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-structured-summary')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-policy')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-policy-enforcement')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-overrides')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-metadata')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-download-markdown')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-runtime-evidence')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-usage-evidence')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-execution-checks')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-failed-checks')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-open-runtime-context')).toHaveAttribute('href', /runtime-observability\?/);
    await expect(authedPage.getByTestId('release-ops__report-open-usage-context')).toHaveAttribute('href', /usage\?/);

    await authedPage.getByTestId('release-ops__report-search').fill('signature');
    await expect(authedPage).toHaveURL(/report_search=signature/);
    await authedPage.getByTestId('release-ops__report-search').fill('');

    await authedPage.getByTestId('release-ops__report-status-filter').click();
    await authedPage.getByRole('option', { name: 'Fail' }).click();
    await expect(authedPage).toHaveURL(/report_status=fail/);
    await expect(authedPage.getByTestId('release-ops__report-item-0')).toContainText('runtime-evidence-gate-regression-20260227');
    await authedPage.getByTestId('release-ops__report-item-0').click();
    await expect(authedPage.getByTestId('release-ops__report-failed-check-0')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-failed-check-command-0')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__report-failed-check-open-context-0')).toBeVisible();
    await authedPage.getByTestId('release-ops__failed-check-category-filter').click();
    await authedPage.getByRole('option', { name: 'runtime' }).click();
    await expect(authedPage).toHaveURL(/failed_check_category=runtime/);

    await authedPage.getByTestId('release-ops__report-search').fill('');
    await authedPage.getByTestId('release-ops__report-status-filter').click();
    await authedPage.getByRole('option', { name: 'Pass' }).click();
    await authedPage.getByTestId('release-ops__report-search').fill('signature');
    await authedPage.getByTestId('release-ops__report-item-0').click();
    await expect(authedPage.getByTestId('release-ops__report-policy-enforcement')).toContainText(/warning|ready|blocked|releasable_with_override|pending_override/i);
    await expect(authedPage.getByTestId('release-ops__override-reason-category')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__override-expires-at')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__override-item-0')).toBeVisible();
    await authedPage.getByTestId('release-ops__override-approve-0').click();
    await expect(authedPage.getByTestId('release-ops__override-item-0')).toContainText('approved');
    await expect(authedPage.getByTestId('release-ops__escalation-0')).toBeVisible();
    await authedPage.getByTestId('release-ops__escalation-0').click();
    await expect(authedPage.getByTestId('release-ops__escalation-detail')).toBeVisible();
    await authedPage.getByTestId('release-ops__escalation-acknowledge').click();
    await authedPage.getByTestId('release-ops__escalation-resolution-reason').fill('Mitigated in follow-up gate');
    await authedPage.getByTestId('release-ops__escalation-resolve').click();
    await expect(authedPage.getByTestId('release-ops__incident-trace')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__run-item-0')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__runner')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__runner-trigger-full')).toBeVisible();
    await expect(authedPage.getByTestId('release-ops__runner-trigger-failed-only')).toBeVisible();
    await authedPage.getByTestId('release-ops__runner-notes').fill('Rerun after approval');
    await authedPage.getByTestId('release-ops__runner-trigger-failed-only').click();
    await expect(authedPage.getByTestId('release-ops__runner-operation-0')).toBeVisible();
    await authedPage.getByTestId('release-ops__run-item-0').click();
    await expect(authedPage.getByTestId('release-ops__run-detail')).toBeVisible();
    await authedPage.getByTestId('release-ops__run-open-artifact').click();
    await expect(authedPage.getByTestId('release-ops__report-detail')).toBeVisible();
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
