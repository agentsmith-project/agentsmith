/**
 * MBOS Platform Screenshot Capture
 *
 * Run: npx playwright test e2e/capture-screenshots.spec.ts --project=marketing-assets
 * Requires: current mock E2E dev server at localhost:3001 or Playwright managed webServer
 *
 * Output: test-results/screenshots/ by default
 * Override with MARKETING_ASSETS_OUTPUT_DIR=/abs/path
 */

import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { gotoAndWait } from './utils/navigation';

const BASE = process.env.MARKETING_ASSETS_OUTPUT_DIR?.trim()
  ? path.resolve(process.env.MARKETING_ASSETS_OUTPUT_DIR)
  : path.join(process.cwd(), 'test-results', 'screenshots');
const WS_ID = 'ws_default';
const PROJECT_ID = 'proj_001';

const DIRS = [
  '01-auth',
  '02-projects',
  '03-overview',
  '04-chat',
  '05-agent-tasks',
  '06-agent-runners',
  '07-endpoints',
  '08-members',
  '09-audit',
  '10-usage',
  '11-settings',
  '12-files',
  '13-credentials',
  '14-user',
  '16-workspace',
];

function ensureDirs() {
  DIRS.forEach((d) => {
    const p = path.join(BASE, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
}

async function mockLogin(page: import('@playwright/test').Page) {
  await page.addInitScript(({ wsId }) => {
    (window as any).__MBOS_AUTH_SETUP__ = true;
    const user = { id: 'user_demo', email: 'demo@demo.com', name: 'Demo User', locale: 'zh-CN' };
    const checkAuth = () => {
      const store = (window as any).__MBOS_AUTH_STORE__;
      if (store && store.getState) {
        const state = store.getState();
        if (!state.isAuthenticated && typeof state.setAuth === 'function') {
          state.setAuth(user, `mock_jwt_demo_${Date.now()}`);
        }
        return true;
      }
      return false;
    };
    if (!checkAuth()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (checkAuth() || attempts > 100) {
          clearInterval(interval);
        }
      }, 50);
    }
  }, { wsId: WS_ID });
}

async function navigateForCapture(page: import('@playwright/test').Page, url: string) {
  await gotoAndWait(page, url, 30000);
  await page.waitForTimeout(500);
}

/** Expand SettingsTokenReference (click to show all limit/limits tokens) */
async function expandTokenReference(page: import('@playwright/test').Page) {
  const btn = page.getByRole('button', { name: /支持的 token|Supported tokens/i });
  if (await btn.isVisible()) {
    await btn.click();
    await page.waitForTimeout(400);
  }
}

test.describe('Screenshot Capture', () => {
  test.beforeAll(() => ensureDirs());

  test('capture all pages', async ({ page }) => {
    test.setTimeout(180000);

    // === 01-auth ===
    await navigateForCapture(page, '/zh-CN/login');
    await page.screenshot({ path: path.join(BASE, '01-auth', 'login.png'), fullPage: true });

    await navigateForCapture(page, '/zh-CN/join');
    await page.screenshot({ path: path.join(BASE, '01-auth', 'join-invalid.png'), fullPage: true });

    await mockLogin(page);
    await navigateForCapture(page, '/zh-CN/login');
    await page.waitForTimeout(800);
    await navigateForCapture(page, '/zh-CN/login/workspace');
    await page.screenshot({ path: path.join(BASE, '01-auth', 'login-workspace.png'), fullPage: true });

    await navigateForCapture(page, '/zh-CN/workspaces/ws_default/projects');
    await page.screenshot({ path: path.join(BASE, '01-auth', 'workspace-select.png'), fullPage: true });

    // === 02-projects ===
    await page.screenshot({ path: path.join(BASE, '02-projects', 'projects-list.png'), fullPage: true });

    // === 16-workspace ===
    await navigateForCapture(page, '/zh-CN/workspaces/ws_default/settings');
    await page.screenshot({ path: path.join(BASE, '16-workspace', 'workspace-settings.png'), fullPage: true });

    // === 03-overview ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/overview`);
    await page.screenshot({ path: path.join(BASE, '03-overview', 'overview.png'), fullPage: true });

    // === 04-chat ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/chat`);
    await page.screenshot({ path: path.join(BASE, '04-chat', 'chat.png'), fullPage: true });

    // === 05-agent-tasks ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/agent-tasks`);
    await page.screenshot({ path: path.join(BASE, '05-agent-tasks', 'agent-tasks.png'), fullPage: true });

    const createTaskBtn = page.getByTestId('agent-tasks__create-task-btn');
    if (await createTaskBtn.isVisible()) {
      await createTaskBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(BASE, '05-agent-tasks', 'create-task-dialog.png'), fullPage: true });
      await page.keyboard.press('Escape');
    }

    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/agent-tasks/task_001`);
    await page.waitForSelector('[data-testid="page-state__success"], [data-testid="page-layout"], [data-testid="page-state__loading"]', {
      timeout: 15000,
    }).catch(() => {});
    await page.screenshot({ path: path.join(BASE, '05-agent-tasks', 'agent-task-detail.png'), fullPage: true });

    // === 06-agent-runners ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/agent-runners`);
    await page.screenshot({ path: path.join(BASE, '06-agent-runners', 'agent-runners.png'), fullPage: true });
    const createRunnerBtn = page.getByTestId('agent-runners__create-btn');
    if (await createRunnerBtn.isVisible().catch(() => false)) {
      await createRunnerBtn.click();
      await page.waitForTimeout(500);
      if (await page.getByTestId('agent-runners__create-dialog').isVisible().catch(() => false)) {
        await page.screenshot({ path: path.join(BASE, '06-agent-runners', 'create-agent-runner-dialog.png'), fullPage: true });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    const connectionKeysBtn = page.locator('[data-testid^="agent-runners__connection-keys-btn--"]').first();
    if (await connectionKeysBtn.isVisible().catch(() => false)) {
      await connectionKeysBtn.click();
      await page.waitForTimeout(500);
      if (await page.getByTestId('agent-runners__connection-keys-sheet').isVisible().catch(() => false)) {
        await page.screenshot({ path: path.join(BASE, '06-agent-runners', 'connection-keys-dialog.png'), fullPage: true });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // === 07-endpoints ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/endpoints`);
    await page.screenshot({ path: path.join(BASE, '07-endpoints', 'endpoints.png'), fullPage: true });
    const createEndpointBtn = page.getByTestId('endpoints__create-btn');
    if (await createEndpointBtn.isVisible().catch(() => false)) {
      await createEndpointBtn.click();
      await page.waitForTimeout(500);
      if (await page.getByTestId('endpoints__create-dialog').isVisible().catch(() => false)) {
        await page.screenshot({ path: path.join(BASE, '07-endpoints', 'create-endpoint-dialog.png'), fullPage: true });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // === 08-members ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/members`);
    await page.screenshot({ path: path.join(BASE, '08-members', 'members-list.png'), fullPage: true });
    const inviteMemberBtn = page.getByTestId('members__invite-btn');
    if (await inviteMemberBtn.isVisible().catch(() => false)) {
      await inviteMemberBtn.click();
      await page.waitForTimeout(500);
      if (await page.getByTestId('members__invite-dialog').isVisible().catch(() => false)) {
        await page.screenshot({ path: path.join(BASE, '08-members', 'invite-member-dialog.png'), fullPage: true });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    const memberActionButton = page.locator('table tbody tr button').first();
    const memberRow = page.locator('table tbody tr').first();
    if (await memberActionButton.isVisible().catch(() => false)) {
      await memberActionButton.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(BASE, '08-members', 'member-detail-overview.png'), fullPage: true });
      await page.keyboard.press('Escape');
    } else if (await memberRow.isVisible().catch(() => false)) {
      await memberRow.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(BASE, '08-members', 'member-detail-overview.png'), fullPage: true });
    }

    // === 09-audit ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/audit`);
    await page.screenshot({ path: path.join(BASE, '09-audit', 'audit.png'), fullPage: true });
    const auditActionButton = page.locator('[data-testid^="audit__row-actions--"]').first();
    if (await auditActionButton.isVisible().catch(() => false)) {
      await auditActionButton.click();
      await page.waitForTimeout(300);
      const viewDetailsButton = page.locator('[data-testid^="audit__view-details--"]').first();
      if (await viewDetailsButton.isVisible().catch(() => false)) {
        await viewDetailsButton.click();
        await page.waitForTimeout(700);
        if (await page.getByTestId('audit__detail-summary').isVisible().catch(() => false)) {
          await page.screenshot({ path: path.join(BASE, '09-audit', 'audit-detail-drawer.png'), fullPage: true });
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    // === 10-usage ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/usage`);
    await page.screenshot({ path: path.join(BASE, '10-usage', 'usage.png'), fullPage: true });

    // === 11-settings ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/settings`);
    await page.screenshot({ path: path.join(BASE, '11-settings', 'settings-general.png'), fullPage: true });

    const executionTab = page.getByRole('tab', { name: /执行偏好|Execution Preferences/i });
    if (await executionTab.isVisible()) {
      await executionTab.click();
      await page.waitForTimeout(500);
      await expandTokenReference(page);
      await page.screenshot({ path: path.join(BASE, '11-settings', 'settings-execution-with-tokens.png'), fullPage: true });
    }

    // === 12-files ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/files`);
    await page.screenshot({ path: path.join(BASE, '12-files', 'files.png'), fullPage: true });
    const libraryCreateBtn = page.getByTestId('files__library-create');
    if (await libraryCreateBtn.isVisible().catch(() => false)) {
      await libraryCreateBtn.click();
      await page.waitForTimeout(500);
      if (await page.getByTestId('files__dialog__library-create').isVisible().catch(() => false)) {
        await page.screenshot({ path: path.join(BASE, '12-files', 'create-library-dialog.png'), fullPage: true });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    const mountAccessBtn = page.locator('[data-testid^="files__library-desktop-access--"]').first();
    if (await mountAccessBtn.isVisible().catch(() => false)) {
      await mountAccessBtn.click();
      await page.waitForTimeout(500);
      if (await page.getByTestId('files__dialog__desktop-mount-access').isVisible().catch(() => false)) {
        await page.screenshot({ path: path.join(BASE, '12-files', 'library-mount-access-dialog.png'), fullPage: true });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    const deleteLibraryBtn = page.locator('[data-testid^="files__library-delete-btn--"]').first();
    if (await deleteLibraryBtn.isVisible().catch(() => false)) {
      await deleteLibraryBtn.click();
      await page.waitForTimeout(500);
      if (await page.getByTestId('files__dialog__library-delete').isVisible().catch(() => false)) {
        await page.screenshot({ path: path.join(BASE, '12-files', 'delete-library-dialog.png'), fullPage: true });
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // === 13-credentials ===
    await navigateForCapture(page, `/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/credentials`);
    await page.screenshot({ path: path.join(BASE, '13-credentials', 'credentials-list.png'), fullPage: true });
    const createKeyBtn = page.getByRole('button', { name: /创建凭据|Create Key|Create Credential/i }).first();
    if (await createKeyBtn.isVisible()) {
      await createKeyBtn.click();
      await page.waitForTimeout(500);
      if (await page.getByTestId('credentials__create-dialog').isVisible().catch(() => false)) {
        await page.screenshot({ path: path.join(BASE, '13-credentials', 'create-credential-dialog.png'), fullPage: true });
      }
      await page.keyboard.press('Escape');
    }

    // === 14-user ===
    await navigateForCapture(page, '/zh-CN/user/profile');
    await page.screenshot({ path: path.join(BASE, '14-user', 'profile.png'), fullPage: true });

    await navigateForCapture(page, '/zh-CN/user/api-keys');
    await page.screenshot({ path: path.join(BASE, '14-user', 'api-keys.png'), fullPage: true });

    const expectedScreenshots = [
      path.join(BASE, '01-auth', 'login.png'),
      path.join(BASE, '01-auth', 'workspace-select.png'),
      path.join(BASE, '01-auth', 'login-workspace.png'),
      path.join(BASE, '01-auth', 'join-invalid.png'),
      path.join(BASE, '02-projects', 'projects-list.png'),
      path.join(BASE, '03-overview', 'overview.png'),
      path.join(BASE, '04-chat', 'chat.png'),
      path.join(BASE, '05-agent-tasks', 'agent-tasks.png'),
      path.join(BASE, '05-agent-tasks', 'agent-task-detail.png'),
      path.join(BASE, '06-agent-runners', 'agent-runners.png'),
      path.join(BASE, '07-endpoints', 'endpoints.png'),
      path.join(BASE, '08-members', 'members-list.png'),
      path.join(BASE, '09-audit', 'audit.png'),
      path.join(BASE, '10-usage', 'usage.png'),
      path.join(BASE, '11-settings', 'settings-general.png'),
      path.join(BASE, '12-files', 'files.png'),
      path.join(BASE, '13-credentials', 'credentials-list.png'),
      path.join(BASE, '14-user', 'profile.png'),
      path.join(BASE, '14-user', 'api-keys.png'),
      path.join(BASE, '16-workspace', 'workspace-settings.png'),
    ];

    const missing = expectedScreenshots.filter((shot) => !fs.existsSync(shot));
    if (missing.length > 0) {
      throw new Error(`Missing screenshots: ${missing.join(', ')}`);
    }
  });
});
