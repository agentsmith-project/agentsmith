import { WebSocket } from 'ws';
import { test, expect, type Page } from '@playwright/test';
import { readStoredAuthToken } from './integration-workspace-access';

const LOCALE = process.env.INTEGRATION_LOCALE ?? 'en-US';
const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'mbos';
const KEYCLOAK_WORKSPACE_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';
const REAL_LANE_ANTHROPIC_BASE_URL = process.env.REAL_LANE_ANTHROPIC_BASE_URL ?? 'https://api.minimaxi.com/anthropic/v1';
const REAL_LANE_MODEL = process.env.REAL_LANE_MODEL ?? 'MiniMax-M2.7-highspeed';
const REAL_LANE_API_KEY = process.env.REAL_LANE_API_KEY;
const DEV_ADMIN_USERNAME = process.env.INTEGRATION_DEV_ADMIN_USERNAME ?? 'dev-admin';
const DEV_ADMIN_PASSWORD = process.env.INTEGRATION_DEV_ADMIN_PASSWORD ?? 'dev-admin-123';
const PROJECT_CREATOR_USERNAME = process.env.INTEGRATION_USER_USERNAME ?? 'integration-user';
const PROJECT_CREATOR_PASSWORD = process.env.INTEGRATION_USER_PASSWORD ?? 'integration-user-123';
const MEMBER_USERNAME = process.env.INTEGRATION_MEMBER_USERNAME ?? 'integration-member';
const MEMBER_PASSWORD = process.env.INTEGRATION_MEMBER_PASSWORD ?? 'integration-member-123';
const MEMBER_EMAIL = 'integration-member@example.com';
const PROJECT_CREATOR_EMAIL = 'integration-user@example.com';
const NOTEBOOK_EXPECTED_TOKEN = `MAINLINE_REAL_NOTEBOOK_OK_${Date.now()}`;

function executionHostForExternalWorkspaceAccess(apiBase: string): string {
  const explicitMetaHost = process.env.EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE?.trim();
  if (explicitMetaHost) {
    if (explicitMetaHost === 'host.docker.internal') {
      return '127.0.0.1';
    }
    return explicitMetaHost;
  }
  const explicit = process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL?.trim();
  const source = explicit || apiBase;
  if (new URL(source).hostname === 'localhost') {
    return '127.0.0.1';
  }
  if (source.includes('host.docker.internal')) {
    return '127.0.0.1';
  }
  return new URL(source).hostname;
}

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

function requireRealLaneApiKey(): string {
  if (!REAL_LANE_API_KEY?.trim()) {
    throw new Error('missing_REAL_LANE_API_KEY');
  }
  return REAL_LANE_API_KEY.trim();
}

async function clearAppState(page: Page, _workspaceId = 'ws_default'): Promise<void> {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/login/workspace`);
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  });
}

async function gotoWithRetry(page: Page, path: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
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
  await expect(page.getByTestId('system-workspaces__heading')).toBeVisible({ timeout: 30_000 });
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
  const workspaceName = `Notebook Mainline ${Date.now()}`;

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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByTestId('system-workspaces__publish').click();
    let status = 'missing';
    await expect
      .poll(
        async () => {
          status = await page.evaluate(async (id) => {
            const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
            const payload = (await response.json()) as {
              items?: Array<{ id: string; provisioning_status: string; last_init_error?: string | null }>;
            };
            const item = payload.items?.find((candidate) => candidate.id === id);
            return item ? `${item.provisioning_status}:${item.last_init_error ?? ''}` : 'missing';
          }, workspaceId);
          return status;
        },
        { timeout: 30_000 },
      )
      .toMatch(/^(ready|failed):/);

    if (status.startsWith('ready:')) {
      break;
    }

    if (attempt === 1) {
      throw new Error(`workspace_publish_failed:${status}`);
    }
  }

  await expect(
    page.getByTestId(`system-workspaces__card--${workspaceId}`).getByTestId(`system-workspaces__open-workspace-login--${workspaceId}`),
  ).toHaveAttribute(
    'href',
    new RegExp(`/${LOCALE}/workspaces/${workspaceId}/login$`),
  );
  await expect
    .poll(
      async () => {
        return page.evaluate(async (id) => {
          const response = await fetch(`/api/public/workspaces/${id}`, { cache: 'no-store' });
          return response.ok ? 'ready' : `status:${response.status}`;
        }, workspaceId);
      },
      { timeout: 30_000 },
    )
    .toBe('ready');
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

async function createProject(page: Page, workspaceId: string): Promise<{ projectId: string; projectName: string }> {
  const projectName = `Notebook Delivery ${Date.now()}`;
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects`);
  await expect(page.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('projects__create-btn').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator('#project-name').fill(projectName);

  const selects = dialog.locator('[role="combobox"]');
  await selects.nth(0).click();
  await page.getByRole('option', { name: /public/i }).click();

  await dialog.getByRole('button', { name: /create|创建/i }).click();
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/.+/overview`), { timeout: 30_000 });

  const match = page.url().match(/\/projects\/([^/]+)\//);
  if (!match?.[1]) {
    throw new Error('project_id_not_found_after_create');
  }
  return { projectId: match[1], projectName };
}

async function requestProjectAccess(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects`);
  const requestButton = page.getByTestId(`projects__join-request-btn--${projectId}`);
  await expect(requestButton).toBeVisible({ timeout: 30_000 });
  await requestButton.click();
  await expect
    .poll(async () => await requestButton.textContent(), { timeout: 5_000 })
    .toMatch(/pending|request access/i);
}

async function approveJoinRequest(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/members?member_tab=requests`);
  await expect(page.getByRole('tab', { name: /join requests/i })).toBeVisible({ timeout: 30_000 });
  const requestCard = page.locator('div').filter({ hasText: /integration-member/i }).first();
  await expect(requestCard).toBeVisible({ timeout: 30_000 });
  await requestCard.getByRole('button', { name: /^approve$/i }).click();
  await expect(requestCard.getByText(/^approved$/i)).toBeVisible({ timeout: 30_000 });
}

async function promoteJoinedMemberToProjectAdmin(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/settings`);
  await expect(page.getByTestId('settings__project-admins-section')).toBeVisible({ timeout: 30_000 });

  const option = page.locator('[data-testid^="settings__project-admin-option--"]').filter({
    hasText: /integration-member|Joined Member|integration-member@example.com/i,
  }).first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await page.getByTestId('settings__project-admins-save').click();
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

async function createFileLibrary(page: Page, workspaceId: string, projectId: string): Promise<string> {
  const libraryName = `Mainline Notebook Workspace ${Date.now()}`;
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/files`);
  await expect(page.getByTestId('files__library-create')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('files__library-create').click();

  const dialog = page.getByTestId('files__dialog__library-create');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByTestId('files__library-create__name').fill(libraryName);
  await dialog.getByTestId('files__library-create__submit').click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: libraryName }).first();
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  return libraryName;
}

async function createEndpoint(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/endpoints`);
  await expect(page.getByTestId('endpoints__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('endpoints__create-btn').click();

  const dialog = page.getByTestId('endpoints__create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /use guided setup/i }).click();

  const wizard = page.getByTestId('endpoints__custom-wizard');
  await expect(wizard).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-name-input').fill('BigModel Anthropic Endpoint');
  await wizard.getByTestId('protocol-anthropic_compatible').click();
  await wizard.getByTestId('wizard-base-url-input').fill(REAL_LANE_ANTHROPIC_BASE_URL);
  await wizard.getByRole('button', { name: /next|下一步/i }).click();
  await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-model-id-input').fill(REAL_LANE_MODEL);
  await wizard.getByRole('button', { name: /next|下一步/i }).click();
  await expect(wizard.getByTestId('wizard-check-button')).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-check-button').click();
  await expect(wizard.getByTestId('wizard-create-button')).toBeEnabled({ timeout: 30_000 });
  await wizard.getByTestId('wizard-create-button').click();
  await expect(wizard).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('BigModel Anthropic Endpoint')).toBeVisible({ timeout: 30_000 });
}

async function createAgent(page: Page, workspaceId: string, projectId: string): Promise<string> {
  const agentName = `Notebook Bridge Agent ${Date.now()}`;
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
  const response = await page.request.get(
    `${apiBase}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { items?: Array<{ id: string; name: string }> };
  const agentId = body.items?.find((item) => item.name === agentName)?.id;
  if (!agentId) {
    throw new Error('agent_id_not_found');
  }
  return agentId;
}

async function createAgentKeyAndConnectionInfo(
  page: Page,
  apiBase: string,
  workspaceId: string,
  projectId: string,
  agentId: string,
  token: string,
): Promise<{ agentKey: string; wsUrl: string }> {
  const createKeyResponse = await page.request.post(
    `${apiBase}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}/keys`,
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {},
    },
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
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const maybeAnthropicContent = (payload as { content?: unknown }).content;
  if (Array.isArray(maybeAnthropicContent)) {
    return maybeAnthropicContent
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }
        const typedPart = part as { type?: unknown; text?: unknown };
        return typedPart.type === 'text' ? String(typedPart.text ?? '') : '';
      })
      .join('');
  }
  const maybeChoices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = maybeChoices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
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
}): {
  ready: Promise<void>;
  observedReply: Promise<string>;
  stop: () => Promise<void>;
} {
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

  const ws = new WebSocket(args.wsUrl, {
    headers: { Authorization: `Bearer ${args.agentKey}` },
  });

  ws.once('error', (error) => {
    if (!helloResolved) {
      helloReject(error);
    }
    observedReject(error);
  });

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'agent.ready',
      timestamp: new Date().toISOString(),
      payload: {
        capabilities: {
          streaming_completion: true,
          multimodal_completion: false,
        },
      },
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

    if (msg.type !== 'server.request.start' || !msg.request_id) {
      return;
    }

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
            payload: {
              error_code: 'AGENT_UPSTREAM_ERROR',
              error_message: errorText || 'upstream_request_failed',
            },
          }));
          observedReject(
            new Error(
              `upstream_request_failed:${upstreamResponse.status}:${errorText || 'empty_response'}`,
            ),
          );
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
          payload: {
            error_code: 'AGENT_BRIDGE_ERROR',
            error_message: error instanceof Error ? error.message : 'bridge_failed',
          },
        }));
        observedReject(error);
      }
    })();
  });

  return {
    ready,
    observedReply,
    stop: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        ws.once('close', () => resolve());
        ws.close();
      }),
  };
}

async function waitForAgentPresenceOnline(
  page: Page,
  apiBase: string,
  workspaceId: string,
  projectId: string,
  agentId: string,
  token: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${apiBase}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok()) {
          return null;
        }
        const body = (await response.json()) as { presence?: string };
        return body.presence ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe('online');
}

async function runNotebookTask(
  page: Page,
  apiBase: string,
  workspaceId: string,
  projectId: string,
  agentName: string,
  workspaceLibraryName: string,
  token: string,
  expectedToken: string,
): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/notebook`);
  await expect(page.getByTestId('notebook__create-task-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('notebook__create-task-btn').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#task-title').fill('Mainline Real Notebook Task');
  await dialog.locator('#task-agent').click();
  await page.getByRole('option', { name: new RegExp(agentName) }).click();
  await dialog.getByRole('radio', { name: /continue an existing workspace/i }).click();
  await dialog.getByTestId('task-create__file-library').click();
  await page.getByRole('option', { name: new RegExp(workspaceLibraryName) }).click();
  await dialog.getByRole('button', { name: /create/i }).click();

  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/notebook/tasks/.+`), {
    timeout: 30_000,
  });
  const taskId = page.url().match(/\/tasks\/([^/?#]+)/)?.[1];
  if (!taskId) {
    throw new Error('task_id_not_found_after_create');
  }
  const workspaceAccessResponse = await page.request.post(
    `${apiBase}/api/v1/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/workspace-access`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(workspaceAccessResponse.ok()).toBeTruthy();
  const workspaceAccess = (await workspaceAccessResponse.json()) as {
    metadata_url: string;
    storage_bucket_url?: string;
  };
  const expectedHost = executionHostForExternalWorkspaceAccess(apiBase);
  expect(new URL(workspaceAccess.metadata_url).hostname).toBe(expectedHost);
  if (workspaceAccess.storage_bucket_url) {
    expect(new URL(workspaceAccess.storage_bucket_url).hostname).toBe(expectedHost);
  }
  await expect(page.getByTestId('notebook__conversation-input')).toBeVisible({ timeout: 30_000 });

  const input = page.getByTestId('notebook__conversation-input').locator('textarea').first();
  await input.fill(`Reply with the exact token ${expectedToken} and nothing else.`);
  await page.getByTestId('notebook__send-btn').click();
  await expect(page.getByText(expectedToken)).toBeVisible({ timeout: 120_000 });
}

test.describe('@lane-real integration system-to-notebook mainline', () => {
  test('completes fresh workspace setup to real notebook work', async ({ page }) => {
    test.setTimeout(600_000);
    const glmApiKey = requireRealLaneApiKey();
    const apiBase = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';
    const pageErrors: string[] = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAsSystemAdmin(page);
    const workspaceId = await createAndPublishWorkspace(page);

    await loginToWorkspace(page, workspaceId, DEV_ADMIN_USERNAME, DEV_ADMIN_PASSWORD);
    await saveWorkspaceProjectCreators(page, workspaceId);

    await loginToWorkspace(page, workspaceId, PROJECT_CREATOR_USERNAME, PROJECT_CREATOR_PASSWORD);
    const { projectId } = await createProject(page, workspaceId);

    await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
    await requestProjectAccess(page, workspaceId, projectId);

    await loginToWorkspace(page, workspaceId, PROJECT_CREATOR_USERNAME, PROJECT_CREATOR_PASSWORD);
    await approveJoinRequest(page, workspaceId, projectId);
    await promoteJoinedMemberToProjectAdmin(page, workspaceId, projectId);

    await loginToWorkspace(page, workspaceId, PROJECT_CREATOR_USERNAME, PROJECT_CREATOR_PASSWORD);
    await createCredential(page, workspaceId, projectId, glmApiKey);
    await createEndpoint(page, workspaceId, projectId);
    const workspaceLibraryName = await createFileLibrary(page, workspaceId, projectId);
    const agentName = await createAgent(page, workspaceId, projectId);

    const token = await readStoredAuthToken(page);
    const agentId = await resolveAgentId(page, apiBase, workspaceId, projectId, token, agentName);
    const { agentKey, wsUrl } = await createAgentKeyAndConnectionInfo(page, apiBase, workspaceId, projectId, agentId, token);

    const bridge = startExternalNotebookBridge({
      wsUrl,
      agentKey,
      expectedToken: NOTEBOOK_EXPECTED_TOKEN,
      model: REAL_LANE_MODEL,
    });

    try {
      await bridge.ready;
      await waitForAgentPresenceOnline(page, apiBase, workspaceId, projectId, agentId, token);
      await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
      await runNotebookTask(
        page,
        apiBase,
        workspaceId,
        projectId,
        agentName,
        workspaceLibraryName,
        token,
        NOTEBOOK_EXPECTED_TOKEN,
      );
      const observedReply = await bridge.observedReply;
      expect(observedReply).toContain(NOTEBOOK_EXPECTED_TOKEN);
    } finally {
      await bridge.stop();
    }

    expect(pageErrors).toEqual([]);
  });
});
