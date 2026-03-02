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
    expect(authedPage.url()).not.toContain('tab=');
  });

  test('switches tabs without page refresh', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Click monitoring tab
    await authedPage.getByTestId('tabs-trigger-monitoring').click();
    await expect(authedPage.getByTestId('tabs-trigger-monitoring')).toHaveAttribute('data-state', 'active');
    await expect(authedPage.url()).toContain('tab=monitoring');

    // Click alerts tab
    await authedPage.getByTestId('tabs-trigger-alerts').click();
    await expect(authedPage.getByTestId('tabs-trigger-alerts')).toHaveAttribute('data-state', 'active');
    await expect(authedPage.url()).toContain('tab=alerts');

    // Click control tab
    await authedPage.getByTestId('tabs-trigger-control').click();
    await expect(authedPage.getByTestId('tabs-trigger-control')).toHaveAttribute('data-state', 'active');
    await expect(authedPage.url()).toContain('tab=control');

    // Click reports tab
    await authedPage.getByTestId('tabs-trigger-reports').click();
    await expect(authedPage.getByTestId('tabs-trigger-reports')).toHaveAttribute('data-state', 'active');
    await expect(authedPage.url()).toContain('tab=reports');
  });

  test('opens overview tab with tab parameter', async ({ authedPage }) => {
    // Navigate with tab=overview parameter (should remove the parameter)
    await authedPage.goto(`${authedPage.url()}?tab=overview`);
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Overview should be active and URL should not have tab parameter
    await expect(authedPage.getByTestId('tabs-trigger-overview')).toHaveAttribute('data-state', 'active');
    expect(authedPage.url()).not.toContain('tab=');
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

    // Verify alert center content is visible
    await expect(authedPage.getByTestId('alert-center__tabs')).toBeVisible({ timeout: 5000 });
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
    await expect(authedPage.getByTestId('runtime-cp__panel')).toBeVisible({ timeout: 5000 });
  });

  test('maintains tab state on browser back/forward', async ({ authedPage }) => {
    // Wait for the page to load
    await expect(authedPage.getByTestId('tabs')).toBeVisible({ timeout: 10000 });

    // Click monitoring tab
    await authedPage.getByTestId('tabs-trigger-monitoring').click();
    await expect(authedPage.getByTestId('tabs-trigger-monitoring')).toHaveAttribute('data-state', 'active');
    await expect(authedPage.url()).toContain('tab=monitoring');

    // Navigate back
    await authedPage.goBack();
    await expect(authedPage.getByTestId('tabs-trigger-overview')).toHaveAttribute('data-state', 'active');

    // Navigate forward
    await authedPage.goForward();
    await expect(authedPage.getByTestId('tabs-trigger-monitoring')).toHaveAttribute('data-state', 'active');
  });
});
