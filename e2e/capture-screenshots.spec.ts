/**
 * MBOS Platform Screenshot Capture
 *
 * Run: npx playwright test e2e/capture-screenshots.spec.ts --project=chromium
 * Requires: dev server at localhost:3000
 *
 * Output: test-results/screenshots/ (temporary, gitignored)
 * For marketing use: manually copy to marketing/screenshots/
 */

import { test } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE = path.join(process.cwd(), 'test-results', 'screenshots');
const WS_ID = 'ws_default';
const PROJECT_ID = 'proj_001';

const DIRS = [
  '01-auth',
  '02-projects',
  '03-overview',
  '04-chat',
  '05-workbench',
  '06-agents',
  '07-endpoints',
  '08-members',
  '09-audit',
  '10-usage',
  '11-settings',
  '12-sources',
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

/** Expand SettingsTokenReference (click to show all quota/limits tokens) */
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
    await page.goto('/zh-CN/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(BASE, '01-auth', 'login.png'), fullPage: true });

    await page.goto('/zh-CN/join', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(BASE, '01-auth', 'join-invalid.png'), fullPage: true });

    await mockLogin(page);
    await page.reload();
    await page.waitForTimeout(1500);
    await page.goto('/zh-CN/login/workspace', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '01-auth', 'login-workspace.png'), fullPage: true });

    await page.goto('/zh-CN/workspaces/ws_default/projects', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '01-auth', 'workspace-select.png'), fullPage: true });

    // === 02-projects ===
    await page.screenshot({ path: path.join(BASE, '02-projects', 'projects-list.png'), fullPage: true });

    // === 16-workspace ===
    await page.goto('/zh-CN/workspaces/ws_default/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '16-workspace', 'workspace-settings.png'), fullPage: true });

    // === 03-overview ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/overview`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(BASE, '03-overview', 'overview.png'), fullPage: true });

    // === 04-chat ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/chat`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '04-chat', 'chat.png'), fullPage: true });

    // === 05-workbench ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/workbench`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '05-workbench', 'workbench.png'), fullPage: true });

    const createRecipeBtn = page.getByTestId('workbench__create-recipe-btn');
    if (await createRecipeBtn.isVisible()) {
      await createRecipeBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(BASE, '05-workbench', 'create-recipe-dialog.png'), fullPage: true });
      await page.keyboard.press('Escape');
    }

    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/workbench/recipes/recipe_001`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(BASE, '05-workbench', 'recipe-detail.png'), fullPage: true });

    // === 06-agents ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/agents`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '06-agents', 'agents.png'), fullPage: true });

    // === 07-endpoints ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/endpoints`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '07-endpoints', 'endpoints.png'), fullPage: true });

    // === 08-members ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/members`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(BASE, '08-members', 'members-list.png'), fullPage: true });

    const memberRow = page.locator('table tbody tr').first();
    if (await memberRow.isVisible()) {
      await memberRow.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(BASE, '08-members', 'member-detail-overview.png'), fullPage: true });

      const drawerTabs = page.locator('[role="tablist"]').first().getByRole('tab');
      await drawerTabs.nth(0).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(BASE, '08-members', 'member-permissions-template.png'), fullPage: true });
      const advTab = page.getByRole('tab').filter({ hasText: /高级模式|Advanced Mode/ });
      if (await advTab.count() > 0) {
        await advTab.first().click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(BASE, '08-members', 'member-permissions-advanced.png'), fullPage: true });
      }
      await drawerTabs.nth(1).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(BASE, '08-members', 'member-quota.png'), fullPage: true });
      await drawerTabs.nth(2).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(BASE, '08-members', 'member-resource-acl.png'), fullPage: true });
      await page.keyboard.press('Escape');
    }

    // === 09-audit ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/audit`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '09-audit', 'audit.png'), fullPage: true });

    // === 10-usage ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/usage`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '10-usage', 'usage.png'), fullPage: true });

    // === 11-settings ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(BASE, '11-settings', 'settings-general.png'), fullPage: true });

    const runtimeTab = page.getByRole('tab', { name: /运行偏好|Runtime Preferences/i });
    if (await runtimeTab.isVisible()) {
      await runtimeTab.click();
      await page.waitForTimeout(500);
      await expandTokenReference(page);
      await page.screenshot({ path: path.join(BASE, '11-settings', 'settings-runtime-with-tokens.png'), fullPage: true });
    }

    // === 12-sources ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/sources`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '12-sources', 'sources.png'), fullPage: true });

    // === 13-credentials ===
    await page.goto(`/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/credentials`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(BASE, '13-credentials', 'credentials-list.png'), fullPage: true });
    const createKeyBtn = page.getByRole('button', { name: /创建凭据|Create Key|Create Credential/i }).first();
    if (await createKeyBtn.isVisible()) {
      await createKeyBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(BASE, '13-credentials', 'create-credential-dialog.png'), fullPage: true });
      await page.keyboard.press('Escape');
    }

    // === 14-user ===
    await page.goto('/zh-CN/user/profile', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(BASE, '14-user', 'profile.png'), fullPage: true });

    await page.goto('/zh-CN/user/api-keys', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(BASE, '14-user', 'api-keys.png'), fullPage: true });

    const expectedScreenshots = [
      path.join(BASE, '01-auth', 'login.png'),
      path.join(BASE, '01-auth', 'workspace-select.png'),
      path.join(BASE, '01-auth', 'login-workspace.png'),
      path.join(BASE, '01-auth', 'join-invalid.png'),
      path.join(BASE, '02-projects', 'projects-list.png'),
      path.join(BASE, '03-overview', 'overview.png'),
      path.join(BASE, '04-chat', 'chat.png'),
      path.join(BASE, '05-workbench', 'workbench.png'),
      path.join(BASE, '05-workbench', 'recipe-detail.png'),
      path.join(BASE, '06-agents', 'agents.png'),
      path.join(BASE, '07-endpoints', 'endpoints.png'),
      path.join(BASE, '08-members', 'members-list.png'),
      path.join(BASE, '09-audit', 'audit.png'),
      path.join(BASE, '10-usage', 'usage.png'),
      path.join(BASE, '11-settings', 'settings-general.png'),
      path.join(BASE, '12-sources', 'sources.png'),
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
