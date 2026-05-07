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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
const VISUAL_CHAT_RUNTIME_SESSION_ID = 'session_001';
const VISUAL_CHAT_ESCALATION_DELAY_MS = 30_000;
const VISUAL_AGENT_TASK_CANCEL_ESCALATION_DELAY_MS = 30_000;
const VISUAL_AGENT_TASK_SSE_RECONNECT_DELAY_MS = 3_000;
const VISUAL_AGENT_TASK_LONG_LATEST_ACTION =
  'python scripts/run_agent_task_recovery_probe.py --workspace very-long-workspace-name --project very-long-project-name --task very-long-task-name --with-many-flags --and-extra-operator-context --final-marker';
const test = base;
type ScreenshotComparator = (
  actual: Buffer,
  expected: Buffer,
  options: {
    comparator?: string;
    maxDiffPixels?: number;
    maxDiffPixelRatio?: number;
    threshold?: number;
  },
) => { errorMessage: string; diff?: Buffer } | null;
type ScreenshotPngCodec = {
  sync: {
    read: (buffer: Buffer) => {
      width: number;
      height: number;
      data: Buffer;
    };
    write: (png: { width: number; height: number; data: Buffer }) => Buffer;
  };
};
let screenshotComparatorPromise: Promise<ScreenshotComparator> | null = null;
let screenshotPngCodecPromise: Promise<ScreenshotPngCodec> | null = null;

function getScreenshotComparator(): Promise<ScreenshotComparator> {
  if (!screenshotComparatorPromise) {
    screenshotComparatorPromise = import(
      pathToFileURL(path.resolve(process.cwd(), 'node_modules/playwright-core/lib/server/utils/comparators.js')).href
    ).then((module) => {
      const getComparator = (module as { getComparator: (mimeType: string) => ScreenshotComparator }).getComparator;
      return getComparator('image/png');
    });
  }
  return screenshotComparatorPromise;
}

function getScreenshotPngCodec(): Promise<ScreenshotPngCodec> {
  if (!screenshotPngCodecPromise) {
    screenshotPngCodecPromise = import(
      pathToFileURL(path.resolve(process.cwd(), 'node_modules/playwright-core/lib/utilsBundle.js')).href
    ).then((module) => (module as { PNG: ScreenshotPngCodec }).PNG);
  }
  return screenshotPngCodecPromise;
}

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
  maskTestIds?: string[];
  stabilizeAttempts?: number;
  stabilizeDelayMs?: number;
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
      document.querySelectorAll('[data-testid="agent-tasks__sse-debug-panel"]').forEach((panel) => {
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

async function seedVisualMswHeaders(page: Page, headers: Record<string, string>) {
  await page.addInitScript((nextHeaders) => {
    const win = window as Window & { __MBOS_MSW_TEST_HEADERS__?: Record<string, string> };
    win.__MBOS_MSW_TEST_HEADERS__ = {
      ...(win.__MBOS_MSW_TEST_HEADERS__ ?? {}),
      ...nextHeaders,
    };
  }, headers);
  await page.evaluate((nextHeaders) => {
    const win = window as Window & { __MBOS_MSW_TEST_HEADERS__?: Record<string, string> };
    win.__MBOS_MSW_TEST_HEADERS__ = {
      ...(win.__MBOS_MSW_TEST_HEADERS__ ?? {}),
      ...nextHeaders,
    };
  }, headers).catch(() => {});
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
  await seedVisualMswHeaders(page, headers);
}

async function seedVisualTestNow(page: Page, iso = VISUAL_TEST_REFERENCE_NOW_ISO) {
  await page.addInitScript((nextNow) => {
    (window as Window & { __MBOS_TEST_NOW__?: string }).__MBOS_TEST_NOW__ = nextNow;
  }, iso);
  await page.evaluate((nextNow) => {
    (window as Window & { __MBOS_TEST_NOW__?: string }).__MBOS_TEST_NOW__ = nextNow;
  }, iso).catch(() => {});
}

async function installVisualMotionFreeze(page: Page) {
  await page.addInitScript(() => {
    type MotionFreezeWindow = Window & {
      __agsVisualMotionFreezeInstalled?: boolean;
      __agsVisualMotionFreezeObserver?: MutationObserver;
    };

    const STYLE_ID = 'ags-visual-disable-motion';
    const win = window as MotionFreezeWindow;
    const install = () => {
      document.documentElement.setAttribute('data-visual-motion', 'disabled');
      if (document.getElementById(STYLE_ID)) {
        return;
      }
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          scroll-behavior: auto !important;
        }
      `;
      (document.head ?? document.documentElement).appendChild(style);
    };

    install();
    if (!win.__agsVisualMotionFreezeObserver) {
      win.__agsVisualMotionFreezeObserver = new MutationObserver(() => install());
      win.__agsVisualMotionFreezeObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    win.__agsVisualMotionFreezeInstalled = true;
  });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-visual-motion', 'disabled');
  }).catch(() => {});
}

async function prepareStableVisualChatSurface(page: Page) {
  await seedVisualTestNow(page);
  await installVisualMotionFreeze(page);
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

function extractVisualRouteWorkspaceId(route: string): string | null {
  const match = route.match(/^\/[a-z]{2}(?:-[A-Z]{2})?\/workspaces\/([^/?#]+)/);
  const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : '';
  if (!workspaceId || workspaceId === 'overview') {
    return null;
  }
  return workspaceId;
}

function resolveVisualFixtureWorkspaceName(workspaceId: string): string | null {
  if (workspaceId === WS_ID) {
    return 'Default Workspace';
  }
  if (workspaceId === 'ws_test') {
    return 'Test Workspace';
  }
  return null;
}

async function waitForVisualRouteWorkspaceIdentityReady(page: Page, scenario: VisualBaselineExecutorScenario) {
  const workspaceId = extractVisualRouteWorkspaceId(scenario.route);
  if (!workspaceId) {
    return;
  }

  const switcher = page.getByTestId('topbar__workspace-switcher');
  if (!(await switcher.isVisible().catch(() => false))) {
    return;
  }

  const expectedName = resolveVisualFixtureWorkspaceName(workspaceId);
  if (expectedName) {
    await expect(switcher).toContainText(expectedName, { timeout: 15_000 });
    return;
  }

  await expect(switcher).not.toContainText(/Select Workspace|选择工作空间/, { timeout: 15_000 });
}

async function waitForAgentTaskTerminalTruthReady(page: Page) {
  await expect(page.getByTestId('agent-task__task-header')).toHaveAttribute('data-terminal-truth-state', 'ready', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('agent-tasks__task-terminal-truth-unavailable')).toHaveCount(0);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractProjectRouteParts(route: string) {
  const match = route.match(/\/workspaces\/([^/]+)\/projects\/([^/]+)/);
  if (!match) {
    throw new Error(`Visual scenario route must include workspace/project params: ${route}`);
  }
  return {
    workspaceId: decodeURIComponent(match[1]),
    projectId: decodeURIComponent(match[2]),
  };
}

function extractAgentTaskRouteParts(route: string) {
  const projectRoute = extractProjectRouteParts(route);
  const match = route.match(/\/agent-tasks\/([^/?#]+)/);
  if (!match) {
    throw new Error(`Visual agent task scenario route must include a task id: ${route}`);
  }
  return {
    ...projectRoute,
    taskId: decodeURIComponent(match[1]),
  };
}

function agentTaskConversationTextarea(page: Page) {
  return page
    .getByTestId('agent-tasks__conversation-input')
    .locator('textarea, input[type="text"], [contenteditable="true"]')
    .first();
}

function chatComposerTextarea(page: Page) {
  return page.getByTestId('chat__composer').locator('textarea').first();
}

function chatStreamAttachPathPattern(sessionId = VISUAL_CHAT_RUNTIME_SESSION_ID) {
  return new RegExp(`/chat/sessions/${escapeRegExp(sessionId)}/messages/streams/[^/]+/?$`);
}

async function installVisualExactTimeoutRewrite(page: Page, rewrites: Record<number, number>) {
  await page.addInitScript((nextRewrites) => {
    type HarnessWindow = Window & {
      __agsVisualTimeoutRewriteInstalled?: boolean;
      __agsVisualTimeoutRewriteMap?: Record<string, number>;
    };

    const win = window as HarnessWindow;
    const normalized = Object.fromEntries(
      Object.entries(nextRewrites).map(([delay, nextDelay]) => [String(delay), Number(nextDelay)]),
    );
    win.__agsVisualTimeoutRewriteMap = normalized;

    if (win.__agsVisualTimeoutRewriteInstalled) {
      return;
    }

    const originalSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const requestedDelay = typeof timeout === 'number' ? timeout : 0;
      const rewriteMap = win.__agsVisualTimeoutRewriteMap ?? {};
      const rewrittenDelay = Object.prototype.hasOwnProperty.call(rewriteMap, String(requestedDelay))
        ? rewriteMap[String(requestedDelay)]
        : requestedDelay;
      return originalSetTimeout(handler, rewrittenDelay, ...args);
    }) as typeof window.setTimeout;

    win.__agsVisualTimeoutRewriteInstalled = true;
  }, rewrites);
}

async function installVisualChatHarness(
  page: Page,
  options: {
    stopEscalationMode?: 'supported' | 'unsupported';
    stallRecoveredStreamAttach?: boolean;
    streamFailure?: {
      sessionId?: string;
      status?: number;
      errorCode?: string;
      errorMessage?: string;
    };
  } = {},
) {
  await page.addInitScript(({ config, recoveredStreamAttachPathPatternSource }) => {
    type HarnessWindow = Window & {
      __agsVisualChatHarnessInstalled?: boolean;
      __agsVisualChatHarnessConfig?: {
        stopEscalationMode?: 'supported' | 'unsupported';
        stallRecoveredStreamAttach?: boolean;
        streamFailure?: {
          sessionId?: string;
          status?: number;
          errorCode?: string;
          errorMessage?: string;
        };
      };
    };

    const win = window as HarnessWindow;
    win.__agsVisualChatHarnessConfig = {
      ...(win.__agsVisualChatHarnessConfig ?? {}),
      ...config,
    };
    const recoveredStreamAttachPathPattern = new RegExp(recoveredStreamAttachPathPatternSource);
    if (win.__agsVisualChatHarnessInstalled) {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const resolvedUrl = request?.url ?? String(input);
      let url: URL;
      try {
        url = new URL(resolvedUrl, window.location.origin);
      } catch {
        return originalFetch(input, init);
      }

      const activeConfig = win.__agsVisualChatHarnessConfig ?? {};
      const isChatRequest = url.pathname.includes('/api/v1/workspaces/') && url.pathname.includes('/chat/sessions');
      if (!isChatRequest) {
        return originalFetch(input, init);
      }

      if (activeConfig.stopEscalationMode) {
        url.searchParams.set('mock_chat_stop_escalation', activeConfig.stopEscalationMode);
      }

      if (activeConfig.stallRecoveredStreamAttach && recoveredStreamAttachPathPattern.test(url.pathname)) {
        return new Promise<Response>(() => {});
      }

      const streamFailure = activeConfig.streamFailure;
      if (
        streamFailure
        && url.pathname.endsWith(`/chat/sessions/${streamFailure.sessionId ?? VISUAL_CHAT_RUNTIME_SESSION_ID}/messages/stream`)
      ) {
        return Promise.resolve(new Response(JSON.stringify({
          error_code: streamFailure.errorCode ?? 'UPSTREAM_RATE_LIMIT',
          message: streamFailure.errorMessage ?? 'Selected model is at capacity. Please retry shortly.',
        }), {
          status: streamFailure.status ?? 429,
          headers: {
            'content-type': 'application/json',
          },
        }));
      }

      const nextInput = request ? new Request(url.toString(), request) : url.toString();
      return originalFetch(nextInput, init);
    };

    win.__agsVisualChatHarnessInstalled = true;
  }, {
    config: options,
    recoveredStreamAttachPathPatternSource: chatStreamAttachPathPattern().source,
  });
}

async function runVisualBrowserApiRequest(
  page: Page,
  input: {
    path: string;
    method?: 'GET' | 'PATCH' | 'POST';
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  },
) {
  const result = await page.evaluate(async (requestInput) => {
    const response = await fetch(requestInput.path, {
      method: requestInput.method ?? 'GET',
      headers: {
        ...(requestInput.body ? { 'Content-Type': 'application/json' } : {}),
        'X-MSW-Enable': 'true',
        ...(requestInput.headers ?? {}),
      },
      body: requestInput.body ? JSON.stringify(requestInput.body) : undefined,
    });
    const text = await response.text().catch(() => '');
    let json: unknown = null;
    if (text.trim().length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = text;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
    };
  }, input);
  expect(
    result.ok,
    `visual browser api request failed (${input.method ?? 'GET'} ${input.path}): ${result.status} ${result.text}`,
  ).toBe(true);
  return result.json;
}

async function bindVisualChatSessionToEndpoint(
  page: Page,
  route: string,
  options: {
    sessionId?: string;
    endpointId: string;
    model: string;
  },
) {
  const { workspaceId, projectId } = extractProjectRouteParts(route);
  const sessionId = options.sessionId ?? VISUAL_CHAT_RUNTIME_SESSION_ID;
  await runVisualBrowserApiRequest(page, {
    path: `/api/v1/workspaces/${workspaceId}/projects/${projectId}/chat/sessions/${sessionId}`,
    method: 'PATCH',
    body: {
      endpoint_id: options.endpointId,
      model: options.model,
    },
  });
}

async function patchVisualAgentTaskTruth(
  page: Page,
  route: string,
  patch: Record<string, unknown>,
) {
  const { taskId } = extractAgentTaskRouteParts(route);
  await installVisualAgentTaskHarness(page, {
    taskPatchesByTaskId: {
      [taskId]: patch,
    },
  });
}

async function createVisualAgentTaskTerminalSession(
  page: Page,
  route: string,
  options: {
    cols?: number;
    rows?: number;
    status?: 'active' | 'disconnected' | 'failed';
  } = {},
) {
  const { taskId } = extractAgentTaskRouteParts(route);
  await installVisualAgentTaskHarness(page, {
    terminalSessionsByTaskId: {
      [taskId]: {
        mode: 'ready',
        items: [{
          terminal_session_id: 'mock_terminal_visual_001',
          status: options.status ?? 'active',
          cols: options.cols ?? 120,
          rows: options.rows ?? 30,
          created_at: VISUAL_TEST_REFERENCE_NOW_ISO,
          last_activity_at: VISUAL_TEST_REFERENCE_NOW_ISO,
          ended_at: null,
          close_reason: null,
          exit_code: null,
          ws_url: 'ws://mock.agentsmith.local/terminal/mock_terminal_visual_001',
        }],
      },
    },
  });
}

async function installVisualAgentTaskHarness(
  page: Page,
  options: {
    taskPatchesByTaskId?: Record<string, Record<string, unknown>>;
    activityByTaskId?: Record<string, Array<Record<string, unknown>>>;
    tracesByTaskId?: Record<string, Array<Record<string, unknown>>>;
    terminalSessionsByTaskId?: Record<
      string,
      | { mode: 'ready'; items: Array<Record<string, unknown>> }
      | { mode: 'unavailable' }
    >;
  } = {},
) {
  await page.addInitScript((config) => {
    type HarnessWindow = Window & {
      __agsVisualAgentTaskHarnessInstalled?: boolean;
      __agsVisualAgentTaskHarnessConfig?: {
        taskPatchesByTaskId?: Record<string, Record<string, unknown>>;
        activityByTaskId?: Record<string, Array<Record<string, unknown>>>;
        tracesByTaskId?: Record<string, Array<Record<string, unknown>>>;
        terminalSessionsByTaskId?: Record<
          string,
          | { mode: 'ready'; items: Array<Record<string, unknown>> }
          | { mode: 'unavailable' }
        >;
      };
    };

    const win = window as HarnessWindow;
    const previousConfig = win.__agsVisualAgentTaskHarnessConfig ?? {};
    win.__agsVisualAgentTaskHarnessConfig = {
      ...previousConfig,
      taskPatchesByTaskId: {
        ...(previousConfig.taskPatchesByTaskId ?? {}),
        ...(config.taskPatchesByTaskId ?? {}),
      },
      activityByTaskId: {
        ...(previousConfig.activityByTaskId ?? {}),
        ...(config.activityByTaskId ?? {}),
      },
      tracesByTaskId: {
        ...(previousConfig.tracesByTaskId ?? {}),
        ...(config.tracesByTaskId ?? {}),
      },
      terminalSessionsByTaskId: {
        ...(previousConfig.terminalSessionsByTaskId ?? {}),
        ...(config.terminalSessionsByTaskId ?? {}),
      },
    };
    if (win.__agsVisualAgentTaskHarnessInstalled) {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const resolvedUrl = request?.url ?? String(input);
      let url: URL;
      try {
        url = new URL(resolvedUrl, window.location.origin);
      } catch {
        return originalFetch(input, init);
      }

      const response = await originalFetch(input, init);
      const method = (request?.method ?? init?.method ?? 'GET').toUpperCase();
      const activeConfig = win.__agsVisualAgentTaskHarnessConfig ?? {};
      const taskDetailMatch = url.pathname.match(/\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/tasks\/([^/]+)$/);
      if (method === 'GET' && taskDetailMatch) {
        const taskId = decodeURIComponent(taskDetailMatch[1]);
        const taskPatch = activeConfig.taskPatchesByTaskId?.[taskId];
        if (taskPatch) {
          const text = await response.text().catch(() => '');
          const json = text.trim().length > 0
            ? JSON.parse(text) as Record<string, unknown>
            : {};
          return new Response(JSON.stringify({
            ...json,
            ...taskPatch,
          }), {
            status: response.status,
            headers: {
              'content-type': 'application/json',
            },
          });
        }
      }

      const taskActivityMatch = url.pathname.match(/\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/tasks\/([^/]+)\/activity$/);
      if (method === 'GET' && taskActivityMatch) {
        const taskId = decodeURIComponent(taskActivityMatch[1]);
        const hasOverride = Object.prototype.hasOwnProperty.call(activeConfig.activityByTaskId ?? {}, taskId);
        if (hasOverride) {
          return new Response(JSON.stringify(activeConfig.activityByTaskId?.[taskId] ?? []), {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          });
        }
      }

      const taskTracesMatch = url.pathname.match(/\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/tasks\/([^/]+)\/traces$/);
      if (method === 'GET' && taskTracesMatch) {
        const taskId = decodeURIComponent(taskTracesMatch[1]);
        const hasOverride = Object.prototype.hasOwnProperty.call(activeConfig.tracesByTaskId ?? {}, taskId);
        if (hasOverride) {
          const messageId = url.searchParams.get('message_id');
          const runId = url.searchParams.get('run_id');
          const items = (activeConfig.tracesByTaskId?.[taskId] ?? []).filter((item) => {
            const itemMessageId = typeof item.message_id === 'string' ? item.message_id : null;
            const itemRunId = typeof item.run_id === 'string' ? item.run_id : null;
            if (messageId && itemMessageId !== messageId) {
              return false;
            }
            if (runId && itemRunId !== runId) {
              return false;
            }
            return true;
          });
          return new Response(JSON.stringify({
            items,
            total: items.length,
            has_more: false,
            next_after_id: null,
          }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          });
        }
      }

      const terminalSessionsMatch = url.pathname.match(/\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/tasks\/([^/]+)\/terminal\/sessions$/);
      if (method === 'GET' && terminalSessionsMatch) {
        const taskId = decodeURIComponent(terminalSessionsMatch[1]);
        const terminalOverride = activeConfig.terminalSessionsByTaskId?.[taskId];
        if (terminalOverride?.mode === 'unavailable') {
          return new Response(JSON.stringify({
            error_code: 'terminal_truth_unavailable',
            message: 'terminal_truth_unavailable',
          }), {
            status: 503,
            headers: {
              'content-type': 'application/json',
            },
          });
        }
        if (terminalOverride?.mode === 'ready') {
          return new Response(JSON.stringify({
            total: terminalOverride.items.length,
            items: terminalOverride.items,
          }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          });
        }
      }

      return response;
    };

    win.__agsVisualAgentTaskHarnessInstalled = true;
  }, options);
}

async function installVisualAgentTaskActivityOverride(
  page: Page,
  route: string,
  items: Array<Record<string, unknown>>,
) {
  const { taskId } = extractAgentTaskRouteParts(route);
  await installVisualAgentTaskHarness(page, {
    activityByTaskId: {
      [taskId]: items,
    },
  });
}

async function seedVisualAgentTaskConversationHistory(page: Page, route: string) {
  const { taskId } = extractAgentTaskRouteParts(route);
  await installVisualAgentTaskActivityOverride(page, route, [
    {
      id: 'msg_visual_agent_task_user_001',
      task_id: taskId,
      kind: 'user_intent',
      actor: 'user',
      content: 'Review the existing task progress before retrying.',
      created_at: '2026-04-12T09:12:00.000Z',
    },
    {
      id: 'msg_visual_agent_task_agent_001',
      task_id: taskId,
      kind: 'runner_output',
      actor: 'runner',
      content: 'The task already has prior context on this surface.',
      created_at: '2026-04-12T09:12:05.000Z',
    },
  ]);
}

async function installVisualAgentTaskTraceOverride(
  page: Page,
  route: string,
  items: Array<Record<string, unknown>>,
) {
  const { taskId } = extractAgentTaskRouteParts(route);
  await installVisualAgentTaskHarness(page, {
    tracesByTaskId: {
      [taskId]: items,
    },
  });
}

async function seedVisualAgentTaskRunState(
  page: Page,
  route: string,
  runState: 'running' | 'cancelling' | 'terminating' | 'finalizing' | 'idle',
) {
  const futureActivityAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await patchVisualAgentTaskTruth(page, route, {
    run_state: runState,
    status: 'active',
    updated_at: futureActivityAt,
    last_activity_at: futureActivityAt,
    stop_mode:
      runState === 'cancelling'
        ? 'cancel'
        : runState === 'terminating'
          ? 'terminate'
          : null,
    can_escalate: false,
    escalation_reason: null,
  });
}

async function seedVisualAgentTaskLongActionRunState(page: Page, route: string) {
  const { taskId } = extractAgentTaskRouteParts(route);
  const startedAt = new Date(Date.now() - 65_000).toISOString();
  const futureActivityAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const userMessageId = 'msg_visual_agent_task_long_action_user';
  const agentMessageId = 'msg_visual_agent_task_long_action_agent';
  const runId = 'run_visual_agent_task_long_action_001';

  await installVisualAgentTaskHarness(page, {
    taskPatchesByTaskId: {
      [taskId]: {
        run_state: 'running',
        status: 'active',
        updated_at: futureActivityAt,
        last_activity_at: futureActivityAt,
        stop_mode: null,
        can_escalate: false,
        escalation_reason: null,
        active_run_started_at: startedAt,
      },
    },
    activityByTaskId: {
      [taskId]: [
        {
          id: userMessageId,
          task_id: taskId,
          kind: 'user_intent',
          actor: 'user',
          content: 'Run the agent task recovery probe with the full diagnostic context.',
          created_at: startedAt,
        },
        {
          id: agentMessageId,
          task_id: taskId,
          kind: 'runner_output',
          actor: 'runner',
          content: '',
          created_at: new Date(Date.now() - 60_000).toISOString(),
          run_id: runId,
        },
      ],
    },
    tracesByTaskId: {
      [taskId]: [
        {
          id: 'trace_visual_agent_task_long_action_001',
          task_id: taskId,
          message_id: agentMessageId,
          run_id: runId,
          seq: 2_000_001,
          at: new Date(Date.now() - 60_000).toISOString(),
          category: 'lifecycle',
          phase: 'start',
          status: 'running',
          name: 'run.lifecycle',
          summary: 'Execution started',
          details: {
            stage: 'dispatching',
          },
        },
        {
          id: 'trace_visual_agent_task_long_action_002',
          task_id: taskId,
          message_id: agentMessageId,
          run_id: runId,
          seq: 2_000_002,
          at: new Date(Date.now() - 55_000).toISOString(),
          category: 'progress',
          phase: 'start',
          status: 'running',
          name: 'codex.output',
          summary: VISUAL_AGENT_TASK_LONG_LATEST_ACTION,
          details: {
            visual_case: 'long_latest_action',
          },
        },
      ],
    },
  });
}

async function seedVisualAgentTaskCancelEscalation(page: Page, route: string) {
  const futureActivityAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await patchVisualAgentTaskTruth(page, route, {
    run_state: 'cancelling',
    status: 'active',
    updated_at: futureActivityAt,
    last_activity_at: futureActivityAt,
    stop_mode: 'cancel',
    can_escalate: true,
    escalation_reason: 'agent did not acknowledge cancel',
  });
}

async function expectVisualAgentTaskActiveRunFooter(page: Page): Promise<{
  activeRunFooter: Locator;
  latestAction: Locator;
  cancel: Locator;
}> {
  await waitForVisualAgentTaskSurface(page);
  const activeRunFooter = page.getByTestId('agent-tasks__message-active-run-footer');
  const latestAction = activeRunFooter.getByTestId('agent-tasks__message-active-run-latest-action');
  const cancel = activeRunFooter.getByTestId('agent-tasks__message-active-run-cancel');

  await expect(activeRunFooter).toBeVisible();
  await expect(activeRunFooter.getByTestId('agent-tasks__message-active-run-status')).toContainText('Running');
  await expect(activeRunFooter.getByTestId('agent-tasks__message-active-run-elapsed')).toContainText('Elapsed:');
  await expect(latestAction).toContainText('Latest action:');
  await expect(cancel).toBeVisible();

  return { activeRunFooter, latestAction, cancel };
}

async function expectVisualAgentTaskLongActiveRunFooterLayout(page: Page) {
  const { activeRunFooter, latestAction, cancel } = await expectVisualAgentTaskActiveRunFooter(page);

  await expect(latestAction).toContainText(VISUAL_AGENT_TASK_LONG_LATEST_ACTION, { timeout: 15_000 });
  await expect(latestAction).toHaveAttribute('title', VISUAL_AGENT_TASK_LONG_LATEST_ACTION);
  await expect(cancel).toHaveAccessibleName('Cancel current run');

  const latestMetrics = await latestAction.evaluate((element) => {
    const node = element as HTMLElement;
    const style = window.getComputedStyle(node);
    return {
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      overflowX: style.overflowX,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(latestMetrics.clientWidth).toBeGreaterThan(0);
  expect(latestMetrics.scrollWidth).toBeGreaterThan(latestMetrics.clientWidth + 1);
  expect(latestMetrics.overflowX).toBe('hidden');
  expect(latestMetrics.textOverflow).toBe('ellipsis');
  expect(latestMetrics.whiteSpace).toBe('nowrap');

  const cancelMetrics = await cancel.evaluate((element) => {
    const node = element as HTMLElement;
    const style = window.getComputedStyle(node);
    return {
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      rectCount: node.getClientRects().length,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(cancelMetrics.clientWidth).toBeGreaterThan(0);
  expect(cancelMetrics.scrollWidth).toBeLessThanOrEqual(cancelMetrics.clientWidth + 2);
  expect(cancelMetrics.rectCount).toBe(1);
  expect(cancelMetrics.whiteSpace).toBe('nowrap');

  const layoutMetrics = await activeRunFooter.evaluate((footer) => {
    const latest = footer.querySelector('[data-testid="agent-tasks__message-active-run-latest-action"]');
    const cancelButton = footer.querySelector('[data-testid="agent-tasks__message-active-run-cancel"]');
    if (!(latest instanceof HTMLElement) || !(cancelButton instanceof HTMLElement)) {
      return null;
    }

    const footerRect = footer.getBoundingClientRect();
    const latestRect = latest.getBoundingClientRect();
    const cancelRect = cancelButton.getBoundingClientRect();
    return {
      footerRight: footerRect.right,
      latestWidth: latestRect.width,
      cancelWidth: cancelRect.width,
      cancelRight: cancelRect.right,
      cancelLeft: cancelRect.left,
      latestLeft: latestRect.left,
      latestCenterY: latestRect.top + latestRect.height / 2,
      cancelCenterY: cancelRect.top + cancelRect.height / 2,
    };
  });
  if (!layoutMetrics) {
    throw new Error('Active run footer layout metrics are unavailable.');
  }
  expect(layoutMetrics.latestWidth).toBeGreaterThan(0);
  expect(layoutMetrics.cancelWidth).toBeGreaterThan(0);
  expect(layoutMetrics.cancelLeft).toBeGreaterThan(layoutMetrics.latestLeft);
  expect(layoutMetrics.cancelRight).toBeLessThanOrEqual(layoutMetrics.footerRight + 1);
  expect(Math.abs(layoutMetrics.latestCenterY - layoutMetrics.cancelCenterY)).toBeLessThanOrEqual(2);
}

async function installVisualAgentTaskEventSourceFailureHarness(page: Page) {
  await page.addInitScript(() => {
    type HarnessWindow = Window & {
      __agsVisualAgentTaskEventSourceInstalled?: boolean;
    };
    const win = window as HarnessWindow;
    if (win.__agsVisualAgentTaskEventSourceInstalled) {
      return;
    }

    class VisualAgentTaskEventSource implements EventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;

      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials: boolean;
      readyState = VisualAgentTaskEventSource.CONNECTING;
      private failureTimer: number | null = null;
      private onopenHandler: ((this: EventSource, ev: Event) => unknown) | null = null;
      private onmessageHandler: ((this: EventSource, ev: MessageEvent<string>) => unknown) | null = null;
      private onerrorHandler: ((this: EventSource, ev: Event) => unknown) | null = null;

      get onopen() {
        return this.onopenHandler;
      }

      set onopen(handler: ((this: EventSource, ev: Event) => unknown) | null) {
        this.onopenHandler = handler;
      }

      get onmessage() {
        return this.onmessageHandler;
      }

      set onmessage(handler: ((this: EventSource, ev: MessageEvent<string>) => unknown) | null) {
        this.onmessageHandler = handler;
      }

      get onerror() {
        return this.onerrorHandler;
      }

      set onerror(handler: ((this: EventSource, ev: Event) => unknown) | null) {
        this.onerrorHandler = handler;
        this.scheduleFailure();
      }

      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        this.url = String(url);
        this.withCredentials = Boolean(eventSourceInitDict?.withCredentials);
        this.scheduleFailure();
      }

      private scheduleFailure() {
        if (this.failureTimer !== null || this.readyState === VisualAgentTaskEventSource.CLOSED) {
          return;
        }
        this.failureTimer = window.setTimeout(() => {
          this.failureTimer = null;
          if (this.readyState === VisualAgentTaskEventSource.CLOSED) {
            return;
          }
          if (!this.onerrorHandler) {
            this.scheduleFailure();
            return;
          }
          this.readyState = VisualAgentTaskEventSource.CLOSED;
          this.onerrorHandler.call(this as unknown as EventSource, new Event('error'));
        }, 50);
      }

      addEventListener(): void {}

      removeEventListener(): void {}

      dispatchEvent(): boolean {
        return true;
      }

      close(): void {
        if (this.failureTimer !== null) {
          window.clearTimeout(this.failureTimer);
          this.failureTimer = null;
        }
        this.readyState = VisualAgentTaskEventSource.CLOSED;
      }
    }

    window.EventSource = VisualAgentTaskEventSource as unknown as typeof window.EventSource;
    win.__agsVisualAgentTaskEventSourceInstalled = true;
  });
}

async function waitForVisualChatStreaming(page: Page) {
  await expect(page.getByTestId('chat__surface')).toBeVisible();
  await expect(page.getByTestId('chat__composer')).toBeVisible();
  await expect(page.getByTestId('chat__stop-btn')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat__stream-status')).toContainText('Generating', { timeout: 15_000 });
  await expect(page.getByTestId('chat__threads-generating-count')).toContainText('1 generating', { timeout: 15_000 });
  await expect(page.getByTestId('chat__thread-streaming-indicator').first()).toBeVisible({ timeout: 15_000 });
}

async function waitForVisualChatRecovering(page: Page) {
  await expect(page.getByTestId('chat__surface')).toBeVisible();
  await expect(page.getByTestId('chat__composer')).toBeVisible();
  await expect(page.getByTestId('chat__stop-btn')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat__stream-status')).toContainText('Recovering stream...', { timeout: 15_000 });
  await expect(page.getByTestId('chat__threads-generating-count')).toContainText('1 generating', { timeout: 15_000 });
  await expect(page.getByTestId('chat__thread-streaming-indicator').first()).toBeVisible({ timeout: 15_000 });
}

async function clickVisualChatStopAndWait(page: Page) {
  await waitForVisualChatStreaming(page);
  await page.getByTestId('chat__stop-btn').click();
  await expect(page.getByTestId('chat__stream-status')).toContainText('Stop', { timeout: 15_000 });
  await expect(page.getByTestId('chat__threads-generating-count')).toContainText('1 generating', { timeout: 15_000 });
  await expect(page.getByTestId('chat__thread-streaming-indicator').first()).toBeVisible({ timeout: 15_000 });
}

async function ensureVisualChatEndpointBound(page: Page, endpointId = 'ep_1') {
  await expect(page.getByTestId('chat__surface')).toBeVisible();
  const composer = chatComposerTextarea(page);
  if (await composer.isEditable().catch(() => false)) {
    return;
  }
  const recoveryEndpoint = page.getByTestId(`chat__composer-recovery-endpoint--${endpointId}`);
  if (await recoveryEndpoint.isVisible().catch(() => false)) {
    await recoveryEndpoint.click();
  }
  await expect(composer).toBeEditable({ timeout: 15_000 });
}

async function triggerVisualChatCapacityRecovery(page: Page) {
  await ensureVisualChatEndpointBound(page);
  await chatComposerTextarea(page).fill('Retry after provider capacity clears.');
  await expect(page.getByTestId('chat__send-btn')).toBeEnabled();
  await page.getByTestId('chat__send-btn').click();
  await expect(page.getByTestId('chat__stream-status')).toContainText('Interrupted', { timeout: 15_000 });
  await expect(page.getByTestId('chat__composer-recovery')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat__stream-error-recovery')).toBeVisible();
  await expect(page.getByTestId('chat__stream-error-message')).toContainText('capacity', { timeout: 15_000 });
  await expect(page.getByTestId('chat__composer-recovery-endpoint--ep_2')).toBeVisible();
  await expect(chatComposerTextarea(page)).toBeEditable();
}

async function waitForVisualAgentTaskSurface(page: Page) {
  await expect(page.getByTestId('agent-task__task-header')).toBeVisible();
  await waitForAgentTaskTerminalTruthReady(page);
  await expect(page.getByTestId('agent-tasks__conversation-input')).toBeVisible();
  await expect(page.getByTestId('agent-tasks__send-btn')).toBeVisible();
}

const VISUAL_SCENE_SETUP_REGISTRY: Partial<Record<string, VisualScenarioSetup>> = {
  'access-guide': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('use-guide__page')).toBeVisible();
    },
  },
  'agent-runners': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agent-runners__create-btn')).toBeVisible();
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
    beforeNavigate: async ({ page }) => {
      await prepareStableVisualChatSurface(page);
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('chat__execution-target-trigger')).toBeVisible();
    },
  },
  'chat-recover-empty': {
    beforeNavigate: async ({ page }) => {
      await prepareStableVisualChatSurface(page);
    },
    afterNavigate: async ({ page }) => {
      await page.getByPlaceholder('Search threads...').fill('zzzzzz-no-match');
    },
  },
  'chat-provider-capacity-retry': {
    beforeNavigate: async ({ page, scenario }) => {
      await prepareStableVisualChatSurface(page);
      await bindVisualChatSessionToEndpoint(page, scenario.route, {
        endpointId: 'ep_1',
        model: 'gpt-4o',
      });
      await installVisualChatHarness(page, {
        streamFailure: {
          sessionId: VISUAL_CHAT_RUNTIME_SESSION_ID,
          status: 429,
          errorCode: 'UPSTREAM_RATE_LIMIT',
          errorMessage: 'Selected model is at capacity. Please retry shortly.',
        },
      });
    },
    afterNavigate: async ({ page }) => {
      await triggerVisualChatCapacityRecovery(page);
    },
  },
  'chat-recovering-live-session': {
    beforeNavigate: async ({ page }) => {
      await prepareStableVisualChatSurface(page);
      await installVisualChatHarness(page, {
        stopEscalationMode: 'supported',
        stallRecoveredStreamAttach: true,
      });
    },
    afterNavigate: async ({ page }) => {
      await waitForVisualChatRecovering(page);
    },
    screenshotOptions: {
      maskTestIds: ['chat__execution-target-trigger'],
      stabilizeAttempts: 4,
      stabilizeDelayMs: 120,
    },
  },
  'chat-stop-escalation-confirm': {
    beforeNavigate: async ({ page }) => {
      await prepareStableVisualChatSurface(page);
      await installVisualExactTimeoutRewrite(page, {
        [VISUAL_CHAT_ESCALATION_DELAY_MS]: 25,
      });
      await installVisualChatHarness(page, {
        stopEscalationMode: 'supported',
      });
    },
    afterNavigate: async ({ page }) => {
      await clickVisualChatStopAndWait(page);
      await expect(page.getByTestId('chat__stop-escalation-dialog')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('chat__stop-escalation-confirm')).toBeVisible();
    },
  },
  'chat-stop-escalation-unavailable': {
    beforeNavigate: async ({ page }) => {
      await prepareStableVisualChatSurface(page);
      await installVisualChatHarness(page, {
        stopEscalationMode: 'unsupported',
      });
    },
    afterNavigate: async ({ page }) => {
      await clickVisualChatStopAndWait(page);
      await expect(page.getByTestId('chat__stop-escalation-unavailable')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('chat__stop-escalation-dialog')).toHaveCount(0);
    },
    screenshotOptions: {
      maskTestIds: ['chat__execution-target-trigger'],
      stabilizeAttempts: 4,
      stabilizeDelayMs: 120,
    },
  },
  'chat-stop-requested': {
    beforeNavigate: async ({ page }) => {
      await prepareStableVisualChatSurface(page);
      await installVisualChatHarness(page, {
        stopEscalationMode: 'supported',
      });
    },
    afterNavigate: async ({ page }) => {
      await clickVisualChatStopAndWait(page);
    },
    screenshotOptions: {
      maskTestIds: ['chat__execution-target-trigger'],
      stabilizeAttempts: 4,
      stabilizeDelayMs: 120,
    },
  },
  'chat-streaming-active': {
    beforeNavigate: async ({ page }) => {
      await prepareStableVisualChatSurface(page);
      await installVisualChatHarness(page, {
        stopEscalationMode: 'supported',
      });
    },
    afterNavigate: async ({ page }) => {
      await waitForVisualChatStreaming(page);
    },
    screenshotOptions: {
      maskTestIds: ['chat__execution-target-trigger'],
      stabilizeAttempts: 4,
      stabilizeDelayMs: 120,
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
  'dialog-create-agent-runner': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('agent-runners__create-btn').click();
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
  'agent-tasks': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agent-tasks__task-list')).toBeVisible();
    },
  },
  'agent-tasks-create-task-dialog': {
    afterNavigate: async ({ page }) => {
      await page.getByTestId('agent-tasks__create-task-btn').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByText('Checking Agent task model setup...')).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId('task-create__model-readiness-blocked')).toHaveCount(0);
      await expect(page.getByText('Agent task model setup required')).toHaveCount(0);
    },
  },
  'agent-task-detail': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agent-task__task-header')).toBeVisible();
      await waitForAgentTaskTerminalTruthReady(page);
    },
  },
  'agent-task-detail-artifact-hover': {
    afterNavigate: async ({ page }) => {
      await waitForAgentTaskTerminalTruthReady(page);
      const firstArtifact = page.getByTestId('agent-tasks__artifact-card').first();
      await expect(firstArtifact).toBeVisible();
      await firstArtifact.hover();
      await expect(page.getByTestId('agent-tasks__artifact-hover-panel')).toBeVisible();
    },
  },
  'agent-task-lifecycle-artifact': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agent-task__task-header')).toBeVisible();
      await waitForAgentTaskTerminalTruthReady(page);
      const artifact = page.getByTestId('agent-tasks__artifact-card').first();
      await expect(artifact).toBeVisible();
      await artifact.hover();
      await expect(page.getByTestId('agent-tasks__artifact-hover-panel')).toBeVisible();
    },
  },
  'agent-task-lifecycle-create-dialog': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agent-tasks__create-task-btn')).toBeVisible();
      await page.getByTestId('agent-tasks__create-task-btn').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByText('Checking Agent task model setup...')).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId('task-create__model-readiness-blocked')).toHaveCount(0);
      await expect(page.getByText('Agent task model setup required')).toHaveCount(0);
    },
  },
  'agent-task-lifecycle-detail': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agent-task__task-header')).toBeVisible();
      await waitForAgentTaskTerminalTruthReady(page);
      await expect(page.getByTestId('agent-tasks__conversation-input')).toBeVisible();
      await expect(page.getByTestId('agent-tasks__send-btn')).toBeVisible();
    },
  },
  'agent-task-lifecycle-list': {
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agent-tasks__task-list')).toBeVisible();
      await expect(page.getByTestId('agent-tasks__task-card').first()).toBeVisible();
      await expect(page.getByTestId('agent-tasks__create-task-btn')).toBeVisible();
    },
  },
  'agent-task-hidden-terminal-blocked': {
    beforeNavigate: async ({ page, scenario }) => {
      await createVisualAgentTaskTerminalSession(page, scenario.route, {
        status: 'failed',
      });
      await seedVisualAgentTaskConversationHistory(page, scenario.route);
    },
    afterNavigate: async ({ page }) => {
      await waitForAgentTaskTerminalTruthReady(page);
      await expect(page.getByTestId('agent-tasks__task-terminal-status-strip')).toBeVisible();
      await expect(page.getByTestId('agent-tasks__task-terminal-status-strip')).toContainText('1 terminal session');
      await expect(page.getByTestId('agent-tasks__task-terminal-status-action')).toHaveText('Reopen Terminal Workspace');
      await expect(page.getByTestId('agent-tasks__task-terminal-status-end-all')).toBeVisible();
      await expect(page.getByText('The task already has prior context on this surface.')).toBeVisible();
      await expect(page.getByTestId('agent-tasks__conversation-blocked-state')).toHaveCount(0);
      await expect(agentTaskConversationTextarea(page)).toHaveAttribute(
        'placeholder',
        'End terminal sessions before starting a new agent run.',
      );
    },
  },
  'agent-task-cancel-escalation-confirm': {
    beforeNavigate: async ({ page, scenario }) => {
      await installVisualExactTimeoutRewrite(page, {
        [VISUAL_AGENT_TASK_CANCEL_ESCALATION_DELAY_MS]: 25,
      });
      await seedVisualAgentTaskCancelEscalation(page, scenario.route);
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agent-task__task-header')).toBeVisible();
      await waitForAgentTaskTerminalTruthReady(page);
      await expect(page.getByTestId('agent-tasks__cancel-escalation-dialog')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('agent-tasks__cancel-escalation-cancel')).toBeVisible();
      await expect(page.getByTestId('agent-tasks__cancel-escalation-confirm')).toBeVisible();
    },
    screenshotOptions: {
      maskTestIds: ['agent-tasks__message-active-run-elapsed'],
      maxDiffPixelRatio: 0.002,
    },
  },
  'agent-task-sse-reconnecting': {
    beforeNavigate: async ({ page, scenario }) => {
      await seedVisualAgentTaskRunState(page, scenario.route, 'running');
      await installVisualExactTimeoutRewrite(page, {
        [VISUAL_AGENT_TASK_SSE_RECONNECT_DELAY_MS]: 60_000,
      });
      await installVisualAgentTaskEventSourceFailureHarness(page);
    },
    afterNavigate: async ({ page }) => {
      await waitForVisualAgentTaskSurface(page);
      const activeRunFooter = page.getByTestId('agent-tasks__message-active-run-footer');
      await expect(activeRunFooter.getByTestId('agent-tasks__message-active-run-status')).toContainText('Reconnecting', {
        timeout: 15_000,
      });
    },
    screenshotOptions: {
      maskTestIds: ['agent-tasks__message-active-run-elapsed'],
      maxDiffPixelRatio: 0.002,
    },
  },
  'agent-task-sse-unavailable-reconcile': {
    beforeNavigate: async ({ page, scenario }) => {
      await seedVisualAgentTaskRunState(page, scenario.route, 'running');
      await installVisualExactTimeoutRewrite(page, {
        [VISUAL_AGENT_TASK_SSE_RECONNECT_DELAY_MS]: 10,
      });
      await installVisualAgentTaskEventSourceFailureHarness(page);
    },
    afterNavigate: async ({ page }) => {
      await waitForVisualAgentTaskSurface(page);
      await expect(page.getByTestId('agent-tasks__sse-status')).toContainText('Realtime task stream unavailable', {
        timeout: 25_000,
      });
    },
    screenshotOptions: {
      maskTestIds: ['agent-tasks__message-active-run-elapsed'],
      maxDiffPixelRatio: 0.002,
    },
  },
  'agent-task-cancelling': {
    beforeNavigate: async ({ page, scenario }) => {
      await seedVisualAgentTaskRunState(page, scenario.route, 'cancelling');
    },
    afterNavigate: async ({ page }) => {
      await waitForVisualAgentTaskSurface(page);
      const activeRunFooter = page.getByTestId('agent-tasks__message-active-run-footer');
      await expect(activeRunFooter.getByTestId('agent-tasks__message-active-run-status')).toContainText('Cancelling');
      await expect(agentTaskConversationTextarea(page)).toHaveAttribute(
        'placeholder',
        'Wait for the current run to stop before sending another message.',
      );
    },
    screenshotOptions: {
      maskTestIds: ['agent-tasks__message-active-run-elapsed'],
      maxDiffPixelRatio: 0.002,
    },
  },
  'agent-task-finalizing': {
    beforeNavigate: async ({ page, scenario }) => {
      await seedVisualAgentTaskRunState(page, scenario.route, 'finalizing');
    },
    afterNavigate: async ({ page }) => {
      await waitForVisualAgentTaskSurface(page);
      const activeRunFooter = page.getByTestId('agent-tasks__message-active-run-footer');
      await expect(activeRunFooter.getByTestId('agent-tasks__message-active-run-status')).toContainText('Saving');
      await expect(agentTaskConversationTextarea(page)).toHaveAttribute(
        'placeholder',
        'Wait for the final results to finish saving before sending another message.',
      );
    },
    screenshotOptions: {
      maskTestIds: ['agent-tasks__message-active-run-elapsed'],
      maxDiffPixelRatio: 0.002,
    },
  },
  'agent-task-recovered-ready': {
    beforeNavigate: async ({ page, scenario }) => {
      await seedVisualAgentTaskRunState(page, scenario.route, 'idle');
    },
    afterNavigate: async ({ page }) => {
      await waitForVisualAgentTaskSurface(page);
      await expect(page.getByTestId('agent-tasks__message-active-run-footer')).toHaveCount(0);
      await expect(agentTaskConversationTextarea(page)).toBeEnabled();
    },
  },
  'agent-task-provider-upstream-error': {
    beforeNavigate: async ({ page, scenario }) => {
      const { taskId } = extractAgentTaskRouteParts(scenario.route);
      await seedVisualAgentTaskRunState(page, scenario.route, 'idle');
      await installVisualAgentTaskActivityOverride(page, scenario.route, [
        {
          id: 'msg_visual_provider_user',
          task_id: taskId,
          kind: 'user_intent',
          actor: 'user',
          content: 'Retry the same provider task once the upstream recovers.',
          created_at: '2026-04-12T09:14:00.000Z',
        },
        {
          id: 'msg_visual_provider_error',
          task_id: taskId,
          kind: 'runner_output',
          actor: 'runner',
          content: 'Provider returned an upstream error. Review the latest provider details, then retry from this same task when ready.',
          created_at: '2026-04-12T09:14:06.000Z',
          run_id: 'run_visual_provider_error_001',
        },
      ]);
      await installVisualAgentTaskTraceOverride(page, scenario.route, [
        {
          id: 'trace_visual_provider_001',
          task_id: taskId,
          message_id: 'msg_visual_provider_error',
          run_id: 'run_visual_provider_error_001',
          seq: 1,
          at: '2026-04-12T09:14:01.000Z',
          category: 'progress',
          phase: 'start',
          status: 'running',
          name: 'codex.exec',
          summary: 'Starting agent task execution',
        },
        {
          id: 'trace_visual_provider_002',
          task_id: taskId,
          message_id: 'msg_visual_provider_error',
          run_id: 'run_visual_provider_error_001',
          seq: 2,
          at: '2026-04-12T09:14:04.000Z',
          category: 'error',
          phase: 'end',
          status: 'error',
          name: 'provider.response',
          summary: 'Provider returned an upstream error',
          details: {
            code: 'UPSTREAM_500',
            provider: 'openai',
          },
        },
        {
          id: 'trace_visual_provider_003',
          task_id: taskId,
          message_id: 'msg_visual_provider_error',
          run_id: 'run_visual_provider_error_001',
          seq: 3,
          at: '2026-04-12T09:14:05.000Z',
          category: 'progress',
          phase: 'end',
          status: 'error',
          name: 'run.summary',
          summary: 'Agent task run failed',
          details: {
            final_status: 'error',
            duration_ms: 4000,
          },
        },
      ]);
    },
    afterNavigate: async ({ page }) => {
      await waitForVisualAgentTaskSurface(page);
      await expect(page.getByTestId('agent-tasks__agent-message-bubble')).toBeVisible();
      await expect(page.getByTestId('agent-tasks__message-run-status')).toContainText('Needs retry', {
        timeout: 15_000,
      });
      await expect(page.getByTestId('agent-tasks__message-final-answer')).toContainText('upstream error');
      await expect(page.getByTestId('agent-tasks__send-btn')).toBeVisible();
      await expect(agentTaskConversationTextarea(page)).toBeEnabled();
    },
  },
  'agent-task-running': {
    beforeNavigate: async ({ page, scenario }) => {
      await seedVisualAgentTaskRunState(page, scenario.route, 'running');
    },
    afterNavigate: async ({ page }) => {
      await expectVisualAgentTaskActiveRunFooter(page);
      await expect(agentTaskConversationTextarea(page)).toBeEnabled();
    },
    screenshotOptions: {
      maskTestIds: ['agent-tasks__message-active-run-elapsed'],
      maxDiffPixelRatio: 0.008,
    },
  },
  'agent-task-running-long-action-narrow': {
    beforeNavigate: async ({ page, scenario }) => {
      await seedVisualAgentTaskLongActionRunState(page, scenario.route);
    },
    afterNavigate: async ({ page }) => {
      await expectVisualAgentTaskLongActiveRunFooterLayout(page);
      await expect(agentTaskConversationTextarea(page)).toBeEnabled();
    },
    screenshotOptions: {
      maskTestIds: ['agent-tasks__message-active-run-elapsed'],
      maxDiffPixelRatio: 0.008,
    },
  },
  'agent-task-terminating': {
    beforeNavigate: async ({ page, scenario }) => {
      await seedVisualAgentTaskRunState(page, scenario.route, 'terminating');
    },
    afterNavigate: async ({ page }) => {
      await waitForVisualAgentTaskSurface(page);
      const activeRunFooter = page.getByTestId('agent-tasks__message-active-run-footer');
      await expect(activeRunFooter.getByTestId('agent-tasks__message-active-run-status')).toContainText('Stopping');
      await expect(agentTaskConversationTextarea(page)).toHaveAttribute(
        'placeholder',
        'Wait for the current execution environment to finish stopping before sending another message.',
      );
    },
    screenshotOptions: {
      maskTestIds: ['agent-tasks__message-active-run-elapsed'],
      maxDiffPixelRatio: 0.002,
    },
  },
  'agent-task-terminal-truth-unavailable': {
    beforeNavigate: async ({ page, scenario }) => {
      await seedVisualAgentTaskConversationHistory(page, scenario.route);
      await seedVisualMswHeaders(page, {
        'x-mock-terminal-truth': 'unavailable',
      });
    },
    afterNavigate: async ({ page }) => {
      await expect(page.getByTestId('agent-task__task-header')).toHaveAttribute('data-terminal-truth-state', 'unavailable', {
        timeout: 15_000,
      });
      await expect(page.getByTestId('agent-tasks__task-terminal-truth-unavailable')).toBeVisible();
      await expect(page.getByTestId('agent-tasks__task-terminal-truth-unavailable-retry')).toHaveText('Retry terminal status check');
      await expect(page.getByTestId('agent-tasks__conversation-blocked-state')).toHaveCount(0);
      await expect(agentTaskConversationTextarea(page)).toBeDisabled();
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

function parseCatalogViewportNote(setupNotes: readonly string[]): { width: number; height: number } | null {
  const viewportNotes = setupNotes.filter((note) => note.startsWith('viewport:'));
  if (viewportNotes.length === 0) {
    return null;
  }
  if (viewportNotes.length > 1) {
    throw new Error(`Visual scenario has multiple viewport setup notes: ${viewportNotes.join(', ')}`);
  }

  const viewportNote = viewportNotes[0];
  if (!viewportNote) {
    return null;
  }
  const match = /^viewport:(\d{3,4})x(\d{3,4})$/.exec(viewportNote);
  if (!match) {
    throw new Error(`Unsupported visual viewport setup note: ${viewportNote}`);
  }
  const [, widthText, heightText] = match;
  if (!widthText || !heightText) {
    throw new Error(`Unsupported visual viewport setup note: ${viewportNote}`);
  }

  const width = Number.parseInt(widthText, 10);
  const height = Number.parseInt(heightText, 10);
  if (width < 320 || height < 240) {
    throw new Error(`Visual viewport setup note is too small: ${viewportNote}`);
  }
  return { width, height };
}

async function applyCatalogViewport(page: Page, scenario: VisualBaselineExecutorScenario) {
  const notedViewport = parseCatalogViewportNote(scenario.setupNotes);
  if (notedViewport) {
    await page.setViewportSize(notedViewport);
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
  actualCapture: Buffer;
  scenario: VisualBaselineExecutorScenario;
  entry: VisualBaselineCatalogEntry;
}) {
  const captureRoot = resolveRunBoundActualCaptureRoot();
  if (!captureRoot) {
    return;
  }

  const targetPath = path.join(captureRoot, args.scenario.scenarioId, args.entry.screenshot);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, args.actualCapture);
}

function parseScreenshotMaskColor(maskColor: string | undefined): [number, number, number, number] {
  const normalized = (maskColor ?? '#FF00FF').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return [
      Number.parseInt(normalized.slice(1, 3), 16),
      Number.parseInt(normalized.slice(3, 5), 16),
      Number.parseInt(normalized.slice(5, 7), 16),
      255,
    ];
  }
  if (/^#[0-9a-fA-F]{8}$/.test(normalized)) {
    return [
      Number.parseInt(normalized.slice(1, 3), 16),
      Number.parseInt(normalized.slice(3, 5), 16),
      Number.parseInt(normalized.slice(5, 7), 16),
      Number.parseInt(normalized.slice(7, 9), 16),
    ];
  }
  return [255, 0, 255, 255];
}

async function resolveScreenshotMaskBoxes(page: Page, testIds: string[] | undefined) {
  if (!testIds || testIds.length === 0) {
    return [];
  }

  const boxes = await Promise.all(testIds.map(async (testId) => {
    const locator = page.getByTestId(testId);
    const visible = await locator.first().isVisible().catch(() => false);
    if (!visible) {
      return null;
    }
    return locator.first().boundingBox().catch(() => null);
  }));

  return boxes
    .filter((box): box is NonNullable<typeof box> => box !== null)
    .map((box) => ({
      x: Math.max(0, Math.floor(box.x)),
      y: Math.max(0, Math.floor(box.y)),
      width: Math.max(0, Math.ceil(box.width)),
      height: Math.max(0, Math.ceil(box.height)),
    }))
    .filter((box) => box.width > 0 && box.height > 0);
}

async function applyScreenshotMaskBoxes(args: {
  screenshot: Buffer;
  maskBoxes: Array<{ x: number; y: number; width: number; height: number }>;
  maskColor: string | undefined;
}) {
  if (args.maskBoxes.length === 0) {
    return args.screenshot;
  }

  const pngCodec = await getScreenshotPngCodec();
  const png = pngCodec.sync.read(args.screenshot);
  const [red, green, blue, alpha] = parseScreenshotMaskColor(args.maskColor);

  for (const box of args.maskBoxes) {
    const left = Math.max(0, Math.min(png.width, box.x));
    const top = Math.max(0, Math.min(png.height, box.y));
    const right = Math.max(left, Math.min(png.width, box.x + box.width));
    const bottom = Math.max(top, Math.min(png.height, box.y + box.height));

    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = (y * png.width + x) * 4;
        png.data[index] = red;
        png.data[index + 1] = green;
        png.data[index + 2] = blue;
        png.data[index + 3] = alpha;
      }
    }
  }

  return pngCodec.sync.write(png);
}

async function captureSnapshotBoundActualScreenshot(args: {
  page: Page;
  entry: VisualBaselineCatalogEntry;
  screenshotOptions: VisualScreenshotOptions;
}): Promise<Buffer> {
  const testInfo = test.info() as {
    config: {
      updateSnapshots: 'all' | 'changed' | 'missing' | 'none';
    };
    snapshotPath: (name: string, options: { kind: 'screenshot' }) => string;
    _projectInternal?: {
      expect?: {
        toHaveScreenshot?: {
          animations?: 'disabled' | 'allow';
          caret?: 'hide' | 'initial';
          comparator?: string;
          maskColor?: string;
          maxDiffPixels?: number;
          maxDiffPixelRatio?: number;
          omitBackground?: boolean;
          scale?: 'css' | 'device';
          threshold?: number;
          timeout?: number;
        };
      };
    };
  };
  const configOptions = testInfo._projectInternal?.expect?.toHaveScreenshot ?? {};
  const updateSnapshots = testInfo.config.updateSnapshots;
  const expectedPath = testInfo.snapshotPath(args.entry.screenshot, { kind: 'screenshot' });
  const hasExpected = existsSync(expectedPath);
  const expected = hasExpected ? readFileSync(expectedPath) : undefined;
  const maskBoxes = await resolveScreenshotMaskBoxes(args.page, args.screenshotOptions.maskTestIds);
  const capturePageScreenshot = () => args.page.screenshot({
    animations: configOptions.animations ?? 'disabled',
    caret: configOptions.caret ?? 'hide',
    fullPage: args.screenshotOptions.fullPage,
    maskColor: configOptions.maskColor,
    omitBackground: configOptions.omitBackground,
    scale: configOptions.scale ?? 'css',
  });
  const actual = await capturePageScreenshot();

  if (updateSnapshots === 'all' || updateSnapshots === 'changed') {
    mkdirSync(path.dirname(expectedPath), { recursive: true });
    writeFileSync(expectedPath, actual);
    return actual;
  }

  if (!expected) {
    if (updateSnapshots !== 'none') {
      mkdirSync(path.dirname(expectedPath), { recursive: true });
      writeFileSync(expectedPath, actual);
      return actual;
    }
    throw new Error(`Missing expected visual baseline for ${args.entry.screenshot}`);
  }

  const screenshotComparator = await getScreenshotComparator();
  const maskedExpected = await applyScreenshotMaskBoxes({
    screenshot: expected,
    maskBoxes,
    maskColor: configOptions.maskColor,
  });
  const compareScreenshots = async (candidate: Buffer) => screenshotComparator(await applyScreenshotMaskBoxes({
    screenshot: candidate,
    maskBoxes,
    maskColor: configOptions.maskColor,
  }), maskedExpected, {
    comparator: configOptions.comparator,
    maxDiffPixels: configOptions.maxDiffPixels,
    maxDiffPixelRatio: args.screenshotOptions.maxDiffPixelRatio ?? configOptions.maxDiffPixelRatio,
    threshold: configOptions.threshold,
  });
  const stabilizeAttempts = Math.max(args.screenshotOptions.stabilizeAttempts ?? 1, 1);
  const stabilizeDelayMs = Math.max(args.screenshotOptions.stabilizeDelayMs ?? 0, 0);
  let comparison = await compareScreenshots(actual);
  let failedActual = actual;
  for (let attempt = 1; comparison && attempt < stabilizeAttempts; attempt += 1) {
    if (stabilizeDelayMs > 0) {
      await args.page.waitForTimeout(stabilizeDelayMs);
    }
    failedActual = await capturePageScreenshot();
    comparison = await compareScreenshots(failedActual);
  }
  if (comparison) {
    throw new Error(comparison.errorMessage);
  }

  return failedActual;
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
  await waitForVisualRouteWorkspaceIdentityReady(page, scenario);
  const actualCapture = await captureSnapshotBoundActualScreenshot({
    page,
    entry,
    screenshotOptions,
  });
  await writeRunBoundActualCapture({
    actualCapture,
    scenario,
    entry,
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
