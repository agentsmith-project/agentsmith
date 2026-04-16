/**
 * Visual Regression Tests - Full Page Screenshots
 *
 * The executable visual scene list is derived from the committed mock-lane
 * story catalog via runtimeData.visualReview.scenes. This spec only owns the
 * page preparation registry needed to put a catalog scene into its screenshot
 * state.
 *
 * Run:   npx playwright test e2e/visual.spec.ts --project=visual
 * Update baselines: npx playwright test e2e/visual.spec.ts --project=visual --update-snapshots
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { ensureAuthenticatedSession, readMockAuthTokenFromContext, withAuth } from './fixtures/authenticated';
import { gotoAndWait, waitForPageReady } from './utils/navigation';
import { expectVisualSemanticAssertions } from './utils/semantic-assertions';
import { setVisualTheme } from './utils/visual-theme';
import {
  assertVisualBaselineActualUrlMatchesRoute,
  listVisualBaselineExecutorScenarios,
  type VisualBaselineAuthLane,
  type VisualBaselineCatalogEntry,
  type VisualBaselineExecutorScenario,
} from './visual-baseline-support';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '@/lib/mock-time';

const WS_ID = 'ws_default';
const test = base;

type VisualAuthOptions = {
  bootstrapPath?: string;
  wsId?: string;
  userEmail?: string;
  userId?: string;
};

type VisualScenarioContext = {
  page: Page;
  request: APIRequestContext;
  scenario: VisualBaselineExecutorScenario;
  entry: VisualBaselineCatalogEntry;
};

type VisualScreenshotOptions = {
  fullPage?: boolean;
  maxDiffPixelRatio?: number;
};

type VisualScenarioSetup = {
  authOptions?: VisualAuthOptions;
  beforeAuth?: (context: VisualScenarioContext) => Promise<void>;
  beforeNavigate?: (context: VisualScenarioContext) => Promise<void>;
  afterNavigate?: (context: VisualScenarioContext) => Promise<void>;
  screenshotOptions?: VisualScreenshotOptions;
};

/** Navigate and wait for page to settle before screenshot. */
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

  const mswBootMessage = page.getByText('Starting mocks...');
  if (await mswBootMessage.isVisible().catch(() => false)) {
    await mswBootMessage.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

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
    window.setTimeout(hideOverlays, 100);
  });
  await page.waitForTimeout(500);
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

async function seedSystemWorkspaces(
  request: APIRequestContext,
  state: 'empty' | 'with_workspace' | 'with_disabled_workspace' | 'with_failed_workspace',
) {
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

async function seedVisualTestNow(page: Page, iso = VISUAL_TEST_REFERENCE_NOW_ISO) {
  await page.addInitScript((nextNow) => {
    (window as Window & { __MBOS_TEST_NOW__?: string }).__MBOS_TEST_NOW__ = nextNow;
  }, iso);
  await page.evaluate((nextNow) => {
    (window as Window & { __MBOS_TEST_NOW__?: string }).__MBOS_TEST_NOW__ = nextNow;
  }, iso).catch(() => {});
}

async function seedJoinRequestNotifications(page: Page) {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/test/me/notifications/seed', {
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
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text().catch(() => ''),
    };
  });
  expect(result.ok, `notification seed failed: ${result.status} ${result.body}`).toBe(true);
}

async function waitForStableRecipeMarkers(page: Page, scenario: VisualBaselineExecutorScenario) {
  for (const marker of scenario.stableMarkers) {
    await expect(page.getByTestId(marker).first()).toBeVisible({ timeout: 15_000 });
  }
}

async function waitForNotebookTerminalTruthReady(page: Page) {
  await expect(page.getByTestId('notebook__task-header')).toHaveAttribute('data-terminal-truth-state', 'ready', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('notebook__task-terminal-truth-unavailable')).toHaveCount(0);
}

async function expectLocatorWithinViewport(page: Page, locator: Locator) {
  const [box, viewport] = await Promise.all([
    locator.boundingBox(),
    page.viewportSize(),
  ]);
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

async function resetPublicVisualState(page: Page) {
  await page.context().clearCookies().catch(() => {});
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  }).catch(() => {});
}

async function requireMockVisualRuntime(page: Page) {
  await stableNavigate(page, '/en-US/login/workspace');
  const useMsw = await page.evaluate(
    () => window.__MBOS_PUBLIC_RUNTIME_CONFIG__?.useMsw ?? false,
  ).catch(() => false);
  test.skip(!useMsw, 'Mock visual pages require NEXT_PUBLIC_USE_MSW=true.');
}

async function ensureVisualMockAuth(page: Page, options: VisualAuthOptions = {}) {
  const wsId = options.wsId ?? WS_ID;
  const userEmail = options.userEmail ?? 'test@example.com';
  const userId = options.userId ?? 'user_001';
  const bootstrapPath = options.bootstrapPath ?? `/en-US/workspaces/${wsId}/projects`;

  await requireMockVisualRuntime(page);
  const seed = await withAuth(page, wsId, userEmail, userId);
  await ensureAuthenticatedSession(page, bootstrapPath, {
    wsId,
    userEmail,
    userId,
  });
  return seed;
}

async function prepareVisualAuthLane(page: Page, authLane: VisualBaselineAuthLane, options: VisualAuthOptions = {}) {
  if (authLane === 'public') {
    await requireMockVisualRuntime(page);
    await resetPublicVisualState(page);
    return;
  }
  if (authLane === 'system_admin') {
    await requireMockVisualRuntime(page);
    await resetPublicVisualState(page);
    await loginAsSystemAdmin(page);
    return;
  }
  if (authLane === 'guest') {
    await ensureVisualMockAuth(page, {
      ...options,
      userEmail: options.userEmail ?? 'guest@example.com',
      userId: options.userId ?? 'user_009',
    });
    return;
  }
  if (authLane === 'mock_auth' || authLane === 'authed') {
    await ensureVisualMockAuth(page, options);
    return;
  }
  throw new Error(`Unsupported visual auth lane: ${authLane}`);
}

async function createThirdPartyVisualConnection(page: Page) {
  await expect(page.getByTestId('third-party-accounts__create-btn')).toBeVisible();
  await page.getByTestId('third-party-accounts__create-btn').click();
  await expect(page.getByTestId('third-party-accounts__sheet')).toBeVisible();
  await page.getByTestId('third-party-accounts__provider-select').selectOption('custom');
  await page.getByTestId('third-party-accounts__custom-domain').fill('api.visual.example.com');
  await page.getByTestId('third-party-accounts__display-name').fill('Visual Custom Integration');
  await page.getByTestId('third-party-accounts__note').fill('Visual seed');
  await page.getByTestId('third-party-accounts__field-key-0').fill('base_url');
  await page.getByTestId('third-party-accounts__field-value-0').fill('https://api.visual.example.com');
  await page.getByTestId('third-party-accounts__field-description-0').fill('Base URL');
  await page.getByTestId('third-party-accounts__add-field').click();
  await page.getByTestId('third-party-accounts__field-key-1').fill('token');
  await page.getByTestId('third-party-accounts__field-value-1').fill('tok-visual-secret');
  await page.getByTestId('third-party-accounts__field-description-1').fill('API token');
  await page.getByTestId('third-party-accounts__submit-btn').click();
  const connectionRow = page.locator('[data-testid^="third-party-accounts__row-"]').filter({
    hasText: 'Visual Custom Integration',
  }).first();
  await expect(connectionRow).toBeVisible();
  await connectionRow.click();
  await expect(page.getByTestId('third-party-accounts__sheet')).toBeVisible();
}

async function selectReadmeFile(page: Page) {
  await dismissFilesOverlayIfPresent(page);
  await expect(page.getByTestId('files__workspace-surface')).toBeVisible();
  await expect(page.getByText('Project Surface')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.getByTestId('files__library-item--lib_shared_default').click();
  await page.getByTestId('files__search').fill('README');
  const fileRow = page.getByTestId('files__object-row').filter({ hasText: 'README.txt' }).first();
  await expect(fileRow).toBeVisible({ timeout: 10_000 });
  const rowButton = fileRow.locator('button').first();
  await expect(rowButton).toBeVisible({ timeout: 10_000 });
  await rowButton.click({ force: true });
  await expect(page.getByTestId('files__selection-summary')).toBeVisible();
}

async function openAuditDetailDrawer(page: Page) {
  const table = page.getByTestId('audit__table');
  await expect(table).toBeVisible();
  const firstRow = table.getByTestId('audit__table__row').first();
  await firstRow.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /view details/i }).click();
  await expect(page.getByTestId('audit__detail-summary')).toBeVisible();
}

async function openMemberEffectiveAccessDrawer(page: Page) {
  await page.getByRole('row', { name: /Charlie Wilson/i }).click();
  const memberSurface = await page.getByRole('dialog').isVisible().catch(() => false)
    ? page.getByRole('dialog')
    : page;
  const authorizationCheck = memberSurface.getByTestId('member-detail__authorization-check').first();
  const authorizeResourceId = memberSurface.getByTestId('member-detail__authorize-resource-id').first();
  const authorizeRun = memberSurface.getByTestId('member-detail__authorize-run').first();
  const authorizeResult = memberSurface.getByTestId('member-detail__authorize-result').first();
  await expect(authorizationCheck).toBeVisible();
  await authorizeResourceId.fill('endpoint_001');
  await authorizeRun.click();
  await expect(authorizeResult).toBeVisible();
}

const VISUAL_SCENE_SETUP_REGISTRY: Partial<Record<string, VisualScenarioSetup>> = {
  'access-guide': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('use-guide__page')).toBeVisible();
    },
  },
  agents: {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agents__create-btn')).toBeVisible();
    },
  },
  'alerts-notifications-tab': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('alerts__tab__notifications').click();
      await expect(page.getByTestId('alert-notifications')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'alerts-rule-create-dialog': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('alerts__tab__rules').click();
      await expect(page.getByTestId('alert-rules-list__surface')).toBeVisible();
      await page.getByTestId('alert-center__create-button').click();
      await expect(page.getByTestId('alert-rule-form-dialog')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'alerts-rules-tab': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('alerts__tab__rules').click();
      await expect(page.getByTestId('alert-rules-list__surface')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'api-keys-create-dialog': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('api-keys__create-btn')).toBeVisible();
      await page.getByTestId('api-keys__create-btn').click();
      await expect(page.getByTestId('api-keys__create-dialog')).toBeVisible();
    },
  },
  'api-keys-key-created-dialog': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('api-keys__create-btn')).toBeVisible();
      await page.getByTestId('api-keys__create-btn').click();
      const dialog = page.getByTestId('api-keys__create-dialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('input').first().fill('Visual API Key');
      await dialog.getByRole('button', { name: /create/i }).click();
      await expect(page.getByTestId('api-keys__key-created-dialog')).toBeVisible();
    },
  },
  'audit-empty-state': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('audit-usage__empty-state')).toBeVisible();
    },
  },
  'chat-operate': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('chat__execution-target-trigger')).toBeVisible();
    },
  },
  'chat-recover-empty': {
    afterNavigate: async ({ page }) => {
      await page.getByPlaceholder('Search threads...').fill('zzzzzz-no-match');
    },
  },
  'chat-ultrawide': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('chat__surface')).toBeVisible();
      await expect(page.getByTestId('chat__execution-target-trigger')).toBeVisible();
    },
  },
  credentials: {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('credentials__create-btn')).toBeVisible();
      await expect(page.getByTestId('credentials__capability-note')).toBeVisible();
      await expect(page.getByTestId('credentials__summary-count')).toBeVisible();
      const rotatedChip = page.getByTestId('credentials__summary-rotated');
      await expect(rotatedChip).toBeVisible();
      await expect(rotatedChip).not.toContainText(/credentials\./i);
      await expect(page.getByTestId('credentials__summary-types')).toBeVisible();
    },
  },
  'desktop-auth-complete': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'single');
      await expect(page.getByTestId('desktop-auth-complete__request-meta')).toBeVisible();
      await expect(page.getByTestId('desktop-auth-complete__workspace-entry-link')).toBeVisible();
    },
  },
  'desktop-auth-request': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('desktop-auth-request__title')).toHaveText('This Desktop handoff link is incomplete');
      await expect(page.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'split');
    },
  },
  'dialog-create-agent': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('agents__create-btn').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  'dialog-create-credential': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('credentials__create-btn').click();
      await page.waitForTimeout(400);
    },
  },
  'dialog-create-endpoint': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('endpoints__create-btn').click();
      await page.waitForTimeout(400);
    },
  },
  'dialog-edit-endpoint': {
    afterNavigate: async ({ page }) => {
      const firstRow = page.getByTestId('endpoints__table__row').first();
      await expect(firstRow).toBeVisible();
      await firstRow.getByRole('button', { name: /edit/i }).click();
      await expect(page.getByTestId('endpoints__edit-dialog')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'dialog-files-create-folder': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('files__workspace-surface')).toBeVisible();
      await page.getByTestId('files__new-folder').click();
      await expect(page.getByTestId('files__dialog__new-folder')).toBeVisible();
    },
  },
  'dialog-files-library-create': {
    afterNavigate: async ({ page }) => {
      await dismissFilesOverlayIfPresent(page);
      await expect(page.getByTestId('files__workspace-surface')).toBeVisible();
      await page.waitForTimeout(1200);
      await page.getByTestId('files__library-create').click();
      await expect(page.getByTestId('files__dialog__library-create')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'dialog-files-library-delete': {
    afterNavigate: async ({ page }) => {
      await dismissFilesOverlayIfPresent(page);
      await expect(page.getByTestId('files__workspace-surface')).toBeVisible();
      await page.waitForTimeout(1200);
      await page
        .getByTestId('files__library-item--lib_shared_default')
        .getByRole('button', { name: /delete/i })
        .click();
      await expect(page.getByTestId('files__dialog__library-delete')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'dialog-files-mount-access': {
    afterNavigate: async ({ page }) => {
      await dismissFilesOverlayIfPresent(page);
      await expect(page.getByTestId('files__workspace-surface')).toBeVisible();
      await expect(page.getByText('Project Surface')).toHaveCount(0);
      await page.waitForTimeout(1500);
      await page.getByTestId('files__library-desktop-access--lib_shared_default').click();
      await expect(page.getByTestId('files__dialog__desktop-mount-access')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'dialog-files-rename': {
    afterNavigate: async ({ page }) => {
      await selectReadmeFile(page);
      await expect(page.getByTestId('files__selection-summary')).toContainText('1');
      const renameButton = page.getByTestId('files__rename');
      await expect(renameButton).toBeEnabled();
      await renameButton.evaluate((node) => {
        (node as HTMLButtonElement).click();
      });
      await expect(page.getByTestId('files__dialog__move')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'dialog-invite-member': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('members__invite-btn').click();
      await page.waitForTimeout(400);
    },
  },
  'dialog-project-join-now': {
    afterNavigate: async ({ page }) => {
      await page.getByRole('button', { name: 'Customer Support Bot' }).click();
      await expect(page.getByTestId('projects__join-now-dialog')).toBeVisible();
    },
  },
  'dialog-project-join-request': {
    afterNavigate: async ({ page }) => {
      await page.getByRole('button', { name: 'AI Assistant Project' }).click();
      await expect(page.getByTestId('projects__join-request-dialog')).toBeVisible();
    },
  },
  'drawer-audit-detail': {
    afterNavigate: async ({ page }) => {
      await openAuditDetailDrawer(page);
      await page.waitForTimeout(400);
    },
  },
  endpoints: {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('endpoints__create-btn')).toBeVisible();
    },
  },
  'files-selection-details': {
    afterNavigate: async ({ page }) => {
      await selectReadmeFile(page);
      await expect(page.getByTestId('files__details-shell')).toBeVisible();
      await expect(page.getByTestId('files__details-panel')).toBeVisible();
      await expect(page.getByTestId('files__details-inspector')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'members-change-history-dialog': {
    afterNavigate: async ({ page }) => {
      const firstRow = page.getByTestId('members__table__row').first();
      await expect(firstRow).toBeVisible();
      await firstRow.click();
      const memberDrawer = page.getByRole('dialog');
      await expect(memberDrawer).toBeVisible();
      await memberDrawer.getByRole('button', { name: /view.*history/i }).click({ force: true });
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByText(/no change history available/i)).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'members-effective-access-drawer': {
    afterNavigate: async ({ page }) => {
      await openMemberEffectiveAccessDrawer(page);
      await page.waitForTimeout(400);
    },
  },
  'members-join-requests-tab': {
    afterNavigate: async ({ page }) => {
      await page.getByRole('tab', { name: /requests/i }).first().click();
      await expect(page.getByRole('tabpanel', { name: /requests/i })).toBeVisible();
    },
  },
  'members-project-groups': {
    afterNavigate: async ({ page }) => {
      await page.getByRole('tab', { name: /groups/i }).first().click();
      const saveButton = page.getByTestId('members__group-save-btn');
      await expect(saveButton).toBeVisible();
      await expectLocatorWithinViewport(page, saveButton);
      await page.waitForTimeout(400);
    },
  },
  notebook: {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('notebook__task-list')).toBeVisible();
    },
  },
  'notebook-create-task-dialog': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('notebook__create-task-btn').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  'notebook-task-detail': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('notebook__task-header')).toBeVisible();
      await waitForNotebookTerminalTruthReady(page);
    },
  },
  'notebook-task-detail-artifact-hover': {
    afterNavigate: async ({ page }) => {
      await waitForNotebookTerminalTruthReady(page);
      const firstArtifact = page.getByTestId('notebook__artifact-card').first();
      await expect(firstArtifact).toBeVisible();
      await firstArtifact.hover();
      await expect(page.getByTestId('notebook__artifact-hover-panel')).toBeVisible();
    },
  },
  'notebook-task-lifecycle-artifact': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('notebook__task-header')).toBeVisible();
      await waitForNotebookTerminalTruthReady(page);
      const artifact = page.getByTestId('notebook__artifact-card').first();
      await expect(artifact).toBeVisible();
      await artifact.hover();
      await expect(page.getByTestId('notebook__artifact-hover-panel')).toBeVisible();
    },
  },
  'notebook-task-lifecycle-create-dialog': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('notebook__create-task-btn')).toBeVisible();
      await page.getByTestId('notebook__create-task-btn').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  'notebook-task-lifecycle-detail': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('notebook__task-header')).toBeVisible();
      await waitForNotebookTerminalTruthReady(page);
      await expect(page.getByTestId('notebook__conversation-input')).toBeVisible();
      await expect(page.getByTestId('notebook__send-btn')).toBeVisible();
    },
  },
  'notebook-task-lifecycle-list': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('notebook__task-list')).toBeVisible();
      await expect(page.getByTestId('notebook__task-card').first()).toBeVisible();
      await expect(page.getByTestId('notebook__create-task-btn')).toBeVisible();
    },
  },
  'notification-center-join-request': {
    authOptions: {
      userEmail: 'guest@example.com',
      userId: 'user_009',
    },
    beforeNavigate: async ({ page }) => {
      await seedJoinRequestNotifications(page);
    },
    afterNavigate: async ({ page }) => {
      await page.getByTestId('topbar__notifications').click();
      await expect(page.getByTestId('topbar__notifications-dropdown')).toBeVisible();
    },
  },
  'projects-empty': {
    authOptions: {
      wsId: 'ws_test',
      bootstrapPath: '/en-US/workspaces/ws_test/projects',
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByText('No projects yet')).toBeVisible();
    },
  },
  'projects-list': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('projects__page')).toBeVisible();
    },
  },
  'projects-list-public-discovery': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByText('Research Project')).not.toBeVisible();
      await expect(page.getByTestId('projects__join-request-btn--proj_001')).toBeVisible();
      await expect(page.getByTestId('projects__join-project-btn--proj_003')).toBeVisible();
    },
  },
  'resource-policy': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('resource-policy__table')).toBeVisible();
    },
  },
  'system-info': {
    beforeAuth: async ({ request }) => {
      await seedSystemWorkspaces(request, 'with_failed_workspace');
    },
  },
  'system-login': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('system-login__heading')).toBeVisible();
    },
  },
  'system-workspaces-empty': {
    beforeAuth: async ({ request }) => {
      await seedSystemWorkspaces(request, 'empty');
    },
  },
  'system-workspaces-default': {
    beforeAuth: async ({ request }) => {
      await seedSystemWorkspaces(request, 'with_workspace');
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('system-workspaces__list')).toBeVisible();
      await expect(page.getByTestId('system-workspaces__editor')).toBeVisible();
      await expect(page.getByTestId('system-workspaces__read-only-notice')).toBeVisible();
      await expect(page.getByTestId('system-workspaces__new-workspace')).toHaveAttribute(
        'data-visual-prominence',
        'primary',
      );
    },
  },
  'system-workspaces-create-wizard': {
    beforeAuth: async ({ request }) => {
      await seedSystemWorkspaces(request, 'empty');
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
      await expect(page.getByTestId('system-workspace-create__shell')).toBeVisible();
      await expect(page.getByTestId('system-workspace-create__step-tracker')).toBeVisible();
    },
  },
  'system-workspaces-delete-confirmation': {
    beforeAuth: async ({ request }) => {
      await seedSystemWorkspaces(request, 'with_disabled_workspace');
    },
    afterNavigate: async ({ page }) => {
      await page.getByTestId('system-workspaces__configure--ws_seeded').click();
      await expect(page.getByTestId('system-workspaces__delete')).toBeEnabled();
      await page.getByTestId('system-workspaces__delete').click();
      await expect(page.getByTestId('system-workspaces__delete-dialog')).toBeVisible();
      await expect(page.getByTestId('system-workspaces__delete-cancel')).toBeVisible();
      await expect(page.getByTestId('system-workspaces__delete-confirm')).toBeVisible();
    },
  },
  'system-workspaces-edit-mode': {
    beforeAuth: async ({ request }) => {
      await seedSystemWorkspaces(request, 'with_workspace');
    },
    afterNavigate: async ({ page }) => {
      await page.getByTestId('system-workspaces__enable-edit').click();
      await expect(page.getByTestId('system-workspaces__draft-name')).toHaveValue('Seeded Workspace');
      await expect(page.getByTestId('system-workspaces__basics')).toBeVisible();
    },
  },
  'system-workspaces-failed-state': {
    beforeAuth: async ({ request }) => {
      await seedSystemWorkspaces(request, 'with_failed_workspace');
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('system-workspaces__status')).toContainText('Failed');
      await expect(page.getByTestId('system-workspaces__status')).toContainText('identity_provider_config_incomplete');
      await expect(page.getByTestId('system-workspaces__read-only-notice')).toBeVisible();
    },
  },
  'third-party-accounts-create-sheet': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('third-party-accounts__create-btn')).toBeVisible();
      await page.getByTestId('third-party-accounts__create-btn').click();
      await expect(page.getByTestId('third-party-accounts__sheet')).toBeVisible();
    },
  },
  'third-party-accounts-edit-sheet': {
    afterNavigate: async ({ page }) => {
      await createThirdPartyVisualConnection(page);
    },
  },
  usage: {
    beforeNavigate: async ({ page }) => {
      await seedVisualTestNow(page);
    },
  },
  'usage-endpoint-switch': {
    beforeNavigate: async ({ page }) => {
      await seedVisualTestNow(page);
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('usage__limits')).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  'workspace-connections-feishu-connected': {
    beforeNavigate: async ({ page }) => {
      await seedVisualFeishuState(page, {
        status: 'enabled',
        appId: 'cli_visual_demo',
        redirectUri: `http://localhost:3001/workspaces/${WS_ID}/feishu/callback`,
        verifiedByEmail: 'visual.admin@example.com',
        connectedEmail: 'visual.tester@example.com',
      });
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('workspace-connections__feishu-connect')).toBeVisible();
      await expect(page.getByTestId('workspace-connections__capability-note')).toBeVisible();
      await expect(page.getByTestId('workspace-connections__personal-state')).toContainText('workspace default connection');
      await expect(page.getByTestId('workspace-connections__resolver-note')).toContainText('Project resolution can still differ');
    },
    screenshotOptions: {
      maxDiffPixelRatio: 0,
    },
  },
  'workspace-connections-feishu-disabled': {
    beforeNavigate: async ({ page }) => {
      await seedVisualFeishuState(page, { status: 'not_configured' });
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('workspace-connections__feishu-connect')).toBeVisible();
      await expect(page.getByTestId('workspace-connections__capability-note')).toBeVisible();
      await expect(page.getByTestId('workspace-connections__personal-state')).toContainText('workspace default connection');
      await expect(page.getByTestId('workspace-connections__resolver-note')).toContainText('Project resolution can still differ');
    },
    screenshotOptions: {
      maxDiffPixelRatio: 0,
    },
  },
  'workspace-feishu-locked': {
    beforeNavigate: async ({ page }) => {
      await seedVisualFeishuState(page, {
        status: 'enabled',
        appId: 'cli_visual_demo',
        redirectUri: `http://localhost:3001/workspaces/${WS_ID}/feishu/callback`,
        verifiedByEmail: 'visual.admin@example.com',
      });
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('ws-feishu__locked')).toBeVisible();
    },
  },
  'workspace-feishu-setup-credentials': {
    beforeNavigate: async ({ page }) => {
      await seedVisualFeishuState(page, { status: 'not_configured' });
    },
  },
  'workspace-home': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('projects__page')).toBeVisible();
    },
  },
  'workspace-home-project-creator': {
    authOptions: {
      userEmail: 'dev2@corp.com',
      userId: 'u_2',
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('projects__page')).toBeVisible();
      await expect(page.getByTestId('projects__create-btn')).toBeVisible();
      await expect(page.getByTestId('projects__back-to-workspace')).toHaveCount(0);
    },
  },
  'workspace-overview': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('workspace-overview__heading')).toBeVisible();
      await expect(page.getByTestId('workspace-overview__list')).toBeVisible();
      await expect(page.getByTestId('workspace-overview__summary')).toBeVisible();
    },
    screenshotOptions: {
      maxDiffPixelRatio: 0,
    },
  },
  'workspace-settings-create-project': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('ws-settings__create-project').click();
      await expect(page.getByRole('heading', { name: /Create Project/i })).toBeVisible();
    },
  },
  'workspace-settings-feishu-enabled': {
    beforeNavigate: async ({ page }) => {
      await seedVisualFeishuState(page, {
        status: 'enabled',
        appId: 'cli_visual_demo',
        redirectUri: `http://localhost:3001/workspaces/${WS_ID}/feishu/callback`,
        verifiedByEmail: 'visual.admin@example.com',
      });
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('ws-settings__integration-feishu')).toBeVisible();
    },
  },
};

function screenshotOptionsFor(
  entry: VisualBaselineCatalogEntry,
  scenario: VisualBaselineExecutorScenario,
  setup: VisualScenarioSetup | undefined,
): VisualScreenshotOptions {
  return {
    ...(entry.capture === 'full_page' ? { fullPage: true } : {}),
    ...(scenario.semanticAssertions.requiredViewportTestIds.length > 0 ? { maxDiffPixelRatio: 0 } : {}),
    ...(setup?.screenshotOptions ?? {}),
  };
}

async function applyCatalogViewport(page: Page, scenario: VisualBaselineExecutorScenario) {
  if (scenario.setupNotes.includes('viewport:1440x900')) {
    await page.setViewportSize({ width: 1440, height: 900 });
    return;
  }
  if (scenario.viewport === 'ultrawide') {
    await page.setViewportSize({ width: 2200, height: 1200 });
  }
}

function resolveRunBoundActualCaptureRoot(): string | null {
  const explicitRoot = process.env.VISUAL_BASELINE_ACTUAL_CAPTURE_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  const buildInfoPath = process.env.VISUAL_BASELINE_BUILD_INFO_FILE?.trim();
  if (!buildInfoPath) {
    return null;
  }

  return path.resolve(path.dirname(buildInfoPath), 'visual-actual-captures');
}

async function writeRunBoundActualCapture(args: {
  page: Page;
  scenario: VisualBaselineExecutorScenario;
  entry: VisualBaselineCatalogEntry;
  screenshotOptions: VisualScreenshotOptions;
}) {
  const captureRoot = resolveRunBoundActualCaptureRoot();
  if (!captureRoot) {
    return;
  }

  const targetPath = path.join(captureRoot, args.scenario.scenarioId, args.entry.screenshot);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  await args.page.screenshot({
    path: targetPath,
    ...(args.screenshotOptions.fullPage ? { fullPage: true } : {}),
  });
}

async function runVisualScenario(context: VisualScenarioContext) {
  const { page, scenario, entry } = context;
  const setup = VISUAL_SCENE_SETUP_REGISTRY[scenario.scenarioId];
  const screenshotOptions = screenshotOptionsFor(entry, scenario, setup);

  await setup?.beforeAuth?.(context);
  await prepareVisualAuthLane(page, scenario.authLane, setup?.authOptions);
  await applyCatalogViewport(page, scenario);
  await setup?.beforeNavigate?.(context);

  if (entry.theme !== 'default') {
    await setVisualTheme(page, entry.theme);
  }

  await stableNavigate(page, scenario.route);
  assertVisualBaselineActualUrlMatchesRoute({
    scenarioId: scenario.scenarioId,
    expectedRoute: scenario.route,
    actualUrl: page.url(),
  });

  await setup?.afterNavigate?.(context);
  assertVisualBaselineActualUrlMatchesRoute({
    scenarioId: scenario.scenarioId,
    expectedRoute: scenario.route,
    actualUrl: page.url(),
  });

  await waitForStableRecipeMarkers(page, scenario);
  await expectVisualSemanticAssertions(page, scenario.semanticAssertions, scenario.scenarioId);
  await expect(page).toHaveScreenshot(entry.screenshot, screenshotOptions);
  await writeRunBoundActualCapture({
    page,
    scenario,
    entry,
    screenshotOptions,
  });
}

test.describe('Visual Auth Contract', () => {
  test('desktop-auth-request public missing-link recovery does not trigger auth bootstrap', async ({ page }) => {
    await requireMockVisualRuntime(page);
    await resetPublicVisualState(page);
    await stableNavigate(page, '/en-US/desktop/auth/request');

    await expect(page.getByTestId('desktop-auth-request__title')).toHaveText('This Desktop handoff link is incomplete');
    await expect(page.getByTestId('public-auth__shell')).toHaveAttribute('data-layout', 'split');
    await expect(await readMockAuthTokenFromContext(page)).toBeNull();
  });

  test('mock_auth visual bootstrap creates a complete token seed before protected navigation', async ({ page }) => {
    const seed = await ensureVisualMockAuth(page, {
      bootstrapPath: `/en-US/workspaces/${WS_ID}/projects`,
      userEmail: 'test@example.com',
      userId: 'user_001',
    });

    expect(seed.token).toMatch(/^mock_token_user_001__/);
    await expect(page.getByTestId('projects__page')).toBeVisible({ timeout: 30_000 });
    await expect(await readMockAuthTokenFromContext(page)).toBe(seed.token);
  });
});

test.describe('Visual - Story Catalog Scenes', () => {
  for (const scenario of listVisualBaselineExecutorScenarios()) {
    test.describe(`${scenario.group} / ${scenario.scenarioId}`, () => {
      for (const entry of scenario.entries) {
        test(`${scenario.scenarioId} [${entry.theme}]`, async ({ page, request }) => {
          await runVisualScenario({
            page,
            request,
            scenario,
            entry,
          });
        });
      }
    });
  }
});
