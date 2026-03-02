import { test, expect, goTo } from './fixtures/test-base';

const ORG_OVERVIEW_PATH = '/en-US/workspaces/overview';

test.describe('Organization Governance Overview', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goTo(authedPage, ORG_OVERVIEW_PATH);
  });

  test('renders organization governance overview core sections', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('workspace-overview__heading')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('workspace-overview__summary')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__matrix')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__attention')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__actions-queue')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__action-explain-panel')).toBeVisible();
  });

  test('actions queue drilldown carries governance context to release ops', async ({ authedPage }) => {
    const releaseOpsLink = authedPage.locator('a[href*="/release-ops"][href*="gov_from=organization_overview"]').first();
    await expect(releaseOpsLink).toBeVisible({ timeout: 10000 });
    await expect(releaseOpsLink).toHaveAttribute('href', /\/release-ops\?/);
    await expect(releaseOpsLink).toHaveAttribute('href', /gov_from=organization_overview/);

    await releaseOpsLink.click();
    await expect(authedPage).toHaveURL(/\/release-ops\?/);
    await expect(authedPage).toHaveURL(/gov_from=organization_overview/);
    await expect(authedPage.getByTestId('release-ops__governance-evidence-bridge')).toBeVisible({ timeout: 10000 });
  });

  test('matrix row provides release readiness shortcut with governance context', async ({ authedPage }) => {
    const readinessLink = authedPage.locator('[data-testid^="workspace-overview__open-release-readiness--"]').first();
    await expect(readinessLink).toBeVisible({ timeout: 10000 });
    await expect(readinessLink).toHaveAttribute('href', /\/release-ops\?/);
    await expect(readinessLink).toHaveAttribute('href', /gov_from=organization_overview/);
    await expect(readinessLink).toHaveAttribute('href', /gov_reason=workspace_release_readiness/);
  });

  test('batch preview updates after selecting workspace rows', async ({ authedPage }) => {
    const selectCheckbox = authedPage.locator('[data-testid^="workspace-overview__matrix-select--"]').first();
    await expect(selectCheckbox).toBeVisible({ timeout: 10000 });
    await selectCheckbox.check();

    await expect(authedPage.getByTestId('workspace-overview__batch-preview')).toBeVisible();
    await expect(authedPage.locator('[data-testid^="workspace-overview__batch-preview-item--"]').first()).toBeVisible();
    await authedPage.getByTestId('workspace-overview__batch-mark-in-progress').click();
    await expect(authedPage.locator('[data-testid^="workspace-overview__actions-queue-history--"]').first()).toBeVisible();
  });
});
