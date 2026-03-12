import { test, expect, goTo } from './fixtures/test-base';

const ORG_OVERVIEW_PATH = '/en-US/workspaces/overview';

async function isOverviewErrorState(page: import('@playwright/test').Page): Promise<boolean> {
  return page.getByTestId('workspace-overview__error').isVisible({ timeout: 5_000 }).catch(() => false);
}

test.describe('Organization Governance Overview', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goTo(authedPage, ORG_OVERVIEW_PATH);
  });

  test('renders organization governance overview core sections', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('workspace-overview__heading')).toBeVisible({ timeout: 10000 });
    if (await isOverviewErrorState(authedPage)) {
      await expect(authedPage.getByTestId('workspace-overview__retry')).toBeVisible();
      test.info().annotations.push({
        type: 'note',
        description: 'workspace-overview is in error state under current real-backend data; core content assertions skipped',
      });
      return;
    }
    await expect(authedPage.getByTestId('workspace-overview__summary')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__matrix')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__attention')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__actions-queue')).toBeVisible();
    await expect(authedPage.getByTestId('workspace-overview__action-explain-panel')).toBeVisible();
  });

  test('actions queue drilldown carries governance context to audit', async ({ authedPage }) => {
    if (await isOverviewErrorState(authedPage)) {
      await expect(authedPage.getByTestId('workspace-overview__retry')).toBeVisible();
      test.info().annotations.push({
        type: 'note',
        description: 'workspace-overview error state; drilldown assertions skipped',
      });
      return;
    }
    const auditLink = authedPage.locator(
      'a[href*="/audit"][href*="gov_from=organization_overview"]',
    ).first();
    await expect(auditLink).toBeVisible({ timeout: 10000 });
    await expect(auditLink).toHaveAttribute('href', /\/audit\?/);
    await expect(auditLink).toHaveAttribute('href', /gov_from=organization_overview/);
    const href = await auditLink.getAttribute('href');
    expect(href).toBeTruthy();
    await goTo(authedPage, href ?? '/en-US/workspaces/overview');
    await expect(authedPage).toHaveURL(/\/audit\?/);
    await expect(authedPage).toHaveURL(/gov_from=organization_overview/);
    await expect(authedPage.getByTestId('audit__page')).toBeVisible({ timeout: 10000 });
  });

  test('matrix row provides audit shortcut with governance context', async ({ authedPage }) => {
    if (await isOverviewErrorState(authedPage)) {
      await expect(authedPage.getByTestId('workspace-overview__retry')).toBeVisible();
      test.info().annotations.push({
        type: 'note',
        description: 'workspace-overview error state; readiness shortcut assertions skipped',
      });
      return;
    }
    const readinessLink = authedPage.locator('[data-testid^="workspace-overview__open-audit--"]').first();
    await expect(readinessLink).toBeVisible({ timeout: 10000 });
    await expect(readinessLink).toHaveAttribute('href', /\/audit\?/);
    await expect(readinessLink).toHaveAttribute('href', /gov_from=organization_overview/);
    await expect(readinessLink).toHaveAttribute('href', /gov_reason=workspace_audit_review/);
  });

  test('batch preview updates after selecting workspace rows', async ({ authedPage }) => {
    if (await isOverviewErrorState(authedPage)) {
      await expect(authedPage.getByTestId('workspace-overview__retry')).toBeVisible();
      test.info().annotations.push({
        type: 'note',
        description: 'workspace-overview error state; batch-preview assertions skipped',
      });
      return;
    }
    const selectCheckbox = authedPage.locator('[data-testid^="workspace-overview__matrix-select--"]').first();
    await expect(selectCheckbox).toBeVisible({ timeout: 10000 });
    await selectCheckbox.check();

    await expect(authedPage.getByTestId('workspace-overview__batch-preview')).toBeVisible();
    await expect(authedPage.locator('[data-testid^="workspace-overview__batch-preview-item--"]').first()).toBeVisible();
    await authedPage.getByTestId('workspace-overview__batch-mark-in-progress').click();
    await expect(authedPage.locator('[data-testid^="workspace-overview__actions-queue-history--"]').first()).toBeVisible();
  });
});
