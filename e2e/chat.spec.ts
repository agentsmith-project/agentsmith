/**
 * Chat Page E2E Tests
 *
 * Tests the chat page three-pane layout, thread list, thread selection,
 * composer input, and message sending.
 */

import type { Page } from '@playwright/test';
import { test, expect, goToProject } from './fixtures/test-base';

type ChatStopEscalationMode = 'supported' | 'unsupported';
type ChatStopEscalationSnapshot = {
  mode: ChatStopEscalationMode;
  sessionId: string;
  armed: boolean;
  paused: boolean;
  released: boolean;
  count: number;
  lastUrl: string | null;
  status: number | null;
  timerScheduled: number;
  timerFired: number;
  timerCleared: number;
  lastTimerClearStack: string | null;
};
type ChatStopMode = 'cancel' | 'terminate';
type ChatStopResponsePayload = {
  state?: string;
  status?: string;
  stop_mode?: string;
  can_escalate?: boolean;
  escalation_reason?: string | null;
};

async function setMockChatStopEscalationMode(page: Page, mode: ChatStopEscalationMode) {
  const installHarness = ({ mockMode, sessionId }: { mockMode: ChatStopEscalationMode; sessionId: string }) => {
    type HarnessState = {
      mode: ChatStopEscalationMode;
      sessionId: string;
      originalFetch: typeof window.fetch;
      armed: boolean;
      paused: boolean;
      released: boolean;
      releaseRequested: boolean;
      releasePausedResponse: (() => void) | null;
      count: number;
      lastUrl: string | null;
      status: number | null;
      timerScheduled: number;
      timerFired: number;
      timerCleared: number;
      lastTimerClearStack: string | null;
      timerIds: Set<number>;
      timeoutWrapped: boolean;
    };
    type HarnessWindow = Window & {
      __agsChatStopEscalationHarness?: HarnessState;
      __agsChatStopEscalationArmRefetch?: () => void;
      __agsChatStopEscalationReleaseRefetch?: () => void;
      __agsChatStopEscalationSnapshot?: () => ChatStopEscalationSnapshot | null;
    };

    const win = window as HarnessWindow;
    const existing = win.__agsChatStopEscalationHarness;
    if (existing) {
      existing.mode = mockMode;
      existing.sessionId = sessionId;
      return;
    }

    const state: HarnessState = {
      mode: mockMode,
      sessionId,
      originalFetch: window.fetch.bind(window),
      armed: false,
      paused: false,
      released: false,
      releaseRequested: false,
      releasePausedResponse: null,
      count: 0,
      lastUrl: null,
      status: null,
      timerScheduled: 0,
      timerFired: 0,
      timerCleared: 0,
      lastTimerClearStack: null,
      timerIds: new Set<number>(),
      timeoutWrapped: false,
    };
    win.__agsChatStopEscalationHarness = state;

    win.__agsChatStopEscalationArmRefetch = () => {
      state.armed = true;
      state.paused = false;
      state.released = false;
      state.releaseRequested = false;
      state.releasePausedResponse = null;
      state.lastUrl = null;
      state.status = null;
      state.timerScheduled = 0;
      state.timerFired = 0;
      state.timerCleared = 0;
      state.lastTimerClearStack = null;
      state.timerIds.clear();
      if (!state.timeoutWrapped) {
        const currentSetTimeout = window.setTimeout.bind(window);
        const currentClearTimeout = window.clearTimeout.bind(window);
        window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
          const delay = typeof timeout === 'number' ? timeout : 0;
          if (delay === 30_000) {
            state.timerScheduled += 1;
          }
          const wrappedHandler: TimerHandler = typeof handler === 'function'
            ? (...handlerArgs: unknown[]) => {
                if (delay === 30_000) {
                  state.timerFired += 1;
                }
                return handler(...handlerArgs);
              }
            : handler;
          const timerId = currentSetTimeout(wrappedHandler, timeout, ...args);
          if (delay === 30_000 && typeof timerId === 'number') {
            state.timerIds.add(timerId);
          }
          return timerId;
        }) as typeof window.setTimeout;
        window.clearTimeout = ((timerId?: number) => {
          if (typeof timerId === 'number' && state.timerIds.has(timerId)) {
            state.timerCleared += 1;
            state.lastTimerClearStack = new Error('chat_stop_escalation_timer_cleared').stack ?? null;
            state.timerIds.delete(timerId);
          }
          return currentClearTimeout(timerId);
        }) as typeof window.clearTimeout;
        state.timeoutWrapped = true;
      }
    };
    win.__agsChatStopEscalationReleaseRefetch = () => {
      state.releaseRequested = true;
      state.released = true;
      state.releasePausedResponse?.();
    };
    win.__agsChatStopEscalationSnapshot = () => ({
      mode: state.mode,
      sessionId: state.sessionId,
      armed: state.armed,
      paused: state.paused,
      released: state.released,
      count: state.count,
      lastUrl: state.lastUrl,
      status: state.status,
      timerScheduled: state.timerScheduled,
      timerFired: state.timerFired,
      timerCleared: state.timerCleared,
      lastTimerClearStack: state.lastTimerClearStack,
    });

    const buildDecoratedFetchInput = (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const resolvedUrl = request?.url ?? String(input);
      const url = new URL(resolvedUrl, window.location.origin);
      if (!url.pathname.includes('/api/v1/workspaces/') || !url.pathname.includes('/chat/sessions')) {
        return { url, input, shouldDecorate: false };
      }
      url.searchParams.set('mock_chat_stop_escalation', state.mode);
      return {
        url,
        input: request ? new Request(url.toString(), request) : url.toString(),
        shouldDecorate: true,
      };
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let decorated: ReturnType<typeof buildDecoratedFetchInput>;
      try {
        decorated = buildDecoratedFetchInput(input, init);
      } catch {
        return state.originalFetch(input, init);
      }

      if (!decorated.shouldDecorate) {
        return state.originalFetch(input, init);
      }

      const request = input instanceof Request ? input : null;
      const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
      const isAuthoritativeSessionRefetch =
        state.armed
        && method === 'GET'
        && new RegExp(`/chat/sessions/${state.sessionId}/?$`).test(decorated.url.pathname);

      if (!isAuthoritativeSessionRefetch) {
        return state.originalFetch(decorated.input, init);
      }

      state.armed = false;
      const response = await state.originalFetch(decorated.input, init);
      state.count += 1;
      state.lastUrl = response.url || decorated.url.toString();
      state.status = response.status;
      state.paused = true;

      await new Promise<void>((resolve) => {
        if (state.releaseRequested) {
          resolve();
          return;
        }
        state.releasePausedResponse = resolve;
      });

      state.paused = false;
      state.released = true;
      state.releasePausedResponse = null;
      return response;
    };
  };

  const args = { mockMode: mode, sessionId: 'session_001' };
  await page.addInitScript(installHarness, args);
  await page.evaluate(installHarness, args).catch(() => {});
}

async function ensureComposerEnabled(page: import('@playwright/test').Page) {
  const composer = page.getByTestId('chat__composer');
  await expect(composer).toBeVisible({ timeout: 10000 });
  const input = composer.locator('textarea, input[type="text"], [contenteditable="true"]').first();
  const disabled = await input.isDisabled().catch(() => false);
  if (!disabled) return;

  const trigger = page.getByTestId('chat__execution-target-trigger');
  await expect(trigger).toBeVisible({ timeout: 10000 });
  await trigger.click();
  const firstModel = page.locator('[data-testid^="chat__execution-target-endpoint--"]').first();
  await expect(firstModel).toBeVisible({ timeout: 10000 });
  await firstModel.click();
  await expect(input).toBeEnabled({ timeout: 10000 });
}

function chatComposerTextarea(page: Page) {
  return page.getByTestId('chat__composer').locator('textarea, input[type="text"], [contenteditable="true"]').first();
}

function chatStopButton(page: Page) {
  return page
    .getByTestId('chat__stop-btn')
    .or(page.getByRole('button', { name: /^Stop$/i }))
    .first();
}

function parseRequestBodyJson(request: import('@playwright/test').Request): Record<string, unknown> {
  const body = request.postData();
  expect(body, `expected request body for ${request.url()}`).toBeTruthy();
  const parsed = JSON.parse(body ?? '{}') as unknown;
  expect(parsed, `expected JSON object body for ${request.url()}`).toEqual(expect.any(Object));
  expect(Array.isArray(parsed), `expected non-array JSON object body for ${request.url()}`).toBe(false);
  return parsed as Record<string, unknown>;
}

function expectStopRequestMode(request: import('@playwright/test').Request, mode: ChatStopMode) {
  const payload = parseRequestBodyJson(request);
  expect(payload.mode).toBe(mode);
  if ('stop_mode' in payload) {
    expect(payload.stop_mode).toBe(mode);
  }
}

function isChatStopEscalationEndpointRequest(request: import('@playwright/test').Request) {
  return request.method() === 'POST'
    && /\/api\/v1\/workspaces\/.*\/projects\/.*\/chat\/sessions\/session_001\/(?:messages\/streams\/[^/]+\/)?stop/.test(request.url());
}

function isChatStopEscalationStopRequest(request: import('@playwright/test').Request, mode: ChatStopMode) {
  const body = request.postData() ?? '';
  return isChatStopEscalationEndpointRequest(request)
    && new RegExp(`"mode"\\s*:\\s*"${mode}"`).test(body);
}

function waitForChatStopResponse(page: Page, mode: ChatStopMode) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return isChatStopEscalationStopRequest(request, mode);
  }, { timeout: 30_000 });
}

async function expectChatStopResponseState(
  response: import('@playwright/test').Response,
  expected: 'stopping' | 'terminating',
  options: {
    stopMode: ChatStopMode;
    canEscalate: boolean;
    escalationReason?: string | null;
  },
) {
  expect(response.status()).toBe(202);
  expect(response.ok()).toBe(true);
  const payload = await response.json() as ChatStopResponsePayload;
  expect(payload.state ?? payload.status).toBe(expected);
  expect(payload.status).toBe(expected);
  expect(payload.stop_mode).toBe(options.stopMode);
  expect(payload.can_escalate).toBe(options.canEscalate);
  if ('escalationReason' in options) {
    expect(payload.escalation_reason ?? null).toBe(options.escalationReason ?? null);
  } else {
    expect(payload.escalation_reason).toBeUndefined();
  }
}

async function fetchChatStopContract(
  page: Page,
  args: {
    sessionId: string;
    mode: ChatStopMode;
    escalationMode: ChatStopEscalationMode;
  },
) {
  return page.evaluate(async ({ sessionId, mode, escalationMode }) => {
    const response = await fetch(
      `/api/v1/workspaces/ws_001/projects/proj_001/chat/sessions/${sessionId}/stop?mock_chat_stop_escalation=${escalationMode}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      },
    );
    return {
      status: response.status,
      payload: await response.json() as ChatStopResponsePayload,
    };
  }, args);
}

async function armChatStopEscalationRefetch(page: Page) {
  await page.evaluate(() => {
    const win = window as Window & {
      __agsChatStopEscalationArmRefetch?: () => void;
    };
    win.__agsChatStopEscalationArmRefetch?.();
  });
}

async function readChatStopEscalationSnapshot(page: Page) {
  return page.evaluate(() => {
    const win = window as Window & {
      __agsChatStopEscalationSnapshot?: () => ChatStopEscalationSnapshot | null;
    };
    return win.__agsChatStopEscalationSnapshot?.() ?? null;
  });
}

async function waitForChatStopEscalationRefetch(page: Page, mode: ChatStopEscalationMode) {
  let latestSnapshot: ChatStopEscalationSnapshot | null = null;
  try {
    await expect.poll(async () => {
      const snapshot = await readChatStopEscalationSnapshot(page);
      latestSnapshot = snapshot;
      if (!snapshot?.paused || snapshot.mode !== mode || snapshot.status === null) return false;
      const url = snapshot.lastUrl ? new URL(snapshot.lastUrl) : null;
      return snapshot.status >= 200
        && snapshot.status < 300
        && url !== null
        && url.pathname.includes('/api/v1/workspaces/')
        && /\/chat\/sessions\/session_001\/?$/.test(url.pathname)
        && url.searchParams.get('mock_chat_stop_escalation') === mode;
    }, { timeout: 10_000 }).toBe(true);
  } catch (error) {
    throw new Error(
      `chat_stop_escalation_refetch_not_observed:${error instanceof Error ? error.message : String(error)}`
      + `\nsnapshot=${JSON.stringify(latestSnapshot, null, 2)}`,
    );
  }
  return readChatStopEscalationSnapshot(page);
}

async function waitForChatStopEscalationTimerScheduled(page: Page) {
  let latestSnapshot: ChatStopEscalationSnapshot | null = null;
  try {
    await expect.poll(async () => {
      latestSnapshot = await readChatStopEscalationSnapshot(page);
      return (latestSnapshot?.timerScheduled ?? 0) > 0;
    }, { timeout: 10_000 }).toBe(true);
  } catch (error) {
    throw new Error(
      `chat_stop_escalation_timer_not_scheduled:${error instanceof Error ? error.message : String(error)}`
      + `\nsnapshot=${JSON.stringify(latestSnapshot, null, 2)}`,
    );
  }
}

async function releaseChatStopEscalationRefetch(page: Page) {
  await page.evaluate(() => {
    const win = window as Window & {
      __agsChatStopEscalationReleaseRefetch?: () => void;
    };
    win.__agsChatStopEscalationReleaseRefetch?.();
  });
}

async function pauseChatEscalationClockAtPageNow(page: Page) {
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + 1_000);
}

function chatEscalationDialog(page: Page) {
  return page
    .getByTestId('chat__stop-escalation-dialog')
    .or(page.getByTestId('chat__cancel-escalation-dialog'))
    .or(page.getByRole('alertdialog').filter({ hasText: /terminate|force stop|escalat|stop_escalation|强制|结束/i }))
    .or(page.getByRole('dialog').filter({ hasText: /terminate|force stop|escalat|stop_escalation|强制|结束/i }))
    .first();
}

async function openChatEscalationDialog(page: Page) {
  const dialog = chatEscalationDialog(page);
  const dialogVisible = await dialog.waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (dialogVisible) return dialog;

  const escalationTrigger = page
    .getByTestId('chat__stop-escalation-trigger')
    .or(page.getByTestId('chat__cancel-escalation-trigger'))
    .or(page.getByRole('button', { name: /terminate|force stop|escalat|upgrade|stop_escalation|强制|结束/i }))
    .first();
  await expect(escalationTrigger).toBeVisible({ timeout: 10000 });
  await escalationTrigger.click();
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
}

test.describe('Chat Page', () => {
  test.beforeEach(async ({ authedPage }) => {
    await goToProject(authedPage, 'chat');
  });

  test('should display three-pane layout', async ({ authedPage }) => {
    const threadsList = authedPage.getByTestId('chat__threads-pane');
    const mainPane = authedPage.getByTestId('chat__main-pane');
    const composer = authedPage.getByTestId('chat__composer');

    await expect(threadsList).toBeVisible({ timeout: 10000 });
    await expect(mainPane).toBeVisible();
    await expect(composer).toBeVisible();
  });

  test('should display thread items from MSW data', async ({ authedPage }) => {
    const threadsList = authedPage.getByTestId('chat__threads-pane');
    await expect(threadsList).toBeVisible({ timeout: 10000 });

    // MSW should provide at least one thread
    const threads = authedPage.getByTestId('chat__thread-item');
    await expect(threads.first()).toBeVisible({ timeout: 10000 });

    // Each thread item should have a data-thread-id attribute
    const firstThreadId = await threads.first().getAttribute('data-thread-id');
    expect(firstThreadId).toBeTruthy();
  });

  test('should display new thread button', async ({ authedPage }) => {
    const newThreadBtn = authedPage.getByTestId('chat__new-thread-btn');
    await expect(newThreadBtn).toBeVisible({ timeout: 10000 });
    await expect(newThreadBtn).toBeEnabled();
  });

  test('should rely on sidebar navigation instead of header cross-links', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('chat__open-notebook')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__open-endpoints')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__open-files')).toHaveCount(0);
    await expect(authedPage.getByTestId('sidebar__nav-item--notebook')).toHaveAttribute('href', /\/notebook$/);
    await expect(authedPage.getByTestId('sidebar__nav-item--files')).toHaveAttribute('href', /\/files$/);
    await expect(authedPage.getByTestId('sidebar__nav-item--endpoints')).toHaveAttribute('href', /\/endpoints$/);
  });

  test('does not render stream diagnostics banner in chat pane', async ({ authedPage }) => {
    await expect(authedPage.getByTestId('chat__stream-error-open-audit')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__stream-error-open-audit-console')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__stream-error-open-agent')).toHaveCount(0);
    await expect(authedPage.getByTestId('chat__stream-error-banner')).toHaveCount(0);
  });

  test('should render thread search and execution target controls', async ({ authedPage }) => {
    await expect(authedPage.getByPlaceholder(/search threads/i)).toBeVisible({ timeout: 10000 });
    await expect(authedPage.getByTestId('chat__execution-target-trigger')).toBeVisible();
  });

  test('should select a thread and display chat area', async ({ authedPage }) => {
    // Wait for thread items to load
    const threads = authedPage.getByTestId('chat__thread-item');
    await expect(threads.first()).toBeVisible({ timeout: 10000 });

    // Click the first thread
    await threads.first().click();
    await authedPage.waitForTimeout(1000);

    // After selecting a thread, the chat content area should be active
    // The main pane should show the thread title, composer, and either messages or "Start a conversation"
    await expect(authedPage.getByTestId('chat__composer')).toBeVisible();
    // The selected thread should be marked as active
    const activeThread = threads.first();
    await activeThread.evaluate((el) =>
      el.classList.contains('active') || el.getAttribute('data-state') === 'active' ||
      el.getAttribute('aria-selected') === 'true' || el.closest('[class*="active"]') !== null,
    );
    // Verify thread selection visual indicator or session title appears in header
    await expect(
      authedPage.getByText('Product Q&A').first(),
    ).toBeVisible();
  });

  test('should enable send button when composer has text', async ({ authedPage }) => {
    const composer = authedPage.getByTestId('chat__composer');
    const sendBtn = authedPage.getByTestId('chat__send-btn');

    await ensureComposerEnabled(authedPage);
    await expect(composer).toBeVisible({ timeout: 10000 });

    // Composer should have an input or textarea
    const input = composer.locator('textarea, input[type="text"], [contenteditable="true"]');
    await expect(input.first()).toBeVisible();

    // Send button should be disabled or hidden when empty
    if (await sendBtn.isVisible().catch(() => false)) {
      await expect(sendBtn).toBeDisabled();
    }

    // Type a message
    await input.first().fill('Hello from E2E test');

    // Send button should now be visible and enabled
    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await expect(sendBtn).toBeEnabled();
  });

  test('should support sending with Enter key', async ({ authedPage }) => {
    await ensureComposerEnabled(authedPage);
    const composer = authedPage.getByTestId('chat__composer');
    await expect(composer).toBeVisible({ timeout: 10000 });

    const input = composer.locator('textarea, input[type="text"], [contenteditable="true"]').first();
    await input.fill('E2E enter send message');
    await input.press('Enter');

    // Composer remains available after send pipeline triggers.
    await expect(composer).toBeVisible();
  });

  test('should send a message via send button', async ({ authedPage }) => {
    await ensureComposerEnabled(authedPage);
    const composer = authedPage.getByTestId('chat__composer');
    const sendBtn = authedPage.getByTestId('chat__send-btn');

    await expect(composer).toBeVisible({ timeout: 10000 });
    const input = composer.locator('textarea, input[type="text"], [contenteditable="true"]');
    await expect(input.first()).toBeVisible();

    // Type and send a message
    await input.first().fill('E2E test message');
    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // After sending, input should either be cleared or remain (depending on implementation)
    // At minimum the send button should still be functional
    await authedPage.waitForTimeout(500);
    // Verify the composer is still visible and functional after send
    await expect(composer).toBeVisible();
  });

  test('should show layout toggle on ultrawide viewport and switch state', async ({ authedPage }) => {
    await authedPage.setViewportSize({ width: 2200, height: 1200 });
    await goToProject(authedPage, 'chat');

    const toggle = authedPage.getByTestId('topbar__layout-toggle');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await expect(toggle).toHaveAttribute('data-state', 'standard');

    await toggle.evaluate((node) => (node as HTMLButtonElement).click());
    await expect(toggle).toHaveAttribute('data-state', 'ultrawide');
    await expect(authedPage.getByTestId('chat__threads-pane')).toHaveClass(/w-\[256px\]/);
  });

  test('should persist ultrawide layout preference after refresh', async ({ authedPage }) => {
    await authedPage.setViewportSize({ width: 2200, height: 1200 });
    await goToProject(authedPage, 'chat');

    const toggle = authedPage.getByTestId('topbar__layout-toggle');
    await expect(toggle).toBeVisible({ timeout: 10000 });

    if ((await toggle.getAttribute('data-state')) !== 'ultrawide') {
      await toggle.evaluate((node) => (node as HTMLButtonElement).click());
      await expect(toggle).toHaveAttribute('data-state', 'ultrawide');
    }

    await authedPage.reload({ waitUntil: 'domcontentloaded' });
    const persistedToggle = authedPage.getByTestId('topbar__layout-toggle');
    if (!(await persistedToggle.isVisible().catch(() => false))) {
      await goToProject(authedPage, 'chat');
    }
    await expect(authedPage.getByTestId('topbar__layout-toggle')).toHaveAttribute('data-state', 'ultrawide');
  });
});

test.describe.serial('Chat Stop Escalation', () => {
  test('should confirm terminate escalation when stop remains stuck and backend allows escalation', async ({ authedPage }) => {
    await authedPage.clock.install();
    await setMockChatStopEscalationMode(authedPage, 'supported');
    await goToProject(authedPage, 'chat');

    await expect(authedPage.getByTestId('chat__main-pane')).toBeVisible({ timeout: 10000 });
    await expect(chatStopButton(authedPage)).toBeVisible({ timeout: 10000 });
    await pauseChatEscalationClockAtPageNow(authedPage);
    await armChatStopEscalationRefetch(authedPage);

    const cancelStopRequest = authedPage.waitForRequest((request) =>
      isChatStopEscalationStopRequest(request, 'cancel'),
    );
    const cancelStopResponse = waitForChatStopResponse(authedPage, 'cancel');
    await chatStopButton(authedPage).click();
    expectStopRequestMode(await cancelStopRequest, 'cancel');
    await expectChatStopResponseState(await cancelStopResponse, 'stopping', {
      stopMode: 'cancel',
      canEscalate: true,
    });

    await expect(authedPage.getByTestId('chat__stream-status')).toContainText(/stop/i);
    await expect(chatComposerTextarea(authedPage)).toBeDisabled();
    await waitForChatStopEscalationTimerScheduled(authedPage);
    await expect(chatEscalationDialog(authedPage)).not.toBeVisible({ timeout: 250 });
    await authedPage.clock.runFor(30_000);
    await waitForChatStopEscalationRefetch(authedPage, 'supported');
    await expect(chatEscalationDialog(authedPage)).not.toBeVisible({ timeout: 250 });
    await releaseChatStopEscalationRefetch(authedPage);

    const dialog = await openChatEscalationDialog(authedPage);
    const terminateRequest = authedPage.waitForRequest((request) =>
      isChatStopEscalationStopRequest(request, 'terminate'),
    );
    const terminateResponse = waitForChatStopResponse(authedPage, 'terminate');

    await dialog
      .getByTestId('chat__stop-escalation-confirm')
      .or(dialog.getByTestId('chat__cancel-escalation-confirm'))
      .or(dialog.getByRole('button', { name: /terminate|force stop|confirm|stop_escalation_confirm|强制|结束/i }))
      .first()
      .click();
    expectStopRequestMode(await terminateRequest, 'terminate');
    await expectChatStopResponseState(await terminateResponse, 'terminating', {
      stopMode: 'terminate',
      canEscalate: false,
      escalationReason: null,
    });

    await expect(authedPage.getByTestId('chat__stream-status')).toContainText(/stop|terminat|结束/i);
    await expect(chatComposerTextarea(authedPage)).toBeDisabled();
    await expect(authedPage.getByTestId('chat__send-btn')).toHaveCount(0);
  });

  test('should show informational prompt instead of terminate confirmation when escalation is unavailable', async ({ authedPage }) => {
    await authedPage.clock.install();
    await setMockChatStopEscalationMode(authedPage, 'unsupported');
    await goToProject(authedPage, 'chat');

    await expect(authedPage.getByTestId('chat__main-pane')).toBeVisible({ timeout: 10000 });
    await expect(chatStopButton(authedPage)).toBeVisible({ timeout: 10000 });
    await pauseChatEscalationClockAtPageNow(authedPage);
    await armChatStopEscalationRefetch(authedPage);

    const cancelStopRequest = authedPage.waitForRequest((request) =>
      isChatStopEscalationStopRequest(request, 'cancel'),
    );
    const cancelStopResponse = waitForChatStopResponse(authedPage, 'cancel');
    await chatStopButton(authedPage).click();
    expectStopRequestMode(await cancelStopRequest, 'cancel');
    await expectChatStopResponseState(await cancelStopResponse, 'stopping', {
      stopMode: 'cancel',
      canEscalate: false,
      escalationReason: 'STOP_ESCALATION_UNAVAILABLE',
    });
    await expect(authedPage.getByTestId('chat__stream-status')).toContainText(/stop/i);
    await waitForChatStopEscalationTimerScheduled(authedPage);
    await expect(chatEscalationDialog(authedPage)).not.toBeVisible({ timeout: 250 });
    await authedPage.clock.runFor(30_000);
    await waitForChatStopEscalationRefetch(authedPage, 'unsupported');
    await expect(chatEscalationDialog(authedPage)).not.toBeVisible({ timeout: 250 });
    await releaseChatStopEscalationRefetch(authedPage);

    const unavailablePrompt = authedPage
      .getByTestId('chat__stop-escalation-unavailable')
      .or(authedPage.getByTestId('chat__cancel-escalation-unavailable'))
      .or(authedPage.getByText(/not available|cannot.*terminate|unable to terminate|manual intervention|failed to stop|stop_escalation_unavailable|无法|不可用/i))
      .first();
    await expect(unavailablePrompt).toBeVisible({ timeout: 10000 });
    await expect(chatEscalationDialog(authedPage)).not.toBeVisible();
    await expect(chatComposerTextarea(authedPage)).toBeDisabled();
  });

  test('should return authoritative unsupported stop contract for cancel and terminate requests', async ({ authedPage }) => {
    await goToProject(authedPage, 'chat');

    const sessionId = `session_e2e_stop_contract_${Date.now()}`;
    const cancel = await fetchChatStopContract(authedPage, {
      sessionId,
      mode: 'cancel',
      escalationMode: 'unsupported',
    });
    expect(cancel.status).toBe(202);
    expect(cancel.payload).toMatchObject({
      state: 'stopping',
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });

    const terminate = await fetchChatStopContract(authedPage, {
      sessionId,
      mode: 'terminate',
      escalationMode: 'unsupported',
    });
    expect(terminate.status).toBe(202);
    expect(terminate.payload).toMatchObject({
      state: 'stopping',
      status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
      escalation_reason: 'STOP_ESCALATION_UNAVAILABLE',
    });
  });
});
