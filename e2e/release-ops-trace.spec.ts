import { test, expect, goTo } from './fixtures/test-base';
import type { Page } from '@playwright/test';

type TraceTarget = 'usage' | 'audit';
const RELEASE_OPS_TRACE_ENTRY_PATH =
  '/en-US/workspaces/ws_default/projects/proj_001/release-ops'
  + '?gov_from=organization_overview'
  + '&gov_kind=workspace'
  + '&gov_workspace_id=ws_default'
  + '&gov_project_id=proj_001'
  + '&gov_reason=cost';

async function findTraceLinkIndex(
  page: Page,
  target: TraceTarget,
): Promise<number> {
  const links = page.locator('[data-testid^="release-ops__governance-trace-open--"]');
  const count = await links.count();
  for (let index = 0; index < count; index += 1) {
    const href = await links.nth(index).getAttribute('href');
    if (!href) continue;
    if (target === 'usage' && href.includes('/usage')) return index;
    if (target === 'audit' && href.includes('/audit')) return index;
  }
  return -1;
}

test.describe('Release Ops Trace Drilldown', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goTo(authedPage, RELEASE_OPS_TRACE_ENTRY_PATH);
  });

  test('governance trace links drill down to usage and audit with trace context', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('release-ops__page')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('release-ops__governance-evidence-bridge')).toBeVisible({ timeout: 10000 });

    const traceLinks = authedPage.locator('[data-testid^="release-ops__governance-trace-open--"]');
    await expect(traceLinks.first()).toBeVisible({ timeout: 10000 });

    const usageIndex = await findTraceLinkIndex(authedPage, 'usage');
    const auditIndex = await findTraceLinkIndex(authedPage, 'audit');
    expect(usageIndex).toBeGreaterThanOrEqual(0);
    expect(auditIndex).toBeGreaterThanOrEqual(0);

    await traceLinks.nth(usageIndex).click();
    await expect(authedPage).toHaveURL(/\/usage\?/);
    await expect(authedPage).toHaveURL(/trace_ref=/);
    await expect(authedPage).toHaveURL(/trace_source=/);
    await expect(authedPage.getByTestId('usage__trace-context')).toBeVisible({ timeout: 10000 });

    await goTo(authedPage, RELEASE_OPS_TRACE_ENTRY_PATH);
    await expect(authedPage.getByTestId('release-ops__page')).toBeVisible({ timeout: 10000 });

    const refreshedTraceLinks = authedPage.locator('[data-testid^="release-ops__governance-trace-open--"]');
    const refreshedAuditIndex = await findTraceLinkIndex(authedPage, 'audit');
    expect(refreshedAuditIndex).toBeGreaterThanOrEqual(0);
    await refreshedTraceLinks.nth(refreshedAuditIndex).click();
    await expect(authedPage).toHaveURL(/\/audit\?/);
    await expect(authedPage).toHaveURL(/trace_ref=/);
    await expect(authedPage).toHaveURL(/trace_source=/);
    await expect(authedPage.getByTestId('audit__trace-context')).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('audit__trace-match-status')).toBeVisible({ timeout: 10000 });
  });
});
