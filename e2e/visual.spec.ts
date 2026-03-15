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
import { gotoAndWait, waitForPageReady } from './utils/navigation';

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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await gotoAndWait(page, path, 20000);
    try {
      await waitForPageReady(page, attempt === 0 ? 30000 : 45000);
    } catch (error) {
      const notFound = await page.getByRole('heading', { name: '404' }).isVisible().catch(() => false);
      const booting = await page.getByText('Starting mocks...').isVisible().catch(() => false);
      if (attempt === 0 && (notFound || booting)) {
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        continue;
      }
      throw error;
    }
    break;
  }
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

async function loginAsSystemAdmin(page: Page) {
  await stableNavigate(page, '/en-US/system/login');
  await page.getByTestId('system-login__username').fill('mbos-admin');
  await page.getByTestId('system-login__password').fill('mbos-admin');
  await page.getByTestId('system-login__submit').click();
  await page.waitForURL(/\/en-US\/system\/workspaces/, { timeout: 15_000 });
  await waitForPageReady(page);
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

  test('system login page', async ({ page }) => {
    await stableNavigate(page, '/en-US/system/login');
    await expect(page).toHaveScreenshot('system-login.png', { fullPage: true });
  });
});

// ─── Workspace Pages ────────────────────────────────────────────────────────

test.describe('Visual - Workspace Pages', () => {
  test('workspace overview', async ({ authedPage }) => {
    await stableNavigate(authedPage, '/en-US/workspaces/overview');
    await expect(authedPage.getByTestId('workspace-overview__heading')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('workspace-overview.png', { fullPage: true });
  });

  test('workspace home', async ({ authedPage }) => {
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}`);
    await expect(authedPage.getByTestId('workspace-home__heading')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('workspace-home.png', { fullPage: true });
  });

  test('workspace home - project creator', async ({ page }) => {
    await withAuth(page, WS_ID, 'dev2@corp.com', 'u_2');
    await stableNavigate(page, `/en-US/workspaces/${WS_ID}`);
    await expect(page.getByTestId('workspace-home__heading')).toBeVisible();
    await expect(page.getByTestId('workspace-home__create-project')).toBeVisible();
    await expect(page.getByTestId('workspace-home__admin-section')).toHaveCount(0);
    await expect(page).toHaveScreenshot('workspace-home-project-creator.png', { fullPage: true });
  });

  test('workspace selection', async ({ authedPage }) => {
    await stableNavigate(authedPage, '/en-US/login/workspace');
    await expect(authedPage).toHaveScreenshot('workspace-select.png', { fullPage: true });
  });

  test('workspace login', async ({ page }) => {
    await stableNavigate(page, `/en-US/workspaces/${WS_ID}/login`);
    await expect(page.getByTestId('workspace-login__heading')).toBeVisible();
    await expect(page).toHaveScreenshot('workspace-login.png', { fullPage: true });
  });

  test('projects list', async ({ authedPage }) => {
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/projects`);
    await expect(authedPage).toHaveScreenshot('projects-list.png', { fullPage: true });
  });

  test('projects empty state', async ({ page }) => {
    await withAuth(page, 'ws_test', 'test@example.com');
    await stableNavigate(page, '/en-US/workspaces/ws_test/projects');
    await expect(page.getByText('No projects yet')).toBeVisible();
    await expect(page).toHaveScreenshot('projects-empty.png', { fullPage: true });
  });

  test('workspace settings', async ({ authedPage }) => {
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/settings`);
    await expect(authedPage).toHaveScreenshot('workspace-settings.png', { fullPage: true });
  });

  test('workspace settings create project dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/settings`);
    await authedPage.getByTestId('ws-settings__create-project').click();
    await expect(authedPage.getByRole('heading', { name: /Create Project/i })).toBeVisible();
    await expect(authedPage).toHaveScreenshot('workspace-settings-create-project.png', { fullPage: true });
  });
});

// ─── System Pages ───────────────────────────────────────────────────────────

test.describe('Visual - System Pages', () => {
  test('system workspaces', async ({ page }) => {
    await loginAsSystemAdmin(page);
    await expect(page.getByTestId('system-workspaces__heading')).toBeVisible();
    await expect(page).toHaveScreenshot('system-workspaces.png', { fullPage: true });
  });

  test('system info', async ({ page }) => {
    await loginAsSystemAdmin(page);
    await page.getByTestId('system-workspaces__open-info').click();
    await page.waitForURL(/\/en-US\/system\/info/, { timeout: 15_000 });
    await expect(page.getByTestId('system-info__heading')).toBeVisible();
    await expect(page).toHaveScreenshot('system-info.png', { fullPage: true });
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

  test('alerts', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('alerts'));
    await expect(authedPage.getByTestId('alerts__open-audit')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('alerts.png', { fullPage: true });
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

  test('use guide', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('use-guide'));
    await expect(authedPage.getByTestId('use-guide__page')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('use-guide.png', { fullPage: true });
  });

  test('resource policy', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('resource-policy'));
    await expect(authedPage).toHaveScreenshot('resource-policy.png', { fullPage: true });
  });

  test('settings - general', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('settings'));
    await expect(authedPage).toHaveScreenshot('settings-general.png', { fullPage: true });
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

  test('third party accounts', async ({ authedPage }) => {
    await stableNavigate(authedPage, '/en-US/user/third-party-accounts');
    await expect(authedPage.getByTestId('third-party-accounts__create-btn')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('third-party-accounts.png', { fullPage: true });
  });
});

// ─── Dialog / Drawer Screenshots ────────────────────────────────────────────

test.describe('Visual - Overlays', () => {
  test('audit - empty state', async ({ authedPage }) => {
    await stableNavigate(authedPage, `${projectPath('audit')}?resource_id=__visual_empty__`);
    await expect(authedPage.getByTestId('audit-usage__empty-state')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('audit-empty-state.png', { fullPage: true });
  });

  test('alerts - notifications tab', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('alerts'));
    await authedPage.getByRole('tab', { name: /notifications/i }).click();
    await expect(authedPage.getByRole('tabpanel', { name: /notifications/i })).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('alerts-notifications-tab.png', { fullPage: true });
  });

  test('members - join requests tab', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('members'));
    await authedPage.getByRole('tab', { name: /requests/i }).first().click();
    await expect(authedPage.getByRole('tabpanel', { name: /requests/i })).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('members-join-requests-tab.png', { fullPage: true });
  });

  test('members - effective access drawer', async ({ authedPage }) => {
    await stableNavigate(authedPage, `${projectPath('members')}?member_tab=people`);
    await authedPage.getByRole('row', { name: /Charlie Wilson/i }).click();
    const memberSurface = await authedPage.getByRole('dialog').isVisible().catch(() => false)
      ? authedPage.getByRole('dialog')
      : authedPage;
    const authorizationCheck = memberSurface.getByTestId('member-detail__authorization-check').first();
    const authorizeResourceId = memberSurface.getByTestId('member-detail__authorize-resource-id').first();
    const authorizeRun = memberSurface.getByTestId('member-detail__authorize-run').first();
    const authorizeResult = memberSurface.getByTestId('member-detail__authorize-result').first();
    await expect(authorizationCheck).toBeVisible();
    await authorizeResourceId.fill('endpoint_001');
    await authorizeRun.click();
    await expect(authorizeResult).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('members-effective-access-drawer.png', { fullPage: true });
  });

  test('audit detail drawer', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('audit'));
    const table = authedPage.getByTestId('audit__table');
    await expect(table).toBeVisible();
    const firstRow = table.getByTestId('audit__table__row').first();
    await firstRow.getByRole('button').last().click();
    await authedPage.getByRole('menuitem', { name: /view details/i }).click();
    await expect(authedPage.getByTestId('audit__detail-summary')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('drawer-audit-detail.png');
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
    await authedPage.getByTestId('files__library-item--lib_shared_default').click();
    await authedPage.getByTestId('files__search').fill('README');
    const fileButton = authedPage.getByRole('button', { name: 'README.txt' }).first();
    await expect(fileButton).toBeVisible({ timeout: 10_000 });
    await fileButton.click();
    await authedPage.getByTestId('files__rename').click();
    await expect(authedPage.getByTestId('files__dialog__move')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-files-rename.png');
  });

  test('files - selection with details panel', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('files'));
    await authedPage.getByTestId('files__library-item--lib_shared_default').click();
    await authedPage.getByTestId('files__search').fill('README');
    const fileButton = authedPage.getByRole('button', { name: 'README.txt' }).first();
    await expect(fileButton).toBeVisible({ timeout: 10_000 });
    await fileButton.click();
    await expect(authedPage.getByTestId('files__selection-summary')).toBeVisible();
    await expect(authedPage.getByTestId('files__details-panel')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('files-selection-details.png', { fullPage: true });
  });

  test('create API key dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, '/en-US/user/api-keys');
    await authedPage.getByTestId('api-keys__create-btn').click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-create-api-key.png');
  });

  test('create third party account dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, '/en-US/user/third-party-accounts');
    await authedPage.getByTestId('third-party-accounts__create-btn').click();
    await expect(authedPage.getByTestId('third-party-accounts__dialog')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-create-third-party-account.png');
  });

  test('members templates - project groups tab', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('members'));
    await authedPage.getByRole('tab', { name: /groups/i }).first().click();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('members-project-groups.png', { fullPage: true });
  });

  test('members - change history dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('members'));
    const firstRow = authedPage.getByTestId('members__table__row').first();
    await expect(firstRow).toBeVisible();
    await firstRow.getByRole('button').click();
    await authedPage.getByRole('menuitem', { name: /view change history/i }).click();
    await expect(authedPage.getByRole('dialog')).toBeVisible();
    await expect(authedPage.getByText(/no change history available/i)).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('members-change-history-dialog.png');
  });

  test('endpoints - edit dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('endpoints'));
    const firstRow = authedPage.getByTestId('endpoints__table__row').first();
    await expect(firstRow).toBeVisible();
    await firstRow.getByRole('button', { name: /edit/i }).click();
    await expect(authedPage.getByTestId('endpoints__edit-dialog')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-edit-endpoint.png');
  });

  test('usage - rate limit focus', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('usage'));
    await authedPage.getByTestId('usage__limit-mode-rate').click();
    await expect(authedPage.locator('[data-testid="usage__progress-card"]').first()).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('usage-rate-focus.png', { fullPage: true });
  });

});
