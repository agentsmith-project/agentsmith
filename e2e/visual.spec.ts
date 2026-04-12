/**
 * Visual Regression Tests - Full Page Screenshots
 *
 * Uses Playwright's built-in toHaveScreenshot() for pixel-level comparison.
 * Baselines are stored in e2e/__screenshots__/ and auto-generated on first run.
 *
 * Run:   npx playwright test e2e/visual.spec.ts --project=visual
 * Update baselines: npx playwright test e2e/visual.spec.ts --project=visual --update-snapshots
 */

import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ensureAuthenticatedSession, withAuth } from './fixtures/authenticated';
import { gotoAndWait, waitForPageReady } from './utils/navigation';
import { setVisualTheme, themedScreenshotName, VISUAL_THEMES } from './utils/visual-theme';
import { resolveVisualBaselineStableMarkers } from './visual-baseline-support';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '@/lib/mock-time';

const WS_ID = 'ws_default';
const PROJECT_ID = 'proj_001';

const test = base.extend<{ authedPage: Page; guestPage: Page }>({
  authedPage: async ({ page }, use) => {
    await withAuth(page, WS_ID, 'test@example.com');
    await use(page);
  },
  guestPage: async ({ page }, use) => {
    await withAuth(page, WS_ID, 'guest@example.com', 'user_009');
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

async function dismissFilesOverlayIfPresent(page: Page) {
  const mountDialog = page.getByTestId('files__dialog__desktop-mount-access');
  if (await mountDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await expect(mountDialog).toHaveCount(0, { timeout: 5_000 });
  }
}

async function loginAsSystemAdmin(page: Page) {
  await stableNavigate(page, '/en-US/system/login');
  await page.getByTestId('system-login__username').fill('mbos-admin');
  await page.getByTestId('system-login__password').fill('mbos-admin');
  await page.getByTestId('system-login__submit').click();
  await expect
    .poll(() => page.url(), { timeout: 20_000 })
    .toMatch(/\/en-US\/system\/workspaces/);
  await waitForPageReady(page);
}

function buildSeededWorkspaceRecord(state: 'with_workspace' | 'with_disabled_workspace' | 'with_failed_workspace') {
  const base = {
    id: 'ws_seeded',
    name: 'Seeded Workspace',
    workspace_admin: 'seed-admin@example.com',
    workspace_admin_user_id: 'kc-seed-admin',
    workspace_admin_name: 'Seed Admin',
    project_creators: [],
    idp: {
      kind: 'keycloak',
      url: 'https://seed.example.com',
      realm: 'seed',
      client_id: 'seed-client',
    },
    tenant: {
      workspace_id: 'ws_seeded',
      workspace_name: 'Seeded Workspace',
      substrate_label: 'primary',
      database_name: 'agentsmith_ws_ws_seeded',
      collection_prefix: 'ws_ws_seeded_',
      key_prefix: 'ws:ws_seeded:',
    },
    provisioning_status: 'ready',
    last_initialized_at: '2026-03-15T00:00:00.000Z',
    last_init_error: null,
    created_at: '2026-03-15T00:00:00.000Z',
    updated_at: '2026-03-15T00:00:00.000Z',
  };
  if (state === 'with_disabled_workspace') {
    return { ...base, provisioning_status: 'disabled' };
  }
  if (state === 'with_failed_workspace') {
    return {
      ...base,
      provisioning_status: 'failed',
      last_initialized_at: null,
      last_init_error: 'identity_provider_config_incomplete',
    };
  }
  return base;
}

async function seedSystemWorkspaces(request: APIRequestContext, state: 'empty' | 'with_workspace' | 'with_disabled_workspace' | 'with_failed_workspace') {
  const response = await request.post('/api/test/system/workspaces/seed', {
    data: {
      records: state === 'empty' ? [] : [buildSeededWorkspaceRecord(state)],
    },
  });
  expect(response.ok()).toBe(true);
}

async function seedVisualFeishuState(
  page: Page,
  options: {
    status?: 'not_configured' | 'verification_required' | 'verified' | 'enabled' | 'error';
    verifiedByEmail?: string;
    appId?: string;
    redirectUri?: string;
    connectedEmail?: string;
  } = {},
) {
  const headers = {
    'x-mock-feishu-status': options.status ?? 'not_configured',
    'x-mock-feishu-verified-email': options.verifiedByEmail ?? '',
    'x-mock-feishu-app-id': options.appId ?? '',
    'x-mock-feishu-redirect-uri': options.redirectUri ?? '',
    'x-mock-connection-provider': options.connectedEmail ? 'feishu' : '',
    'x-mock-connection-workspace': WS_ID,
    'x-mock-connection-email': options.connectedEmail ?? '',
  };
  await page.addInitScript((nextHeaders) => {
    (window as Window & { __MBOS_MSW_TEST_HEADERS__?: Record<string, string> }).__MBOS_MSW_TEST_HEADERS__ = nextHeaders;
  }, headers);
  await page.evaluate((nextHeaders) => {
    (window as Window & { __MBOS_MSW_TEST_HEADERS__?: Record<string, string> }).__MBOS_MSW_TEST_HEADERS__ = nextHeaders;
  }, headers).catch(() => {});
}

function projectPath(section: string) {
  return `/en-US/workspaces/${WS_ID}/projects/${PROJECT_ID}/${section}`;
}

async function seedVisualTestNow(page: Page, iso = VISUAL_TEST_REFERENCE_NOW_ISO) {
  await page.addInitScript((nextNow) => {
    (window as Window & { __MBOS_TEST_NOW__?: string }).__MBOS_TEST_NOW__ = nextNow;
  }, iso);
  await page.evaluate((nextNow) => {
    (window as Window & { __MBOS_TEST_NOW__?: string }).__MBOS_TEST_NOW__ = nextNow;
  }, iso).catch(() => {});
}

async function waitForStableRecipeMarkers(page: Page, scenarioId: string) {
  const stableMarkers = resolveVisualBaselineStableMarkers(scenarioId);
  for (const marker of stableMarkers) {
    await expect(page.getByTestId(marker)).toBeVisible({ timeout: 15_000 });
  }
}

async function resetPublicVisualState(page: Page) {
  await page.context().clearCookies().catch(() => {});
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  }).catch(() => {});
}

async function requireMockVisualAuthLane(page: Page, bootstrapPath = `/en-US/workspaces/${WS_ID}/projects`) {
  await stableNavigate(page, '/en-US/login/workspace');
  const useMsw = await page.evaluate(
    () => window.__MBOS_PUBLIC_RUNTIME_CONFIG__?.useMsw ?? false,
  ).catch(() => false);
  test.skip(!useMsw, 'Mock-auth visual pages require NEXT_PUBLIC_USE_MSW=true.');
  await ensureAuthenticatedSession(page, bootstrapPath, {
    wsId: WS_ID,
    userEmail: 'test@example.com',
    userId: 'user_001',
  });
}

// ─── Workspace Pages ────────────────────────────────────────────────────────

test.describe('Visual - Workspace Pages', () => {

  test('workspace home - project creator', async ({ page }) => {
    await withAuth(page, WS_ID, 'dev2@corp.com', 'u_2');
    await stableNavigate(page, `/en-US/workspaces/${WS_ID}`);
    await expect(page.getByTestId('projects__page')).toBeVisible();
    await expect(page.getByTestId('projects__create-btn')).toBeVisible();
    await expect(page.getByTestId('projects__back-to-workspace')).toHaveCount(0);
    await expect(page).toHaveScreenshot('workspace-home-project-creator.png', { fullPage: true });
  });

  test('projects list', async ({ authedPage }) => {
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/projects`);
    await expect(authedPage).toHaveScreenshot('projects-list.png', { fullPage: true });
  });

  test('projects list public discovery', async ({ guestPage }) => {
    await stableNavigate(guestPage, `/en-US/workspaces/${WS_ID}/projects`);
    await expect(guestPage.getByText('Research Project')).not.toBeVisible();
    await expect(guestPage.getByTestId('projects__join-request-btn--proj_001')).toBeVisible();
    await expect(guestPage.getByTestId('projects__join-project-btn--proj_003')).toBeVisible();
    await expect(guestPage).toHaveScreenshot('projects-list-public-discovery.png', { fullPage: true });
  });

  test('project join request dialog', async ({ guestPage }) => {
    await stableNavigate(guestPage, `/en-US/workspaces/${WS_ID}/projects`);
    await guestPage.getByRole('button', { name: 'AI Assistant Project' }).click();
    await expect(guestPage.getByTestId('projects__join-request-dialog')).toBeVisible();
    await expect(guestPage).toHaveScreenshot('dialog-project-join-request.png', { fullPage: true });
  });

  test('project join now dialog', async ({ guestPage }) => {
    await stableNavigate(guestPage, `/en-US/workspaces/${WS_ID}/projects`);
    await guestPage.getByRole('button', { name: 'Customer Support Bot' }).click();
    await expect(guestPage.getByTestId('projects__join-now-dialog')).toBeVisible();
    await expect(guestPage).toHaveScreenshot('dialog-project-join-now.png', { fullPage: true });
  });

  test('notification center join request outcome', async ({ page }) => {
    await withAuth(page, WS_ID, 'guest@example.com', 'user_009');
    await stableNavigate(page, `/en-US/workspaces/${WS_ID}/projects`);
    await page.evaluate(async () => {
      await fetch('/api/test/me/notifications/seed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: 'user_009',
          notifications: [
            {
              id: 'notif_visual_join_approved',
              type: 'join_request_approved',
              title: 'Project access approved',
              body: 'Your request to join AI Assistant Project was approved.',
              link_url: '/workspaces/ws_default/projects/proj_001/overview',
            },
            {
              id: 'notif_visual_join_rejected',
              type: 'join_request_rejected',
              title: 'Project access request declined',
              body: 'Your request to join AI Assistant Project was declined: Not in scope for this project',
              link_url: '/workspaces/ws_default/projects',
            },
          ],
        }),
      });
    });
    await stableNavigate(page, `/en-US/workspaces/${WS_ID}/projects`);
    await page.getByTestId('topbar__notifications').click();
    await expect(page.getByTestId('topbar__notifications-dropdown')).toBeVisible();
    await expect(page).toHaveScreenshot('notification-center-join-request.png', { fullPage: true });
  });

  test('projects empty state', async ({ page }) => {
    await withAuth(page, 'ws_test', 'test@example.com');
    await stableNavigate(page, '/en-US/workspaces/ws_test/projects');
    await expect(page.getByText('No projects yet')).toBeVisible();
    await expect(page).toHaveScreenshot('projects-empty.png', { fullPage: true });
  });

  test('workspace settings create project dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/settings`);
    await authedPage.getByTestId('ws-settings__create-project').click();
    await expect(authedPage.getByRole('heading', { name: /Create Project/i })).toBeVisible();
    await expect(authedPage).toHaveScreenshot('workspace-settings-create-project.png', { fullPage: true });
  });

  test('workspace settings - Feishu enabled card', async ({ authedPage }) => {
    await seedVisualFeishuState(authedPage, {
      status: 'enabled',
      appId: 'cli_visual_demo',
      redirectUri: `http://localhost:3001/workspaces/${WS_ID}/feishu/callback`,
      verifiedByEmail: 'visual.admin@example.com',
    });
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/settings`);
    await expect(authedPage.getByTestId('ws-settings__integration-feishu')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('workspace-settings-feishu-enabled.png', { fullPage: true });
  });

  test('workspace Feishu setup - credentials draft', async ({ authedPage }) => {
    await seedVisualFeishuState(authedPage, { status: 'not_configured' });
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/settings/feishu?step=credentials`);
    await expect(authedPage.getByTestId('ws-feishu__save-draft')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('workspace-feishu-setup-credentials.png', { fullPage: true });
  });

  test('workspace Feishu setup - enabled locked state', async ({ authedPage }) => {
    await seedVisualFeishuState(authedPage, {
      status: 'enabled',
      appId: 'cli_visual_demo',
      redirectUri: `http://localhost:3001/workspaces/${WS_ID}/feishu/callback`,
      verifiedByEmail: 'visual.admin@example.com',
    });
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/settings/feishu`);
    await expect(authedPage.getByTestId('ws-feishu__locked')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('workspace-feishu-locked.png', { fullPage: true });
  });

  test('workspace connections - Feishu disabled state', async ({ authedPage }) => {
    await seedVisualFeishuState(authedPage, { status: 'not_configured' });
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/connections`);
    await expect(authedPage.getByTestId('workspace-connections__feishu-connect')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('workspace-connections-feishu-disabled.png', { fullPage: true });
  });

  test('workspace connections - Feishu connected state', async ({ authedPage }) => {
    await seedVisualFeishuState(authedPage, {
      status: 'enabled',
      appId: 'cli_visual_demo',
      redirectUri: `http://localhost:3001/workspaces/${WS_ID}/feishu/callback`,
      verifiedByEmail: 'visual.admin@example.com',
      connectedEmail: 'visual.tester@example.com',
    });
    await stableNavigate(authedPage, `/en-US/workspaces/${WS_ID}/connections`);
    await expect(authedPage.getByTestId('workspace-connections__feishu-connect')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('workspace-connections-feishu-connected.png', { fullPage: true });
  });
});

// ─── System Pages ───────────────────────────────────────────────────────────

test.describe('Visual - System Pages', () => {

  test('system workspaces edit mode', async ({ page, request }) => {
    await seedSystemWorkspaces(request, 'with_workspace');
    await loginAsSystemAdmin(page);
    await page.getByTestId('system-workspaces__enable-edit').click();
    await expect(page.getByTestId('system-workspaces__draft-name')).toHaveValue('Seeded Workspace');
    await expect(page.getByTestId('system-workspaces__basics')).toBeVisible();
    await expect(page).toHaveScreenshot('system-workspaces-edit-mode.png', { fullPage: true });
  });

  test('system workspaces create wizard', async ({ page, request }) => {
    await seedSystemWorkspaces(request, 'empty');
    await loginAsSystemAdmin(page);
    await page.getByTestId('system-workspaces__new-workspace').click();
    await page.waitForURL(/\/en-US\/system\/workspaces\/new/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
    await expect(page.getByTestId('system-workspace-create__shell')).toBeVisible();
    await expect(page.getByTestId('system-workspace-create__step-tracker')).toBeVisible();
    await expect(page).toHaveScreenshot('system-workspaces-create-wizard.png', { fullPage: true });
  });

  test('system workspaces failed state', async ({ page, request }) => {
    await seedSystemWorkspaces(request, 'with_failed_workspace');
    await loginAsSystemAdmin(page);
    await expect(page.getByTestId('system-workspaces__status')).toContainText('Failed');
    await expect(page.getByTestId('system-workspaces__status')).toContainText('identity_provider_config_incomplete');
    await expect(page.getByTestId('system-workspaces__read-only-notice')).toBeVisible();
    await expect(page).toHaveScreenshot('system-workspaces-failed-state.png', { fullPage: true });
  });

  test('system workspaces delete confirmation', async ({ page, request }) => {
    await seedSystemWorkspaces(request, 'with_disabled_workspace');
    await loginAsSystemAdmin(page);
    await page.getByTestId('system-workspaces__configure--ws_seeded').click();
    await expect(page.getByTestId('system-workspaces__delete')).toBeEnabled();
    await page.getByTestId('system-workspaces__delete').click();
    await expect(page.getByTestId('system-workspaces__delete-dialog')).toBeVisible();
    await expect(page.getByTestId('system-workspaces__delete-cancel')).toBeVisible();
    await expect(page.getByTestId('system-workspaces__delete-confirm')).toBeVisible();
    await expect(page).toHaveScreenshot('system-workspaces-delete-confirmation.png', { fullPage: true });
  });

});

// ─── Project Pages ──────────────────────────────────────────────────────────

test.describe('Visual - Project Pages', () => {

  test('chat - ultrawide', async ({ authedPage }) => {
    await authedPage.setViewportSize({ width: 2200, height: 1200 });
    await stableNavigate(authedPage, projectPath('chat'));
    await expect(authedPage.getByTestId('chat__surface')).toBeVisible();
    await expect(authedPage.getByTestId('chat__execution-target-trigger')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('chat-ultrawide.png', { fullPage: true });
  });

  test('notebook create task dialog - create new workspace', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('notebook'));
    await authedPage.getByTestId('notebook__create-task-btn').click();
    await expect(authedPage.getByRole('dialog')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('notebook-create-task-dialog.png', { fullPage: true });
  });

  test('notebook task detail', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('notebook/tasks/task_001'));
    await expect(authedPage.getByTestId('notebook__task-header')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('notebook-task-detail.png', { fullPage: true });
  });

  test('notebook task detail - artifact hover', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('notebook/tasks/task_001'));
    const firstArtifact = authedPage.getByTestId('notebook__artifact-card').first();
    await expect(firstArtifact).toBeVisible();
    await firstArtifact.hover();
    await expect(authedPage.getByTestId('notebook__artifact-hover-panel')).toBeVisible();
    await expect(authedPage).toHaveScreenshot('notebook-task-detail-artifact-hover.png', { fullPage: true });
  });

});

const THEMED_WALKTHROUGH_PAGES = [
  {
    name: 'overview',
    run: async (page: Page) => {
      await stableNavigate(page, projectPath('overview'));
      await expect(page.getByTestId('project-hub__summary')).toBeVisible();
      await expect(page.getByTestId('project-hub__use-summary')).toBeVisible();
      await expect(page.getByTestId('project-hub__governance-summary')).toBeVisible();
    },
  },
  {
    name: 'chat-standard',
    stableMarkers: ['chat__surface', 'chat__threads-pane', 'chat__main-pane', 'chat__header', 'chat__composer'],
    run: async (page: Page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await stableNavigate(page, projectPath('chat'));
      await expect(page.getByTestId('chat__surface')).toBeVisible();
      await expect(page.getByTestId('chat__threads-pane')).toBeVisible();
      await expect(page.getByTestId('chat__main-pane')).toBeVisible();
      await expect(page.getByTestId('chat__header')).toBeVisible();
      await expect(page.getByTestId('chat__composer')).toBeVisible();
    },
  },
  {
    name: 'notebook',
    run: async (page: Page) => {
      await stableNavigate(page, projectPath('notebook'));
      await expect(page.getByTestId('notebook__task-list')).toBeVisible();
    },
  },
  {
    name: 'files',
    stableMarkers: ['files__workspace-surface', 'files__workspace-grid', 'files__libraries-shell', 'files__browser-shell'],
    run: async (page: Page) => {
      await stableNavigate(page, projectPath('files'));
      await expect(page.getByTestId('files__workspace-surface')).toBeVisible();
      await expect(page.getByTestId('files__workspace-grid')).toBeVisible();
      await expect(page.getByTestId('files__libraries-shell')).toBeVisible();
      await expect(page.getByTestId('files__browser-shell')).toBeVisible();
    },
  },
  {
    name: 'alerts',
    stableMarkers: ['alerts__main-surface', 'alert-center-page', 'alert-center__summary-meta', 'alerts__open-audit', 'alerts__open-usage'],
    run: async (page: Page) => {
      await stableNavigate(page, projectPath('alerts'));
      await expect(page.getByTestId('alerts__main-surface')).toBeVisible();
      await expect(page.getByTestId('alert-center-page')).toBeVisible();
      await expect(page.getByTestId('alert-center__summary-meta')).toBeVisible();
      await expect(page.getByTestId('alerts__open-audit')).toBeVisible();
      await expect(page.getByTestId('alerts__open-usage')).toBeVisible();
    },
  },
] as const;

test.describe('Visual - Project Pages (Light/Dark)', () => {
  for (const theme of VISUAL_THEMES) {
    test.describe(`${theme} theme`, () => {
      for (const pageCase of THEMED_WALKTHROUGH_PAGES) {
        test(pageCase.name, async ({ authedPage }) => {
          await setVisualTheme(authedPage, theme);
          await pageCase.run(authedPage);
          if ('stableMarkers' in pageCase && pageCase.stableMarkers) {
            await waitForStableRecipeMarkers(authedPage, pageCase.name);
          }
          await expect(authedPage).toHaveScreenshot(themedScreenshotName(pageCase.name, theme), { fullPage: true });
        });
      }
    });
  }
});

const THEMED_PUBLIC_PAGES = [
  {
    name: 'join',
    path: '/en-US/join',
    run: async () => {},
  },
  {
    name: 'system-login',
    path: '/en-US/system/login',
    run: async (page: Page) => {
      await expect(page.getByTestId('system-login__heading')).toBeVisible();
    },
  },
  {
    name: 'workspace-select',
    path: '/en-US/login/workspace',
    run: async (page: Page) => {
      await expect(page.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'single');
      await expect(page.getByTestId('workspace-select__list')).toBeVisible();
      await expect(page.getByTestId('workspace-select__system-link')).toBeVisible();
    },
  },
  {
    name: 'workspace-login',
    path: `/en-US/workspaces/${WS_ID}/login`,
    run: async (page: Page) => {
      await expect(page.getByTestId('workspace-login__heading')).toBeVisible();
    },
  },
  {
    name: 'desktop-auth-request',
    path: '/en-US/desktop/auth/request',
    requiresMockAuthLane: true,
    run: async (page: Page) => {
      await expect(page.getByTestId('desktop-auth-request__title')).toHaveText('This Desktop handoff link is incomplete');
      await expect(page.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'split');
    },
  },
  {
    name: 'desktop-auth-complete',
    path: '/en-US/desktop/auth/complete?desktop_auth_request_id=req_visual_001',
    run: async (page: Page) => {
      await expect(page.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'single');
      await expect(page.getByTestId('desktop-auth-complete__request-meta')).toBeVisible();
      await expect(page.getByTestId('desktop-auth-complete__workspace-entry-link')).toBeVisible();
    },
  },
] as const;

const THEMED_WORKSPACE_PAGES_AUTHED = [
  {
    name: 'workspace-overview',
    path: '/en-US/workspaces/overview',
    run: async (page: Page) => {
      await expect(page.getByTestId('workspace-overview__heading')).toBeVisible();
    },
  },
  {
    name: 'workspace-home',
    path: `/en-US/workspaces/${WS_ID}`,
    run: async (page: Page) => {
      await expect(page.getByTestId('projects__page')).toBeVisible();
    },
  },
  {
    name: 'workspace-settings',
    path: `/en-US/workspaces/${WS_ID}/settings`,
    stableMarkers: ['ws-settings__summary-line', 'ws-settings__workspace', 'ws-settings__integrations', 'ws-settings__projects'],
    run: async (page: Page) => {
      await expect(page.getByTestId('ws-settings__summary-line')).toBeVisible();
      await expect(page.getByTestId('ws-settings__workspace')).toBeVisible();
      await expect(page.getByTestId('ws-settings__integrations')).toBeVisible();
      await expect(page.getByTestId('ws-settings__projects')).toBeVisible();
    },
  },
] as const;

const THEMED_SYSTEM_PAGES = [
  {
    name: 'system-workspaces',
    path: '/en-US/system/workspaces',
    run: async (page: Page) => {
      await expect(page.getByTestId('system-workspaces__list')).toBeVisible();
      await expect(page.getByTestId('system-workspaces__editor-empty')).toBeVisible();
    },
  },
  {
    name: 'system-info',
    path: '/en-US/system/info',
    run: async (page: Page) => {
      await expect(page.getByTestId('system-info__shell')).toBeVisible();
      await expect(page.getByTestId('system-info__health')).toBeVisible();
      await expect(page.getByTestId('system-info__next-steps')).toBeVisible();
    },
  },
] as const;

const THEMED_USER_PAGES = [
  {
    name: 'profile',
    path: `/en-US/user/profile?workspace=${WS_ID}&project=${PROJECT_ID}`,
    requiresMockAuthLane: true,
    run: async (page: Page) => {
      await expect(page.getByTestId('profile__save-btn')).toBeVisible();
    },
  },
  {
    name: 'api-keys',
    path: '/en-US/user/api-keys',
    requiresMockAuthLane: true,
    run: async (page: Page) => {
      await expect(page.getByTestId('api-keys__create-btn')).toBeVisible();
    },
  },
  {
    name: 'third-party-accounts',
    path: '/en-US/user/third-party-accounts',
    requiresMockAuthLane: true,
    run: async (page: Page) => {
      await expect(page.getByTestId('third-party-accounts__create-btn')).toBeVisible();
    },
  },
] as const;

const THEMED_GOVERNANCE_PAGES = [
  {
    name: 'agents',
    path: projectPath('agents'),
    run: async (page: Page) => {
      await expect(page.getByTestId('agents__create-btn')).toBeVisible();
    },
  },
  {
    name: 'endpoints',
    path: projectPath('endpoints'),
    run: async (page: Page) => {
      await expect(page.getByTestId('endpoints__create-btn')).toBeVisible();
    },
  },
  {
    name: 'credentials',
    path: projectPath('credentials'),
    run: async (page: Page) => {
      await expect(page.getByTestId('credentials__create-btn')).toBeVisible();
    },
  },
  {
    name: 'members',
    path: projectPath('members'),
    run: async (page: Page) => {
      await expect(page.getByTestId('members__invite-btn')).toBeVisible();
    },
  },
  {
    name: 'resource-policy',
    path: projectPath('resource-policy'),
    run: async (page: Page) => {
      await expect(page.getByTestId('resource-policy__table')).toBeVisible();
    },
  },
  {
    name: 'access-guide',
    path: projectPath('use-guide'),
    run: async (page: Page) => {
      await expect(page.getByTestId('use-guide__page')).toBeVisible();
    },
  },
  {
    name: 'audit',
    path: projectPath('audit'),
    run: async (page: Page) => {
      await expect(page.getByTestId('audit__table')).toBeVisible();
    },
  },
  {
    name: 'usage',
    path: projectPath('usage'),
    run: async (page: Page) => {
      await expect(page.getByTestId('usage__work-surface')).toBeVisible();
      await expect(page.getByTestId('usage__summary-line')).toBeVisible();
      await expect(page.getByTestId('usage__selected-endpoint')).toBeVisible();
      await expect(page.getByTestId('usage__trend')).toBeVisible();
    },
  },
  {
    name: 'settings',
    path: projectPath('settings'),
    stableMarkers: ['settings__summary-line', 'settings__general-section', 'settings__ownership-section', 'settings__project-admins-section'],
    run: async (page: Page) => {
      await expect(page.getByTestId('settings__summary-line')).toBeVisible();
      await expect(page.getByTestId('settings__general-section')).toBeVisible();
      await expect(page.getByTestId('settings__ownership-section')).toBeVisible();
      await expect(page.getByTestId('settings__project-admins-section')).toBeVisible();
    },
  },
] as const;

const THEMED_OVERLAY_CASES = [
  {
    name: 'audit-empty-state',
    path: `${projectPath('audit')}?resource_id=__visual_empty__`,
    setup: async (page: Page) => {
      await expect(page.getByTestId('audit-usage__empty-state')).toBeVisible();
    },
  },
  {
    name: 'members-join-requests-tab',
    path: projectPath('members'),
    setup: async (page: Page) => {
      await page.getByRole('tab', { name: /requests/i }).first().click();
      await expect(page.getByRole('tabpanel', { name: /requests/i })).toBeVisible();
    },
  },
  {
    name: 'dialog-create-agent',
    path: projectPath('agents'),
    setup: async (page: Page) => {
      await page.getByTestId('agents__create-btn').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  {
    name: 'dialog-files-create-folder',
    path: projectPath('files'),
    setup: async (page: Page) => {
      await expect(page.getByTestId('files__workspace-surface')).toBeVisible();
      await page.getByTestId('files__new-folder').click();
      await expect(page.getByTestId('files__dialog__new-folder')).toBeVisible();
    },
  },
] as const;

test.describe('Visual - Public Pages (Light/Dark)', () => {
  for (const theme of VISUAL_THEMES) {
    test.describe(`${theme} theme`, () => {
      for (const pageCase of THEMED_PUBLIC_PAGES) {
        test(pageCase.name, async ({ page }) => {
          if ('requiresMockAuthLane' in pageCase && pageCase.requiresMockAuthLane) {
            await requireMockVisualAuthLane(page);
          }
          if ('prepare' in pageCase && typeof pageCase.prepare === 'function') {
            await pageCase.prepare(page);
          }
          if (pageCase.authLane === 'public') {
            await resetPublicVisualState(page);
          }
          await setVisualTheme(page, theme);
          await stableNavigate(page, pageCase.path);
          await waitForStableRecipeMarkers(page, pageCase.name);
          await pageCase.run(page);
          await expect(page).toHaveScreenshot(themedScreenshotName(pageCase.name, theme), { fullPage: true });
        });
      }
    });
  }
});

test.describe('Visual - Workspace Pages (Light/Dark)', () => {
  for (const theme of VISUAL_THEMES) {
    test.describe(`${theme} theme`, () => {
      for (const pageCase of THEMED_WORKSPACE_PAGES_AUTHED) {
        test(pageCase.name, async ({ authedPage }) => {
          await setVisualTheme(authedPage, theme);
          await stableNavigate(authedPage, pageCase.path);
          if ('stableMarkers' in pageCase && pageCase.stableMarkers) {
            await waitForStableRecipeMarkers(authedPage, pageCase.name);
          }
          await pageCase.run(authedPage);
          await expect(authedPage).toHaveScreenshot(themedScreenshotName(pageCase.name, theme), { fullPage: true });
        });
      }

    });
  }
});

test.describe('Visual - System Pages (Light/Dark)', () => {
  for (const theme of VISUAL_THEMES) {
    test.describe(`${theme} theme`, () => {
      for (const pageCase of THEMED_SYSTEM_PAGES) {
        test(pageCase.name, async ({ page, request }) => {
          await seedSystemWorkspaces(request, pageCase.name === 'system-workspaces' ? 'empty' : 'with_failed_workspace');
          await setVisualTheme(page, theme);
          await loginAsSystemAdmin(page);
          await stableNavigate(page, pageCase.path);
          await pageCase.run(page);
          await expect(page).toHaveScreenshot(themedScreenshotName(pageCase.name, theme), { fullPage: true });
        });
      }
    });
  }
});

test.describe('Visual - User Pages (Light/Dark)', () => {
  for (const theme of VISUAL_THEMES) {
    test.describe(`${theme} theme`, () => {
      for (const pageCase of THEMED_USER_PAGES) {
        test(pageCase.name, async ({ authedPage, page }) => {
          const targetPage = pageCase.auth === 'plain' ? page : authedPage;
          if (pageCase.requiresMockAuthLane) {
            await requireMockVisualAuthLane(targetPage);
          }
          await setVisualTheme(targetPage, theme);
          await stableNavigate(targetPage, pageCase.path);
          await pageCase.run(targetPage);
          await expect(targetPage).toHaveScreenshot(themedScreenshotName(pageCase.name, theme), { fullPage: true });
        });
      }
    });
  }
});

test.describe('Visual - Governance Pages (Light/Dark)', () => {
  for (const theme of VISUAL_THEMES) {
    test.describe(`${theme} theme`, () => {
      for (const pageCase of THEMED_GOVERNANCE_PAGES) {
        test(pageCase.name, async ({ authedPage }) => {
          await setVisualTheme(authedPage, theme);
          await seedVisualTestNow(authedPage);
          await stableNavigate(authedPage, pageCase.path);
          if ('stableMarkers' in pageCase && pageCase.stableMarkers) {
            await waitForStableRecipeMarkers(authedPage, pageCase.name);
          }
          await pageCase.run(authedPage);
          await expect(authedPage).toHaveScreenshot(themedScreenshotName(pageCase.name, theme), { fullPage: true });
        });
      }
    });
  }
});

test.describe('Visual - Overlays (Light/Dark)', () => {
  for (const theme of VISUAL_THEMES) {
    test.describe(`${theme} theme`, () => {
      for (const pageCase of THEMED_OVERLAY_CASES) {
        test(pageCase.name, async ({ authedPage }) => {
          await setVisualTheme(authedPage, theme);
          await seedVisualTestNow(authedPage);
          await stableNavigate(authedPage, pageCase.path);
          await pageCase.setup(authedPage);
          await expect(authedPage).toHaveScreenshot(themedScreenshotName(pageCase.name, theme), { fullPage: true });
        });
      }
    });
  }
});

// ─── Dialog / Drawer Screenshots ────────────────────────────────────────────

test.describe('Visual - Overlays', () => {

  test('alerts - notifications tab', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('alerts'));
    await waitForStableRecipeMarkers(authedPage, 'alerts-notifications-tab');
    await expect(authedPage.getByTestId('alerts__main-surface')).toBeVisible();
    await expect(authedPage.getByTestId('alert-center-page')).toBeVisible();
    await expect(authedPage.getByTestId('alert-center__summary-meta')).toBeVisible();
    await authedPage.getByTestId('alerts__tab__notifications').click();
    await expect(authedPage.getByTestId('alert-notifications')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('alerts-notifications-tab.png', { fullPage: true });
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

  test('files - rename dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('files'));
    await dismissFilesOverlayIfPresent(authedPage);
    await expect(authedPage.getByTestId('files__workspace-surface')).toBeVisible();
    await expect(authedPage.getByText('Project Surface')).toHaveCount(0);
    await authedPage.waitForTimeout(1500);
    await authedPage.getByTestId('files__library-item--lib_shared_default').click();
    await authedPage.getByTestId('files__search').fill('README');
    const fileRow = authedPage.getByTestId('files__object-row').filter({ hasText: 'README.txt' }).first();
    await expect(fileRow).toBeVisible({ timeout: 10_000 });
    const rowButton = fileRow.locator('button').first();
    await expect(rowButton).toBeVisible({ timeout: 10_000 });
    await rowButton.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(authedPage.getByTestId('files__selection-summary')).toBeVisible();
    await expect(authedPage.getByTestId('files__selection-summary')).toContainText('1');
    const renameButton = authedPage.getByTestId('files__rename');
    await expect(renameButton).toBeEnabled();
    await renameButton.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(authedPage.getByTestId('files__dialog__move')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-files-rename.png');
  });

  test('files - selection with details panel', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('files'));
    await dismissFilesOverlayIfPresent(authedPage);
    await expect(authedPage.getByTestId('files__workspace-surface')).toBeVisible();
    await expect(authedPage.getByText('Project Surface')).toHaveCount(0);
    await authedPage.waitForTimeout(1500);
    await authedPage.getByTestId('files__library-item--lib_shared_default').click();
    await authedPage.getByTestId('files__search').fill('README');
    const fileRow = authedPage.getByTestId('files__object-row').filter({ hasText: 'README.txt' }).first();
    await expect(fileRow).toBeVisible({ timeout: 10_000 });
    const rowButton = fileRow.locator('button').first();
    await expect(rowButton).toBeVisible({ timeout: 10_000 });
    await rowButton.click({ force: true });
    await expect(authedPage.getByTestId('files__selection-summary')).toBeVisible();
    await expect(authedPage.getByTestId('files__details-shell')).toBeVisible();
    await expect(authedPage.getByTestId('files__details-panel')).toBeVisible();
    await expect(authedPage.getByTestId('files__details-inspector')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('files-selection-details.png', { fullPage: true });
  });

  test('files - mount access dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('files'));
    await dismissFilesOverlayIfPresent(authedPage);
    await expect(authedPage.getByTestId('files__workspace-surface')).toBeVisible();
    await expect(authedPage.getByText('Project Surface')).toHaveCount(0);
    await authedPage.waitForTimeout(1500);
    await authedPage.getByTestId('files__library-desktop-access--lib_shared_default').click();
    await expect(authedPage.getByTestId('files__dialog__desktop-mount-access')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-files-mount-access.png');
  });

  test('files - create library dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('files'));
    await dismissFilesOverlayIfPresent(authedPage);
    await expect(authedPage.getByTestId('files__workspace-surface')).toBeVisible();
    await authedPage.waitForTimeout(1200);
    await authedPage.getByTestId('files__library-create').click();
    await expect(authedPage.getByTestId('files__dialog__library-create')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-files-library-create.png');
  });

  test('files - delete non-empty library dialog', async ({ authedPage }) => {
    await stableNavigate(authedPage, projectPath('files'));
    await dismissFilesOverlayIfPresent(authedPage);
    await expect(authedPage.getByTestId('files__workspace-surface')).toBeVisible();
    await authedPage.waitForTimeout(1200);
    await authedPage
      .getByTestId('files__library-item--lib_shared_default')
      .getByRole('button', { name: /delete/i })
      .click();
    await expect(authedPage.getByTestId('files__dialog__library-delete')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('dialog-files-library-delete.png');
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
    await firstRow.click();
    const memberDrawer = authedPage.getByRole('dialog');
    await expect(memberDrawer).toBeVisible();
    await memberDrawer.getByRole('button', { name: /view.*history/i }).click({ force: true });
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

  test('usage - endpoint switch', async ({ authedPage }) => {
    await seedVisualTestNow(authedPage);
    await stableNavigate(authedPage, projectPath('usage'));
    await waitForStableRecipeMarkers(authedPage, 'usage-endpoint-switch');
    await expect(authedPage.getByTestId('usage__work-surface')).toBeVisible();
    await expect(authedPage.getByTestId('usage__summary-line')).toBeVisible();
    await expect(authedPage.getByTestId('usage__selected-endpoint')).toBeVisible();
    await expect(authedPage.getByTestId('usage__limits')).toBeVisible();
    await authedPage.waitForTimeout(400);
    await expect(authedPage).toHaveScreenshot('usage-endpoint-switch.png', { fullPage: true });
  });

});
