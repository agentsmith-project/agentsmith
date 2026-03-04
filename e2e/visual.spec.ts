/**
 * Visual Regression Tests - Full Page Screenshots
 *
 * Uses Playwright's built-in toHaveScreenshot() for pixel-level comparison.
 * Baselines are stored in e2e/__screenshots__/ and auto-generated on first run.
 *
 * Run:   npx playwright test e2e/visual.spec.ts --project=visual
 * Update baselines: npx playwright test e2e/visual.spec.ts --project=visual --update-snapshots
 */

import { test as base, expect, type Page } from '@playwright/test';
import { withAuth } from './fixtures/authenticated';
import { waitForPageReady } from './utils/navigation';

const WS_ID = 'ws_default';
const PROJECT_ID = 'proj_001';

const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await withAuth(page, WS_ID, 'test@example.com');
    await use(page);
  },
});

/** Navigate and wait for page to settle before screenshot */
async function stableNavigate(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForPageReady(page);
  // In MSW mode, the app can briefly render a full-page "Starting mocks..." overlay after the route is technically mounted.
  // Wait for it to disappear to avoid capturing transient bootstrap screens as baselines.
  const mwsBootMessage = page.getByText('Starting mocks...');
  if (await mwsBootMessage.isVisible().catch(() => false)) {
    await mwsBootMessage.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }
  // Ensure dev overlays are removed before capturing screenshots.
  await page.evaluate(() => {
    const hideOverlays = () => {
      document.querySelectorAll('nextjs-portal').forEach((portal) => {
        portal.remove();
      });
      document.querySelectorAll('[data-testid="notebook__sse-debug-panel"]').forEach((panel) => {
        (panel as HTMLElement).style.display = 'none';
      });
    };
    hideOverlays();
    // Guard against re-insertion in dev mode.
    window.setTimeout(hideOverlays, 100);
  });
  await page.waitForTimeout(500); // Let animations finish
}

function projectPath(section: string) {
  return `/en-US/workspaces/${WS_ID}/projects/${PROJECT_ID}/${section}`;
}

// ─── Public Pages ───────────────────────────────────────────────────────────

test.describe('Visual - Public Pages', () => {
  test('login page', async ({ page }) => {
    await stableNavigate(page, '/en-US/login');
    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  });

  test('join page', async ({ page }) => {
    await stableNavigate(page, '/en-US/join');
    await expect(page).toHaveScreenshot('join.png', { fullPage: true });
  });
});

// ─── Workspace Pages ────────────────────────────────────────────────────────

test.describe('Visual - Workspace Pages', () => {
  test('workspace selection', async ({ authedPage }) => {
    await stableNavigate(authedPage, '/en-US/login/workspace');
    await expect(authedPage).toHaveScreenshot('workspace-select.png', { fullPage: true });
  });

  test('projects list', async ({ authedPage }) => {
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/projects`);
    await expect(authedPage).toHaveScreenshot('projects-list.png', { fullPage: true });
  });

  test('workspace settings', async ({ authedPage }) => {
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/settings`);
    await expect(authedPage).toHaveScreenshot('workspace-settings.png', { fullPage: true });
  });
});

// ─── Project Pages ──────────────────────────────────────────────────────────

test.describe('Visual - Project Pages', () => {
  test('overview', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('overview'));
    await expect(authedPage).toHaveScreenshot('overview.png', { fullPage: true });
  });

  test('chat - standard', async ({ authedPage }) => {
    await authedPage.setViewportSize({ width: 1440, height: 900 });
    await stableNavigate(authedPage, projectPath('chat'));
    await expect(authedPage).toHaveScreenshot('chat-standard.png', { fullPage: true });
  });

  test('chat - ultrawide', async ({ authedPage }) => {
    await authedPage.setViewportSize({ width: 2200, height: 1200 });
    await stableNavigate(authedPage, projectPath('chat'));
    await expect(authedPage).toHaveScreenshot('chat-ultrawide.png', { fullPage: true });
  });

  test('notebook', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('notebook'));
    await expect(authedPage.getByTestId('notebook__task-list')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('notebook.png', { fullPage: true });
  });

  test('notebook task detail', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('notebook/tasks/task_001'));
    await expect(authedPage.getByTestId('notebook__task-header')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('notebook-task-detail.png', { fullPage: true });
  });

  test('agents', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('agents'));
    await expect(authedPage).toHaveScreenshot('agents.png', { fullPage: true });
  });

  test('endpoints', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('endpoints'));
    await expect(authedPage).toHaveScreenshot('endpoints.png', { fullPage: true });
  });

  test('credentials', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('credentials'));
    await expect(authedPage).toHaveScreenshot('credentials.png', { fullPage: true });
  });

  test('members', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('members'));
    await expect(authedPage).toHaveScreenshot('members.png', { fullPage: true });
  });

  test('files', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('files'));
    await expect(authedPage).toHaveScreenshot('files.png', { fullPage: true });
  });

  test('audit', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('audit'));
    await expect(authedPage).toHaveScreenshot('audit.png', { fullPage: true });
  });

  test('usage', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('usage'));
    await expect(authedPage).toHaveScreenshot('usage.png', { fullPage: true });
  });

  test('resource policy', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('resource-policy'));
    await expect(authedPage).toHaveScreenshot('resource-policy.png', { fullPage: true });
  });

  test('settings - general', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('settings'));
    await expect(authedPage).toHaveScreenshot('settings-general.png', { fullPage: true });
  });

  test('settings - runtime', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('settings'));
    const tab = authedPage.getByTestId('settings__tab--runtime');
    if (await tab.isVisible()) {
      await tab.click();
      await authedPage.waitForTimeout(400);
    }
    await expect(authedPage).toHaveScreenshot('settings-runtime.png', { fullPage: true });
  });

  // Runtime Console tests (WP-05: Replaced runtime-control-plane, runtime-observability, release-ops)
  test('runtime console - overview', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('runtime-console'));
    await expect(authedPage).toHaveScreenshot('runtime-console-overview.png', { fullPage: true });
  });

  test('runtime console - monitoring', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('runtime-console'));
    const tab = authedPage.getByTestId('tabs-trigger-monitoring');
    if (await tab.isVisible()) {
      await tab.click();
      await authedPage.waitForTimeout(400);
    }
    await expect(authedPage).toHaveScreenshot('runtime-console-monitoring.png', { fullPage: true });
  });

  test('runtime console - alerts', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('runtime-console'));
    const tab = authedPage.getByTestId('tabs-trigger-alerts');
    if (await tab.isVisible()) {
      await tab.click();
      await authedPage.waitForTimeout(400);
    }
    await expect(authedPage).toHaveScreenshot('runtime-console-alerts.png', { fullPage: true });
  });

  test('runtime console - control', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('runtime-console'));
    const tab = authedPage.getByTestId('tabs-trigger-control');
    if (await tab.isVisible()) {
      await tab.click();
      await authedPage.waitForTimeout(400);
    }
    await expect(authedPage).toHaveScreenshot('runtime-console-control.png', { fullPage: true });
  });

  test('runtime console - reports', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('runtime-console'));
    const tab = authedPage.getByTestId('tabs-trigger-reports');
    if (await tab.isVisible()) {
      await tab.click();
      await authedPage.waitForTimeout(400);
    }
    await expect(authedPage).toHaveScreenshot('runtime-console-reports.png', { fullPage: true });
  });

});

// ─── User Pages ─────────────────────────────────────────────────────────────

test.describe('Visual - User Pages', () => {
  test('profile', async ({ authedPage }) => {
    await stableNavigate(authedPage, '/en-US/user/profile');
    await expect(authedPage).toHaveScreenshot('profile.png', { fullPage: true });
  });

  test('api keys', async ({ authedPage }) => {
    await stableNavigate(authedPage, '/en-US/user/api-keys');
    await expect(authedPage).toHaveScreenshot('api-keys.png', { fullPage: true });
  });
});

// ─── Dialog / Drawer Screenshots ────────────────────────────────────────────

test.describe('Visual - Overlays', () => {
  test('create project dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/projects`);
    await authedPage.getByTestId('projects__create-btn').click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-create-project.png');
  });

  test('create agent dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('agents'));
    await authedPage.getByTestId('agents__create-btn').click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-create-agent.png');
  });

  test('create endpoint dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('endpoints'));
    await authedPage.getByTestId('endpoints__create-btn').click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-create-endpoint.png');
  });

  test('create credential dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('credentials'));
    await authedPage.getByTestId('credentials__create-btn').click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-create-credential.png');
  });

  test('invite member dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('members'));
    await authedPage.getByTestId('members__invite-btn').click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-invite-member.png');
  });

  test('files - create folder dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('files'));
    await authedPage.getByTestId('files__new-folder').click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-files-create-folder.png');
  });

  test('files - rename dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('files'));
    const row = authedPage.getByTestId('files__object-row').filter({ hasText: 'README.txt' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button').click();
    await authedPage.getByTestId('files__rename').click();
    await expect(authedPage.getByTestId('files__dialog__move')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-files-rename.png');
  });

  test('create API key dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, '/en-US/user/api-keys');
    await authedPage.getByTestId('api-keys__create-btn').click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-create-api-key.png');
  });

  test('member permissions drawer - permissions tab', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('members'));
    const rows = authedPage.getByTestId('members__table__row');
    await expect(rows.first()).toBeVisible();

    const actionBtn = rows.nth(1).getByRole('button', { name: /more/i }).or(
      rows.nth(1).locator('button:has(svg)')
    ).last();
    await actionBtn.click();

    await authedPage.getByRole('menuitem', { name: /edit permissions/i }).click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('drawer-member-permissions.png');
  });

  test('member permissions drawer - limits tab', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('members'));
    const rows = authedPage.getByTestId('members__table__row');
    await expect(rows.first()).toBeVisible();

    const actionBtn = rows.nth(1).getByRole('button', { name: /more/i }).or(
      rows.nth(1).locator('button:has(svg)')
    ).last();
    await actionBtn.click();

    await authedPage.getByRole('menuitem', { name: /edit permissions/i }).click();
    const drawer = authedPage.locator('[role="dialog"], [data-state="open"]').last();
    await expect(drawer).toBeVisible({ timeout: 5000 });
    await drawer.getByRole('tab', { name: /quota/i }).click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('drawer-member-limits.png');
  });

  test('members templates - project groups tab', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('members'));
    await authedPage.getByRole('tab', { name: /groups/i }).first().click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('members-project-groups.png', { fullPage: true });
  });

});
