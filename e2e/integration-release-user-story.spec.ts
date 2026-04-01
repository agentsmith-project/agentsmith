import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  createCredentialViaUi,
  createProjectInWorkspace,
  startCodexRunnerDockerProcess,
  waitForAgentPresenceOnline,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';

const LOCALE = process.env.INTEGRATION_LOCALE ?? 'en-US';
const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'mbos';
const KEYCLOAK_WORKSPACE_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';
const ANTHROPIC_BASE_URL = process.env.BACKEND_REAL_ANTHROPIC_BASE_URL ?? 'https://anthropic-compatible.provider.example/v1';
const OPENAI_BASE_URL = process.env.BACKEND_REAL_OPENAI_BASE_URL ?? 'https://openai-compatible.provider.example/v1';
const BACKEND_REAL_MODEL = process.env.BACKEND_REAL_MODEL ?? 'placeholder-model';
const BACKEND_REAL_API_KEY = process.env.BACKEND_REAL_API_KEY;
const SYSTEM_ADMIN_USERNAME = 'mbos-admin';
const SYSTEM_ADMIN_PASSWORD = 'mbos-admin';
const MEMBER_USERNAME = process.env.INTEGRATION_USER_USERNAME ?? 'integration-user';
const MEMBER_PASSWORD = process.env.INTEGRATION_USER_PASSWORD ?? 'integration-user-123';
const MEMBER_EMAIL = 'integration-user@example.com';
const INTERNAL_AGENT_IMAGE =
  process.env.INTEGRATION_INTERNAL_AGENT_IMAGE?.trim() ||
  process.env.INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE?.trim() ||
  'agentsmith-codex-runner:local';
const DEMO_DEPLOY_MODE = process.env.INTEGRATION_DEMO_DEPLOY_MODE?.trim() || 'full';
const DEMO_MODE_IS_FULL = DEMO_DEPLOY_MODE === 'full';
const CREATE_NEW_TASK_RESPONSE_TIMEOUT_MS = 60_000;

function requireRealLaneApiKey(): string {
  const value = BACKEND_REAL_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return value;
}

async function gotoWithRetry(page: Page, pathName: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(pathName, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete');
      if (page.url() === 'about:blank') throw new Error('blank_navigation');
      const bodyText = await page.locator('body').textContent().catch(() => '');
      if ((bodyText ?? '').trim().length === 0) throw new Error('empty_document');
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

async function clearSystemAppState(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/system/login`);
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  });
}

async function clearWorkspaceAppState(page: Page, workspaceId: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function loginAsSystemAdmin(page: Page): Promise<void> {
  await clearSystemAppState(page);
  await gotoWithRetry(page, `/${LOCALE}/system/login`);
  await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-login__username').fill(SYSTEM_ADMIN_USERNAME);
  await page.getByTestId('system-login__password').fill(SYSTEM_ADMIN_PASSWORD);
  let loginResponseOk = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page
      .waitForResponse(
        (response) => response.url().includes('/api/system/session') && response.request().method() === 'POST',
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
  await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(new RegExp(`/${LOCALE}/system/workspaces`));
  await expect(page.getByTestId('system-workspaces__heading')).toBeVisible({ timeout: 30_000 });
}

async function loginToWorkspace(page: Page, workspaceId: string, username: string, password: string): Promise<void> {
  await clearWorkspaceAppState(page, workspaceId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`/${LOCALE}/workspaces/${workspaceId}/login`);
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

    if (reachedWorkspace) return;
    if (callbackError && attempt < 2) {
      await clearWorkspaceAppState(page, workspaceId);
      continue;
    }
    throw new Error(`workspace_login_failed:${workspaceId}:${username}`);
  }

  throw new Error(`workspace_login_retry_exhausted:${workspaceId}:${username}`);
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

async function waitForWorkspaceId(page: Page, workspaceName: string): Promise<string> {
  await expect
    .poll(
      async () => page.evaluate(async (name) => {
        const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
        const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
        return payload.items?.find((item) => item.name === name)?.id ?? null;
      }, workspaceName),
      { timeout: 30_000 },
    )
    .toBeTruthy();

  const resolved = await page.evaluate(async (name) => {
    const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
    const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
    return payload.items?.find((item) => item.name === name)?.id ?? null;
  }, workspaceName);

  if (!resolved) throw new Error('workspace_id_not_found');
  return resolved;
}

async function createAndPublishWorkspace(page: Page): Promise<string> {
  const workspaceName = `Release Story ${Date.now()}`;
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
  await expect
    .poll(
      async () => page.evaluate(async (id) => {
        const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
        const payload = (await response.json()) as {
          items?: Array<{ id: string; provisioning_status: string; last_init_error?: string | null }>;
        };
        const item = payload.items?.find((candidate) => candidate.id === id);
        return item ? `${item.provisioning_status}:${item.last_init_error ?? ''}` : 'missing';
      }, workspaceId),
      { timeout: 60_000 },
    )
    .toMatch(/^ready:/);
  return workspaceId;
}

async function saveWorkspaceProjectCreators(page: Page, workspaceId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/settings`);
  await expect(page.getByTestId('ws-settings__project-creators')).toBeVisible({ timeout: 30_000 });
  const searchInput = page.getByTestId('ws-settings__project-creators-input');
  await searchInput.fill(MEMBER_EMAIL);
  const creatorOption = page.getByTestId('ws-settings__project-creators-results').getByRole('button', {
    name: new RegExp(MEMBER_EMAIL.replace('.', '\\.')),
  });
  await expect(creatorOption).toBeVisible({ timeout: 15_000 });
  await creatorOption.click();
  await page.getByTestId('ws-settings__project-creators-save').click();
  await expect
    .poll(async () => page.getByTestId('ws-settings__project-creators-selected').textContent(), { timeout: 20_000 })
    .toContain(MEMBER_EMAIL);
}

async function requestProjectAccess(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects`);
  const requestButton = page.getByTestId(`projects__join-request-btn--${projectId}`);
  await expect(requestButton).toBeVisible({ timeout: 30_000 });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/join-requests`)
      && response.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await requestButton.click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect.poll(async () => requestButton.textContent(), { timeout: 15_000 }).toMatch(/pending/i);
}

async function approveJoinRequest(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/members?member_tab=requests`);
  const requestCard = page.locator('div').filter({ hasText: /integration-user/i }).first();
  await expect(requestCard).toBeVisible({ timeout: 30_000 });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/join-requests/`)
      && response.url().includes('/approve')
      && response.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await requestCard.getByRole('button', { name: /^approve$/i }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect(requestCard.getByText(/^approved$/i)).toBeVisible({ timeout: 30_000 });
}

async function createEndpointViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  name: string;
  upstreamProtocol: 'anthropic_messages' | 'openai_chat_completions' | 'openai_responses';
  baseUrl: string;
  model: string;
}): Promise<void> {
  const { page, workspaceId, projectId, name, upstreamProtocol, baseUrl, model } = args;
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/endpoints`);
  await expect(page.getByTestId('endpoints__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('endpoints__create-btn').click();

  const dialog = page.getByTestId('endpoints__create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /use guided setup/i }).click();

  const wizard = page.getByTestId('endpoints__custom-wizard');
  await expect(wizard).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-name-input').fill(name);
  await wizard.getByTestId(`protocol-${upstreamProtocol}`).click();
  await wizard.getByTestId('wizard-base-url-input').fill(baseUrl);
  await wizard.getByRole('button', { name: /next|下一步/i }).click();
  await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-model-id-input').fill(model);
  await wizard.getByRole('button', { name: /next|下一步/i }).click();
  await expect(wizard.getByTestId('wizard-check-button')).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-check-button').click();
  await expect(wizard.getByTestId('wizard-create-button')).toBeEnabled({ timeout: 30_000 });
  await wizard.getByTestId('wizard-create-button').click();
  await expect(wizard).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
}

async function resolveEndpointId(page: Page, workspaceId: string, projectId: string, endpointName: string): Promise<string> {
  const token = await readStoredAuthToken(page);
  const response = await page.request.get(`${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints?page=1&page_size=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items?: Array<{ id: string; name: string }> };
  const endpointId = body.items?.find((item) => item.name === endpointName)?.id;
  if (!endpointId) throw new Error(`endpoint_id_not_found:${endpointName}`);
  return endpointId;
}

async function updateResourcePolicyViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  endpointId: string;
  requestsPerDay: string;
  spendingUsdPerDay: string;
}): Promise<void> {
  const { page, workspaceId, projectId, endpointId, requestsPerDay, spendingUsdPerDay } = args;
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/resource-policy`);
  await expect(page.getByTestId('resource-policy__table')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`resource-policy__row--endpoint--${endpointId}`).click();
  await expect(page.getByTestId('resource-policy__editor')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('resource-policy__endpoint-requests-per-day').fill(requestsPerDay);
  await page.getByTestId('resource-policy__endpoint-spending-usd-per-day').fill(spendingUsdPerDay);
  const saveResponse = page.waitForResponse((response) =>
    response.request().method() === 'PATCH'
    && response.url().includes(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/resources/endpoint/${endpointId}/policy`),
  );
  await page.getByTestId('resource-policy__save').click();
  const response = await saveResponse;
  expect(response.ok()).toBeTruthy();
}

async function createAgentViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  name: string;
  mode: 'external' | 'internal';
  endpointId: string;
  image?: string;
}): Promise<void> {
  const { page, workspaceId, projectId, name, mode, endpointId, image } = args;
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agents`);
  await expect(page.getByTestId('agents__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('agents__create-btn').click();
  const dialog = page.getByTestId('agents__create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#agent-name').fill(name);
  if (mode === 'internal') {
    await dialog.locator('input[name="mode"][value="internal"]').click();
    await dialog.locator('#agent-image').fill(image ?? INTERNAL_AGENT_IMAGE);
    await dialog.locator('#internal-notebook-endpoint-id').selectOption(endpointId);
  } else {
    await dialog.locator('#notebook-endpoint-id').selectOption(endpointId);
  }
  const createResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && response.url().includes(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents`),
  );
  await dialog.getByRole('button', { name: /^create$/i }).click();
  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  const createdAgent = (await response.json()) as { id: string };
  const token = await readStoredAuthToken(page);
  const visibilityResponse = await page.request.patch(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${createdAgent.id}`,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { visibility: 'public' },
    },
  );
  expect(visibilityResponse.ok()).toBeTruthy();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
}

async function resolveAgent(page: Page, workspaceId: string, projectId: string, agentName: string): Promise<{ id: string; wsUrl?: string; key?: string }> {
  const token = await readStoredAuthToken(page);
  const listResponse = await page.request.get(`${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(listResponse.ok()).toBeTruthy();
  const body = (await listResponse.json()) as { items?: Array<{ id: string; name: string }> };
  const agentId = body.items?.find((item) => item.name === agentName)?.id;
  if (!agentId) throw new Error(`agent_id_not_found:${agentName}`);

  const result: { id: string; wsUrl?: string; key?: string } = { id: agentId };
  const keyResponse = await page.request.post(`${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/keys`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {},
  });
  if (keyResponse.ok()) {
    const keyBody = (await keyResponse.json()) as { key: string };
    result.key = keyBody.key;
    const connectionResponse = await page.request.get(`${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/connection-info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(connectionResponse.ok()).toBeTruthy();
    const connectionBody = (await connectionResponse.json()) as { ws_url: string };
    result.wsUrl = connectionBody.ws_url.replace('ws://localhost:20000', API_BASE.replace('http://', 'ws://'));
  }
  return result;
}

async function openCreateTaskDialog(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/notebook`);
  await expect(page.getByTestId('notebook__create-task-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('notebook__create-task-btn').click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
}

async function createTaskViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  agentName: string;
  workspaceMode: 'create_new' | 'use_existing';
  workspaceName?: string;
  existingWorkspaceName?: string;
}): Promise<{ taskId: string; workspaceName: string }> {
  const { page, workspaceId, projectId, title, agentName, workspaceMode, workspaceName, existingWorkspaceName } = args;
  await openCreateTaskDialog(page, workspaceId, projectId);
  const dialog = page.getByRole('dialog');
  await dialog.locator('#task-title').fill(title);
  await dialog.locator('#task-agent').click();
  await page.getByRole('option', { name: new RegExp(agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  if (workspaceMode === 'use_existing') {
    await dialog.getByRole('radio', { name: /continue an existing workspace/i }).click();
    await dialog.getByTestId('task-create__file-library').click();
    await page.getByRole('option', { name: new RegExp((existingWorkspaceName ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  } else if (workspaceName) {
    await dialog.locator('#task-workspace-name').fill(workspaceName);
  }
  const createButton = dialog.locator('button[type="submit"]');
  await expect(createButton).toBeEnabled({ timeout: 10_000 });
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks`)
      && response.request().method() === 'POST',
    { timeout: workspaceMode === 'create_new' ? CREATE_NEW_TASK_RESPONSE_TIMEOUT_MS : 15_000 },
  );
  await createButton.click();
  const createResponse = await createResponsePromise;
  if (!createResponse.ok()) {
    const body = await createResponse.text().catch(() => '');
    throw new Error(`task_create_failed:${createResponse.status}:${body}`);
  }
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/notebook/tasks/.+`), {
    timeout: 30_000,
  });
  await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });
  const taskId = page.url().match(/\/tasks\/([^/?#]+)/)?.[1];
  if (!taskId) throw new Error('task_id_not_found_after_create');
  const workspaceBadge = await page.getByTestId('notebook__task-header-workspace-library').textContent();
  const resolvedWorkspaceName = workspaceBadge?.split(':').slice(1).join(':').trim();
  if (!resolvedWorkspaceName) throw new Error('task_workspace_name_not_found');
  return { taskId, workspaceName: resolvedWorkspaceName };
}

async function sendNotebookMessage(page: Page, content: string): Promise<void> {
  const input = page.getByTestId('notebook__conversation-input').locator('textarea').first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(content);
  await page.getByTestId('notebook__send-btn').click();
}

async function waitForAgentReply(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  expectedToken: string;
  minAgentMessages: number;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  await expect.poll(async () => {
    const response = await args.page.request.get(`${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok()) return false;
    const messages = (await response.json()) as Array<{ role?: string; content?: string }>;
    const agentMessages = messages.filter((item) => item.role === 'agent');
    if (agentMessages.length < args.minAgentMessages) return false;
    return agentMessages.some((item) => item.content?.includes(args.expectedToken));
  }, { timeout: 300_000, intervals: [1_000, 2_000, 5_000] }).toBe(true);
}

async function deleteCurrentTaskViaUi(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await page.getByRole('button', { name: /delete task|^delete$/i }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: /delete task|^delete$/i }).click();
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/notebook$`), { timeout: 30_000 });
}

async function openWorkspaceFilesRoot(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  workspaceName: string;
}): Promise<void> {
  await gotoWithRetry(args.page, `/${LOCALE}/workspaces/${args.workspaceId}/projects/${args.projectId}/files`);
  const libraryItem = args.page.locator('[data-testid^="files__library-item--"]').filter({ hasText: args.workspaceName }).first();
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  await libraryItem.click();
  await expect(args.page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
}

async function openFolderByName(page: Page, name: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visibleDialog = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last();
    if (!(await visibleDialog.isVisible().catch(() => false))) {
      break;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  const folderRow = page.getByTestId('files__object-row').filter({ hasText: name }).first();
  await expect(folderRow).toBeVisible({ timeout: 30_000 });
  const button = folderRow.getByRole('button').first();
  if (await button.isVisible().catch(() => false)) {
    await button.dblclick();
    return;
  }
  await folderRow.dblclick();
}

async function waitForTaskArtifacts(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  expectedPath: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  await expect.poll(async () => {
    const response = await args.page.request.get(`${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/artifacts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok()) return false;
    const payload = (await response.json()) as Array<{ task_relative_path?: string }>;
    return payload.some((item) => item.task_relative_path === args.expectedPath);
  }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toBe(true);
}

function externalExecutionHost(): string {
  const dockerManualHost = process.env.DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE?.trim();
  if (dockerManualHost) {
    return dockerManualHost;
  }
  if (process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL?.includes('host.docker.internal')) {
    return 'host.docker.internal';
  }
  const explicitMetaHost = process.env.EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE?.trim();
  if (explicitMetaHost) {
    return explicitMetaHost;
  }
  const source = process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL?.trim() || API_BASE;
  return new URL(source).hostname;
}

async function expectExternalTaskWorkspaceAccessReachable(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/workspace-access`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(response.ok()).toBeTruthy();
  const workspaceAccess = (await response.json()) as {
    metadata_url: string;
    storage_bucket_url?: string;
  };
  const expectedHost = externalExecutionHost();
  expect(new URL(workspaceAccess.metadata_url).hostname).toBe(expectedHost);
  if (workspaceAccess.storage_bucket_url) {
    expect(new URL(workspaceAccess.storage_bucket_url).hostname).toBe(expectedHost);
  }
}

async function waitForUsageFacts(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  endpointIds: string[];
}): Promise<Array<{ resource_id?: string; requests?: number; tokens_total?: number }>> {
  const token = await readStoredAuthToken(args.page);
  const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await args.page.request.get(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/usage/facts?start_time=${encodeURIComponent(
        startTime,
      )}&end_time=${encodeURIComponent(endTime)}&page=1&page_size=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok()) {
      await args.page.waitForTimeout(2_000);
      continue;
    }
    const payload = (await response.json()) as { items?: Array<{ resource_id?: string; requests?: number; tokens_total?: number }> };
    const items = payload.items ?? [];
    const touchedEndpoints = new Set(items.map((item) => item.resource_id).filter(Boolean));
    if (args.endpointIds.every((id) => touchedEndpoints.has(id)) && items.length >= 2) {
      return items;
    }
    await args.page.waitForTimeout(2_000);
  }
  throw new Error('usage_facts_not_ready');
}

async function expectUsageTabToShowRequests(args: {
  page: Page;
  endpointId: string;
  endpointName: string;
}): Promise<void> {
  const { page, endpointId, endpointName } = args;
  await page.getByTestId(`usage__resource-tab-${endpointId}`).click();
  await expect(page.getByTestId('usage__selected-endpoint')).toHaveText(endpointName, { timeout: 30_000 });
  const firstCard = page.getByTestId('usage__progress-card').first();
  await expect(firstCard).toContainText(/requests/i, { timeout: 30_000 });
  const valueText = ((await firstCard.locator('p').nth(1).textContent()) ?? '').replace(/,/g, '').trim();
  const used = Number.parseInt(valueText, 10);
  expect(Number.isFinite(used)).toBe(true);
  expect(used).toBeGreaterThan(0);
}

test.describe('@lane-real release user story end-to-end', () => {
  test('rebuilds the system and runs the full user story with dual preset endpoints', async ({ page }) => {
    test.setTimeout(1_200_000);
    const providerApiKey = requireRealLaneApiKey();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAsSystemAdmin(page);
    const workspaceId = await createAndPublishWorkspace(page);

    await loginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    const { projectId, projectName } = await createProjectInWorkspace(page, workspaceId, 'Release Story Project', {
      visibility: 'public',
      joinPolicy: 'approval_required',
    });

    await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
    await requestProjectAccess(page, workspaceId, projectId);

    await loginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
    await approveJoinRequest(page, workspaceId, projectId);

    await createCredentialViaUi(page, workspaceId, projectId, 'Provider Unified Key', providerApiKey);
    const anthropicEndpointName = `Preset Anthropic Endpoint ${Date.now()}`;
    const openaiEndpointName = `Preset OpenAI Endpoint ${Date.now()}`;
    await createEndpointViaUi({
      page,
      workspaceId,
      projectId,
      name: anthropicEndpointName,
      upstreamProtocol: 'anthropic_messages',
      baseUrl: ANTHROPIC_BASE_URL,
      model: BACKEND_REAL_MODEL,
    });
    await createEndpointViaUi({
      page,
      workspaceId,
      projectId,
      name: openaiEndpointName,
      upstreamProtocol: 'openai_chat_completions',
      baseUrl: OPENAI_BASE_URL,
      model: BACKEND_REAL_MODEL,
    });

    const primaryEndpointId = await resolveEndpointId(page, workspaceId, projectId, anthropicEndpointName);
    const secondaryEndpointId = await resolveEndpointId(page, workspaceId, projectId, openaiEndpointName);

    await updateResourcePolicyViaUi({
      page,
      workspaceId,
      projectId,
      endpointId: primaryEndpointId,
      requestsPerDay: '1000',
      spendingUsdPerDay: '500',
    });
    await updateResourcePolicyViaUi({
      page,
      workspaceId,
      projectId,
      endpointId: secondaryEndpointId,
      requestsPerDay: '1000',
      spendingUsdPerDay: '500',
    });

    const externalAgentName = `External Story Agent ${Date.now()}`;
    const internalAgentName = `Internal Story Agent ${Date.now()}`;
    await createAgentViaUi({
      page,
      workspaceId,
      projectId,
      name: externalAgentName,
      mode: 'external',
      endpointId: primaryEndpointId,
    });
    if (DEMO_MODE_IS_FULL) {
      await createAgentViaUi({
        page,
        workspaceId,
        projectId,
        name: internalAgentName,
        mode: 'internal',
        endpointId: secondaryEndpointId,
        image: INTERNAL_AGENT_IMAGE,
      });
    }

    const externalAgent = await resolveAgent(page, workspaceId, projectId, externalAgentName);
    if (!externalAgent.wsUrl || !externalAgent.key) {
      throw new Error('external_agent_connection_info_missing');
    }
    const externalRunner = await startCodexRunnerDockerProcess({
      wsUrl: externalAgent.wsUrl,
      agentKey: externalAgent.key,
    });

    try {
      await waitForAgentPresenceOnline(page, workspaceId, projectId, externalAgent.id);
      await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);

      const externalTaskOne = await createTaskViaUi({
        page,
        workspaceId,
        projectId,
        title: `External Task A ${Date.now()}`,
        agentName: externalAgentName,
        workspaceMode: 'create_new',
        workspaceName: `External Workspace ${Date.now()}`,
      });
      await expectExternalTaskWorkspaceAccessReachable({
        page,
        workspaceId,
        projectId,
        taskId: externalTaskOne.taskId,
      });
      await sendNotebookMessage(page, 'Create notes/external_story.txt with exactly one line: external turn 1. Then reply with exactly EXT_T1_OK.');
      await waitForAgentReply({
        page,
        workspaceId,
        projectId,
        taskId: externalTaskOne.taskId,
        expectedToken: 'EXT_T1_OK',
        minAgentMessages: 1,
      });
      await sendNotebookMessage(page, 'Read notes/external_story.txt, append a second line external turn 2, create .artifacts/external_summary.md summarizing the file, then reply with exactly EXT_T2_OK.');
      await waitForAgentReply({
        page,
        workspaceId,
        projectId,
        taskId: externalTaskOne.taskId,
        expectedToken: 'EXT_T2_OK',
        minAgentMessages: 2,
      });
      await waitForTaskArtifacts({
        page,
        workspaceId,
        projectId,
        taskId: externalTaskOne.taskId,
        expectedPath: '.artifacts/external_summary.md',
      });
      await openWorkspaceFilesRoot({
        page,
        workspaceId,
        projectId,
        workspaceName: externalTaskOne.workspaceName,
      });
      await openFolderByName(page, '.artifacts');
      await expect(page.getByText('external_summary.md')).toBeVisible({ timeout: 30_000 });

      await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/notebook/tasks/${externalTaskOne.taskId}`);
      await expect(page.getByTestId('notebook__task-header')).toBeVisible({ timeout: 30_000 });

      await deleteCurrentTaskViaUi(page, workspaceId, projectId);

      const externalTaskTwo = await createTaskViaUi({
        page,
        workspaceId,
        projectId,
        title: `External Task B ${Date.now()}`,
        agentName: externalAgentName,
        workspaceMode: 'use_existing',
        existingWorkspaceName: externalTaskOne.workspaceName,
      });
      await expectExternalTaskWorkspaceAccessReachable({
        page,
        workspaceId,
        projectId,
        taskId: externalTaskTwo.taskId,
      });
      expect(externalTaskTwo.workspaceName).toBe(externalTaskOne.workspaceName);
      await sendNotebookMessage(page, 'Read notes/external_story.txt and reply with exactly EXT_REUSE_T1_OK if it still contains both lines.');
      await waitForAgentReply({
        page,
        workspaceId,
        projectId,
        taskId: externalTaskTwo.taskId,
        expectedToken: 'EXT_REUSE_T1_OK',
        minAgentMessages: 1,
      });
      await sendNotebookMessage(page, 'Create .artifacts/external_reuse.md that says the reused workspace is intact, then reply with exactly EXT_REUSE_T2_OK.');
      await waitForAgentReply({
        page,
        workspaceId,
        projectId,
        taskId: externalTaskTwo.taskId,
        expectedToken: 'EXT_REUSE_T2_OK',
        minAgentMessages: 2,
      });
      await waitForTaskArtifacts({
        page,
        workspaceId,
        projectId,
        taskId: externalTaskTwo.taskId,
        expectedPath: '.artifacts/external_reuse.md',
      });

      if (DEMO_MODE_IS_FULL) {
        const internalTask = await createTaskViaUi({
          page,
          workspaceId,
          projectId,
          title: `Internal Task ${Date.now()}`,
          agentName: internalAgentName,
          workspaceMode: 'create_new',
          workspaceName: `Internal Workspace ${Date.now()}`,
        });
        await sendNotebookMessage(
          page,
          [
            'Run the following shell command exactly, then reply with exactly INT_T1_OK.',
            '```bash',
            "mkdir -p notes && cat <<'EOF' > notes/internal_story.txt",
            'internal turn 1',
            'EOF',
            '```',
          ].join(' '),
        );
        await waitForAgentReply({
          page,
          workspaceId,
          projectId,
          taskId: internalTask.taskId,
          expectedToken: 'INT_T1_OK',
          minAgentMessages: 1,
        });
        await sendNotebookMessage(
          page,
          [
            'Run the following shell commands exactly, then reply with exactly INT_T2_OK.',
            '```bash',
            "if [ ! -f notes/internal_story.txt ]; then echo 'missing-internal-story' >&2; exit 1; fi",
            "printf '\\ninternal turn 2\\n' >> notes/internal_story.txt",
            'mkdir -p .artifacts',
            "cat <<'EOF' > .artifacts/internal_summary.md",
            '# Internal Story Summary',
            'internal turn 1',
            'internal turn 2',
            'EOF',
            '```',
          ].join(' '),
        );
        await waitForAgentReply({
          page,
          workspaceId,
          projectId,
          taskId: internalTask.taskId,
          expectedToken: 'INT_T2_OK',
          minAgentMessages: 2,
        });
        await waitForTaskArtifacts({
          page,
          workspaceId,
          projectId,
          taskId: internalTask.taskId,
          expectedPath: '.artifacts/internal_summary.md',
        });
        await openWorkspaceFilesRoot({
          page,
          workspaceId,
          projectId,
          workspaceName: internalTask.workspaceName,
        });
        await openFolderByName(page, '.artifacts');
        await expect(page.getByText('internal_summary.md')).toBeVisible({ timeout: 30_000 });

        await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
      }

      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/usage`);
      await expect(page.getByTestId('usage__view')).toBeVisible({ timeout: 30_000 });
      const expectedUsageEndpointIds = DEMO_MODE_IS_FULL
        ? [primaryEndpointId, secondaryEndpointId]
        : [primaryEndpointId];
      await waitForUsageFacts({
        page,
        workspaceId,
        projectId,
        endpointIds: expectedUsageEndpointIds,
      });
      await expect(page.getByRole('button', { name: anthropicEndpointName })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: openaiEndpointName })).toBeVisible({ timeout: 30_000 });
      await expectUsageTabToShowRequests({
        page,
        endpointId: primaryEndpointId,
        endpointName: anthropicEndpointName,
      });
      if (DEMO_MODE_IS_FULL) {
        await expectUsageTabToShowRequests({
          page,
          endpointId: secondaryEndpointId,
          endpointName: openaiEndpointName,
        });
      }
      expect(pageErrors).toEqual([]);
      expect(projectName).toContain('Release Story Project');
    } finally {
      await externalRunner.stop();
    }
  });
});
