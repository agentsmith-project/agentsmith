import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import { expect, test, type Page } from '@playwright/test';
import {
  createInternalCodexAgent,
  deleteInternalWorkloadViaManager,
  startCodexRunnerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

const LOCALE = process.env.INTEGRATION_LOCALE ?? 'en-US';
const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'mbos';
const KEYCLOAK_WORKSPACE_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';
const GLM_BASE_URL = process.env.INTEGRATION_GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/anthropic';
const GLM_MODEL = process.env.INTEGRATION_GLM_MODEL ?? 'GLM-5';
const GLM_API_KEY = process.env.GLM_API_KEY;
const DEV_ADMIN_USERNAME = process.env.INTEGRATION_DEV_ADMIN_USERNAME ?? 'dev-admin';
const DEV_ADMIN_PASSWORD = process.env.INTEGRATION_DEV_ADMIN_PASSWORD ?? 'dev-admin-123';
const PROJECT_CREATOR_USERNAME = process.env.INTEGRATION_USER_USERNAME ?? 'integration-user';
const PROJECT_CREATOR_PASSWORD = process.env.INTEGRATION_USER_PASSWORD ?? 'integration-user-123';
const MEMBER_USERNAME = process.env.INTEGRATION_MEMBER_USERNAME ?? 'integration-member';
const MEMBER_PASSWORD = process.env.INTEGRATION_MEMBER_PASSWORD ?? 'integration-member-123';
const MEMBER_EMAIL = 'integration-member@example.com';
const PROJECT_CREATOR_EMAIL = 'integration-user@example.com';
const NOTEBOOK_EXPECTED_TOKEN = `REAL_VISUAL_NOTEBOOK_OK_${Date.now()}`;
const NOTEBOOK_ARTIFACT_NAME = `visual-review-summary-${Date.now()}.md`;
const ARTIFACT_DIR = process.env.RELEASE_REAL_VISUAL_ARTIFACT_DIR
  ? path.resolve(process.env.RELEASE_REAL_VISUAL_ARTIFACT_DIR)
  : path.resolve('artifacts/release-real-visual/manual-run');

type ExecutionWsMessage = {
  type?: string;
  request_id?: string;
  payload?: {
    messages?: Array<{ role?: string; content?: unknown }>;
    resource_proxy?: {
      base_url?: string;
    };
    execution_context?: {
      user_bearer_token?: string;
      task_id?: string;
      run_id?: string;
    };
  };
};

type CaptureEntry = {
  name: string;
  path: string;
  role: string;
  route: string;
  notes: string;
  status: 'pass' | 'pass_with_follow_up' | 'needs_fix';
  blocking: boolean;
};

type ProjectContext = {
  workspaceId: string;
  projectId: string;
  projectName: string;
};

function requireGlmApiKey(): string {
  if (!GLM_API_KEY?.trim()) {
    throw new Error('missing_GLM_API_KEY');
  }
  return GLM_API_KEY.trim();
}

async function ensureArtifactDir() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function capturePage(page: Page, captures: CaptureEntry[], args: {
  name: string;
  role: string;
  route?: string;
  notes: string;
  fullPage?: boolean;
  status?: CaptureEntry['status'];
  blocking?: boolean;
}) {
  await ensureArtifactDir();
  const filename = `${args.name}.png`;
  const absolutePath = path.join(ARTIFACT_DIR, filename);
  await page.screenshot({ path: absolutePath, fullPage: args.fullPage ?? true });
  captures.push({
    name: args.name,
    path: filename,
    role: args.role,
    route: args.route ?? page.url(),
    notes: args.notes,
    status: args.status ?? 'pass',
    blocking: args.blocking ?? false,
  });
}

async function flushReviewArtifacts(captures: CaptureEntry[]) {
  await ensureArtifactDir();
  const counts = {
    pass: captures.filter((item) => item.status === 'pass').length,
    pass_with_follow_up: captures.filter((item) => item.status === 'pass_with_follow_up').length,
    needs_fix: captures.filter((item) => item.status === 'needs_fix').length,
  };
  const blockingItems = captures.filter((item) => item.blocking);
  const manifest = {
    generated_at: new Date().toISOString(),
    total: captures.length,
    summary: counts,
    screenshots: captures,
  };
  const reviewLines = [
    '# 真实后端界面巡检截图',
    '',
    `- generated_at: ${manifest.generated_at}`,
    `- total: ${manifest.total}`,
    `- pass: ${counts.pass}`,
    `- pass_with_follow_up: ${counts.pass_with_follow_up}`,
    `- needs_fix: ${counts.needs_fix}`,
    '',
    '## 发布审查结论',
    '',
    blockingItems.length === 0 ? '- ready for release' : '- not ready for release',
    blockingItems.length === 0
      ? '- 当前真实后端主链、主要界面与关键操作路径未发现阻塞发布的问题。'
      : `- 当前仍有 ${blockingItems.length} 个阻塞发布的问题需要修复。`,
    '',
    '## 页面审查结果',
    '',
    '| Screenshot | Role | Status | Blocking | Route | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
    ...captures.map((item) => `| ${item.path} | ${item.role} | ${item.status} | ${item.blocking ? 'yes' : 'no'} | ${item.route} | ${item.notes} |`),
    '',
    '## 审查说明',
    '',
    '- 这批截图来自真实 Keycloak、真实 API、真实 notebook 主线。',
    '- 用于人工观察界面、状态、操作路径和明显 UX/UI 缺陷。',
  ];
  await writeFile(path.join(ARTIFACT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  await writeFile(path.join(ARTIFACT_DIR, 'review.md'), `${reviewLines.join('\n')}\n`, 'utf-8');
}

async function clearAppState(page: Page, workspaceId = 'ws_default'): Promise<void> {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/login`);
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  });
}

async function gotoWithRetry(page: Page, pathOrUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(pathOrUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete');
      if (page.url() === 'about:blank') {
        throw new Error('blank_navigation');
      }
      const bodyText = await page.locator('body').textContent().catch(() => '');
      if ((bodyText ?? '').trim().length === 0) {
        throw new Error('empty_document');
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if ((!message.includes('ERR_ABORTED') && !message.includes('blank_navigation') && !message.includes('empty_document')) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(500);
    }
  }
}

async function waitForSystemLoginReady(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await gotoWithRetry(page, `/${LOCALE}/system/login`);
    const heading = page.getByTestId('system-login__heading');
    if (await heading.isVisible({ timeout: 10_000 }).catch(() => false)) {
      return;
    }
    await page.waitForTimeout(1_000);
  }
  await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
}

async function settlePage(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  await page.waitForTimeout(600);
}

async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.context().clearCookies();
  await waitForSystemLoginReady(page);
  await page.getByTestId('system-login__username').fill('mbos-admin');
  await page.getByTestId('system-login__password').fill('mbos-admin');
  let loginResponseOk = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page
      .waitForResponse(
        (response) =>
          response.url().includes('/api/system/session') && response.request().method() === 'POST',
        { timeout: 5_000 },
      )
      .catch(() => null);
    await page.getByTestId('system-login__submit').click();
    const response = await responsePromise;
    if (response) {
      loginResponseOk = response.ok();
      break;
    }
    await page.waitForTimeout(1_000);
  }
  expect(loginResponseOk).toBe(true);
  await expect
    .poll(() => page.url(), { timeout: 30_000 })
    .toMatch(new RegExp(`/${LOCALE}/system/workspaces`));
  await expect(page.getByTestId('system-workspaces__heading')).toBeVisible();
  await expect(page.getByText('Loading workspaces...')).not.toBeVisible({ timeout: 30_000 });
}

async function waitForWorkspaceId(page: Page, workspaceName: string): Promise<string> {
  await expect
    .poll(
      async () => {
        return page.evaluate(async (name) => {
          const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
          const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
          return payload.items?.find((item) => item.name === name)?.id ?? null;
        }, workspaceName);
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();

  const resolved = await page.evaluate(async (name) => {
    const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
    const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
    return payload.items?.find((item) => item.name === name)?.id ?? null;
  }, workspaceName);

  if (!resolved) {
    throw new Error('workspace_id_not_found');
  }
  return resolved;
}

async function createAndPublishWorkspace(page: Page): Promise<string> {
  const workspaceName = `Real Visual Workspace ${Date.now()}`;
  await page.getByTestId('system-workspaces__new-workspace').click();
  await page.waitForURL(new RegExp(`/${LOCALE}/system/workspaces/new$`), { timeout: 30_000 });
  await expect(page.getByTestId('system-workspace-create__heading')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
  await page.getByTestId('system-workspace-create__next').click();
  await page.getByTestId('system-workspaces__draft-idp-url').fill(KEYCLOAK_BASE_URL);
  await page.getByTestId('system-workspaces__draft-idp-realm').fill(KEYCLOAK_REALM);
  await page.getByTestId('system-workspaces__draft-idp-client-id').fill(KEYCLOAK_WORKSPACE_CLIENT_ID);
  await verifyIdentityProvider(page);
  await page.getByTestId('system-workspace-create__next').click();
  await page.getByTestId('system-workspaces__admin-mode--email').click();
  await page.getByTestId('system-workspaces__draft-admin-email').fill('dev-admin@example.com');
  await page.getByTestId('system-workspace-create__next').click();
  await page.getByTestId('system-workspace-create__create').click();

  const workspaceId = await waitForWorkspaceId(page, workspaceName);
  await page.getByTestId(`system-workspaces__configure--${workspaceId}`).click();
  await page.getByTestId('system-workspaces__publish').click();
  await expect(
    page.getByTestId(`system-workspaces__card--${workspaceId}`).getByTestId(`system-workspaces__open-workspace-login--${workspaceId}`),
  ).toHaveAttribute(
    'href',
    new RegExp(`/${LOCALE}/workspaces/${workspaceId}/login$`),
  );
  return workspaceId;
}

async function verifyIdentityProvider(page: Page): Promise<void> {
  const responsePromise = page.waitForResponse(
    (candidate) => candidate.url().includes('/api/system/workspaces/idp/verify') && candidate.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await page.getByTestId('system-workspaces__verify-idp').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId('system-workspaces__idp-status')).toBeVisible({ timeout: 15_000 });
}

async function selectWorkspaceAdmin(page: Page, email: string): Promise<void> {
  const adminInput = page.getByTestId('system-workspaces__draft-admin');
  let lastFailure = 'directory_request_not_observed';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page.waitForResponse(
      (candidate) => candidate.url().includes('/api/system/workspaces/directory/users') && candidate.request().method() === 'POST',
      { timeout: 15_000 },
    ).catch(() => null);
    await adminInput.fill('');
    await adminInput.fill(email);
    const response = await responsePromise;
    if (!response) {
      lastFailure = 'directory_request_timeout';
      continue;
    }

    const payload = (await response.json().catch(() => null)) as
      | { items?: Array<{ user_id?: string; email?: string }> }
      | { error_message?: string }
      | null;
    if (!response.ok()) {
      lastFailure = `directory_response_${response.status()}`;
      continue;
    }

    const matchedUser = Array.isArray(payload?.items)
      ? payload.items.find((item) => item.email === email)
      : null;
    const userId = typeof matchedUser?.user_id === 'string' ? matchedUser.user_id : '';
    if (!userId) {
      lastFailure = 'directory_user_missing';
      continue;
    }

    const adminOption = page.getByTestId(`system-workspaces__admin-option--${userId}`);
    await expect(adminOption).toBeVisible({ timeout: 15_000 });
    await adminOption.click();
    return;
  }

  throw new Error(`workspace_admin_directory_user_missing:${email}:${lastFailure}`);
}

async function loginToWorkspace(page: Page, workspaceId: string, username: string, password: string): Promise<void> {
  await clearAppState(page, workspaceId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/login`);
    await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('workspace-login__keycloak-btn').click();

    const bootstrapError = page.getByTestId('workspace-login__keycloak-error');
    if (await bootstrapError.isVisible({ timeout: 3_000 }).catch(() => false)) {
      throw new Error(`workspace_login_bootstrap_failed:${await bootstrapError.textContent()}`);
    }

    await page.waitForURL(/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i, {
      timeout: 30_000,
    });
    await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(username);
    await page.locator('input#password, input[name="password"]').first().fill(password);
    await page.locator('#kc-login, button[type="submit"]').first().click();

    let reachedWorkspace = false;
    let callbackError = false;
    for (let tick = 0; tick < 120; tick += 1) {
      const currentUrl = page.url();
      if (new RegExp(`/${LOCALE}/workspaces/${workspaceId}(?:$|/projects|/settings)`).test(currentUrl)) {
        reachedWorkspace = true;
        break;
      }
      if (new RegExp(`/${LOCALE}/workspaces/${workspaceId}/login/callback`).test(currentUrl)) {
        const errorNode = page.getByTestId('workspace-login-callback__error');
        if (await errorNode.isVisible({ timeout: 300 }).catch(() => false)) {
          callbackError = true;
          break;
        }
      }
      await page.waitForTimeout(500);
    }

    if (reachedWorkspace) {
      return;
    }

    if (callbackError && attempt < 2) {
      await clearAppState(page, workspaceId);
      continue;
    }

    throw new Error(`workspace_login_failed:${workspaceId}:${username}`);
  }

  throw new Error(`workspace_login_retry_exhausted:${workspaceId}:${username}`);
}

async function saveWorkspaceProjectCreators(page: Page, workspaceId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/settings`);
  await expect(page.getByTestId('ws-settings__project-creators')).toBeVisible({ timeout: 30_000 });
  const searchInput = page.getByTestId('ws-settings__project-creators-input');
  await searchInput.fill(PROJECT_CREATOR_EMAIL);
  const creatorOption = page.getByTestId('ws-settings__project-creators-results').getByRole('button', {
    name: new RegExp(PROJECT_CREATOR_EMAIL.replace('.', '\\.')),
  });
  await expect(creatorOption).toBeVisible({ timeout: 15_000 });
  await creatorOption.click();
  await page.getByTestId('ws-settings__project-creators-save').click();
  await expect
    .poll(async () => page.getByTestId('ws-settings__project-creators-selected').textContent(), { timeout: 20_000 })
    .toContain(PROJECT_CREATOR_EMAIL);
}

async function createProject(page: Page, workspaceId: string): Promise<ProjectContext> {
  const projectName = `Real Visual Project ${Date.now()}`;
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects`);
  await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('projects__create-btn').click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
  await page.locator('#project-name').fill(projectName);
  await page.getByRole('button', { name: /create|创建/i }).click();
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/.+/overview`), { timeout: 30_000 });
  const match = page.url().match(/\/projects\/([^/]+)\//);
  if (!match?.[1]) {
    throw new Error('project_id_not_found_after_create');
  }
  return { workspaceId, projectId: match[1], projectName };
}

async function requestProjectAccess(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects`);
  const requestButton = page.getByTestId(`projects__join-request-btn--${projectId}`);
  await expect(requestButton).toBeVisible({ timeout: 30_000 });
  await requestButton.click();
  await expect.poll(async () => await requestButton.textContent(), { timeout: 5_000 }).toMatch(/pending|request access/i);
}

async function approveJoinRequest(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/members?member_tab=requests`);
  await expect(page.getByRole('tab', { name: /join requests/i })).toBeVisible({ timeout: 30_000 });
  const requestCard = page.locator('div').filter({ hasText: /integration-member/i }).first();
  await expect(requestCard).toBeVisible({ timeout: 30_000 });
  await requestCard.getByRole('button', { name: /approve and grant project admin|批准并授予项目管理权限/i }).click();
  await expect(page.getByText(/project admin/i).first()).toBeVisible({ timeout: 30_000 });
}

async function createCredential(page: Page, workspaceId: string, projectId: string, apiKey: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/credentials`);
  await expect(page.getByTestId('credentials__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('credentials__create-btn').click();
  const dialog = page.getByTestId('credentials__create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#cred-name').fill('BigModel Anthropic Key');
  await dialog.locator('#cred-value').fill(apiKey);
  await dialog.getByRole('button', { name: /create/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('BigModel Anthropic Key')).toBeVisible({ timeout: 30_000 });
}

async function createEndpoint(page: Page, workspaceId: string, projectId: string): Promise<{ endpointId: string; endpointName: string }> {
  const endpointName = 'BigModel Anthropic Endpoint';
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/endpoints`);
  await expect(page.getByTestId('endpoints__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('endpoints__create-btn').click();
  const dialog = page.getByTestId('endpoints__create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /use guided setup/i }).click();
  const wizard = page.getByTestId('endpoints__custom-wizard');
  await expect(wizard).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-name-input').fill(endpointName);
  await wizard.getByTestId('protocol-anthropic_compatible').click();
  await wizard.getByTestId('wizard-base-url-input').fill(GLM_BASE_URL);
  await wizard.getByRole('button', { name: /next|下一步/i }).click();
  await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-model-id-input').fill(GLM_MODEL);
  await wizard.getByRole('button', { name: /next|下一步/i }).click();
  await expect(wizard.getByTestId('wizard-check-button')).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-check-button').click();
  await expect(wizard.getByTestId('wizard-create-button')).toBeEnabled({ timeout: 30_000 });
  await wizard.getByTestId('wizard-create-button').click();
  await expect(wizard).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(endpointName)).toBeVisible({ timeout: 30_000 });

  const token = await readStoredAuthToken(page);
  const response = await page.request.get(`${apiBaseForPage(page)}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { items?: Array<{ id?: string; name?: string }> };
  const endpointId = payload.items?.find((item) => item.name === endpointName)?.id;
  expect(endpointId).toBeTruthy();
  return {
    endpointId: endpointId!,
    endpointName,
  };
}

function apiBaseForPage(page: Page): string {
  return process.env.INTEGRATION_API_BASE ?? 'http://localhost:20070';
}

async function createAgent(page: Page, workspaceId: string, projectId: string): Promise<string> {
  const agentName = `Real Visual Agent ${Date.now()}`;
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agents`);
  await expect(page.getByTestId('agents__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('agents__create-btn').click();
  const dialog = page.getByTestId('agents__create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#agent-name').fill(agentName);
  const endpointSelect = dialog.locator('#notebook-endpoint-id');
  await expect(endpointSelect).toBeVisible({ timeout: 30_000 });
  await endpointSelect.selectOption({ index: 0 });
  await dialog.getByRole('button', { name: /create/i }).click();
  await expect(page.getByText(agentName)).toBeVisible({ timeout: 30_000 });
  return agentName;
}

async function resolveAgentId(page: Page, apiBase: string, workspaceId: string, projectId: string, token: string, agentName: string): Promise<string> {
  const response = await page.request.get(`${apiBase}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items?: Array<{ id: string; name: string }> };
  const agentId = body.items?.find((item) => item.name === agentName)?.id;
  if (!agentId) {
    throw new Error('agent_id_not_found');
  }
  return agentId;
}

async function createAgentKeyAndConnectionInfo(page: Page, apiBase: string, workspaceId: string, projectId: string, agentId: string, token: string) {
  const createKeyResponse = await page.request.post(
    `${apiBase}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/keys`,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data: {} },
  );
  expect(createKeyResponse.ok()).toBeTruthy();
  const keyBody = (await createKeyResponse.json()) as { key: string };
  const connectionResponse = await page.request.get(
    `${apiBase}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/connection-info`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(connectionResponse.ok()).toBeTruthy();
  const connectionBody = (await connectionResponse.json()) as { ws_url: string };
  return {
    agentKey: keyBody.key,
    wsUrl: connectionBody.ws_url.replace('ws://localhost:20000', apiBase.replace('http://', 'ws://')),
  };
}

function extractAssistantContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const maybeChoices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = maybeChoices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
      .join('');
  }
  return '';
}

function startExternalNotebookBridge(args: {
  wsUrl: string;
  agentKey: string;
  expectedToken: string;
  model: string;
}) {
  let helloResolved = false;
  let helloResolve!: () => void;
  let helloReject!: (reason?: unknown) => void;
  let observedResolve!: (reply: string) => void;
  let observedReject!: (reason?: unknown) => void;
  let resourceProxyBase = '';

  const ready = new Promise<void>((resolve, reject) => {
    helloResolve = resolve;
    helloReject = reject;
  });
  const observedReply = new Promise<string>((resolve, reject) => {
    observedResolve = resolve;
    observedReject = reject;
  });

  const ws = new WebSocket(args.wsUrl, { headers: { Authorization: `Bearer ${args.agentKey}` } });

  ws.once('error', (error) => {
    if (!helloResolved) helloReject(error);
    observedReject(error);
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'agent.ready',
      timestamp: new Date().toISOString(),
      payload: { capabilities: { streaming_completion: true, multimodal_completion: false } },
    }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString('utf-8')) as ExecutionWsMessage;
    if (msg.type === 'server.ping') {
      ws.send(JSON.stringify({ type: 'agent.pong', timestamp: new Date().toISOString(), payload: {} }));
      return;
    }
    if (msg.type === 'server.hello') {
      resourceProxyBase = msg.payload?.resource_proxy?.base_url ?? '';
      helloResolved = true;
      helloResolve();
      return;
    }
    if (msg.type !== 'server.request.start' || !msg.request_id) return;

    void (async () => {
      const userToken = msg.payload?.execution_context?.user_bearer_token ?? '';
      try {
        const upstreamResponse = await fetch(`${resourceProxyBase}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: args.model,
            messages: msg.payload?.messages ?? [],
          }),
        });
        if (!upstreamResponse.ok) {
          const errorText = await upstreamResponse.text();
          ws.send(JSON.stringify({
            type: 'agent.response.error',
            request_id: msg.request_id,
            timestamp: new Date().toISOString(),
            payload: { error_code: 'AGENT_UPSTREAM_ERROR', error_message: errorText || 'upstream_request_failed' },
          }));
          observedReject(new Error(`upstream_request_failed:${upstreamResponse.status}`));
          return;
        }
        const responseBody = (await upstreamResponse.json()) as unknown;
        const assistantContent = extractAssistantContent(responseBody);
        ws.send(JSON.stringify({
          type: 'agent.response.delta',
          request_id: msg.request_id,
          timestamp: new Date().toISOString(),
          payload: { delta: assistantContent },
        }));
        ws.send(JSON.stringify({
          type: 'agent.response.done',
          request_id: msg.request_id,
          timestamp: new Date().toISOString(),
          payload: { finish_reason: 'stop', usage_tokens: assistantContent.length },
        }));
        if (assistantContent.includes(args.expectedToken)) {
          observedResolve(assistantContent);
        }
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'agent.response.error',
          request_id: msg.request_id,
          timestamp: new Date().toISOString(),
          payload: { error_code: 'AGENT_BRIDGE_ERROR', error_message: error instanceof Error ? error.message : 'unknown_error' },
        }));
        observedReject(error);
      }
    })();
  });

  return {
    ready,
    observedReply,
    stop: async () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        await withTimeout(new Promise<void>((resolve) => {
          ws.once('close', () => resolve());
          ws.close();
        }), 5_000, undefined);
      }
    },
  };
}

async function runNotebookTask(args: {
  page: Page;
  context: ProjectContext;
  agentId: string;
  fileLibraryId: string;
  expectedToken: string;
  artifactName: string;
}) {
  const { page, context, agentId, fileLibraryId, expectedToken, artifactName } = args;
  const taskTitle = `Release Review Task ${Date.now()}`;
  const taskId = await createNotebookTaskViaApi({
    page,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    title: taskTitle,
    agentId,
    fileLibraryId,
  });
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/notebook/tasks/${taskId}`);
  await expect(page.getByTestId('notebook__conversation-input')).toBeVisible({ timeout: 30_000 });

  const input = page.getByTestId('notebook__conversation-input').locator('textarea').first();
  await input.fill([
    'Run the following shell command exactly, then reply with the token and filename.',
    '```bash',
    `mkdir -p .artifacts && cat <<'EOF' > .artifacts/${artifactName}`,
    '# Market sizing summary',
    `- Token: ${expectedToken}`,
    '- Segment: North America consumer electronics',
    '- Insight: online channel share is expanding faster than retail',
    '- Recommendation: prioritize search plus retail media in the next planning cycle',
    'EOF',
    '```',
    `After the file is written, reply with exactly: ${expectedToken} ${artifactName}`,
  ].join(' '));
  await page.getByTestId('notebook__send-btn').click();
  await expect(page.getByText(expectedToken)).toBeVisible({ timeout: 120_000 });
}

async function createNotebookTaskViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  agentId: string;
  fileLibraryId: string;
}): Promise<string> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${apiBaseForPage(args.page)}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: args.title,
        agent_id: args.agentId,
        workspace_file_library_id: args.fileLibraryId,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const taskId = payload?.id ?? payload?.data?.id;
  expect(taskId).toBeTruthy();
  return taskId!;
}

async function sendNotebookTaskMessage(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  content: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${apiBaseForPage(args.page)}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        role: 'user',
        content: args.content,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function waitForNotebookTaskToken(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
  minAgentMessages?: number;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  await expect
    .poll(
      async () => {
        const response = await args.page.request.get(
          `${apiBaseForPage(args.page)}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!response.ok()) return false;
        const payload = (await response.json()) as Array<{ role?: string; content?: string }>;
        const agentMessages = payload.filter((item) => item.role === 'agent');
        if (agentMessages.length < (args.minAgentMessages ?? 1)) return false;
        return agentMessages.some((item) => item.content?.includes(args.token));
      },
      { timeout: 300_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe(true);
}

function sanitizeWorkloadId(taskId: string): string {
  const normalized = taskId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return normalized || 'workload';
}

async function captureProjectPages(page: Page, captures: CaptureEntry[], context: ProjectContext, role: string) {
  const pages: Array<{ name: string; path: string; waitFor?: string }> = [
    { name: 'project-overview', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/overview`, waitFor: 'project-hub__page' },
    { name: 'project-chat', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/chat`, waitFor: 'chat__main-pane' },
    { name: 'project-notebook', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/notebook`, waitFor: 'notebook__task-list' },
    { name: 'project-files', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/files`, waitFor: 'files__library-create' },
    { name: 'project-endpoints', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/endpoints`, waitFor: 'endpoints__create-btn' },
    { name: 'project-credentials', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/credentials`, waitFor: 'credentials__create-btn' },
    { name: 'project-agents', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/agents`, waitFor: 'agents__create-btn' },
    { name: 'project-members', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/members`, waitFor: 'members__search-input' },
    { name: 'project-resource-policy', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/resource-policy`, waitFor: 'resource-policy__editor' },
    { name: 'project-audit', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/audit`, waitFor: 'audit__page' },
    { name: 'project-usage', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/usage`, waitFor: 'usage__view' },
    { name: 'project-settings', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/settings`, waitFor: 'settings__general-section' },
    { name: 'project-use-guide', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/use-guide`, waitFor: 'use-guide__page' },
    { name: 'project-alerts', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/alerts`, waitFor: 'alerts__open-audit' },
  ];

  for (const item of pages) {
    await gotoWithRetry(page, item.path);
    let notes = `真实项目页面巡检: ${item.name}`;
    if (item.waitFor) {
      const target = page.getByTestId(item.waitFor);
      const permissionDenied = page.getByRole('heading', { name: /permission denied/i });
      const notFound = page.getByRole('heading', { name: '404' });
      const result = await Promise.race([
        target.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'ready' as const),
        permissionDenied.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'permission_denied' as const),
        notFound.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'not_found' as const),
      ]).catch(() => 'timeout' as const);

      if (result === 'not_found') {
        throw new Error(`visual_review_not_found:${item.name}:${item.path}`);
      }
      if (result === 'timeout') {
        throw new Error(`visual_review_wait_timeout:${item.name}:${item.path}:${item.waitFor}`);
      }
      if (result === 'permission_denied') {
        notes = `真实项目页面巡检: ${item.name}（当前角色权限不足，页面显示拒绝访问）`;
      }
    }
    await settlePage(page);
    await capturePage(page, captures, {
      name: item.name,
      role,
      notes,
    });
  }
}

test.describe('@lane-real integration visual review', () => {
  test('captures real backend screenshots for main system and project surfaces', async ({ page }) => {
    test.setTimeout(900_000);
    const captures: CaptureEntry[] = [];
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20070';
    const glmApiKey = requireGlmApiKey();

    await gotoWithRetry(page, `/${LOCALE}/system/login`);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'system-login',
      role: 'system 管理侧',
      notes: 'system 管理侧登录入口',
    });

    await loginAsSystemAdmin(page);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'system-workspaces',
      role: 'system 管理侧',
      notes: '工作区清单与创建入口',
    });

    const workspaceId = await createAndPublishWorkspace(page);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'system-workspace-editor',
      role: 'system 管理侧',
      notes: '新工作区创建并发布后的 system 管理侧工作区清单',
    });

    await page.getByTestId('system-workspaces__open-info').click();
    await page.waitForURL(new RegExp(`/${LOCALE}/system/info`), { timeout: 20_000 });
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'system-info',
      role: 'system 管理侧',
      notes: 'system 信息页',
    });

    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/login`);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'workspace-login',
      role: 'workspace admin',
      notes: '工作区登录入口',
    });

    await loginToWorkspace(page, workspaceId, DEV_ADMIN_USERNAME, DEV_ADMIN_PASSWORD);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'workspace-home-admin',
      role: 'workspace admin',
      notes: 'workspace admin 进入工作区首页',
    });

    await saveWorkspaceProjectCreators(page, workspaceId);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'workspace-settings',
      role: 'workspace admin',
      notes: '工作区设置与 project creators 配置',
    });

    await loginToWorkspace(page, workspaceId, PROJECT_CREATOR_USERNAME, PROJECT_CREATOR_PASSWORD);
    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects`);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'workspace-projects-before-create',
      role: 'project creator',
      notes: 'project creator 的项目列表与创建入口',
    });

    await page.getByTestId('projects__create-btn').click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'dialog-create-project-real',
      role: 'project creator',
      notes: '真实环境创建项目对话框',
    });
    await page.getByRole('dialog').getByRole('button', { name: /cancel|取消/i }).click();

    const project = await createProject(page, workspaceId);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'project-overview-initial',
      role: 'project owner',
      notes: '项目创建成功后的 overview',
    });

    await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
    await requestProjectAccess(page, workspaceId, project.projectId);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'projects-join-request-pending',
      role: 'ordinary member',
      notes: '普通用户发起加入申请后的项目列表状态',
    });

    await loginToWorkspace(page, workspaceId, PROJECT_CREATOR_USERNAME, PROJECT_CREATOR_PASSWORD);
    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/members?member_tab=requests`);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'members-join-requests-before-approve',
      role: 'project owner',
      notes: '加入申请审批页',
    });
    await approveJoinRequest(page, workspaceId, project.projectId);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'members-join-requests-after-approve',
      role: 'project owner',
      notes: '批准并授予项目管理权限后的成员治理页',
    });

    const projectOwnerToken = await readStoredAuthToken(page);

    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/credentials`);
    await expect(page.getByTestId('credentials__create-btn')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('credentials__create-btn').click();
    await expect(page.getByTestId('credentials__create-dialog')).toBeVisible();
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'dialog-create-credential-real',
      role: 'project owner',
      notes: '真实环境创建凭据对话框',
    });
    await page.getByTestId('credentials__create-dialog').getByRole('button', { name: /cancel|取消/i }).click();
    await createCredential(page, workspaceId, project.projectId, glmApiKey);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'project-credentials-real',
      role: 'project owner',
      notes: '真实凭据列表',
    });

    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/endpoints`);
    await expect(page.getByTestId('endpoints__create-btn')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('endpoints__create-btn').click();
    await expect(page.getByTestId('endpoints__create-dialog')).toBeVisible();
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'dialog-create-endpoint-real',
      role: 'project owner',
      notes: '真实环境 endpoint 创建入口',
    });
    await page.getByTestId('endpoints__create-dialog').getByRole('button', { name: /cancel|取消/i }).click();
    const endpointInfo = await createEndpoint(page, workspaceId, project.projectId);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'project-endpoints-real',
      role: 'project owner',
      notes: '真实 endpoint 列表',
    });

    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/agents`);
    await expect(page.getByTestId('agents__create-btn')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('agents__create-btn').click();
    await expect(page.getByTestId('agents__create-dialog')).toBeVisible();
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'dialog-create-agent-real',
      role: 'project owner',
      notes: '真实环境 agent 创建对话框',
    });
    await page.getByTestId('agents__create-dialog').getByRole('button', { name: /cancel|取消/i }).click();
    const agentName = await createAgent(page, workspaceId, project.projectId);
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'project-agents-real',
      role: 'project owner',
      notes: '真实 agent 列表',
    });

    const agentId = await resolveAgentId(page, apiBase, workspaceId, project.projectId, projectOwnerToken, agentName);
    const connectionInfo = await createAgentKeyAndConnectionInfo(page, apiBase, workspaceId, project.projectId, agentId, projectOwnerToken);

    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/agents`);
    await expect(page.getByTestId(`agents__keys-btn--${agentId}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`agents__keys-btn--${agentId}`).click();
    await expect(page.getByTestId('agents__dialog__keys')).toBeVisible({ timeout: 30_000 });
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'dialog-agent-connection-info-real',
      role: 'project owner',
      notes: '真实 external agent 的 key 与连接信息对话框',
    });
    await page.keyboard.press('Escape');

    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/files`);
    await expect(page.getByTestId('files__library-create')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('files__library-create').click();
    await expect(page.getByTestId('files__dialog__library-create')).toBeVisible({ timeout: 30_000 });
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'dialog-file-library-create-real',
      role: 'project owner',
      notes: '真实文件库创建对话框',
    });
    await page.keyboard.press('Escape');
    await page.getByTestId('files__library-create').click();
    await page.getByTestId('files__library-create__name').fill('Visual Review Library');
    const createLibraryResponsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/file-libraries\/?$/.test(response.url()),
      );
    await page.getByTestId('files__library-create__submit').click();
    const createLibraryResponse = await createLibraryResponsePromise;
    expect(createLibraryResponse.ok()).toBeTruthy();
    const createLibraryPayload = (await createLibraryResponse.json().catch(() => null)) as
      | { id?: string; data?: { id?: string } }
      | null;
    const visualLibraryId = createLibraryPayload?.id ?? createLibraryPayload?.data?.id;
    expect(visualLibraryId).toBeTruthy();
    const visualLibrary = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: 'Visual Review Library' }).first();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await visualLibrary.isVisible({ timeout: 5_000 }).catch(() => false)) {
        break;
      }
      await page.reload();
    }
    await expect(visualLibrary).toBeVisible({ timeout: 30_000 });
    await visualLibrary.locator('[data-testid^="files__library-mount-access--"]').first().click();
    await expect(page.getByTestId('files__dialog__library-mount-access')).toBeVisible({ timeout: 30_000 });
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'dialog-file-library-mount-access-real',
      role: 'project owner',
      notes: '真实文件库本地挂载说明对话框',
    });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('files__dialog__library-mount-access')).toBeHidden({ timeout: 10_000 });

    const runner = await startCodexRunnerProcess({
      wsUrl: connectionInfo.wsUrl,
      agentKey: connectionInfo.agentKey,
    });
    test.info().annotations.push({ type: 'codex_runner_log', description: runner.logPath });
    await waitForAgentPresenceOnline(page, workspaceId, project.projectId, agentId);

    try {
      await captureProjectPages(page, captures, project, 'project owner');
      await runNotebookTask({
        page,
        context: project,
        agentId,
        fileLibraryId: visualLibraryId!,
        expectedToken: NOTEBOOK_EXPECTED_TOKEN,
        artifactName: NOTEBOOK_ARTIFACT_NAME,
      });
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'project-notebook-task-detail-real',
        role: 'project owner',
        notes: 'notebook 真实任务完成后的详情页',
      });
      const traceToggle = page.getByTestId('notebook__message-trace-toggle').first();
      if (await traceToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await traceToggle.click();
        await expect(page.getByTestId('notebook__message-trace-panel')).toBeVisible({ timeout: 30_000 });
        await settlePage(page);
        await capturePage(page, captures, {
          name: 'project-notebook-trace-real',
          role: 'project owner',
          notes: '真实 notebook 任务的执行 trace 面板',
        });
      }

      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/files`);
      const mountDialog = page.getByTestId('files__dialog__library-mount-access');
      if (await mountDialog.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await expect(mountDialog).toBeHidden({ timeout: 10_000 });
      }
      const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: 'Visual Review Library' }).first();
      await expect(libraryItem).toBeVisible({ timeout: 30_000 });
      await libraryItem.click();
      const artifactsRow = page.getByTestId('files__object-row').filter({ hasText: '.artifacts' }).first();
      await expect(artifactsRow).toBeVisible({ timeout: 30_000 });
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'project-files-notebook-workspace-real',
        role: 'project owner',
        notes: 'notebook 任务绑定的文件库根目录，.artifacts 交付目录已经在 Files 页面中可见',
      });
    } finally {
      await runner.stop();
    }

    if (
      process.env.SANDBOX_MANAGER_URL?.trim()
      && process.env.SANDBOX_SERVICE_KEY?.trim()
      && process.env.INTERNAL_AGENT_K8S_NAMESPACE?.trim()
    ) {
      const internalAgent = await createInternalCodexAgent(page, {
        workspaceId,
        projectId: project.projectId,
        endpointId: endpointInfo.endpointId,
        title: 'internal-visual-review-agent',
      });
      const internalExpectedToken = `INTERNAL_VISUAL_NOTEBOOK_OK_${Date.now()}`;
      const internalArtifactName = `internal-visual-review-${Date.now()}.md`;
      const internalTaskTitle = `Internal Visual Review ${Date.now()}`;
      const internalTaskId = await createNotebookTaskViaApi({
        page,
        workspaceId,
        projectId: project.projectId,
        title: internalTaskTitle,
        agentId: internalAgent.agentId,
        fileLibraryId: visualLibraryId!,
      });

      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/notebook`);
      await expect(page.getByTestId('notebook__task-list')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('notebook__task-list').getByText(internalTaskTitle).first().click();
      await expect(page.getByTestId('notebook__conversation-input')).toBeVisible({ timeout: 30_000 });

      await sendNotebookTaskMessage({
        page,
        workspaceId,
        projectId: project.projectId,
        taskId: internalTaskId,
        content: [
          'Run the following shell command exactly, then reply with the token and filename.',
          '```bash',
          `mkdir -p .artifacts && cat <<'EOF' > .artifacts/${internalArtifactName}`,
          '# Internal workspace summary',
          `- Token: ${internalExpectedToken}`,
          '- Mode: internal-k8s',
          '- Insight: JuiceFS CSI mounted workspace remained consistent across notebook execution',
          'EOF',
          '```',
          `After the file is written, reply with exactly: ${internalExpectedToken} ${internalArtifactName}`,
        ].join(' '),
      });
      await page.waitForTimeout(1_500);
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'project-notebook-task-internal-preparing-real',
        role: 'project owner',
        notes: 'internal agent lazy start 后的 notebook 任务执行中状态',
      });

      await waitForNotebookTaskToken({
        page,
        workspaceId,
        projectId: project.projectId,
        taskId: internalTaskId,
        token: internalExpectedToken,
      });
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'project-notebook-task-internal-detail-real',
        role: 'project owner',
        notes: 'internal-k8s notebook 任务完成后的详情页，工作目录固定为 /workspace',
      });

      const internalWorkloadId = sanitizeWorkloadId(internalTaskId);
      await deleteInternalWorkloadViaManager({
        workspaceId,
        projectId: project.projectId,
        workloadId: internalWorkloadId,
      });
      await page.waitForTimeout(3_000);

      const resumeToken = `INTERNAL_VISUAL_NOTEBOOK_RESUME_${Date.now()}`;
      await sendNotebookTaskMessage({
        page,
        workspaceId,
        projectId: project.projectId,
        taskId: internalTaskId,
        content: `Reply with exactly ${resumeToken} after verifying the existing .artifacts/${internalArtifactName} file is still present in the workspace.`,
      });
      await waitForNotebookTaskToken({
        page,
        workspaceId,
        projectId: project.projectId,
        taskId: internalTaskId,
        token: resumeToken,
        minAgentMessages: 2,
      });

      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/files`);
      const internalLibraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: 'Visual Review Library' }).first();
      await expect(internalLibraryItem).toBeVisible({ timeout: 30_000 });
      await internalLibraryItem.click();
      const internalArtifactsRow = page.getByTestId('files__object-row').filter({ hasText: '.artifacts' }).first();
      await expect(internalArtifactsRow).toBeVisible({ timeout: 30_000 });
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'project-files-internal-workspace-real',
        role: 'project owner',
        notes: 'internal-k8s 任务恢复后，.artifacts 交付目录仍在 Files 页面中可见',
      });
    }

    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/usage`);
    await expect(page.getByTestId('usage__view')).toBeVisible({ timeout: 30_000 });
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'usage-limits-and-trend-real',
      role: 'project owner',
      notes: '真实 endpoint 调用后的用量卡片和趋势视图',
    });

    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/audit`);
    await expect(page.getByTestId('audit__page')).toBeVisible({ timeout: 30_000 });
    const firstAuditAction = page.locator('[data-testid^="audit__row-actions--"]').first();
    if (await firstAuditAction.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await firstAuditAction.click();
      await page.locator('[data-testid^="audit__view-details--"]').first().click();
      await expect(page.getByTestId('audit__detail-summary')).toBeVisible({ timeout: 30_000 });
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'audit-detail-drawer-real',
        role: 'project owner',
        notes: '真实审计详情抽屉',
      });
    }

    await loginToWorkspace(page, workspaceId, PROJECT_CREATOR_USERNAME, PROJECT_CREATOR_PASSWORD);
    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/members?member_tab=people`);
    await expect(page.getByTestId('members__search-input')).toBeVisible({ timeout: 30_000 });
    const firstMemberRow = page.getByTestId('members__table__row').first();
    await expect(firstMemberRow).toBeVisible({ timeout: 30_000 });
    await firstMemberRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await settlePage(page);
    await capturePage(page, captures, {
      name: 'members-effective-access-real',
      role: 'project owner',
      notes: '成员有效权限抽屉',
    });

    await flushReviewArtifacts(captures);
  });
});
