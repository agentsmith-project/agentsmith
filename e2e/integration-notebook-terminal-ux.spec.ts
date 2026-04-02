import { expect, test, type Page } from '@playwright/test';
import {
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  LOCALE,
} from './integration-real-helpers';

const WORKSPACE_ID = process.env.INTEGRATION_NOTEBOOK_TERMINAL_WORKSPACE_ID ?? 'ws_default';
const PROJECT_ID = process.env.INTEGRATION_NOTEBOOK_TERMINAL_PROJECT_ID ?? 'proj_1775067184556_95890';
const AGENT_ID = process.env.INTEGRATION_NOTEBOOK_TERMINAL_AGENT_ID ?? '';
const TASK_ID = process.env.INTEGRATION_NOTEBOOK_TERMINAL_TASK_ID ?? '';
const API_BASE = process.env.INTEGRATION_API_BASE ?? 'http://localhost:21000';
const TERMINAL_SESSION_ROUTE = new RegExp(`${API_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/v1/workspaces/.+/projects/.+/tasks/.+/terminal/sessions$`);

async function loginThroughWorkspaceSelection(page: Page) {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/login/workspace`);
  await expect(page.getByTestId(`workspace-select__card--${WORKSPACE_ID}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`workspace-select__card--${WORKSPACE_ID}`).click();

  await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('workspace-login__keycloak-btn').click();
  await page.waitForURL(/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i, {
    timeout: 30_000,
  });
  await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(KEYCLOAK_DEV_ADMIN_USERNAME);
  await page.locator('input#password, input[name="password"]').first().fill(KEYCLOAK_DEV_ADMIN_PASSWORD);
  await page.locator('#kc-login, button[type="submit"]').first().click();
  await expect
    .poll(() => page.url(), { timeout: 60_000 })
    .toMatch(new RegExp(`/${LOCALE}/workspaces/${WORKSPACE_ID}(?:$|/projects)`));
}

async function resolveTerminalTaskId(page: Page, options?: { allowFallback?: boolean; preferFreshTask?: boolean }): Promise<string> {
  return page.evaluate(async ({ workspaceId, projectId, taskId, agentId, apiBase, allowFallback, preferFreshTask }) => {
    const stored = window.localStorage.getItem('agentsmith-auth');
    const parsed = stored ? JSON.parse(stored) as { state?: { token?: string | null } } : null;
    const bearer = parsed?.state?.token?.trim();
    if (!bearer) {
      throw new Error('auth_token_missing');
    }
    const taskBase = `${apiBase}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/tasks`;
    const headers = {
      Authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    };
    const fetchWithRetry = async (input: string, init?: RequestInit, attempts = 5): Promise<Response> => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const response = await fetch(input, init);
          return response;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      throw lastError instanceof Error ? lastError : new Error('terminal_task_fetch_failed');
    };
    if (taskId && !preferFreshTask) {
      const seedRes = await fetchWithRetry(`${taskBase}/${encodeURIComponent(taskId)}`, {
        headers: {
          Authorization: `Bearer ${bearer}`,
        },
      });
      if (seedRes.ok) {
        const seedTask = await seedRes.json() as { id?: string };
        if (seedTask.id) {
          return seedTask.id;
        }
      }
    }
    let resolvedAgentId = agentId;
    if (!preferFreshTask) {
      const listRes = await fetchWithRetry(taskBase, {
        headers: {
          Authorization: `Bearer ${bearer}`,
        },
      });
      if (listRes.ok) {
        const listed = await listRes.json() as { items?: Array<{ id?: string; status?: string; agent_id?: string }> };
        const matchingActiveTask = (listed.items ?? []).find(
          (item) => item.status === 'active' && item.id && item.agent_id && (!resolvedAgentId || item.agent_id === resolvedAgentId),
        );
        if (matchingActiveTask?.id) {
          return matchingActiveTask.id;
        }
        if (!resolvedAgentId) {
          const activeTask = (listed.items ?? []).find((item) => item.status === 'active' && item.agent_id && item.id);
          if (activeTask?.id && activeTask.agent_id) {
            return activeTask.id;
          }
        }
      }
    }
    if (!resolvedAgentId) {
      throw new Error('seed_task_missing_agent');
    }
    let createRes: Response | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      createRes = await fetchWithRetry(
        taskBase,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: `Playwright Terminal UX ${Date.now()}`,
            agent_id: resolvedAgentId,
            workspace_mode: 'create_new',
          }),
        },
        3,
      );
      if (createRes.ok) break;
      if (createRes.status !== 409 && createRes.status < 500) {
        throw new Error(`task_create_failed:${createRes.status}`);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000 * (attempt + 1)));
    }
    if (!createRes?.ok) {
      if (!allowFallback) {
        throw new Error(`task_create_failed:${createRes?.status ?? 'unknown'}`);
      }
      if (taskId) {
        return taskId;
      }
      throw new Error(`task_create_failed:${createRes?.status ?? 'unknown'}`);
    }
    const created = await createRes.json() as { id?: string };
    if (!created.id) {
      throw new Error('created_task_missing_id');
    }
    return created.id;
  }, {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    agentId: AGENT_ID,
    apiBase: API_BASE,
    allowFallback: options?.allowFallback ?? false,
    preferFreshTask: options?.preferFreshTask ?? false,
  });
}

test.describe.serial('@lane-real notebook terminal UX walkthrough', () => {
  test('shows task-integrated terminal session with real shell output', async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    await loginThroughWorkspaceSelection(page);
    const terminalTaskId = await resolveTerminalTaskId(page, { allowFallback: true, preferFreshTask: true });
    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook/tasks/${terminalTaskId}`);

    await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
    const terminalToggle = page.getByTestId('notebook__task-header-terminal');
    await expect(terminalToggle).toBeVisible();
    await expect(terminalToggle).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('notebook-terminal-closed.png'), fullPage: true });

    await terminalToggle.click();

    const panel = page.getByTestId('notebook__task-terminal');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('Terminal');
    await expect(panel).toContainText('Active', { timeout: 120_000 });
    await expect(terminalToggle).toContainText('Hide Terminal');
    await expect(page.getByTestId('notebook__conversation-input').getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Close Terminal before starting a new agent run...',
    );

    const terminalViewport = panel.locator('.xterm-screen');
    await expect(terminalViewport).toBeVisible({ timeout: 30_000 });
    await terminalViewport.click();

    const marker = `PLAYWRIGHT_TERMINAL_OK_${Date.now()}`;
    await page.keyboard.type(`echo ${marker}`);
    await page.keyboard.press('Enter');

    await expect.poll(async () => (await panel.textContent()) ?? '', {
      timeout: 60_000,
      intervals: [500, 1_000, 2_000],
    }).toContain(marker);

    await expect(panel).not.toContainText('zsh-newuser-install');
    await expect(panel).not.toContainText('You are seeing this message because you have no zsh startup files');

    await page.screenshot({ path: testInfo.outputPath('notebook-terminal-active.png'), fullPage: true });
    await page.screenshot({ path: testInfo.outputPath('notebook-terminal-input-blocked.png'), fullPage: true });

    await panel.getByRole('button', { name: /close/i }).click();
    await expect(panel).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('notebook-terminal-closed-after-session.png'), fullPage: true });
  });

  test('shows connecting state while runner warmup retries are in progress', async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    await loginThroughWorkspaceSelection(page);
    const freshTaskId = await resolveTerminalTaskId(page, { allowFallback: true, preferFreshTask: true });
    let intercepted = 0;
    await page.route(TERMINAL_SESSION_ROUTE, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      if (intercepted < 2) {
        intercepted += 1;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error_code: 'RESOURCE_CONFLICT',
            message: 'task_runner_offline',
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook/tasks/${freshTaskId}`);
    const terminalToggle = page.getByTestId('notebook__task-header-terminal');
    await expect(terminalToggle).toBeVisible({ timeout: 30_000 });
    await terminalToggle.click();

    const panel = page.getByTestId('notebook__task-terminal');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('Connecting', { timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath('notebook-terminal-connecting.png'), fullPage: true });
    await expect(panel).toContainText('Active', { timeout: 60_000 });
  });

  test('shows failed state with friendly guidance when terminal creation is rejected', async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    await loginThroughWorkspaceSelection(page);
    const failureTaskId = TASK_ID || await resolveTerminalTaskId(page, { allowFallback: true, preferFreshTask: false });
    await page.route(TERMINAL_SESSION_ROUTE, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error_code: 'RESOURCE_CONFLICT',
          message: 'task_agent_not_available',
        }),
      });
    });

    await page.goto(`/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook/tasks/${failureTaskId}`);
    const terminalToggle = page.getByTestId('notebook__task-header-terminal');
    await expect(terminalToggle).toBeVisible({ timeout: 30_000 });
    await terminalToggle.click();

    const panel = page.getByTestId('notebook__task-terminal');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('Failed', { timeout: 10_000 });
    await expect(panel).toContainText("This task's runner is not available right now.");
    await page.screenshot({ path: testInfo.outputPath('notebook-terminal-failed.png'), fullPage: true });
  });
});
