/**
 * Runtime Console Test Helpers
 *
 * Helper functions for testing the Runtime Console page and its tabs.
 * These functions will be used after WP-02 (Runtime Console page) is completed.
 */

import type { Page } from '@playwright/test';

export type RuntimeConsoleTab = 'overview' | 'monitoring' | 'alerts' | 'control' | 'reports';

/**
 * Navigate to Runtime Console with a specific tab
 */
export async function goToRuntimeConsole(
  page: Page,
  tab: RuntimeConsoleTab = 'overview',
  locale = 'en-US',
  workspaceId = 'ws_default',
  projectId = 'proj_001',
): Promise<void> {
  const url = `/${locale}/workspaces/${workspaceId}/projects/${projectId}/runtime-console`;
  const tabParam = tab !== 'overview' ? `?tab=${tab}` : '';
  await page.goto(`${url}${tabParam}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
}

/**
 * Switch to a specific tab in Runtime Console
 */
export async function switchRuntimeConsoleTab(
  page: Page,
  tab: RuntimeConsoleTab,
): Promise<void> {
  const tabName = getTabLabel(tab);
  const tabElement = page.getByRole('tab', { name: new RegExp(tabName, 'i') });

  // Check if tab is already active
  const isActive = await tabElement.getAttribute('data-state') === 'active';
  if (isActive) return;

  // Wait for tab to be visible and click it
  await tabElement.waitFor({ state: 'visible', timeout: 5000 });
  await tabElement.click();

  // Wait for tab content to load
  await page.waitForTimeout(400);
}

/**
 * Get the display label for a tab
 */
function getTabLabel(tab: RuntimeConsoleTab): string {
  const labels: Record<RuntimeConsoleTab, string> = {
    overview: 'Overview',
    monitoring: 'Monitoring',
    alerts: 'Alerts',
    control: 'Control',
    reports: 'Reports',
  };
  return labels[tab];
}

/**
 * Wait for Runtime Console page to be ready
 */
export async function waitForRuntimeConsoleReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="runtime-console__page"]', { timeout: 10000 });
}

/**
 * Get the current active tab in Runtime Console
 */
export async function getActiveTab(page: Page): Promise<RuntimeConsoleTab | null> {
  const activeTab = page.locator('[role="tab"][data-state="active"]').first();
  if (!(await activeTab.isVisible()).catch(() => false)) {
    return null;
  }

  const tabText = await activeTab.textContent();
  if (!tabText) return null;

  const tabMap: Record<string, RuntimeConsoleTab> = {
    overview: 'overview',
    monitoring: 'monitoring',
    alerts: 'alerts',
    control: 'control',
    reports: 'reports',
  };

  const normalizedText = tabText.toLowerCase().trim();
  return tabMap[normalizedText] || null;
}

/**
 * Navigate to a specific Runtime Console tab with stable wait
 */
export async function goToRuntimeConsoleTab(
  page: Page,
  tab: RuntimeConsoleTab,
  locale = 'en-US',
  workspaceId = 'ws_default',
  projectId = 'proj_001',
): Promise<void> {
  await goToRuntimeConsole(page, 'overview', locale, workspaceId, projectId);
  await waitForRuntimeConsoleReady(page);

  if (tab !== 'overview') {
    await switchRuntimeConsoleTab(page, tab);
  }
}

/**
 * Testid constants for Runtime Console components
 * Update these after WP-02 is complete to match actual implementation
 */
export const RUNTIME_CONSOLE_TESTIDS = {
  page: 'runtime-console__page',

  // Tabs
  tabOverview: 'runtime-console__tab--overview',
  tabMonitoring: 'runtime-console__tab--monitoring',
  tabAlerts: 'runtime-console__tab--alerts',
  tabControl: 'runtime-console__tab--control',
  tabReports: 'runtime-console__tab--reports',

  // Overview tab
  overviewHealthStatus: 'runtime-console__overview__health-status',
  overviewKpiCards: 'runtime-console__overview__kpi-card',

  // Monitoring tab
  monitoringMetrics: 'runtime-console__monitoring__metrics',
  monitoringTraces: 'runtime-console__monitoring__traces',

  // Alerts tab
  alertsCreateButton: 'runtime-console__alerts__create-button',
  alertsRulesList: 'runtime-console__alerts__rules-list',
  alertsNotifications: 'runtime-console__alerts__notifications',
  alertsRuleCard: 'runtime-console__alerts__rule-card',
  alertsRuleToggle: 'runtime-console__alerts__rule-toggle',

  // Control tab
  controlPage: 'runtime-console__control__page',
  controlGovernanceEvidence: 'runtime-console__control__governance-evidence-bridge',
  controlTraceOpen: 'runtime-console__control__trace-open--',

  // Reports tab
  reportsList: 'runtime-console__reports__list',
  reportsDetail: 'runtime-console__reports__detail',
} as const;
