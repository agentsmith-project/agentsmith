/**
 * MBOS Platform Screenshot Capture Script
 *
 * Logs in with demo@demo.com, navigates all pages, and captures screenshots
 * for technical documentation and marketing materials.
 *
 * Usage: npx playwright test scripts/capture-screenshots.ts --project=chromium
 * Or: npx ts-node scripts/capture-screenshots.ts (if using playwright programmatically)
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:3000';
const OUTPUT_DIR = path.join(__dirname, '../marketing/screenshots');
const WS_ID = 'ws_default';
const PROJECT_ID = 'proj_001';

async function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function mockLogin(page: Page) {
  await page.evaluate(({ wsId }) => {
    const mockAuthState = {
      state: {
        user: {
          id: 'user_demo',
          email: 'demo@demo.com',
          name: 'Demo User',
          locale: 'zh-CN',
        },
        token: 'mock_jwt_demo_' + Date.now(),
        isAuthenticated: true,
        currentWorkspace: {
          id: wsId,
          name: wsId === 'ws_default' ? 'Default Workspace' : 'Test Workspace',
          role: 'owner',
        },
        currentProject: {
          id: 'proj_001',
          workspace_id: wsId,
          name: 'AI Assistant Project',
          visibility: 'public',
          role: 'owner',
          permissions: ['project:*'],
          status: 'active',
        },
        workspaces: [
          { id: 'ws_default', name: 'Default Workspace', role: 'owner' },
          { id: 'ws_test', name: 'Test Workspace', role: 'admin' },
        ],
        projects: [
          {
            id: 'proj_001',
            workspace_id: wsId,
            name: 'AI Assistant Project',
            visibility: 'public',
            role: 'owner',
            permissions: ['project:*'],
            status: 'active',
          },
          {
            id: 'proj_002',
            workspace_id: wsId,
            name: 'Research Project',
            visibility: 'private',
            role: 'admin',
            permissions: ['project:endpoint:use', 'project:agent:manage'],
            status: 'active',
          },
        ],
      },
      version: 0,
    };
    localStorage.setItem('agentsmith-auth', JSON.stringify(mockAuthState));
  }, { wsId: WS_ID });
}

async function capture(page: Page, name: string, subdir = '') {
  const dir = subdir ? path.join(OUTPUT_DIR, subdir) : OUTPUT_DIR;
  await ensureDir(dir);
  const filepath = path.join(dir, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  Captured: ${subdir ? subdir + '/' : ''}${name}.png`);
}

async function main() {
  ensureDir(OUTPUT_DIR);
  console.log('MBOS Screenshot Capture - Starting...');
  console.log(`Output directory: ${OUTPUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  try {
    // 1. Login page
    await page.goto(`${BASE_URL}/zh-CN/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await capture(page, '01-login-page');

    // Fill and login
    await page.getByRole('main').getByRole('button', { name: /Default Workspace|选择工作空间/i }).click();
    await page.getByRole('menuitem', { name: 'Default Workspace' }).click();
    await page.locator('input[placeholder*="user@example.com"], input[placeholder*="user@"]').fill('demo@demo.com');
    await page.getByText('Quick Login').click();
    await page.waitForURL(/\/login\/workspace/, { timeout: 5000 });

    // 2. Workspace selection
    await capture(page, '02-workspace-select');
    await page.getByText('Default Workspace').first().click();
    await page.waitForURL(/\/projects/, { timeout: 5000 });

    // 3. Projects list
    await page.waitForTimeout(1000);
    await capture(page, '03-projects-list');

    // 4. Navigate to project
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/overview`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(1000);

    // 5. Overview
    await capture(page, '05-overview');

    // 6. Chat
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/chat`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(800);
    await capture(page, '06-chat');

    // 7. Workbench
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/studio`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(800);
    await capture(page, '07-studio');

    // 8. Agents
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/agents`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(800);
    await capture(page, '08-agents');

    // 9. Endpoints
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/endpoints`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(800);
    await capture(page, '09-endpoints');

    // 10. Members
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/members`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(1000);
    await capture(page, '10-members-list');

    // Open member detail (click first member row)
    const memberRow = page.locator('table tbody tr').first();
    if (await memberRow.isVisible()) {
      await memberRow.click();
      await page.waitForTimeout(800);
      await capture(page, '10b-member-detail', 'members');
      // Try to find Permissions tab
      const permTab = page.getByRole('tab', { name: /权限|Permissions/i });
      if (await permTab.isVisible()) {
        await permTab.click();
        await page.waitForTimeout(500);
        await capture(page, '10c-member-permissions', 'members');
      }
      const quotaTab = page.getByRole('tab', { name: /配额|Quota/i });
      if (await quotaTab.isVisible()) {
        await quotaTab.click();
        await page.waitForTimeout(500);
        await capture(page, '10d-member-quota', 'members');
      }
      await page.keyboard.press('Escape');
    }

    // 11. Audit
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/audit`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(800);
    await capture(page, '11-audit');

    // 12. Usage
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/usage`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(800);
    await capture(page, '12-usage');

    // 13. Settings
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/settings`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(1000);
    await capture(page, '13-settings-general');

    const policyTab = page.getByRole('tab', { name: /策略|Policy|治理|Governance/i });
    if (await policyTab.isVisible()) {
      await policyTab.click();
      await page.waitForTimeout(500);
      await capture(page, '13b-settings-governance', 'settings');
    }
    const limitsTab = page.getByRole('tab', { name: /限额|Limits|限制/i });
    if (await limitsTab.isVisible()) {
      await limitsTab.click();
      await page.waitForTimeout(500);
      await capture(page, '13c-settings-limits', 'settings');
    }

    // 14. Sources
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/sources`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(800);
    await capture(page, '14-sources');

    // 15. Credentials (API Keys)
    await page.goto(`${BASE_URL}/zh-CN/workspaces/${WS_ID}/projects/${PROJECT_ID}/credentials`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(800);
    await capture(page, '15-credentials');

    // Try create credential dialog
    const createKeyBtn = page.getByRole('button', { name: /创建|Create|新增/i });
    if (await createKeyBtn.isVisible()) {
      await createKeyBtn.click();
      await page.waitForTimeout(500);
      await capture(page, '15b-create-credential-dialog', 'credentials');
      await page.keyboard.press('Escape');
    }

    // 16. User profile (optional)
    await page.goto(`${BASE_URL}/zh-CN/user/profile`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await capture(page, '16-user-profile');

    // 17. API Keys (user level)
    await page.goto(`${BASE_URL}/zh-CN/user/api-keys`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await capture(page, '17-user-api-keys');

    console.log('\nScreenshot capture completed successfully!');
  } catch (err) {
    console.error('Capture failed:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

main();
