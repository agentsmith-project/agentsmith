import { test, expect, goToProject } from './fixtures/test-base';

test.describe('Runtime Console', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'runtime-console');
  });

  test('renders all 5 tabs', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Check all tabs are present
    await expect(authedPage.getByTestId('tabs-trigger-overview')).toBeVisible();
    await expect(authedPage.getByTestId('tabs-trigger-monitoring')).toBeVisible();
    await expect(authedPage.getByTestId('tabs-trigger-alerts')).toBeVisible();
    await expect(authedPage.getByTestId('tabs-trigger-control')).toBeVisible();
    await expect(authedPage.getByTestId('tabs-trigger-reports')).toBeVisible();
  });

  test('shows overview tab as default', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Verify the overview tab is active (has data-state="active")
    await expect(authedPage.getByTestId('tabs-trigger-overview')).toHaveAttribute('data-state', 'active');

    // Verify URL doesn't have tab parameter for overview (default)
    await expect(authedPage).not.toHaveURL(/tab=/);
  });

  test('switches tabs without page refresh', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Click monitoring tab
    await authedPage.getByTestId('tabs-trigger-monitoring').click();
    await expect(authedPage.getByTestId('tabs-trigger-monitoring')).toHaveAttribute('data-state', 'active');
    await expect(authedPage).toHaveURL(/tab=monitoring/);

    // Click alerts tab
    await authedPage.getByTestId('tabs-trigger-alerts').click();
    await expect(authedPage.getByTestId('tabs-trigger-alerts')).toHaveAttribute('data-state', 'active');
    await expect(authedPage).toHaveURL(/tab=alerts/);

    // Click control tab
    await authedPage.getByTestId('tabs-trigger-control').click();
    await expect(authedPage.getByTestId('tabs-trigger-control')).toHaveAttribute('data-state', 'active');
    await expect(authedPage).toHaveURL(/tab=control/);

    // Click reports tab
    await authedPage.getByTestId('tabs-trigger-reports').click();
    await expect(authedPage.getByTestId('tabs-trigger-reports')).toHaveAttribute('data-state', 'active');
    await expect(authedPage).toHaveURL(/tab=reports/);
  });

  test('opens overview tab with tab parameter', async ({ authedPage }) => {
    // Navigate with tab=overview parameter (should remove the parameter)
    await authedPage.goto(`${authedPage.url()}?tab=overview`);
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Overview should be active and URL should not have tab parameter
    await expect(authedPage.getByTestId('tabs-trigger-overview')).toHaveAttribute('data-state', 'active');
    await expect(authedPage).not.toHaveURL(/tab=/);
  });

  test('shows runtime observability console in overview tab', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Verify runtime observability console is visible in overview tab
    await expect(authedPage.getByTestId('runtime-observability__refresh')).toBeVisible();
  });

  test('shows alert center in alerts tab', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Click alerts tab
    await authedPage.getByTestId('tabs-trigger-alerts').click();
    await expect(authedPage.getByTestId('tabs-trigger-alerts')).toHaveAttribute('data-state', 'active');

    // Verify alert center page is visible
    await expect(authedPage.getByTestId('alert-center-page')).toBeVisible({ timeout: 5000 });
  });

  test('shows release ops dashboard in reports tab', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Click reports tab
    await authedPage.getByTestId('tabs-trigger-reports').click();
    await expect(authedPage.getByTestId('tabs-trigger-reports')).toHaveAttribute('data-state', 'active');

    // Verify release ops dashboard is visible
    await expect(authedPage.getByTestId('release-ops__dashboard')).toBeVisible({ timeout: 5000 });
  });

  test('shows runtime control plane panel in control tab', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Click control tab
    await authedPage.getByTestId('tabs-trigger-control').click();
    await expect(authedPage.getByTestId('tabs-trigger-control')).toHaveAttribute('data-state', 'active');

    // Verify runtime control plane panel is visible
    await expect(authedPage.getByTestId('settings-runtime__panel')).toBeVisible({ timeout: 5000 });
  });

  test('maintains tab state on browser back/forward', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Store initial URL for later comparison
    const initialUrl = authedPage.url();

    // Click monitoring tab - uses router.replace so URL changes but no new history entry
    await authedPage.getByTestId('tabs-trigger-monitoring').click();
    await expect(authedPage.getByTestId('tabs-trigger-monitoring')).toHaveAttribute('data-state', 'active');
    await expect(authedPage).toHaveURL(/tab=monitoring/);

    // Click overview tab - also uses router.replace
    await authedPage.getByTestId('tabs-trigger-overview').click();
    await expect(authedPage.getByTestId('tabs-trigger-overview')).toHaveAttribute('data-state', 'active');
    // Overview tab removes the tab parameter
    await expect(authedPage).not.toHaveURL(/tab=/);

    // Note: Since handleTabChange uses router.replace (not push),
    // browser back/forward won't navigate between tabs.
    // Each tab click just replaces the current history entry.
  });
});

test.describe('Runtime Console - Permission-Based URL Correction', () => {
  test('redirects to first available tab when user lacks permission for requested tab', async ({ limitedPage }) => {
    // limitedPage uses user_004 which has project:endpoint:use but NOT project:manage
    await goToProject(limitedPage, 'overview');

    // Navigate directly to control tab (requires project:manage)
    await limitedPage.goto(limitedPage.url().replace('overview', 'runtime-console?tab=control'));

    // Page should load and redirect to overview tab (first accessible for usage:view permission)
    await expect(limitedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // URL should be corrected (overview removes tab parameter)
    await expect(limitedPage).toHaveURL(/runtime-console/);
    await expect(limitedPage).not.toHaveURL(/tab=control/);

    // Verify overview tab is active (first accessible tab)
    await expect(limitedPage.getByTestId('tabs-trigger-overview')).toHaveAttribute('data-state', 'active');
  });

  test('preserves URL correction in browser history', async ({ limitedPage }) => {
    // limitedPage uses user_004 which lacks project:manage
    await goToProject(limitedPage, 'overview');

    // Navigate to control tab (user doesn't have permission)
    const originalUrl = limitedPage.url().replace('overview', 'runtime-console?tab=control');
    await limitedPage.goto(originalUrl);

    // Wait for correction to overview
    await expect(limitedPage.getByTestId('tabs-trigger-overview')).toHaveAttribute('data-state', 'active');

    // Verify corrected URL
    await expect(limitedPage).toHaveURL(/runtime-console/);
    await expect(limitedPage).not.toHaveURL(/tab=control/);

    // Navigate back should return to overview
    await limitedPage.goBack();
    await expect(limitedPage).toHaveURL(/overview/);

    // Navigate forward should redo the correction
    await limitedPage.goForward();
    await expect(limitedPage).toHaveURL(/runtime-console/);
    await expect(limitedPage).not.toHaveURL(/tab=control/);
  });

  test('allows access to tabs user has permission for', async ({ limitedPage }) => {
    // limitedPage has project:endpoint:use permission
    await goToProject(limitedPage, 'overview');

    // Navigate to monitoring tab (user has permission)
    await limitedPage.goto(limitedPage.url().replace('overview', 'runtime-console?tab=monitoring'));

    await expect(limitedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });
    await expect(limitedPage.getByTestId('tabs-trigger-monitoring')).toHaveAttribute('data-state', 'active');
    await expect(limitedPage).toHaveURL(/tab=monitoring/);

    // Verify content is visible
    await expect(limitedPage.getByTestId('runtime-observability__refresh')).toBeVisible();
  });

  test('falls back to overview when tab requires unavailable permission', async ({ authedPage }) => {
    // Even with full permissions, invalid tab parameter should fall back to overview
    await goToProject(authedPage, 'overview');

    // Navigate with invalid tab parameter
    await authedPage.goto(authedPage.url().replace('overview', 'runtime-console?tab=invalid'));

    // Should fall back to overview (default tab)
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('tabs-trigger-overview')).toHaveAttribute('data-state', 'active');

    // URL should be corrected (tab parameter removed for overview)
    await expect(authedPage).toHaveURL(/runtime-console/);
    await expect(authedPage).not.toHaveURL(/tab=/);
  });
});
